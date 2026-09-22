// Pure, side-effect-free decision logic for ciq-lookup's three-tier
// verification (government/generic search, a broader second attempt, then
// a curated industry-source fallback). Deliberately has ZERO Deno-specific
// imports/globals so the exact same module can be imported both by the
// Deno Edge Function at runtime and by the Vite/vitest test suite for
// automated testing without a Deno runtime or any live/paid API calls —
// same pattern as permit-lookup/verification-logic.ts.
//
// THE BUG THIS FIXES: ciq-lookup asks an LLM to judge CIQ (Customs,
// Immigration, Quarantine) availability at an airport, optionally grounded
// by a Firecrawl-scraped official source. When Firecrawl's search AND its
// curated-URL fallback both come back empty, the LLM was still asked for —
// and gave — a confident yes/no/limited answer from general knowledge
// alone, with no way for the caller to tell an ungrounded guess apart from
// a well-supported one. Observed failure: LFPB (a well-known CIQ-available
// airport) was reported as unavailable on one run, then correctly reported
// as available on a re-run — a plain model-variance miss on an ungrounded
// guess, not a scraping bug (Firecrawl itself was healthy at the time).
//
// THE FIX (extended): never let an ungrounded guess stand as the final
// answer. If the first pass has no grounding, attempt a differently-worded
// second pass. If that is ALSO ungrounded, attempt a third pass scoped to a
// small, independently-verified list of business-aviation trip-support
// publishers (see ../_shared/industry-evidence-sources.ts) — the same
// government-then-industry two-tier model used by permit-lookup. Only if
// ALL THREE passes are ungrounded is the final answer 'unknown' —
// explicitly, regardless of what any pass's LLM call guessed.

export type CiqAvailability = 'yes' | 'no' | 'limited' | 'unknown';
export type CiqConfidence = 'high' | 'medium' | 'low';
export type CiqEvidenceQuality = 'grounded' | 'ungrounded';
/** 'government' = a national/official source found via the generic Firecrawl search (primary or second pass). 'industry' = a curated business-aviation trip-support publisher, used only when neither generic pass grounded an answer. Always surfaced to the user — these carry different weight. */
export type CiqSourceType = 'government' | 'industry';

/** Result of one extraction attempt (one Firecrawl-context-then-LLM pass). */
export interface CiqPassResult {
  ciqAvailable: 'yes' | 'no' | 'limited';
  confidence: CiqConfidence;
  /** True only when the Firecrawl scrape/search for this pass returned real, non-empty content — never inferred from the LLM's own stated confidence. */
  grounded: boolean;
}

export interface ResolvedCiqResult {
  ciqAvailable: CiqAvailability;
  /** null only when evidenceQuality is 'ungrounded' — there is no confidence rating worth trusting for an admitted-unknown result. */
  confidence: CiqConfidence | null;
  evidenceQuality: CiqEvidenceQuality;
  secondPassAttempted: boolean;
  /** True only when the industry tier was actually attempted (both generic passes were ungrounded first). */
  industryPassAttempted: boolean;
  /** Which tier actually produced the grounded answer, when one was found — undefined when evidenceQuality is 'ungrounded'. */
  sourceType?: CiqSourceType;
}

/**
 * Whether a second, differently-worded verification pass should be
 * attempted. Deliberately keyed ONLY on grounding, not on confidence: a
 * grounded-but-low-confidence answer is left as-is (the low confidence is
 * surfaced to the user instead — see the frontend), rather than chasing an
 * open-ended "what if the second pass is also low-confidence" regress.
 */
export function shouldAttemptSecondPass(primary: Pick<CiqPassResult, 'grounded'>): boolean {
  return !primary.grounded;
}

/** Whether the curated-industry-source tier should be attempted — only once both the primary and second generic passes have failed to ground an answer. */
export function shouldAttemptIndustryPass(
  primary: Pick<CiqPassResult, 'grounded'>,
  secondPass: Pick<CiqPassResult, 'grounded'> | null,
): boolean {
  return !primary.grounded && !(secondPass?.grounded ?? false);
}

/**
 * Combines up to three passes into the final, caller-facing result.
 * secondPass/industryPass are null when that tier was not attempted at all
 * (the corresponding should-attempt check returned false) OR could not be
 * attempted (e.g. missing API key) — both are treated identically: fall
 * through to the next tier, or to "no grounded evidence" handling, rather
 * than trusting an ungrounded guess from any tier.
 */
export function resolveCiqAvailability(
  primary: CiqPassResult,
  secondPass: CiqPassResult | null,
  industryPass: CiqPassResult | null = null,
): ResolvedCiqResult {
  if (primary.grounded) {
    return {
      ciqAvailable: primary.ciqAvailable,
      confidence: primary.confidence,
      evidenceQuality: 'grounded',
      secondPassAttempted: false,
      industryPassAttempted: false,
      sourceType: 'government',
    };
  }

  if (secondPass && secondPass.grounded) {
    return {
      ciqAvailable: secondPass.ciqAvailable,
      confidence: secondPass.confidence,
      evidenceQuality: 'grounded',
      secondPassAttempted: true,
      industryPassAttempted: false,
      sourceType: 'government',
    };
  }

  if (industryPass && industryPass.grounded) {
    return {
      ciqAvailable: industryPass.ciqAvailable,
      confidence: industryPass.confidence,
      evidenceQuality: 'grounded',
      secondPassAttempted: secondPass !== null,
      industryPassAttempted: true,
      sourceType: 'industry',
    };
  }

  // No tier was grounded: never surface any tier's raw guess as the answer.
  return {
    ciqAvailable: 'unknown',
    confidence: null,
    evidenceQuality: 'ungrounded',
    secondPassAttempted: secondPass !== null,
    industryPassAttempted: industryPass !== null,
  };
}

/**
 * A broader, differently-phrased search query for the second pass, so it
 * has a genuine chance of finding something the primary pass's exact query
 * missed — reusing the identical query would just fail identically, since
 * scrapeOfficialSources' own search-then-fallback-URL strategy is
 * deterministic for a given query.
 */
export function secondPassSearchQuery(icao: string): string {
  return `${icao} airport customs hours general aviation international arrivals FBO`;
}

/** Query for the curated-industry-source tier — deliberately framed around trip-support/business-aviation terminology, matching the kind of content these specific publishers actually write. */
export function industryPassSearchQuery(icao: string): string {
  return `${icao} airport customs immigration business aviation trip support`;
}

