import { scrapeOfficialSources } from '../_shared/firecrawl-scrape.ts';
import { searchIndustryEvidence } from '../_shared/industry-evidence-search.ts';
import {
  shouldAttemptSecondPass,
  shouldAttemptIndustryPass,
  resolveCiqAvailability,
  secondPassSearchQuery,
  industryPassSearchQuery,
  type CiqPassResult,
} from './verification-logic.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface CiqExtraction {
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
}

type ExtractionOutcome =
  | { ok: true; extraction: CiqExtraction; grounded: boolean }
  | { ok: false; errorResponse: Response };

/**
 * Runs one CIQ extraction pass: an OpenRouter/Gemini call, optionally
 * grounded by firecrawlContext. "grounded" reflects ONLY whether real,
 * non-empty scraped content was actually provided to the model for THIS
 * call — never inferred from the model's own self-reported confidence,
 * which is a separate, independent signal.
 */
async function runCiqExtraction(
  icao: string,
  firecrawlContext: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExtractionOutcome> {
  const icaoPrefix = icao.substring(0, 2);
  const prompt = `Given the ICAO airport code "${icao}" (prefix "${icaoPrefix}"), determine whether Customs, Immigration, and Quarantine (CIQ) services are available at this airport for general aviation and private jet operations.

${firecrawlContext ? `## Official eAIP / CAA scraped data (highest priority source):\n${firecrawlContext}\n\n---\n` : ''}
Consider:
- The country this ICAO prefix belongs to
- Whether this airport is an international airport or port of entry
- Whether CIQ/customs clearance is available for GA/private flights
- Whether CIQ is available 24/7 or only during specific hours
- Whether advance notice is required for CIQ services
- Any fees or special arrangements needed
- Alternative nearby airports with CIQ if this one doesn't have it

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
  return { ok: true, extraction, grounded: firecrawlContext.trim().length > 0 };
}

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

    const apiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'AI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // TEMPORARY DIAGNOSTIC — remove once the "no results across all
    // airports" issue is root-caused. Not a permanent field.
    const firecrawlKeyPresentAtStart = !!Deno.env.get('FIRECRAWL_API_KEY');

    // TEMPORARY DIAGNOSTIC — a raw, standalone Firecrawl search call,
    // completely separate from scrapeOfficialSources, purely to capture
    // the actual HTTP status code. scrapeOfficialSources only logs this
    // via console.warn internally and never returns it to the caller, and
    // the Supabase dashboard Logs page has been unable to show us that
    // console output today — this surfaces the same fact directly in the
    // JSON response instead, via the Network tab.
    let rawFirecrawlSearchStatus: number | null = null;
    let rawFirecrawlSearchError: string | null = null;
    let rawFirecrawlResultCount: number | null = null;
    try {
      const rawFcKey = Deno.env.get('FIRECRAWL_API_KEY');
      if (rawFcKey) {
        const rawRes = await fetch('https://api.firecrawl.dev/v1/search', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${rawFcKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `${icao} customs immigration CIQ international port of entry`,
            limit: 2,
            scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
          }),
        });
        rawFirecrawlSearchStatus = rawRes.status;
        if (rawRes.ok) {
          const rawData = await rawRes.json();
          const rawResults = rawData.data || rawData.results || [];
          rawFirecrawlResultCount = Array.isArray(rawResults) ? rawResults.length : null;
        } else {
          rawFirecrawlSearchError = await rawRes.text();
        }
      }
    } catch (e) {
      rawFirecrawlSearchError = e instanceof Error ? e.message : String(e);
    }

    // ── Primary pass ──────────────────────────────────────────────────
    const { combinedContent: primaryContext, results: primaryResults } = await scrapeOfficialSources(icao, 'ciq');
    if (primaryContext) {
      console.log(`Firecrawl CIQ context (primary): ${primaryContext.length} chars`);
    }

    const primaryOutcome = await runCiqExtraction(icao, primaryContext, apiKey);
    if (!primaryOutcome.ok) {
      return primaryOutcome.errorResponse;
    }

    const primaryPass: CiqPassResult = {
      ciqAvailable: primaryOutcome.extraction.ciqAvailable,
      confidence: primaryOutcome.extraction.confidence,
      grounded: primaryOutcome.grounded,
    };

    // ── Optional second pass, only when the primary pass found nothing
    // to ground its answer in. Never triggered by low confidence alone —
    // see verification-logic.ts for why. ──────────────────────────────
    let secondPass: CiqPassResult | null = null;
    let secondExtraction: CiqExtraction | null = null;
    let secondResults: unknown[] = [];
    if (shouldAttemptSecondPass(primaryPass)) {
      console.log(`CIQ primary pass ungrounded for ${icao} — attempting second pass with a broader query`);
      const { combinedContent: secondContext, results: secondResultsRaw } = await scrapeOfficialSources(
        icao,
        'ciq',
        { searchQuery: secondPassSearchQuery(icao), maxPages: 3 }
      );
      secondResults = secondResultsRaw;
      if (secondContext) {
        console.log(`Firecrawl CIQ context (second pass): ${secondContext.length} chars`);
      }
      const secondOutcome = await runCiqExtraction(icao, secondContext, apiKey);
      if (secondOutcome.ok) {
        secondExtraction = secondOutcome.extraction;
        secondPass = {
          ciqAvailable: secondOutcome.extraction.ciqAvailable,
          confidence: secondOutcome.extraction.confidence,
          grounded: secondOutcome.grounded,
        };
      } else {
        // Deliberately swallowed, not propagated as the overall response:
        // we still have a (ungrounded) primary answer, and
        // resolveCiqAvailability treats secondPass: null as "could not
        // attempt", collapsing safely to 'unknown' rather than failing
        // the whole request over a second-pass-only hiccup.
        console.warn(`CIQ second pass call failed for ${icao}; treating as ungrounded`);
      }
    }

    const resolved = resolveCiqAvailability(primaryPass, secondPass);

    // ── Optional third pass: curated industry sources, only when BOTH
    // generic passes above found no grounded answer at all. Uses
    // Firecrawl's search directly (no scrapeOfficialSources — that
    // function's Strategy 2 static-URL fallback is government-specific and
    // not applicable here) filtered strictly to the curated industry
    // domain list; a result from any other domain is never accepted, no
    // matter how well it ranks. ──────────────────────────────────────────
    let industryPass: CiqPassResult | null = null;
    let industryExtraction: CiqExtraction | null = null;
    let industryResultForDebug: { content: string; sourceUrl: string } | null = null;
    let industryKeyPresent = false;
    if (shouldAttemptIndustryPass(primaryPass, secondPass)) {
      console.log(`CIQ government/generic passes both ungrounded for ${icao} — attempting curated-industry-source pass`);
      const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
      industryKeyPresent = !!firecrawlApiKey;
      const industryResult = await searchIndustryEvidence(industryPassSearchQuery(icao), firecrawlApiKey);
      industryResultForDebug = industryResult;
      const industryContext = industryResult?.content ?? '';
      if (industryContext) {
        console.log(`Industry evidence context for ${icao}: ${industryContext.length} chars from ${industryResult?.sourceUrl}`);
      }
      const industryOutcome = await runCiqExtraction(icao, industryContext, apiKey);
      if (industryOutcome.ok) {
        industryExtraction = industryOutcome.extraction;
        industryPass = {
          ciqAvailable: industryOutcome.extraction.ciqAvailable,
          confidence: industryOutcome.extraction.confidence,
          grounded: industryOutcome.grounded,
        };
      } else {
        // Same reasoning as the second-pass failure handling above:
        // swallowed here, not propagated as the overall response — we
        // still have the generic passes' results, and resolveCiqAvailability
        // treats industryPass: null as "could not attempt".
        console.warn(`CIQ industry pass call failed for ${icao}; treating as ungrounded`);
      }
    }

    const finalResolved = resolveCiqAvailability(primaryPass, secondPass, industryPass);
    console.log(`CIQ final resolution for ${icao}: ciqAvailable=${finalResolved.ciqAvailable}, evidenceQuality=${finalResolved.evidenceQuality}, sourceType=${finalResolved.sourceType ?? '(none)'}`);

    // Use whichever pass's extracted descriptive fields (country, hours,
    // etc.) actually produced the grounded answer; fall back to the
    // primary extraction otherwise (including the all-ungrounded case,
    // where ciqAvailable is overridden to 'unknown' regardless).
    const sourceExtraction = finalResolved.sourceType === 'industry' && industryExtraction
      ? industryExtraction
      : (!primaryPass.grounded && secondExtraction)
        ? secondExtraction
        : primaryOutcome.extraction;

    return new Response(
      JSON.stringify({
        success: true,
        icao,
        country: sourceExtraction.country,
        airportName: sourceExtraction.airportName,
        ciqAvailable: finalResolved.ciqAvailable,
        isPortOfEntry: sourceExtraction.isPortOfEntry,
        operatingHours: sourceExtraction.operatingHours,
        advanceNotice: sourceExtraction.advanceNotice,
        fees: sourceExtraction.fees,
        alternateAirports: sourceExtraction.alternateAirports,
        notes: finalResolved.evidenceQuality === 'ungrounded'
          ? `Could not find grounded, official information about CIQ availability at ${icao} after checking government and industry sources.${sourceExtraction.notes ? ` ${sourceExtraction.notes}` : ''}`
          : sourceExtraction.notes,
        confidence: finalResolved.confidence,
        evidenceQuality: finalResolved.evidenceQuality,
        secondPassAttempted: finalResolved.secondPassAttempted,
        industryPassAttempted: finalResolved.industryPassAttempted,
        sourceType: finalResolved.sourceType,
        // TEMPORARY DIAGNOSTIC BLOCK — remove once root-caused. Never a
        // permanent field; exists only to see what each search attempt
        // actually returned via the browser Network tab, since the
        // Supabase dashboard Logs page has been unreliable.
        _debug: {
          firecrawlKeyPresentAtStart,
          rawFirecrawlSearchStatus,
          rawFirecrawlSearchError,
          rawFirecrawlResultCount,
          primaryResultsCount: primaryResults.length,
          primaryContextLength: primaryContext.length,
          secondPassRan: shouldAttemptSecondPass(primaryPass),
          secondResultsCount: secondResults.length,
          industryPassRan: shouldAttemptIndustryPass(primaryPass, secondPass),
          industryKeyPresent,
          industryResultFound: industryResultForDebug !== null,
          industrySourceUrl: industryResultForDebug?.sourceUrl ?? null,
          industryContentLength: industryResultForDebug?.content?.length ?? 0,
        },
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
