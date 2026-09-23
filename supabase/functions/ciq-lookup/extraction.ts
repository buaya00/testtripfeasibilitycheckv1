// Network orchestration for a single CIQ extraction pass (one OpenRouter/
// Gemini call, optionally grounded by scraped source content). Extracted
// from ciq-lookup/index.ts into its own Deno-free module — the same
// separation already used for permit-lookup (verification-logic.ts /
// verification-runtime.ts) — specifically so this function can be imported
// and tested directly under vitest with a mocked fetch, without also
// importing index.ts's top-level Deno.serve(...) call, which would crash
// immediately outside a Deno runtime.

export interface CiqExtraction {
  country: string;
  airportName?: string;
  ciqAvailable: 'yes' | 'no' | 'limited';
  isPortOfEntry?: boolean;
  operatingHours?: string;
  advanceNotice?: string;
  fees?: string;
  alternateAirports?: string;
  notes?: string;
  confidence: 'high' | 'medium' | 'low';
  /**
   * Internal-only signal, never exposed in the API response: whether the
   * scraped source content provided to THIS call (if any) actually
   * discusses CIQ/customs/immigration/port-of-entry procedures for this
   * specific airport/ICAO code — not merely whether the source is about
   * the right airport or country in some general sense. False whenever no
   * source content was provided, the provided content is genuinely about a
   * different airport or country (e.g. US CBP procedures returned for a
   * France query), OR the content is genuinely about the correct airport
   * but says nothing about customs/CIQ specifically (e.g. a source
   * describing an airport as "business-aviation-friendly" or listing its
   * runway data, from which CIQ availability would have to be inferred
   * rather than read directly). The model is required to state this
   * explicitly rather than have grounding inferred from the model's own
   * confidence or narrative text, which was the bug: earlier extractions
   * could correctly note in prose that a source was "not relevant to
   * LFPB" while the code still treated the pass as grounded, high-
   * confidence, government-sourced truth, purely because non-empty text
   * had been scraped from somewhere. A narrower version of the same bug
   * persisted even after requiring the source to be about the right
   * airport: a source genuinely about LFPB that never mentions customs at
   * all could still be marked relevant, and the model would then
   * extrapolate ("suggests comprehensive CIQ services are available")
   * rather than report an actual absence of evidence — this field's
   * description now requires topical relevance to CIQ specifically, not
   * just airport/country relevance.
   */
  sourceRelevant: boolean;
}

export type ExtractionOutcome =
  | { ok: true; extraction: CiqExtraction; grounded: boolean }
  | { ok: false; errorResponse: Response };

/**
 * Runs one CIQ extraction pass: an OpenRouter/Gemini call, optionally
 * grounded by firecrawlContext. "grounded" requires BOTH that real,
 * non-empty scraped content was actually provided to the model for THIS
 * call, AND that the model explicitly confirms (via the required
 * sourceRelevant field, not inferred from prose or self-reported
 * confidence) that the content is actually about this airport/country —
 * never merely that some non-empty text came back from a search. A
 * defense-in-depth check enforces the non-empty-content requirement here
 * regardless of what the model reports, since an empty-context call
 * incorrectly claiming relevance must never count as grounded.
 */
export async function runCiqExtraction(
  icao: string,
  firecrawlContext: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  corsHeaders: Record<string, string> = {},
): Promise<ExtractionOutcome> {
  const icaoPrefix = icao.substring(0, 2);
  const prompt = `Given the ICAO airport code "${icao}" (prefix "${icaoPrefix}"), determine whether Customs, Immigration, and Quarantine (CIQ) services are available at this airport for general aviation and private jet operations.

${firecrawlContext ? `## Official eAIP / CAA scraped data (highest priority source, IF it actually discusses this airport/country — see sourceRelevant below):\n${firecrawlContext}\n\n---\n` : ''}
Consider:
- The country this ICAO prefix belongs to
- Whether this airport is an international airport or port of entry
- Whether CIQ/customs clearance is available for GA/private flights
- Whether CIQ is available 24/7 or only during specific hours
- Whether advance notice is required for CIQ services
- Any fees or special arrangements needed
- Alternative nearby airports with CIQ if this one doesn't have it

CRITICAL: if scraped source data was provided above, you MUST independently verify it actually specifically discusses CUSTOMS, IMMIGRATION, or CIQ/port-of-entry PROCEDURES for THIS airport (${icao}) before treating it as evidence — not merely that the source is about the right airport or country in some general sense. Two distinct failure modes to watch for: (1) the source can be about a completely different country or agency (for example, US Customs and Border Protection content returned for a French airport query) — in this case sourceRelevant must be false; (2) the source can be genuinely about the correct airport but never actually mention customs/immigration/CIQ at all (for example, a page about the airport's runways, general business-aviation friendliness, or FBO services) — this is ALSO not relevant evidence, even though it is about the right airport, and sourceRelevant must be false here too. Do not infer or extrapolate CIQ availability from an airport's general characteristics (e.g. "it's a major international gateway, so it must have full CIQ services") when the source itself does not state this — that is exactly the kind of confident-but-unsupported claim this check exists to prevent. If no source data was provided above at all, sourceRelevant must be false. Only set sourceRelevant to true when the source explicitly discusses customs, immigration, CIQ, or port-of-entry status/procedures for this specific airport.

Provide your best assessment based on known aviation information about this airport.`;

  const aiResponse = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
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
                sourceRelevant: { type: 'boolean', description: 'True only if scraped source data was provided above AND it specifically discusses customs, immigration, CIQ, or port-of-entry status/procedures for THIS exact airport/ICAO code. False if no source data was provided, the data is about a different airport/country, OR the data is genuinely about this airport but never actually mentions customs/immigration/CIQ (e.g. only discusses runways, general business-aviation friendliness, or FBO services) -- do not set this true based on an inference or extrapolation from general airport characteristics.' },
              },
              required: ['country', 'ciqAvailable', 'confidence', 'sourceRelevant'],
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
      return { ok: false, errorResponse: new Response(
        JSON.stringify({ success: false, error: 'Rate limit exceeded, please try again shortly' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      ) };
    }
    if (status === 402) {
      return { ok: false, errorResponse: new Response(
        JSON.stringify({ success: false, error: 'Usage limit reached. Please add credits to continue using AI lookups.' }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      ) };
    }
    console.error('AI gateway error:', status);
    return { ok: false, errorResponse: new Response(
      JSON.stringify({ success: false, error: 'AI lookup failed' }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    ) };
  }

  const aiData = await aiResponse.json();
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

  if (!toolCall?.function?.arguments) {
    return { ok: false, errorResponse: new Response(
      JSON.stringify({ success: false, error: 'Could not determine CIQ availability' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    ) };
  }

  const extraction = JSON.parse(toolCall.function.arguments) as CiqExtraction;
  // Defense in depth: never trust the model's sourceRelevant claim alone —
  // an empty-context call must never be grounded regardless of what the
  // model reports for a field it was told to always set false in that case.
  const grounded = firecrawlContext.trim().length > 0 && extraction.sourceRelevant === true;
  return { ok: true, extraction, grounded };
}

export interface IndustryCandidate {
  content: string;
  sourceUrl: string;
}

export interface IndustryCandidateResolution {
  /** The grounded outcome, if any candidate was confirmed genuinely relevant. */
  grounded: { extraction: CiqExtraction; sourceUrl: string } | null;
  /** The last successfully-extracted (but not grounded) result, kept only as a descriptive fallback — never treated as evidence. Undefined if every candidate's extraction call itself failed. */
  lastUngrounded: CiqExtraction | undefined;
}

/**
 * Tries each industry-source candidate IN THE GIVEN ORDER, calling
 * runCiqExtraction for each, and stops at the first one the model confirms
 * (via the same sourceRelevant field every tier uses) is genuinely specific
 * to this airport. This exists because live testing found the top-ranked
 * search result for a specific airport is often a broader country/region
 * guide that never names the airport, while a more specific, airport-level
 * page exists further down the results and was never even tried when only
 * the first candidate was attempted — exactly the mechanism that produced a
 * real false "unable to determine" for an airport a lower-ranked candidate
 * (an AC-U-KWIK-style page explicitly showing "Customs Available: Yes")
 * could have confirmed directly.
 */
export async function resolveIndustryCandidates(
  icao: string,
  candidates: IndustryCandidate[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  corsHeaders: Record<string, string> = {},
): Promise<IndustryCandidateResolution> {
  let lastUngrounded: CiqExtraction | undefined;
  for (const candidate of candidates) {
    const outcome = await runCiqExtraction(icao, candidate.content, apiKey, fetchImpl, corsHeaders);
    if (!outcome.ok) {
      // Try the next candidate rather than aborting the whole industry tier
      // over one candidate's extraction call failing.
      continue;
    }
    if (outcome.grounded) {
      return { grounded: { extraction: outcome.extraction, sourceUrl: candidate.sourceUrl }, lastUngrounded };
    }
    lastUngrounded = outcome.extraction;
  }
  return { grounded: null, lastUngrounded };
}
