const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { legs, aircraftNationality, flightType, aircraftType } = await req.json();

    if (!legs || !Array.isArray(legs) || legs.length < 2) {
      return new Response(
        JSON.stringify({ success: false, error: 'At least 2 legs (ICAOs) required for cabotage analysis' }),
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

    const routeDescription = legs.map((l: { icao: string; country?: string }) => l.icao).join(' → ');

    const prompt = `Analyze the following flight routing for potential cabotage violations:

Route: ${routeDescription}
Aircraft registration country: ${aircraftNationality || 'Not specified'}
Flight type: ${flightType || 'Not specified'}
Aircraft type: ${aircraftType || 'Not specified'}

Leg details:
${legs.map((l: { icao: string; country?: string }, i: number) => `  Leg ${i + 1}: ${l.icao} (${l.country || 'country unknown'})`).join('\n')}

Cabotage in aviation refers to the restriction on foreign-registered aircraft carrying passengers or cargo between two points within the same foreign country. Analyze each consecutive pair of legs and determine:

1. Whether any leg pair constitutes cabotage (picking up passengers/cargo at one domestic point and dropping them at another domestic point within a country where the aircraft is NOT registered)
2. Whether any exemptions apply (e.g., EU single aviation market for EU-registered aircraft, bilateral agreements, repositioning/ferry flights, private non-revenue flights)
3. The specific cabotage laws of each relevant country

Important considerations:
- Private (non-commercial, Part 91 equivalent) flights are generally exempt from cabotage in most countries
- Charter/commercial flights between two points in a foreign country almost always constitute cabotage
- EU member states allow cabotage for EU-registered aircraft within the EU
- Some countries have specific bilateral agreements that permit certain operations
- Repositioning (empty/ferry) legs are typically not cabotage
- Transit stops (technical stops without embarking/disembarking passengers) are not cabotage`;

    const requestBody = JSON.stringify({
      model: 'google/gemini-3-flash-preview',
      messages: [
        {
          role: 'system',
          content: 'You are an aviation regulatory expert specializing in international air transport law and cabotage regulations. Provide precise analysis of cabotage risks based on aircraft registration, routing, and applicable laws.',
        },
        { role: 'user', content: prompt },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'report_cabotage_analysis',
            description: 'Report structured cabotage analysis for a flight routing.',
            parameters: {
              type: 'object',
              properties: {
                overallRisk: {
                  type: 'string',
                  enum: ['none', 'low', 'medium', 'high'],
                  description: 'Overall cabotage risk level for the entire routing',
                },
                legAnalysis: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      fromIcao: { type: 'string', description: 'Departure ICAO' },
                      toIcao: { type: 'string', description: 'Arrival ICAO' },
                      fromCountry: { type: 'string', description: 'Departure country' },
                      toCountry: { type: 'string', description: 'Arrival country' },
                      isCabotageRisk: { type: 'boolean', description: 'Whether this leg pair poses a cabotage risk' },
                      riskLevel: { type: 'string', enum: ['none', 'low', 'medium', 'high'], description: 'Risk level for this specific leg' },
                      reason: { type: 'string', description: 'Explanation of why this is or is not a cabotage risk' },
                      exemptions: { type: 'string', description: 'Any applicable exemptions (e.g., private flight, EU single market, bilateral agreement)' },
                      applicableLaw: { type: 'string', description: 'Relevant cabotage law or regulation' },
                    },
                    required: ['fromIcao', 'toIcao', 'isCabotageRisk', 'riskLevel', 'reason'],
                    additionalProperties: false,
                  },
                  description: 'Per-leg cabotage analysis',
                },
                summary: { type: 'string', description: 'Brief overall summary of cabotage assessment' },
                recommendations: { type: 'string', description: 'Recommendations to mitigate cabotage risks if any' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence level' },
              },
              required: ['overallRisk', 'legAnalysis', 'summary', 'confidence'],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'report_cabotage_analysis' } },
    });

    // Retry with backoff
    let aiResponse: Response | null = null;
    let lastStatus = 0;
    let lastErrText = '';

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
      const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: requestBody,
      });

      if (res.ok) { aiResponse = res; break; }
      lastStatus = res.status;
      lastErrText = await res.text();
      console.error(`AI gateway error (attempt ${attempt + 1}):`, lastStatus, lastErrText);
      if (lastStatus === 402 || lastStatus === 401) break;
    }

    if (!aiResponse) {
      if (lastStatus === 429) {
        return new Response(
          JSON.stringify({ success: false, error: 'Rate limit exceeded, please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (lastStatus === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'Usage limit reached. Please add credits to continue.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ success: false, error: `AI lookup failed (${lastStatus})` }),
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

    return new Response(
      JSON.stringify({
        success: true,
        ...extracted,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in cabotage-check:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
