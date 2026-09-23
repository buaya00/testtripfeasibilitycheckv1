import { scrapeOfficialSources } from '../_shared/firecrawl-scrape.ts';
import { searchIndustryEvidence } from '../_shared/industry-evidence-search.ts';
import { runCiqExtraction, resolveIndustryCandidates, type CiqExtraction } from './extraction.ts';
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

    // ── Primary pass ──────────────────────────────────────────────────
    const { combinedContent: primaryContext } = await scrapeOfficialSources(icao, 'ciq');
    if (primaryContext) {
      console.log(`Firecrawl CIQ context (primary): ${primaryContext.length} chars`);
    }

    const primaryOutcome = await runCiqExtraction(icao, primaryContext, apiKey, fetch, corsHeaders);
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
    if (shouldAttemptSecondPass(primaryPass)) {
      console.log(`CIQ primary pass ungrounded for ${icao} — attempting second pass with a broader query`);
      const { combinedContent: secondContext } = await scrapeOfficialSources(
        icao,
        'ciq',
        { searchQuery: secondPassSearchQuery(icao), maxPages: 3 }
      );
      if (secondContext) {
        console.log(`Firecrawl CIQ context (second pass): ${secondContext.length} chars`);
      }
      const secondOutcome = await runCiqExtraction(icao, secondContext, apiKey, fetch, corsHeaders);
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
    // matter how well it ranks.
    //
    // Tries EVERY curated-domain candidate in the search's own ranked
    // order, not just the first — live testing found the top-ranked result
    // for a specific airport is often a broader country/region-level guide
    // that's genuinely about customs in general but never names the
    // specific airport, while a more specific, airport-level page (e.g. an
    // AC-U-KWIK-style profile explicitly confirming "Customs Available:
    // Yes" for that exact ICAO code) exists further down the results and
    // was never attempted when only the first result was tried. Stops at
    // the first candidate the SAME sourceRelevant check every other tier
    // already uses confirms is genuinely specific to this airport — a
    // broader guide's inferred answer is never accepted just because nothing
    // more specific was tried first. ────────────────────────────────────
    let industryPass: CiqPassResult | null = null;
    let industryExtraction: CiqExtraction | null = null;
    if (shouldAttemptIndustryPass(primaryPass, secondPass)) {
      console.log(`CIQ government/generic passes both ungrounded for ${icao} — attempting curated-industry-source pass`);
      const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
      const industryCandidates = await searchIndustryEvidence(industryPassSearchQuery(icao), firecrawlApiKey);
      console.log(`Industry evidence search for ${icao} returned ${industryCandidates.length} curated-domain candidate(s)`);
      const resolution = await resolveIndustryCandidates(icao, industryCandidates, apiKey, fetch, corsHeaders);
      if (resolution.grounded) {
        console.log(`Industry tier grounded for ${icao} via ${resolution.grounded.sourceUrl}`);
        industryExtraction = resolution.grounded.extraction;
        industryPass = {
          ciqAvailable: resolution.grounded.extraction.ciqAvailable,
          confidence: resolution.grounded.extraction.confidence,
          grounded: true,
        };
      } else if (resolution.lastUngrounded) {
        industryExtraction = resolution.lastUngrounded;
        industryPass = {
          ciqAvailable: resolution.lastUngrounded.ciqAvailable,
          confidence: resolution.lastUngrounded.confidence,
          grounded: false,
        };
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
