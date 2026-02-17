const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { icao, arrivalDate, arrivalTime, departureDate, departureTime, aircraftType, flightType } = await req.json();

    if (!icao || typeof icao !== 'string' || !/^[A-Z]{4}$/.test(icao)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Valid 4-letter ICAO code required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Also try to fetch live NOTAM data from FAA
    let notamData = '';
    try {
      // FAA NOTAM API (public, no key required for basic queries)
      const notamUrl = `https://www.notams.faa.gov/dinsQueryWeb/queryRetrievalMapAction.do?reportType=Raw&retrieveLocId=${icao}&actionType=notamRetrievalByICAOs`;
      const notamRes = await fetch(notamUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AirportOpsChecker/1.0)', 'Accept': 'text/html' },
      });
      if (notamRes.ok) {
        const html = await notamRes.text();
        // Extract NOTAM text content (strip HTML tags)
        const bodyMatch = html.match(/<PRE[^>]*>([\s\S]*?)<\/PRE>/gi);
        if (bodyMatch) {
          notamData = bodyMatch.map(m => m.replace(/<[^>]+>/g, '').trim()).join('\n').substring(0, 5000);
        }
      }
    } catch (e) {
      console.error('NOTAM fetch error (non-fatal):', e);
    }

    const dateContext = arrivalDate || departureDate
      ? `\nPlanned dates: ${arrivalDate ? `Arrival: ${arrivalDate}` : ''} ${departureDate ? `Departure: ${departureDate}` : ''}`
      : '';
    const timeContext = arrivalTime || departureTime
      ? `\nPlanned times (UTC): ${arrivalTime ? `Arrival: ${arrivalTime}` : ''} ${departureTime ? `Departure: ${departureTime}` : ''}`
      : '';

    const prompt = `Provide airport operating hours and any current or typical restrictions for ${icao}.
${dateContext}${timeContext}
${aircraftType ? `Aircraft: ${aircraftType}` : ''}
${flightType ? `Flight type: ${flightType}` : ''}

${notamData ? `Here are recent NOTAMs retrieved for this airport:\n${notamData}\n\nAnalyze these NOTAMs for any closures, restrictions, or operational impacts.` : 'No live NOTAM data was available. Provide known operating hours and typical restrictions based on your knowledge.'}

Return structured data about:
1. Airport published operating hours (open/close times in UTC, days of operation)
2. Any active NOTAMs that affect operations (closures, restrictions, runway closures, equipment outages)
3. Whether the planned arrival/departure times fall outside operating hours
4. Any curfew or noise restrictions
5. Seasonal or temporary restrictions`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content: 'You are an aviation operations specialist. Extract structured airport operating hours and NOTAM information. Always provide times in UTC 24h format (HH:MM). Be precise about closures and restrictions.',
          },
          { role: 'user', content: prompt },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'report_airport_hours',
              description: 'Report structured airport operating hours and NOTAM data.',
              parameters: {
                type: 'object',
                properties: {
                  airportName: { type: 'string', description: 'Full airport name' },
                  country: { type: 'string', description: 'Country name' },
                  operatingHoursOpen: { type: 'string', description: 'Opening time HH:MM UTC. Empty string if H24.' },
                  operatingHoursClose: { type: 'string', description: 'Closing time HH:MM UTC. Empty string if H24.' },
                  is24Hours: { type: 'boolean', description: 'Whether airport operates 24 hours' },
                  operatingDays: { type: 'string', description: 'Days of operation e.g. "Mon-Fri", "Daily"' },
                  curfewStart: { type: 'string', description: 'Curfew/quiet hours start HH:MM UTC, empty if none' },
                  curfewEnd: { type: 'string', description: 'Curfew/quiet hours end HH:MM UTC, empty if none' },
                  curfewNotes: { type: 'string', description: 'Curfew details or noise restrictions' },
                  activeNotams: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', description: 'NOTAM ID if available' },
                        type: { type: 'string', enum: ['closure', 'restriction', 'runway_closure', 'equipment', 'hazard', 'info'], description: 'Type of NOTAM' },
                        summary: { type: 'string', description: 'Brief summary of the NOTAM' },
                        effectiveFrom: { type: 'string', description: 'Start date/time if known' },
                        effectiveTo: { type: 'string', description: 'End date/time if known' },
                        affectsOperations: { type: 'boolean', description: 'Whether this NOTAM could affect planned operations' },
                      },
                      required: ['type', 'summary', 'affectsOperations'],
                      additionalProperties: false,
                    },
                    description: 'Active NOTAMs affecting this airport',
                  },
                  arrivalOutsideHours: { type: 'boolean', description: 'Whether planned arrival time is outside operating hours' },
                  departureOutsideHours: { type: 'boolean', description: 'Whether planned departure time is outside operating hours' },
                  arrivalDuringCurfew: { type: 'boolean', description: 'Whether planned arrival falls during curfew' },
                  departureDuringCurfew: { type: 'boolean', description: 'Whether planned departure falls during curfew' },
                  seasonalRestrictions: { type: 'string', description: 'Any seasonal or temporary restrictions' },
                  notes: { type: 'string', description: 'Additional operational notes' },
                  confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence in the data' },
                },
                required: ['is24Hours', 'operatingDays', 'activeNotams', 'arrivalOutsideHours', 'departureOutsideHours', 'arrivalDuringCurfew', 'departureDuringCurfew', 'confidence'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'report_airport_hours' } },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('AI gateway error:', aiResponse.status, errText);

      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: 'Rate limit exceeded, please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'Usage limit reached.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: false, error: 'AI lookup failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(
        JSON.stringify({ success: false, error: 'No structured data returned' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const extracted = JSON.parse(toolCall.function.arguments);

    const result = {
      success: true,
      icao,
      airportName: extracted.airportName || null,
      country: extracted.country || null,
      is24Hours: extracted.is24Hours,
      operatingHoursOpen: extracted.operatingHoursOpen || null,
      operatingHoursClose: extracted.operatingHoursClose || null,
      operatingDays: extracted.operatingDays || 'Daily',
      curfewStart: extracted.curfewStart || null,
      curfewEnd: extracted.curfewEnd || null,
      curfewNotes: extracted.curfewNotes || null,
      activeNotams: extracted.activeNotams || [],
      arrivalOutsideHours: extracted.arrivalOutsideHours || false,
      departureOutsideHours: extracted.departureOutsideHours || false,
      arrivalDuringCurfew: extracted.arrivalDuringCurfew || false,
      departureDuringCurfew: extracted.departureDuringCurfew || false,
      seasonalRestrictions: extracted.seasonalRestrictions || null,
      notes: extracted.notes || null,
      hasLiveNotamData: notamData.length > 0,
      confidence: extracted.confidence || 'medium',
    };

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in airport-hours-notam:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
