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
    const flightTypeLabel = flightType === 'private'
      ? 'Private / general aviation (non-commercial, owner/operator flown)'
      : flightType === 'non-scheduled-commercial'
        ? 'Non-scheduled commercial (charter / air taxi — operated for hire)'
        : flightType === 'commercial'
          ? 'Scheduled commercial airline service'
          : 'Private / general aviation (assume non-commercial)';

    const prompt = `You are an expert aviation regulatory consultant. Given the ICAO airport code "${icao}" (prefix "${icaoPrefix}"), provide a comprehensive analysis of ALL permit and regulatory requirements for the following flight:

Flight type: ${flightTypeLabel}
${aircraftRegistration ? `Aircraft registration prefix: ${aircraftRegistration}` : ''}

Provide an in-depth analysis covering ALL of the following areas:

1. LANDING PERMIT
   - Is a landing permit required? (yes/no/conditional)
   - Type of permit (e.g. diplomatic clearance, landing permit, blanket permit, exemption)
   - Issuing authority (full name of CAA or ministry)
   - Lead time in business days
   - Conditions under which permit is/isn't needed

2. THIRD COUNTRY OPERATOR (TCO) AUTHORIZATION — CRITICAL FOR EU & UK
   - For flights INTO EU/EASA states: Non-EU registered operators (aircraft not registered in an EASA member state) require a TCO Authorization issued by EASA. This applies to commercial and non-scheduled commercial operations. Private flights may be exempt.
   - For flights INTO UK: Post-Brexit, non-UK registered operators need a UK TCO Authorization from the UK CAA for commercial operations.
   - Is TCO authorization required for this specific flight type and aircraft registration?
   - Lead time (TCO applications typically take 3–6 months for initial approval)
   - Note if the aircraft registration prefix suggests TCO may apply (e.g. N-reg in EU, VP-B in UK, etc.)

3. BILATERAL AIR SERVICE AGREEMENT (ASA / BASA)
   - Does the country have a bilateral air services agreement that affects permit requirements?
   - Are there Open Skies agreements that simplify or eliminate permits?
   - Any multilateral agreements (e.g. intra-EU freedom, ASEAN Open Skies, GCC)
   - How does the ASA affect this specific flight type?

4. CHARTER / NON-SCHEDULED COMMERCIAL SPECIFIC REQUIREMENTS
   - Many countries require additional authorizations specifically for charter flights beyond a standard landing permit:
     * Singapore: Series permit or charter permit from CAAS — can take 4–8 weeks
     * China: CAAC approval for each charter flight, 7–14 days lead time
     * India: DGCA charter permit, 3–7 days
     * Brazil: ANAC non-scheduled flight authorization
     * Russia/CIS: Multiple approvals needed
     * Gulf states (UAE, Saudi, Qatar, Bahrain): Permit from GCAA/GACA/QCAA required
   - Is a separate charter/non-scheduled commercial permit required beyond the landing permit?
   - Lead time specifically for charter permits
   - Which authority issues charter permits

5. REGULATORY WARNINGS & SPECIAL SITUATIONS
   - Any sanctions, restrictions, or political complications
   - Curfews or noise restrictions at this specific airport
   - Cabotage rules (operating between points within the same country)
   - Specific airport slot restrictions (coordinated airports)
   - Any documentation requirements (Air Operator Certificate acceptance, insurance minimums, etc.)
   - Countries where operations are practically very difficult (high bureaucratic burden)

Be specific and accurate. Use your knowledge of ICAO country prefixes:
- EG = UK, EH = Netherlands, LF = France, ED = Germany, LE = Spain, LI = Italy (EASA members — TCO relevant for non-EASA operators)
- WS = Singapore (charter permits are notoriously complex)
- ZB/ZH/ZL/ZS/ZU/ZW/ZY/ZG = China (CAAC approval required)
- VT = India, PP/PT/SW = Brazil, UU/UD/UK = Russia/CIS
- OM = UAE, OE = Saudi Arabia, OT = Qatar, OB = Bahrain

For the specific flight type "${flightTypeLabel}", be explicit about whether each requirement applies.`;

    const requestBody = JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: 'You are a precise aviation regulatory expert with deep knowledge of international permit requirements, TCO authorizations, bilateral air service agreements, and country-specific charter regulations. Return structured data via the provided tool. Be specific, accurate, and comprehensive — operators depend on this information for safety-critical decisions.',
        },
        { role: 'user', content: prompt },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'extract_permit_info',
            description: 'Extract comprehensive landing permit and regulatory information for an airport/country.',
            parameters: {
              type: 'object',
              properties: {
                country: { type: 'string', description: 'Country name where the airport is located' },
                permitRequired: { type: 'string', enum: ['yes', 'no', 'conditional'], description: 'Whether a standard landing permit is required' },
                permitType: { type: 'string', description: 'Type of permit needed (e.g. landing permit, diplomatic clearance, blanket permit, exemption)' },
                leadTimeDays: { type: 'number', description: 'Typical lead time in business days to obtain the standard landing permit' },
                issuingAuthority: { type: 'string', description: 'Full name of authority that issues the landing permit (e.g. Civil Aviation Authority of Singapore)' },
                conditions: { type: 'string', description: 'Conditions under which a permit is or is not required' },
                overflightPermit: { type: 'string', enum: ['yes', 'no', 'conditional'], description: 'Whether an overflight permit is also needed' },
                tcoRequired: { type: 'string', enum: ['yes', 'no', 'conditional', 'not_applicable'], description: 'Whether Third Country Operator (TCO) authorization is required (relevant for EU/UK destinations with non-EASA/non-UK registered aircraft on commercial operations)' },
                tcoAuthority: { type: 'string', description: 'Authority issuing TCO authorization (e.g. EASA for EU, UK CAA for UK)' },
                tcoLeadTimeDays: { type: 'number', description: 'Lead time for TCO authorization in days (typically 90-180 days for initial approval)' },
                tcoNotes: { type: 'string', description: 'Important notes about TCO requirements, including which flight types are exempt (e.g. private flights exempt from TCO)' },
                bilateralAgreement: { type: 'string', description: 'Relevant bilateral or multilateral air service agreements affecting permit requirements (e.g. Open Skies agreement with US, intra-EU rights, ASEAN Open Skies)' },
                bilateralImpact: { type: 'string', description: 'How the bilateral agreement affects permit requirements for this flight type' },
                charterPermitRequired: { type: 'string', enum: ['yes', 'no', 'conditional', 'not_applicable'], description: 'Whether an additional charter/non-scheduled commercial permit is required beyond the standard landing permit' },
                charterPermitAuthority: { type: 'string', description: 'Authority issuing charter permits (may differ from landing permit authority)' },
                charterLeadTimeDays: { type: 'number', description: 'Lead time specifically for charter permits in business days' },
                charterPermitNotes: { type: 'string', description: 'Details about charter permit process, complexity, and any known difficulties (e.g. Singapore series permits, China CAAC approvals)' },
                regulatoryWarnings: { type: 'array', items: { type: 'string' }, description: 'List of important regulatory warnings, special situations, sanctions, documentation requirements, slot restrictions, cabotage rules, or operational complications specific to this country/airport' },
                notes: { type: 'string', description: 'Additional important notes about permits for this country/airport, including practical advice for operators' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence level in the information provided' },
              },
              required: ['country', 'permitRequired', 'confidence'],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'extract_permit_info' } },
    });

    let permitInfo = null;
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
        console.error('AI gateway error:', aiResponse.status);
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
        permitInfo = JSON.parse(toolCall.function.arguments);
        break;
      }
      console.warn(`No tool call in response on attempt ${attempt + 1}`);
    }

    if (!permitInfo) {
      return new Response(
        JSON.stringify({ success: false, error: 'Could not determine permit requirements' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
