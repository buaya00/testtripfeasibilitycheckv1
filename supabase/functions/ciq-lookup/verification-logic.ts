// Pure, side-effect-free decision logic for ciq-lookup's two-pass
// verification. Deliberately has ZERO Deno-specific imports/globals so the
// exact same module can be imported both by the Deno Edge Function at
// runtime and by the Vite/vitest test suite for automated testing without a
// Deno runtime or any live/paid API calls — same pattern as
// permit-lookup/verification-logic.ts.
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
// THE FIX: never let an ungrounded guess stand as the final answer. If the
// first pass has no grounding, attempt one differently-worded second pass.
// If NEITHER pass is grounded, the final answer is 'unknown' — explicitly,
// regardless of what either pass's LLM call guessed — not silently
// defaulted to 'no' and not left as an unlabeled low-confidence 'no'/'yes'.

export type CiqAvailability = 'yes' | 'no' | 'limited' | 'unknown';
export type CiqConfidence = 'high' | 'medium' | 'low';
export type CiqEvidenceQuality = 'grounded' | 'ungrounded';

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

/**
 * Combines a primary pass and an optional second pass into the final,
 * caller-facing result. secondPass is null when a second pass was not
 * attempted at all (shouldAttemptSecondPass returned false) OR could not be
 * attempted (e.g. missing API key) — both are treated identically: fall
 * back to "no grounded evidence" handling rather than trusting the
 * ungrounded primary guess.
 */
export function resolveCiqAvailability(
  primary: CiqPassResult,
  secondPass: CiqPassResult | null
): ResolvedCiqResult {
  if (primary.grounded) {
    return {
      ciqAvailable: primary.ciqAvailable,
      confidence: primary.confidence,
      evidenceQuality: 'grounded',
      secondPassAttempted: false,
    };
  }

  if (secondPass && secondPass.grounded) {
    return {
      ciqAvailable: secondPass.ciqAvailable,
      confidence: secondPass.confidence,
      evidenceQuality: 'grounded',
      secondPassAttempted: true,
    };
  }

  // Neither pass was grounded (or no second pass could be attempted at
  // all): never surface either pass's raw guess as the answer.
  return {
    ciqAvailable: 'unknown',
    confidence: null,
    evidenceQuality: 'ungrounded',
    secondPassAttempted: secondPass !== null,
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
