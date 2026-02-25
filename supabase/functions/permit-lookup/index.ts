const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { icao, aircraftRegistration, flightType, aircraftNationality } = await req.json();

    if (!icao || typeof icao !== 'string' || !/^[A-Z]{4}$/.test(icao)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Valid 4-letter ICAO code required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const perplexityApiKey = Deno.env.get('PERPLEXITY_API_KEY');
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!perplexityApiKey && !lovableApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'No AI API key configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Hardcoded overrides for known airports ───────────────────────────────
    if (icao === 'VHHH') {
      const isPrivate = !flightType || flightType === 'private';
      return new Response(
        JSON.stringify({
          success: true,
          icao,
          country: 'Hong Kong SAR, China',
          permitRequired: 'yes',
          permitType: 'Landing Permit',
          leadTimeDays: isPrivate ? 3 : 14,
          issuingAuthority: 'Civil Aviation Department (CAD) Hong Kong',
          conditions: 'Landing permit required for all foreign-registered aircraft regardless of flight type.',
          overflightPermit: 'no',
          tcoRequired: 'not_applicable',
          tcoAuthority: null,
          tcoLeadTimeDays: null,
          tcoNotes: null,
          bilateralAgreement: null,
          bilateralImpact: null,
          charterPermitRequired: isPrivate ? 'not_applicable' : 'yes',
          charterPermitAuthority: isPrivate ? null : 'Civil Aviation Department (CAD) Hong Kong',
          charterLeadTimeDays: isPrivate ? null : 14,
          charterPermitNotes: isPrivate ? null : 'Non-scheduled/charter permit required in addition to the standard landing permit. 14 business days lead time.',
          regulatoryWarnings: [
            'Permit required for ALL foreign aircraft operations regardless of flight type.',
            isPrivate
              ? 'Private flights: minimum 3 business days lead time for landing permit.'
              : 'Non-private/commercial flights: minimum 14 business days lead time for landing permit.',
          ],
          notes: `VHHH (Hong Kong International Airport) requires a landing permit for all foreign-registered aircraft. Lead time: ${isPrivate ? '3 business days (private flights)' : '14 business days (non-private/commercial flights)'}.`,
          confidence: 'high',
          citations: [],
          groundedByPerplexity: false,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Resolve airport name ──────────────────────────────────────────
    const AIRPORT_NAME_OVERRIDES: Record<string, string> = {
      'KOPF': 'Miami-Opa Locka Executive Airport',
    };
    let resolvedAirportName = AIRPORT_NAME_OVERRIDES[icao] || '';
    try {
      const apRes = await fetch('https://davidmegginson.github.io/ourairports-data/airports.csv');
      if (apRes.ok) {
        const csv = await apRes.text();
        const lines = csv.split('\n');
        const hdr = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
        const iIdent = hdr.indexOf('ident');
        const iName = hdr.indexOf('name');
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.replace(/"/g, '').trim());
          if (cols[iIdent] === icao) { resolvedAirportName = cols[iName] || ''; break; }
        }
      }
    } catch (e) { console.warn('Airport name lookup failed:', e); }

    const icaoPrefix = icao.substring(0, 2);
    const flightTypeLabel = flightType === 'private'
      ? 'Private / general aviation — FAR Part 91 (non-commercial; owner or operator is aboard or flight is not-for-hire)'
      : flightType === 'non-scheduled-commercial'
        ? 'Non-scheduled commercial (charter / air taxi — operated for hire under FAR Part 135 or equivalent)'
        : flightType === 'commercial'
          ? 'Scheduled commercial airline service (FAR Part 121 or equivalent)'
          : 'Private / general aviation — FAR Part 91 (assume non-commercial, owner/operator onboard)';

    // ── Step 1: Use Perplexity to get real-time grounded regulatory data ──────
    let perplexityContext = '';
    let citations: string[] = [];

    if (perplexityApiKey) {
      try {
        console.log(`Fetching Perplexity data for ICAO: ${icao}`);
        const perplexityResponse = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${perplexityApiKey}`,
            'Content-Type': 'application/json',
          },
            body: JSON.stringify({
            model: 'sonar-pro',
            messages: [
              {
                role: 'system',
                content: 'You are an aviation regulatory expert. Provide accurate, up-to-date information about landing permits, regulatory requirements, and air service agreements for specific airports. Focus on official sources like civil aviation authority (CAA) websites, official AIP (Aeronautical Information Publication) entries, ICAO publications, and official government documents. Prioritize AIP GEN and AD sections, national CAA portals, and EASA/FAA documentation over secondary sources.',
              },
              {
                role: 'user',
                content: `Research the current landing permit and regulatory requirements for ICAO airport code "${icao}"${resolvedAirportName ? ` (${resolvedAirportName})` : ''} (prefix "${icaoPrefix}"). Flight type: ${flightTypeLabel}.${aircraftRegistration ? ` Aircraft registration prefix: ${aircraftRegistration}.` : ''}${aircraftNationality ? ` Aircraft nationality/country of registration: ${aircraftNationality}.` : ''}

Please search official AIP publications, CAA websites, and ICAO documentation for:
1. Whether a landing permit is required (yes/no/conditional) and from which authority — check the country's AIP GEN 1.2 or equivalent
2. Any TCO (Third Country Operator) authorization requirements for EU/UK destinations — specifically whether these apply based on the aircraft's country of registration
3. Relevant bilateral air service agreements between the aircraft's country of registration and the destination country
4. Charter/non-scheduled commercial permit requirements if applicable
5. Any sanctions, restrictions, curfews, or special regulatory warnings
6. Lead times in business days for any permits required

Prioritize official CAA websites, EASA, UK CAA, FAA, and AIP sources. Provide specific, accurate information based on current regulations.`,
              },
            ],
            search_domain_filter: [
              'ead.eurocontrol.int',
              'icao.int',
              'easa.europa.eu',
              'caa.co.uk',
              'faa.gov',
              'iata.org',
              'skybrary.aero',
              'gcaa.gov.ae',
              'caac.gov.cn',
              'dgca.gov.in',
            ],
            search_recency_filter: 'year',
            max_tokens: 1500,
          }),
        });

        if (perplexityResponse.ok) {
          const perplexityData = await perplexityResponse.json();
          perplexityContext = perplexityData.choices?.[0]?.message?.content || '';
          citations = perplexityData.citations || [];
          console.log(`Perplexity returned ${citations.length} citations`);
        } else {
          console.warn('Perplexity request failed:', perplexityResponse.status);
        }
      } catch (err) {
        console.warn('Perplexity lookup failed, falling back to AI only:', err);
      }
    }

    // ── Step 2: Use Lovable AI to extract structured data (using Perplexity context if available) ──
    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'AI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isPrivateFlight = !flightType || flightType === 'private';

    const prompt = `You are an expert aviation regulatory consultant. Given the ICAO airport code "${icao}" (prefix "${icaoPrefix}"), provide a comprehensive analysis of ALL permit and regulatory requirements for the following flight:

Flight type: ${flightTypeLabel}
${aircraftRegistration ? `Aircraft registration prefix: ${aircraftRegistration}` : ''}
${aircraftNationality ? `Aircraft nationality / country of registration: ${aircraftNationality}` : ''}

${isPrivateFlight ? `CRITICAL — PRIVATE / PART 91 FLIGHT CONTEXT:
This is a FAR Part 91 private flight. This is NON-COMMERCIAL — the aircraft is operated by the owner or for the owner's personal/business use, and is NOT operated for hire or reward. Key implications:
- Many landing permit requirements that appear "conditional" are conditioned on whether the flight is commercial or non-commercial. For this private Part 91 flight, those conditions resolve to NO permit required in most cases.
- Countries that require permits ONLY for commercial or charter operations do NOT require permits for private/Part 91 flights — mark permitRequired as "no" in those cases.
- If a permit is required regardless of flight type (e.g. diplomatic clearances, restricted airspace, specific country policies for ALL foreign aircraft), then mark permitRequired as "yes".
- Charter-specific permits (charterPermitRequired) are NOT applicable to private flights — mark as "not_applicable".
- TCO (Third Country Operator) authorization is a commercial operator safety oversight requirement and does NOT apply to private/Part 91 non-commercial operations.
- Be decisive: apply the Part 91 private non-commercial context to resolve any conditional requirements to a definitive yes/no answer.

` : ''}IMPORTANT — Aircraft Nationality Context:
${aircraftNationality ? `The aircraft is registered in ${aircraftNationality}. You must tailor your analysis based on this:
- For TCO authorization: A ${aircraftNationality}-registered aircraft operating into EU/EASA states requires EASA TCO authorization UNLESS ${aircraftNationality} is itself an EU/EASA member state OR the operation is private/non-commercial (TCO is a commercial operator requirement). Similarly for UK post-Brexit.
- For bilateral air service agreements: Evaluate the agreement between ${aircraftNationality} and the destination country specifically.
- For landing permits: Some countries grant permit-free access to aircraft from countries with open-skies or bilateral agreements with ${aircraftNationality}.
- For charter permits: Requirements often differ based on whether the operator's home state (${aircraftNationality}) has a relevant BASA with the destination country. Not applicable for private flights.` : 'No aircraft nationality specified — provide general requirements applicable to international operators.'}

${perplexityContext ? `## Real-time regulatory research (use this as primary source):
${perplexityContext}

---
` : ''}

Based on the above${perplexityContext ? ' real-time research' : ' knowledge'}, provide an in-depth analysis covering ALL of the following areas:

1. LANDING PERMIT
   - Is a landing permit required? (yes/no/conditional)
   - ${isPrivateFlight ? 'IMPORTANT: Resolve any conditional requirements in the context of a private/Part 91 non-commercial flight. Only return "yes" if a permit is required specifically for private/non-commercial foreign aircraft.' : 'Type of permit (e.g. diplomatic clearance, landing permit, blanket permit, exemption)'}
   - Issuing authority (full name of CAA or ministry)
   - Lead time in business days
   - Conditions under which permit is/isn't needed

2. THIRD COUNTRY OPERATOR (TCO) AUTHORIZATION — CRITICAL FOR EU & UK
   - ${isPrivateFlight ? 'TCO is a commercial operator authorization. For this private Part 91 flight, TCO is NOT applicable — return "not_applicable".' : 'For flights INTO EU/EASA states: Non-EU registered operators require a TCO Authorization issued by EASA.'}
   - ${isPrivateFlight ? '' : 'For flights INTO UK: Post-Brexit, non-UK registered operators need a UK TCO Authorization from the UK CAA.'}
   - Is TCO authorization required for this specific flight type and aircraft registration?
   - Lead time (typically 3–6 months for initial approval)

3. BILATERAL AIR SERVICE AGREEMENT (ASA / BASA)
   - Relevant bilateral or multilateral air service agreements
   - How does the ASA affect permit requirements for this flight type?

4. CHARTER / NON-SCHEDULED COMMERCIAL SPECIFIC REQUIREMENTS
   - ${isPrivateFlight ? 'Not applicable for private Part 91 flights — return "not_applicable" for charterPermitRequired.' : 'Is a separate charter/non-scheduled commercial permit required beyond the landing permit?'}
   - ${isPrivateFlight ? '' : 'Lead time and authority for charter permits'}

5. REGULATORY WARNINGS & SPECIAL SITUATIONS
   - Sanctions, restrictions, political complications
   - Curfews or noise restrictions
   - Slot restrictions, cabotage rules, documentation requirements

Be specific and accurate. For the specific flight type "${flightTypeLabel}", be explicit about whether each requirement applies.`;

    const requestBody = JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: 'You are a precise aviation regulatory expert. Return structured data via the provided tool. Be specific, accurate, and comprehensive — operators depend on this information for safety-critical decisions.',
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
                permitType: { type: 'string', description: 'Type of permit needed' },
                leadTimeDays: { type: 'number', description: 'Typical lead time in business days' },
                issuingAuthority: { type: 'string', description: 'Full name of authority that issues the landing permit' },
                conditions: { type: 'string', description: 'Conditions under which a permit is or is not required' },
                overflightPermit: { type: 'string', enum: ['yes', 'no', 'conditional'], description: 'Whether an overflight permit is also needed' },
                tcoRequired: { type: 'string', enum: ['yes', 'no', 'conditional', 'not_applicable'], description: 'Whether Third Country Operator (TCO) authorization is required' },
                tcoAuthority: { type: 'string', description: 'Authority issuing TCO authorization' },
                tcoLeadTimeDays: { type: 'number', description: 'Lead time for TCO authorization in days' },
                tcoNotes: { type: 'string', description: 'Important notes about TCO requirements' },
                bilateralAgreement: { type: 'string', description: 'Relevant bilateral or multilateral air service agreements' },
                bilateralImpact: { type: 'string', description: 'How the bilateral agreement affects permit requirements' },
                charterPermitRequired: { type: 'string', enum: ['yes', 'no', 'conditional', 'not_applicable'], description: 'Whether an additional charter/non-scheduled commercial permit is required' },
                charterPermitAuthority: { type: 'string', description: 'Authority issuing charter permits' },
                charterLeadTimeDays: { type: 'number', description: 'Lead time specifically for charter permits in business days' },
                charterPermitNotes: { type: 'string', description: 'Details about charter permit process' },
                regulatoryWarnings: { type: 'array', items: { type: 'string' }, description: 'List of important regulatory warnings and special situations' },
                notes: { type: 'string', description: 'Additional important notes, including practical advice for operators' },
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
        headers: { 'Authorization': `Bearer ${lovableApiKey}`, 'Content-Type': 'application/json' },
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
        const status = aiResponse.status;
        if (status === 402) {
          return new Response(
            JSON.stringify({ success: false, error: 'Usage limit reached. Please add credits to continue using AI lookups.' }),
            { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        console.error('AI gateway error:', status);
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
        citations,
        groundedByPerplexity: citations.length > 0,
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
