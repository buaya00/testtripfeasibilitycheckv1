const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { nationalities, destinationCountry, destinationIcao, isAircrew } = await req.json();

    if (!nationalities || !Array.isArray(nationalities) || nationalities.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'At least one nationality is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!destinationCountry && !destinationIcao) {
      return new Response(
        JSON.stringify({ success: false, error: 'Destination country or ICAO code required' }),
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

    const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY');

    const nationalityList = nationalities.join(', ');
    const destination = destinationCountry || `the country of airport ${destinationIcao}`;
    const personType = isAircrew ? 'aircrew members (pilots, co-pilots, cabin crew, engineers)' : 'passengers';

    // ── Step 1: Ground with Perplexity real-time search ──────────────────────
    let perplexityContext = '';
    if (perplexityKey) {
      try {
        const searchQuery = isAircrew
          ? `Do ${nationalityList} aircrew / flight crew members need a visa to enter ${destination} in 2025? Include any recent changes to crew visa policy, ICAO exemptions, or aviation bilateral agreements.`
          : `Do ${nationalityList} passport holders need a visa to enter ${destination} in 2025? Include any recent visa policy changes, reinstatements, new e-visa programs, or reciprocal measures introduced in 2024 or 2025.`;

        const perpResponse = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${perplexityKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'sonar-pro',
            messages: [
              {
                role: 'system',
                content: 'You are a visa and immigration research assistant. Search for the most current visa requirements, including any policy changes announced or implemented in 2024–2025. Be explicit and specific: state clearly whether a visa IS required, available on arrival, or visa-free. Do not hedge — give a definitive current answer with sources.',
              },
              {
                role: 'user',
                content: searchQuery,
              },
            ],
            search_recency_filter: 'month',
          }),
        });

        if (perpResponse.ok) {
          const perpData = await perpResponse.json();
          perplexityContext = perpData.choices?.[0]?.message?.content || '';
          console.log('Perplexity grounding successful, context length:', perplexityContext.length);
        } else {
          console.warn('Perplexity search failed:', perpResponse.status);
        }
      } catch (e) {
        console.warn('Perplexity search error:', e);
      }
    } else {
      console.warn('PERPLEXITY_API_KEY not set — falling back to model knowledge only');
    }

    // ── Step 2: Extract structured data with AI, using grounded context ───────
    const prompt = `Determine visa requirements for ${personType} with the following nationalities: ${nationalityList}.

Destination: ${destination}${destinationIcao ? ` (ICAO: ${destinationIcao})` : ''}.
${isAircrew ? `
IMPORTANT: These are AIRCREW members operating a private or charter flight, NOT tourists or business travelers.
Aircrew often have special visa exemptions, crew visas (C-1/D for US), or bilateral aviation agreements that give them different treatment from regular passengers.
Consider ICAO Annex 9 facilitation provisions, crew visas, and any specific aircrew exemptions.
` : ''}
${perplexityContext ? `
=== CURRENT VISA POLICY RESEARCH (use this as your primary source — it contains up-to-date information) ===
${perplexityContext}
===

Use the above research as your authoritative source. It may include recent policy changes (e.g. visa reinstatements, new e-visa programs, reciprocal measures). Do NOT rely on outdated training data if it conflicts with the research above.
` : ''}
For EACH nationality, determine:
- Whether a visa is required to enter the destination country${isAircrew ? ' specifically for aircrew in their professional capacity' : ''}
- The type of visa needed (${isAircrew ? 'crew visa, C-1/D, airside transit, etc.' : 'tourist, transit, business, etc.'})
- Whether visa-on-arrival or e-visa is available${isAircrew ? ' for crew members' : ''}
- Typical processing time
- Maximum stay allowed without a visa (if visa-free)
- Any special conditions or bilateral agreements${isAircrew ? ' for aviation crew' : ''}
- Whether a transit visa is needed if only transiting through${isAircrew ? ' (airside transit for crew)' : ''}${isAircrew ? '\n- Any specific aircrew exemptions or facilitation provisions (ICAO Annex 9)' : ''}`;

    const requestBody = {
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are an aviation immigration and visa requirements expert specializing in ${isAircrew ? 'aircrew visa requirements, crew visas, and aviation facilitation agreements (ICAO Annex 9)' : 'passenger visa requirements and immigration policies'}. CRITICAL: The research context provided is from a real-time web search performed TODAY and MUST override your training data. If the research says a visa IS required, you must report it as required — do NOT revert to older training data. You MUST call the extract_visa_requirements tool to return structured data.`,
        },
        { role: 'user', content: prompt },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'extract_visa_requirements',
            description: 'Extract visa requirements for passengers by nationality visiting a destination country.',
            parameters: {
              type: 'object',
              properties: {
                destinationCountry: { type: 'string', description: 'The destination country name' },
                results: {
                  type: 'array',
                  description: 'Visa requirement results for each nationality',
                  items: {
                    type: 'object',
                    properties: {
                      nationality: { type: 'string', description: 'Passenger nationality / passport country' },
                      visaRequired: { type: 'string', enum: ['yes', 'no', 'conditional'], description: 'Whether a visa is required' },
                      visaType: { type: 'string', description: 'Type of visa needed (e.g. tourist, transit, business)' },
                      visaOnArrival: { type: 'boolean', description: 'Whether visa-on-arrival is available' },
                      eVisaAvailable: { type: 'boolean', description: 'Whether e-visa is available' },
                      processingTimeDays: { type: 'number', description: 'Typical processing time in business days' },
                      maxStayDays: { type: 'number', description: 'Maximum stay allowed in days (visa-free or visa duration)' },
                      transitVisaRequired: { type: 'boolean', description: 'Whether a transit visa is needed' },
                      conditions: { type: 'string', description: 'Special conditions or bilateral agreements' },
                      notes: { type: 'string', description: 'Additional notes or recommendations' },
                    },
                    required: ['nationality', 'visaRequired'],
                    additionalProperties: false,
                  },
                },
                notes: { type: 'string', description: 'General notes about visa policies for this destination, including any aircrew-specific exemptions or provisions if applicable' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence level' },
              },
              required: ['destinationCountry', 'results', 'confidence'],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'extract_visa_requirements' } },
    };

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
      console.warn(`No tool call on attempt ${attempt + 1}`);
    }

    if (!toolCall?.function?.arguments) {
      return new Response(
        JSON.stringify({ success: false, error: 'Could not determine visa requirements — please try again' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const visaInfo = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({ success: true, groundedByPerplexity: !!perplexityContext, ...visaInfo }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in visa-check:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
