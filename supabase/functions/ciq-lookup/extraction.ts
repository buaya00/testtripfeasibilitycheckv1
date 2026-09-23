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
   * discusses this specific airport/ICAO code or its country's CIQ/customs
   * procedures. False whenever no source content was provided, or the
   * provided content is genuinely about a different airport or country
   * (e.g. US CBP procedures returned for a France query — the observed
   * defect this field exists to catch). The model is required to state
   * this explicitly rather than have grounding inferred from the model's
   * own confidence or narrative text, which was the bug: earlier extractions
   * could correctly note in prose that a source was "not relevant to
   * LFPB" while the code still treated the pass as grounded, high-
   * confidence, government-sourced truth, purely because non-empty text
   * had been scraped from somewhere.
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

CRITICAL: if scraped source data was provided above, you MUST independently verify it actually discusses THIS specific airport (${icao}) or its country's CIQ/customs/immigration procedures before treating it as evidence. Scraped search results can sometimes be about a completely different country or agency (for example, US Customs and Border Protection content returned for a French airport query). If the provided content is not genuinely about this airport or its country, set sourceRelevant to false and answer from general aviation knowledge instead — never treat off-topic content as if it were an authoritative source for this airport. If no source data was provided above at all, sourceRelevant must be false.

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
                sourceRelevant: { type: 'boolean', description: 'True only if scraped source data was provided above AND it actually discusses this specific airport/ICAO code or its country\'s CIQ procedures. False if no source data was provided, or the provided data is about a different airport or country.' },
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
