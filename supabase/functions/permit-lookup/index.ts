const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { icao, aircraftRegistration, flightType } = await req.json();

    if (!icao || typeof icao !== 'string' || !/^[A-Z]{4}$/.test(icao)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Valid 4-letter ICAO code required' }),
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

    const icaoPrefix = icao.substring(0, 2);

    const prompt = `Given the ICAO airport code "${icao}" (prefix "${icaoPrefix}"), determine the landing permit requirements for a general aviation / private jet flight arriving at this airport.

Consider:
- The country this ICAO prefix belongs to
- Whether foreign-registered private aircraft typically need a landing permit
- Whether overflight permits are also required
- Typical lead time for obtaining permits
- Any special requirements (e.g. diplomatic clearance, restricted airspace)
- Whether the country is part of agreements that simplify permits (e.g. EU/EASA for intra-EU flights)

${flightType === 'private' ? 'Flight type: Private / general aviation (non-commercial).' : flightType === 'non-scheduled-commercial' ? 'Flight type: Non-scheduled commercial (charter / air taxi).' : flightType === 'commercial' ? 'Flight type: Scheduled commercial airline service.' : 'Assume private/general aviation flight.'}
${aircraftRegistration ? `Aircraft registration prefix: ${aircraftRegistration}` : ''}

IMPORTANT: Different flight types often have different permit requirements. For example, private flights may need a landing permit while scheduled commercial flights may not (or vice versa). Be specific about how the flight type affects the permit requirement.`;

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
            content: 'You are an aviation regulatory expert. Extract landing permit requirements for airports based on their ICAO code and country. Return structured data via the provided tool.',
          },
          { role: 'user', content: prompt },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'extract_permit_info',
              description: 'Extract structured landing permit information for an airport/country.',
              parameters: {
                type: 'object',
                properties: {
                  country: { type: 'string', description: 'Country name where the airport is located' },
                  permitRequired: { type: 'string', enum: ['yes', 'no', 'conditional'], description: 'Whether a landing permit is required' },
                  permitType: { type: 'string', description: 'Type of permit needed (e.g. landing permit, overflight permit, blanket permit)' },
                  leadTimeDays: { type: 'number', description: 'Typical lead time in business days to obtain the permit' },
                  issuingAuthority: { type: 'string', description: 'Authority that issues the permit (e.g. CAA name)' },
                  conditions: { type: 'string', description: 'Conditions under which a permit is or is not required' },
                  overflightPermit: { type: 'string', enum: ['yes', 'no', 'conditional'], description: 'Whether an overflight permit is also needed' },
                  notes: { type: 'string', description: 'Additional important notes about permits for this country/airport' },
                  confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence level in the information provided' },
                },
                required: ['country', 'permitRequired', 'confidence'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'extract_permit_info' } },
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
        JSON.stringify({ success: false, error: 'Could not determine permit requirements' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const permitInfo = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({
        success: true,
        icao,
        ...permitInfo,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in permit-lookup:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
