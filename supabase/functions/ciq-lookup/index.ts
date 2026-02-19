const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { icao } = await req.json();

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

    const prompt = `Given the ICAO airport code "${icao}" (prefix "${icaoPrefix}"), determine whether Customs, Immigration, and Quarantine (CIQ) services are available at this airport for general aviation and private jet operations.

Consider:
- The country this ICAO prefix belongs to
- Whether this airport is an international airport or port of entry
- Whether CIQ/customs clearance is available for GA/private flights
- Whether CIQ is available 24/7 or only during specific hours
- Whether advance notice is required for CIQ services
- Any fees or special arrangements needed
- Alternative nearby airports with CIQ if this one doesn't have it

Provide your best assessment based on known aviation information about this airport.`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: 'You are an aviation operations expert specializing in international airport services. Determine CIQ (Customs, Immigration, Quarantine) availability at airports based on their ICAO code. Return structured data via the provided tool.',
          },
          { role: 'user', content: prompt },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'extract_ciq_info',
              description: 'Extract structured CIQ availability information for an airport.',
              parameters: {
                type: 'object',
                properties: {
                  country: { type: 'string', description: 'Country name where the airport is located' },
                  airportName: { type: 'string', description: 'Full name of the airport' },
                  ciqAvailable: { type: 'string', enum: ['yes', 'no', 'limited'], description: 'Whether CIQ services are available' },
                  isPortOfEntry: { type: 'boolean', description: 'Whether the airport is an official port of entry / international airport' },
                  operatingHours: { type: 'string', description: 'CIQ operating hours if known (e.g. "24/7", "0800-1800 local", "By arrangement")' },
                  advanceNotice: { type: 'string', description: 'Advance notice required for CIQ (e.g. "24 hours", "48 hours", "None")' },
                  fees: { type: 'string', description: 'Any known overtime or special CIQ fees' },
                  alternateAirports: { type: 'string', description: 'Nearby airports with CIQ if this airport has limited or no CIQ' },
                  notes: { type: 'string', description: 'Additional important notes about CIQ at this airport' },
                  confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence level in the information provided' },
                },
                required: ['country', 'ciqAvailable', 'confidence'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'extract_ciq_info' } },
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
      if (status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'Usage limit reached. Please add credits to continue using AI lookups.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
        JSON.stringify({ success: false, error: 'Could not determine CIQ availability' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ciqInfo = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({
        success: true,
        icao,
        ...ciqInfo,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in ciq-lookup:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
