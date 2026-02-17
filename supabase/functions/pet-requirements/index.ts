const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { petTypes, destinationIcao, originIcao } = await req.json();

    if (!petTypes || !Array.isArray(petTypes) || petTypes.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'At least one pet type is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!destinationIcao) {
      return new Response(
        JSON.stringify({ success: false, error: 'Destination ICAO code is required' }),
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

    const petList = petTypes.join(', ');

    const prompt = `Determine pet import/export requirements for transporting the following animals by PRIVATE aircraft:
Pet types: ${petList}

Destination airport: ${destinationIcao}
${originIcao ? `Origin airport: ${originIcao}` : ''}

For EACH pet type, determine the import requirements for the destination country including:
- Whether pet import is allowed
- Required health certificates (type, validity period, issuing authority)
- Required vaccinations (rabies, others) and timing requirements
- Microchip requirements (ISO standard)
- Quarantine requirements (duration, facility type, cost estimate)
- Blood tests or titer tests required
- Import permit requirements and lead times
- CITES permits if applicable
- Breed restrictions or bans
- Number limits per passenger/flight
- Required documentation and forms
- Advance notification requirements to customs/agriculture authorities
- Any special requirements for private/general aviation vs commercial flights
- Fees and charges
- Recommended preparation timeline

Focus on current regulations. Be specific about the destination country's requirements.`;

    const requestBody = {
      model: 'google/gemini-3-flash-preview',
      messages: [
        {
          role: 'system',
          content: 'You are an expert in international pet travel regulations, animal import/export requirements, and veterinary border control procedures. Provide accurate, detailed guidance based on current regulations for private aviation. You MUST call the extract_pet_requirements tool to return structured data.',
        },
        { role: 'user', content: prompt },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'extract_pet_requirements',
            description: 'Extract pet import/export requirements for animals traveling to a destination country.',
            parameters: {
              type: 'object',
              properties: {
                destinationCountry: { type: 'string', description: 'The destination country name' },
                destinationIcao: { type: 'string', description: 'Destination ICAO code' },
                results: {
                  type: 'array',
                  description: 'Requirements for each pet type',
                  items: {
                    type: 'object',
                    properties: {
                      petType: { type: 'string', description: 'Type of pet (Dog, Cat, etc.)' },
                      importAllowed: { type: 'string', enum: ['yes', 'no', 'conditional'], description: 'Whether import is allowed' },
                      healthCertificate: { type: 'string', description: 'Health certificate requirements (type, validity, issuing authority)' },
                      vaccinations: { type: 'string', description: 'Required vaccinations and timing (rabies, etc.)' },
                      microchipRequired: { type: 'boolean', description: 'Whether ISO microchip is required' },
                      quarantine: { type: 'string', description: 'Quarantine requirements (duration, type, or none)' },
                      quarantineDays: { type: 'number', description: 'Quarantine duration in days (0 if none)' },
                      bloodTests: { type: 'string', description: 'Required blood/titer tests' },
                      importPermit: { type: 'string', description: 'Import permit requirements and how to obtain' },
                      leadTimeDays: { type: 'number', description: 'Recommended preparation lead time in days' },
                      breedRestrictions: { type: 'string', description: 'Any breed bans or restrictions' },
                      documentsRequired: { type: 'string', description: 'List of required documents and forms' },
                      advanceNotification: { type: 'string', description: 'Advance notification requirements to authorities' },
                      privateAviationNotes: { type: 'string', description: 'Special notes for private/general aviation' },
                      estimatedFeesUsd: { type: 'number', description: 'Estimated total fees in USD' },
                      preparationTimeline: { type: 'string', description: 'Recommended step-by-step preparation timeline' },
                      notes: { type: 'string', description: 'Additional important notes or warnings' },
                    },
                    required: ['petType', 'importAllowed'],
                    additionalProperties: false,
                  },
                },
                generalNotes: { type: 'string', description: 'General notes about pet travel to this destination' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence level' },
              },
              required: ['destinationCountry', 'results', 'confidence'],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'extract_pet_requirements' } },
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
        JSON.stringify({ success: false, error: 'Could not determine pet requirements — please try again' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const petInfo = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({ success: true, ...petInfo }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in pet-requirements:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
