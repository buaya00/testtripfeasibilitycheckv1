const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { originIcao, destinationIcao, flightType, aircraftType } = await req.json();

    if (!originIcao || !/^[A-Z]{4}$/.test(originIcao)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Valid 4-letter origin ICAO code required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!destinationIcao || !/^[A-Z]{4}$/.test(destinationIcao)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Valid 4-letter destination ICAO code required' }),
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

    const flightTypeDesc = flightType === 'private'
      ? 'Private / general aviation (non-commercial)'
      : flightType === 'non-scheduled-commercial'
        ? 'Non-scheduled commercial (charter / air taxi)'
        : flightType === 'commercial'
          ? 'Scheduled commercial airline service'
          : 'Private / general aviation';

    // ── Step 1: Perplexity grounding for overflight requirements ─────────────
    let perplexityContext = '';
    if (perplexityApiKey) {
      try {
        const icaoPrefix1 = originIcao.substring(0, 2);
        const icaoPrefix2 = destinationIcao.substring(0, 2);
        const perpResponse = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${perplexityApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'sonar-pro',
            messages: [
              {
                role: 'system',
                content: 'You are an aviation regulatory expert. Search official CAA, ICAO, and government aviation authority sources for overflight permit requirements and air navigation charges. Prioritize official AIP publications, ICAO documentation, and national CAA websites.',
              },
              {
                role: 'user',
                content: `What are the overflight permit requirements and air navigation charges for a ${flightTypeDesc} flight from ${originIcao} (prefix ${icaoPrefix1}) to ${destinationIcao} (prefix ${icaoPrefix2})? Include requirements for each country whose airspace is crossed on the great circle route. Search official CAA and AIP sources.${aircraftType ? ` Aircraft: ${aircraftType}.` : ''}`,
              },
            ],
            search_domain_filter: [
              'ead.eurocontrol.int',
              'eurocontrol.int',
              'icao.int',
              'faa.gov',
              'caa.co.uk',
              'easa.europa.eu',
              'iata.org',
              'gcaa.gov.ae',
              'caac.gov.cn',
            ],
            search_recency_filter: 'year',
            max_tokens: 1000,
          }),
        });
        if (perpResponse.ok) {
          const perpData = await perpResponse.json();
          perplexityContext = perpData.choices?.[0]?.message?.content || '';
          console.log(`Perplexity overflight context: ${perplexityContext.length} chars`);
        } else {
          console.warn('Perplexity overflight lookup failed:', perpResponse.status);
        }
      } catch (e) {
        console.warn('Perplexity overflight lookup error (non-fatal):', e);
      }
    }

    const prompt = `A flight is planned from ${originIcao} to ${destinationIcao}.

${perplexityContext ? `## Official regulatory research (use as primary source):\n${perplexityContext}\n\n---\n` : ''}
Determine the great circle route between these two airports. Identify ALL countries whose airspace would be crossed or closely skirted on this direct route (including the departure and arrival countries).

For EACH country whose airspace is crossed, determine the overflight permit requirements AND estimated overflight charges/fees.

Flight type: ${flightTypeDesc}
${aircraftType ? `Aircraft type: ${aircraftType}` : 'Assume a mid-size business jet (~15,000 kg MTOW) if no aircraft specified.'}

For each country, consider:
- Whether a foreign-registered aircraft needs an overflight permit
- Whether the flight type affects the requirement
- Typical lead time for obtaining the permit
- The issuing authority
- Any special conditions or exemptions (e.g. EU/EASA member states, bilateral agreements)
- Whether a diplomatic clearance is needed for certain regions
- Estimated overflight/air navigation charges in USD (based on MTOW, distance through airspace, and published Eurocontrol/IATA rates or national ANS fee schedules)
- The basis for the charge calculation (e.g. weight factor, distance factor, unit rate)`;

    const requestBody = {
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: 'You are an aviation regulatory expert specializing in overflight permits and airspace requirements. Analyze routes between airports, identify countries overflown on the great circle path, and determine overflight permit requirements and charges for each. You MUST call the extract_overflight_permits tool to return structured data.',
        },
        { role: 'user', content: prompt },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'extract_overflight_permits',
            description: 'Extract overflight permit requirements for all countries on a route.',
            parameters: {
              type: 'object',
              properties: {
                originAirport: { type: 'string', description: 'Full name of origin airport' },
                originCountry: { type: 'string', description: 'Country of origin airport' },
                destinationAirport: { type: 'string', description: 'Full name of destination airport' },
                destinationCountry: { type: 'string', description: 'Country of destination airport' },
                routeSummary: { type: 'string', description: 'Brief description of the great circle route and countries crossed' },
                countries: {
                  type: 'array',
                  description: 'List of countries whose airspace is crossed, in order along the route',
                  items: {
                    type: 'object',
                    properties: {
                      country: { type: 'string' },
                      overflightPermitRequired: { type: 'string', enum: ['yes', 'no', 'conditional'] },
                      permitType: { type: 'string' },
                      leadTimeDays: { type: 'number' },
                      issuingAuthority: { type: 'string' },
                      conditions: { type: 'string' },
                      notes: { type: 'string' },
                      overflightChargeUsd: { type: 'number', description: 'Estimated overflight charge in USD' },
                      chargeBasis: { type: 'string', description: 'Basis for the charge calculation' },
                    },
                    required: ['country', 'overflightPermitRequired'],
                    additionalProperties: false,
                  },
                },
                totalPermitsNeeded: { type: 'number' },
                maxLeadTimeDays: { type: 'number' },
                totalOverflightChargesUsd: { type: 'number' },
                notes: { type: 'string' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              },
              required: ['countries', 'totalPermitsNeeded', 'confidence'],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'extract_overflight_permits' } },
    };

    // Try up to 2 times
    let toolCall = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!aiResponse.ok) {
        const status = aiResponse.status;
        await aiResponse.text().catch(() => {});
        if (status === 429) {
          return new Response(
            JSON.stringify({ success: false, error: 'Rate limit exceeded, please try again shortly' }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (status === 402) {
          return new Response(
            JSON.stringify({ success: false, error: 'Usage limit reached. Please add credits to continue using AI lookups.' }),
            { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        console.error(`AI gateway error (attempt ${attempt + 1}):`, status);
        if (attempt === 1) {
          return new Response(
            JSON.stringify({ success: false, error: 'AI lookup failed' }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        continue;
      }

      const aiData = await aiResponse.json();
      toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

      if (toolCall?.function?.arguments) break;
      console.warn(`No tool call on attempt ${attempt + 1}, message:`, JSON.stringify(aiData.choices?.[0]?.message).slice(0, 300));
    }

    if (!toolCall?.function?.arguments) {
      return new Response(
        JSON.stringify({ success: false, error: 'Could not determine overflight requirements — please try again' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const overflightInfo = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({
        success: true,
        originIcao,
        destinationIcao,
        ...overflightInfo,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in overflight-permits:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
