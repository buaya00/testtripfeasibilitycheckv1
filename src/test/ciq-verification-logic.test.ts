import { describe, it, expect } from "vitest";
import {
  shouldAttemptSecondPass,
  shouldAttemptIndustryPass,
  resolveCiqAvailability,
  secondPassSearchQuery,
  industryPassSearchQuery,
  type CiqPassResult,
} from "../../supabase/functions/ciq-lookup/verification-logic";

// These tests exercise the actual pure decision-logic module used by
// ciq-lookup, mirroring the permit-verification-logic test style. The
// scenario they lock in: LFPB (a well-known CIQ-available airport) was
// reported unavailable on one run and correctly available on a re-run —
// a plain ungrounded-LLM-guess miss, not a scraping bug. The fix must
// never let an ungrounded guess (from any pass) stand as a confident
// yes/no/limited answer — extended to a third, curated-industry-source
// tier when both generic passes come back ungrounded, mirroring
// permit-lookup's government-then-industry two-tier evidence model.

function pass(overrides: Partial<CiqPassResult> = {}): CiqPassResult {
  return { ciqAvailable: 'no', confidence: 'high', grounded: true, ...overrides };
}

describe("shouldAttemptSecondPass", () => {
  it("does NOT trigger a second pass when the primary pass is grounded, even at low confidence — low confidence is surfaced to the user instead of chased with more passes", () => {
    expect(shouldAttemptSecondPass({ grounded: true })).toBe(false);
  });

  it("triggers a second pass when the primary pass has no grounding at all", () => {
    expect(shouldAttemptSecondPass({ grounded: false })).toBe(true);
  });
});

describe("shouldAttemptIndustryPass", () => {
  it("does NOT trigger when the primary pass is already grounded", () => {
    expect(shouldAttemptIndustryPass({ grounded: true }, null)).toBe(false);
    expect(shouldAttemptIndustryPass({ grounded: true }, { grounded: false })).toBe(false);
  });

  it("does NOT trigger when the second pass is grounded, even if the primary was not", () => {
    expect(shouldAttemptIndustryPass({ grounded: false }, { grounded: true })).toBe(false);
  });

  it("triggers only when BOTH the primary and second pass have no grounding", () => {
    expect(shouldAttemptIndustryPass({ grounded: false }, { grounded: false })).toBe(true);
  });

  it("triggers when primary is ungrounded and no second pass was even attempted (null)", () => {
    expect(shouldAttemptIndustryPass({ grounded: false }, null)).toBe(true);
  });
});

describe("resolveCiqAvailability — the core fix (government tier)", () => {
  it("trusts a grounded primary pass as-is and does not attempt/require a second or industry pass", () => {
    const primary = pass({ ciqAvailable: 'yes', confidence: 'high', grounded: true });
    const result = resolveCiqAvailability(primary, null);
    expect(result).toEqual({
      ciqAvailable: 'yes',
      confidence: 'high',
      evidenceQuality: 'grounded',
      secondPassAttempted: false,
      industryPassAttempted: false,
      sourceType: 'government',
    });
  });

  it("preserves a grounded primary pass's low confidence rather than upgrading or hiding it", () => {
    const primary = pass({ ciqAvailable: 'limited', confidence: 'low', grounded: true });
    const result = resolveCiqAvailability(primary, null);
    expect(result.ciqAvailable).toBe('limited');
    expect(result.confidence).toBe('low');
    expect(result.evidenceQuality).toBe('grounded');
    expect(result.sourceType).toBe('government');
  });

  it("THE LFPB CASE: ungrounded primary guessing 'no', grounded second pass correctly finding 'yes' — final answer uses the second pass, not the ungrounded first guess, sourceType still 'government' (both generic passes are government/official-search tier)", () => {
    const primary = pass({ ciqAvailable: 'no', confidence: 'medium', grounded: false });
    const secondPass = pass({ ciqAvailable: 'yes', confidence: 'high', grounded: true });
    const result = resolveCiqAvailability(primary, secondPass);
    expect(result).toEqual({
      ciqAvailable: 'yes',
      confidence: 'high',
      evidenceQuality: 'grounded',
      secondPassAttempted: true,
      industryPassAttempted: false,
      sourceType: 'government',
    });
  });

  it("every ciqAvailable value (yes/no/limited) passes through unchanged when grounded", () => {
    for (const value of ['yes', 'no', 'limited'] as const) {
      const result = resolveCiqAvailability(pass({ ciqAvailable: value, grounded: true }), null);
      expect(result.ciqAvailable).toBe(value);
    }
  });
});

describe("resolveCiqAvailability — industry tier fallback", () => {
  it("both generic passes ungrounded, industry pass grounded -> final answer uses the industry pass, tagged sourceType 'industry'", () => {
    const primary = pass({ ciqAvailable: 'no', confidence: 'medium', grounded: false });
    const secondPass = pass({ ciqAvailable: 'no', confidence: 'medium', grounded: false });
    const industryPass = pass({ ciqAvailable: 'yes', confidence: 'high', grounded: true });
    const result = resolveCiqAvailability(primary, secondPass, industryPass);
    expect(result).toEqual({
      ciqAvailable: 'yes',
      confidence: 'high',
      evidenceQuality: 'grounded',
      secondPassAttempted: true,
      industryPassAttempted: true,
      sourceType: 'industry',
    });
  });

  it("primary ungrounded, no second pass attempted, industry pass grounded -> still resolves via industry", () => {
    const primary = pass({ ciqAvailable: 'no', confidence: 'medium', grounded: false });
    const industryPass = pass({ ciqAvailable: 'limited', confidence: 'medium', grounded: true });
    const result = resolveCiqAvailability(primary, null, industryPass);
    expect(result.ciqAvailable).toBe('limited');
    expect(result.sourceType).toBe('industry');
    expect(result.industryPassAttempted).toBe(true);
  });

  it("ALL THREE passes ungrounded: final answer is 'unknown', REGARDLESS of what any pass's LLM call guessed — never silently defaults to 'no'", () => {
    const primary = pass({ ciqAvailable: 'no', confidence: 'high', grounded: false });
    const secondPass = pass({ ciqAvailable: 'yes', confidence: 'high', grounded: false });
    const industryPass = pass({ ciqAvailable: 'yes', confidence: 'high', grounded: false });
    const result = resolveCiqAvailability(primary, secondPass, industryPass);
    expect(result.ciqAvailable).toBe('unknown');
    expect(result.confidence).toBeNull();
    expect(result.evidenceQuality).toBe('ungrounded');
    expect(result.secondPassAttempted).toBe(true);
    expect(result.industryPassAttempted).toBe(true);
    expect(result.sourceType).toBeUndefined();
  });

  it("primary ungrounded, no second pass, no industry pass could even be attempted (e.g. missing API key): still 'unknown', not the ungrounded primary guess", () => {
    const primary = pass({ ciqAvailable: 'no', confidence: 'high', grounded: false });
    const result = resolveCiqAvailability(primary, null, null);
    expect(result.ciqAvailable).toBe('unknown');
    expect(result.confidence).toBeNull();
    expect(result.evidenceQuality).toBe('ungrounded');
    expect(result.secondPassAttempted).toBe(false);
    expect(result.industryPassAttempted).toBe(false);
  });

  it("ungrounded primary + ungrounded second + ungrounded industry pass that all happen to agree: still 'unknown' — agreement between ungrounded guesses is not evidence", () => {
    const primary = pass({ ciqAvailable: 'no', confidence: 'high', grounded: false });
    const secondPass = pass({ ciqAvailable: 'no', confidence: 'high', grounded: false });
    const industryPass = pass({ ciqAvailable: 'no', confidence: 'high', grounded: false });
    const result = resolveCiqAvailability(primary, secondPass, industryPass);
    expect(result.ciqAvailable).toBe('unknown');
  });

  it("industry pass is never even considered when the second pass already grounded an answer — sourceType stays 'government'", () => {
    const primary = pass({ ciqAvailable: 'no', confidence: 'medium', grounded: false });
    const secondPass = pass({ ciqAvailable: 'yes', confidence: 'high', grounded: true });
    // Even if an industryPass value were somehow present, it must never be
    // consulted once the second pass already grounded the answer.
    const industryPass = pass({ ciqAvailable: 'no', confidence: 'high', grounded: true });
    const result = resolveCiqAvailability(primary, secondPass, industryPass);
    expect(result.ciqAvailable).toBe('yes');
    expect(result.sourceType).toBe('government');
    expect(result.industryPassAttempted).toBe(false);
  });
});

describe("secondPassSearchQuery", () => {
  it("produces a query distinct from the primary context query, so a second pass has a genuine chance of finding different results", () => {
    const q = secondPassSearchQuery('LFPB');
    expect(q).toContain('LFPB');
    expect(q).not.toBe('LFPB customs immigration CIQ international port of entry');
  });
});

describe("industryPassSearchQuery", () => {
  it("includes the ICAO code and is framed around business-aviation trip-support terminology, distinct from both generic-pass queries", () => {
    const q = industryPassSearchQuery('LFPB');
    expect(q).toContain('LFPB');
    expect(q.toLowerCase()).toContain('business aviation');
    expect(q).not.toBe(secondPassSearchQuery('LFPB'));
  });
});
