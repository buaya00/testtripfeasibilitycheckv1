import { scrapeOfficialSources } from '../_shared/firecrawl-scrape.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { icao, aircraftType, arrivalDate, arrivalTime, departureDate, departureTime } = await req.json();

    if (!icao || typeof icao !== 'string' || !/^[A-Z]{4}$/.test(icao)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Valid 4-letter ICAO code required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    const perplexityApiKey = Deno.env.get('PERPLEXITY_API_KEY');

    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'AI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // ── Resolve airport name ──────────────────────────────────────────
    const AIRPORT_NAME_OVERRIDES: Record<string, string> = {
      'KOPF': 'Miami-Opa Locka Executive Airport',
    };
    let resolvedAirportName = AIRPORT_NAME_OVERRIDES[icao] || '';
    try {
      const apRes = await fetch('https://davidmegginson.github.io/ourairports-data/airports.csv');
      if (apRes.ok) {
        const csv = await apRes.text();
        const lines = csv.split('\n');
        const hdr = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
        const iIdent = hdr.indexOf('ident');
        const iName = hdr.indexOf('name');
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.replace(/"/g, '').trim());
          if (cols[iIdent] === icao) { resolvedAirportName = cols[iName] || ''; break; }
        }
      }
    } catch (e) { console.warn('Airport name lookup failed:', e); }

    const icaoPrefix = icao.substring(0, 2);

    // Calculate parking duration if dates provided
    let parkingInfo = '';
    if (arrivalDate && departureDate) {
      const arr = new Date(arrivalDate);
      const dep = new Date(departureDate);
      if (arrivalTime) { const [h, m] = arrivalTime.split(':').map(Number); arr.setUTCHours(h, m); }
      if (departureTime) { const [h, m] = departureTime.split(':').map(Number); dep.setUTCHours(h, m); }
      const diffMs = dep.getTime() - arr.getTime();
      const diffHours = Math.max(0, diffMs / (1000 * 60 * 60));
      const diffDays = Math.ceil(diffHours / 24);
      parkingInfo = `\nParking duration: approximately ${diffHours.toFixed(1)} hours (${diffDays} day${diffDays !== 1 ? 's' : ''}).`;
    }

    let scheduleInfo = '';
    if (arrivalTime) scheduleInfo += `\nArrival time (UTC): ${arrivalTime}`;
    if (departureTime) scheduleInfo += `\nDeparture time (UTC): ${departureTime}`;

    // ── Step 1: Perplexity grounding with official airport charge schedules ───
    let perplexityContext = '';
    if (perplexityApiKey) {
      try {
        const perpResponse = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${perplexityApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'sonar-pro',
            messages: [
              {
                role: 'system',
                content: 'You are an aviation cost analyst. Search for official published landing and parking fees from airport authority websites, AIP AD 2 sections, and official airport charge schedules. Prioritize official published tariffs over estimates.',
              },
              {
                role: 'user',
                content: `Find the official published landing and parking fees for airport ICAO "${icao}"${resolvedAirportName ? ` (${resolvedAirportName})` : ''}${aircraftType ? ` for a ${aircraftType}` : ' for a mid-size business jet'}. Look for the airport authority or AIP official charge schedule. Include landing fee, parking fee per day, any passenger fees, and surcharges (night, noise, weekend).`,
              },
            ],
            search_domain_filter: [
              'ead.eurocontrol.int',
              'faa.gov',
              'airportguide.com',
              'anna.aero',
              'eurocontrol.int',
              'iata.org',
              'airport-data.com',
            ],
            search_recency_filter: 'year',
            max_tokens: 600,
          }),
        });
        if (perpResponse.ok) {
          const perpData = await perpResponse.json();
          perplexityContext = perpData.choices?.[0]?.message?.content || '';
          console.log(`Perplexity charges context: ${perplexityContext.length} chars`);
        } else {
          console.warn('Perplexity charges lookup failed:', perpResponse.status);
        }
      } catch (e) {
        console.warn('Perplexity charges lookup error (non-fatal):', e);
      }
    }

    const prompt = `Estimate the airport landing and parking charges for airport ICAO "${icao}" (prefix "${icaoPrefix}") for the aircraft type "${aircraftType || 'mid-size business jet (~15,000 kg MTOW)'}".
${parkingInfo}${scheduleInfo}

${perplexityContext ? `## Official published charge schedule research (use as primary source):\n${perplexityContext}\n\n---\n` : ''}
Provide realistic estimates in USD based on:
- Published airport authority fee schedules where known
- Regional averages for similar airports in the same country
- Aircraft MTOW category appropriate for the specified type
- Typical GA/business aviation rates (not airline rates)
${parkingInfo ? '- Calculate total parking cost based on the actual parking duration provided' : '- Parking fee per day or per 24-hour period'}

Include:
- Landing fee (per landing/movement)
- Parking fee${parkingInfo ? ' for the actual duration' : ' (per day or per 24-hour period)'}
- Any terminal/passenger fees if applicable
- Any known surcharges (noise, night operations, weekend/holiday) — check if arrival/departure times fall in surcharge windows
- Currency context (if originally in local currency, show both)

Be specific about what MTOW assumption you're using for the calculation.`;

    const requestBody = JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: 'You are an aviation cost analyst specializing in airport charges. Provide realistic fee estimates based on known published rates, regional averages, and industry knowledge. Always note the MTOW assumption and currency. Return structured data via the provided tool.',
          },
          { role: 'user', content: prompt },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'extract_airport_charges',
              description: 'Extract structured airport landing and parking charge estimates.',
              parameters: {
                type: 'object',
                properties: {
                  country: { type: 'string', description: 'Country where the airport is located' },
                  airportName: { type: 'string', description: 'Full name of the airport' },
                  currency: { type: 'string', description: 'Local currency code (e.g. EUR, GBP, SGD)' },
                  mtowKg: { type: 'number', description: 'MTOW assumption in kg used for the estimate' },
                  landingFeeLocal: { type: 'number', description: 'Estimated landing fee in local currency' },
                  landingFeeUsd: { type: 'number', description: 'Estimated landing fee in USD' },
                  parkingPerDayLocal: { type: 'number', description: 'Parking fee per day in local currency' },
                  parkingPerDayUsd: { type: 'number', description: 'Parking fee per day in USD' },
                  parkingDays: { type: 'number', description: 'Number of parking days used in calculation' },
                  totalParkingUsd: { type: 'number', description: 'Total parking cost in USD for the full duration' },
                  passengerFeeUsd: { type: 'number', description: 'Per-passenger terminal fee in USD, if applicable' },
                  surcharges: { type: 'string', description: 'Description of any surcharges (noise, night, weekend) and whether they apply based on schedule' },
                  nightSurchargeApplies: { type: 'boolean', description: 'Whether a night surcharge applies based on arrival/departure times' },
                  totalEstimateUsd: { type: 'number', description: 'Total estimated cost in USD for a single landing + 1 day parking' },
                  notes: { type: 'string', description: 'Important caveats, source context, or additional details' },
                  confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence level in the estimates' },
                },
                required: ['country', 'airportName', 'landingFeeUsd', 'parkingPerDayUsd', 'totalEstimateUsd', 'confidence'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'extract_airport_charges' } },
      });

    let charges = null;
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = 1000 * Math.pow(2, attempt - 1);
        console.log(`Retry attempt ${attempt + 1} after ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }

      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: requestBody,
      });

      if (aiResponse.status === 429) {
        console.warn(`Rate limited on attempt ${attempt + 1}`);
        if (attempt === maxRetries - 1) {
          return new Response(
            JSON.stringify({ success: false, error: 'Rate limit exceeded, please try again shortly' }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        continue;
      }

      if (!aiResponse.ok) {
        const status = aiResponse.status;
        if (status === 402) {
          return new Response(
            JSON.stringify({ success: false, error: 'Usage limit reached. Please add credits to continue using AI lookups.' }),
            { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        console.error('AI gateway error:', status);
        if (attempt === maxRetries - 1) {
          return new Response(
            JSON.stringify({ success: false, error: 'AI lookup failed' }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        continue;
      }

      const aiData = await aiResponse.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        charges = JSON.parse(toolCall.function.arguments);
        break;
      }
      console.warn(`No tool call in response on attempt ${attempt + 1}`);
    }

    if (!charges) {
      return new Response(
        JSON.stringify({ success: false, error: 'Could not estimate airport charges' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        icao,
        aircraftType: aircraftType || null,
        ...charges,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in charges-lookup:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
