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

    const prompt = `A flight is planned from ${originIcao} to ${destinationIcao}.

Determine the great circle route between these two airports. Identify ALL countries whose airspace would be crossed or closely skirted on this direct route (including the departure and arrival countries).

For EACH country whose airspace is crossed, determine the overflight permit requirements.

Flight type: ${flightTypeDesc}
${aircraftType ? `Aircraft type: ${aircraftType}` : ''}

For each country, consider:
- Whether a foreign-registered aircraft needs an overflight permit
- Whether the flight type affects the requirement
- Typical lead time for obtaining the permit
- The issuing authority
- Any special conditions or exemptions (e.g. EU/EASA member states, bilateral agreements)
- Whether a diplomatic clearance is needed for certain regions`;

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
            content: 'You are an aviation regulatory expert specializing in overflight permits and airspace requirements. Analyze routes between airports, identify countries overflown on the great circle path, and determine overflight permit requirements for each. Return structured data via the provided tool.',
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
                        country: { type: 'string', description: 'Country name' },
                        overflightPermitRequired: { type: 'string', enum: ['yes', 'no', 'conditional'], description: 'Whether overflight permit is needed' },
                        permitType: { type: 'string', description: 'Type of permit (e.g. overflight permit, diplomatic clearance, blanket permit)' },
                        leadTimeDays: { type: 'number', description: 'Typical lead time in business days' },
                        issuingAuthority: { type: 'string', description: 'Authority that issues the permit' },
                        conditions: { type: 'string', description: 'Conditions or exemptions that apply' },
                        notes: { type: 'string', description: 'Additional notes for this country' },
                      },
                      required: ['country', 'overflightPermitRequired'],
                      additionalProperties: false,
                    },
                  },
                  totalPermitsNeeded: { type: 'number', description: 'Total number of overflight permits required' },
                  maxLeadTimeDays: { type: 'number', description: 'Maximum lead time across all required permits' },
                  notes: { type: 'string', description: 'Overall route notes and recommendations' },
                  confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence level' },
                },
                required: ['countries', 'totalPermitsNeeded', 'confidence'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'extract_overflight_permits' } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: 'Rate limit exceeded, please try again shortly' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.error('AI gateway error:', status);
      return new Response(
        JSON.stringify({ success: false, error: 'AI lookup failed' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      return new Response(
        JSON.stringify({ success: false, error: 'Could not determine overflight requirements' }),
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
