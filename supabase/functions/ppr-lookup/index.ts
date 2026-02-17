const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { icao, flightType, aircraftType } = await req.json();

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

    const flightTypeDesc = flightType === 'private'
      ? 'Private / general aviation (non-commercial)'
      : flightType === 'non-scheduled-commercial'
        ? 'Non-scheduled commercial (charter / air taxi)'
        : flightType === 'commercial'
          ? 'Scheduled commercial airline service'
          : 'Private / general aviation';

    const prompt = `Given the ICAO airport code "${icao}", determine if Prior Permission Required (PPR) applies for landing at this airport.

Consider:
- Whether the airport requires PPR for all traffic or only certain categories
- Whether PPR requirements differ by flight type (private, charter, scheduled)
- The advance notice period typically required
- How to obtain PPR (phone, email, online system, handling agent)
- Whether specific slots need to be booked
- Any restrictions on operating hours that effectively make PPR necessary
- Whether the airport has noise restrictions or curfews that affect access

Flight type: ${flightTypeDesc}
${aircraftType ? `Aircraft type: ${aircraftType}` : ''}`;

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
            content: 'You are an aviation operations expert specializing in airport access requirements. Determine PPR (Prior Permission Required) status for airports based on their ICAO code. Return structured data via the provided tool.',
          },
          { role: 'user', content: prompt },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'extract_ppr_info',
              description: 'Extract structured PPR (Prior Permission Required) information for an airport.',
              parameters: {
                type: 'object',
                properties: {
                  country: { type: 'string', description: 'Country where the airport is located' },
                  airportName: { type: 'string', description: 'Full name of the airport' },
                  pprRequired: { type: 'string', enum: ['yes', 'no', 'conditional'], description: 'Whether PPR is required' },
                  advanceNoticePeriod: { type: 'string', description: 'How far in advance PPR must be obtained (e.g. 24 hours, 48 hours, 72 hours)' },
                  contactMethod: { type: 'string', description: 'How to obtain PPR (e.g. phone, email, handling agent, online portal)' },
                  contactDetails: { type: 'string', description: 'Specific contact info if known (phone number, email, website)' },
                  slotRequired: { type: 'boolean', description: 'Whether a specific landing/departure slot must be booked' },
                  operatingRestrictions: { type: 'string', description: 'Any noise curfews, restricted hours, or weekend closures' },
                  conditions: { type: 'string', description: 'Conditions under which PPR is or is not required (e.g. only for GA, only outside business hours)' },
                  handlingAgentRequired: { type: 'boolean', description: 'Whether a handling agent must be arranged in advance' },
                  notes: { type: 'string', description: 'Additional important notes about PPR at this airport' },
                  confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence level in the information provided' },
                },
                required: ['pprRequired', 'confidence'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'extract_ppr_info' } },
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
        JSON.stringify({ success: false, error: 'Could not determine PPR requirements' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const pprInfo = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({ success: true, icao, ...pprInfo }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in ppr-lookup:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
