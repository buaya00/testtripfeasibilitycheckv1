import { describe, it, expect } from "vitest";
import {
  shouldAttemptSecondPass,
  resolveCiqAvailability,
  secondPassSearchQuery,
  type CiqPassResult,
} from "../../supabase/functions/ciq-lookup/verification-logic";

// These tests exercise the actual pure decision-logic module used by
// ciq-lookup, mirroring the permit-verification-logic test style. The
// scenario they lock in: LFPB (a well-known CIQ-available airport) was
// reported unavailable on one run and correctly available on a re-run —
// a plain ungrounded-LLM-guess miss, not a scraping bug. The fix must
// never let an ungrounded guess (from either pass) stand as a confident
// yes/no/limited answer.

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

describe("resolveCiqAvailability — the core fix", () => {
  it("trusts a grounded primary pass as-is and does not attempt/require a second pass", () => {
    const primary = pass({ ciqAvailable: 'yes', confidence: 'high', grounded: true });
    const result = resolveCiqAvailability(primary, null);
    expect(result).toEqual({
      ciqAvailable: 'yes',
      confidence: 'high',
      evidenceQuality: 'grounded',
      secondPassAttempted: false,
    });
  });

  it("preserves a grounded primary pass's low confidence rather than upgrading or hiding it", () => {
    const primary = pass({ ciqAvailable: 'limited', confidence: 'low', grounded: true });
    const result = resolveCiqAvailability(primary, null);
    expect(result.ciqAvailable).toBe('limited');
    expect(result.confidence).toBe('low');
    expect(result.evidenceQuality).toBe('grounded');
  });

  it("THE LFPB CASE: ungrounded primary guessing 'no', grounded second pass correctly finding 'yes' — final answer uses the second pass, not the ungrounded first guess", () => {
    const primary = pass({ ciqAvailable: 'no', confidence: 'medium', grounded: false });
    const secondPass = pass({ ciqAvailable: 'yes', confidence: 'high', grounded: true });
    const result = resolveCiqAvailability(primary, secondPass);
    expect(result).toEqual({
      ciqAvailable: 'yes',
      confidence: 'high',
      evidenceQuality: 'grounded',
      secondPassAttempted: true,
    });
  });

  it("both passes ungrounded: final answer is 'unknown', REGARDLESS of what either pass's LLM call guessed — never silently defaults to 'no'", () => {
    const primary = pass({ ciqAvailable: 'no', confidence: 'high', grounded: false });
    const secondPass = pass({ ciqAvailable: 'yes', confidence: 'high', grounded: false });
    const result = resolveCiqAvailability(primary, secondPass);
    expect(result.ciqAvailable).toBe('unknown');
    expect(result.confidence).toBeNull();
    expect(result.evidenceQuality).toBe('ungrounded');
    expect(result.secondPassAttempted).toBe(true);
  });

  it("primary ungrounded and no second pass could even be attempted (e.g. missing API key): still 'unknown', not the ungrounded primary guess", () => {
    const primary = pass({ ciqAvailable: 'no', confidence: 'high', grounded: false });
    const result = resolveCiqAvailability(primary, null);
    expect(result.ciqAvailable).toBe('unknown');
    expect(result.confidence).toBeNull();
    expect(result.evidenceQuality).toBe('ungrounded');
    expect(result.secondPassAttempted).toBe(false);
  });

  it("ungrounded primary + ungrounded second pass that happen to agree: still 'unknown' — agreement between two ungrounded guesses is not evidence", () => {
    const primary = pass({ ciqAvailable: 'no', confidence: 'high', grounded: false });
    const secondPass = pass({ ciqAvailable: 'no', confidence: 'high', grounded: false });
    const result = resolveCiqAvailability(primary, secondPass);
    expect(result.ciqAvailable).toBe('unknown');
  });

  it("every ciqAvailable value (yes/no/limited) passes through unchanged when grounded", () => {
    for (const value of ['yes', 'no', 'limited'] as const) {
      const result = resolveCiqAvailability(pass({ ciqAvailable: value, grounded: true }), null);
      expect(result.ciqAvailable).toBe(value);
    }
  });
});

describe("secondPassSearchQuery", () => {
  it("produces a query distinct from the primary context query, so a second pass has a genuine chance of finding different results", () => {
    const q = secondPassSearchQuery('LFPB');
    expect(q).toContain('LFPB');
    expect(q).not.toBe('LFPB customs immigration CIQ international port of entry');
  });
});
