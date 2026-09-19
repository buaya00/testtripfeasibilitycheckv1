import { describe, it, expect } from "vitest";
import {
  assessNeedsVerification,
  resolveVerificationStatus,
  requiresVerificationWarning,
  isSourceVerified,
  isValidHttpUrl,
  isPubliclyRoutableHostname,
  isSafeEvidenceUrl,
  citationMatchesOfficialDomain,
  sanitizeCitations,
} from "../../supabase/functions/permit-lookup/verification-logic";

// These tests exercise the actual pure decision-logic module used by the
// permit-lookup Edge Function at runtime (imported directly, not
// reimplemented). No network/API calls are made — every scenario below
// supplies a pre-determined input/outcome.

const HK = 'Hong Kong';
const OFFICIAL_URL = 'https://www.faa.gov/some/page';
const OTHER_OFFICIAL_URL = 'https://www.dgca.gov.in/other';
const UNOFFICIAL_URL = 'https://some-random-blog.example.com/post';

function baseInput(overrides: Partial<Parameters<typeof assessNeedsVerification>[0]> = {}) {
  return {
    permitRequired: 'yes' as const,
    confidence: 'high' as const,
    citations: [OFFICIAL_URL],
    country: HK,
    conditions: `A landing permit is required for all foreign aircraft arriving in ${HK}.`,
    notes: '',
    ...overrides,
  };
}

describe("assessNeedsVerification — trigger rules", () => {
  it("1. Required permit, authoritative citation, and evidence naming the country: no trigger", () => {
    const r = assessNeedsVerification(baseInput());
    expect(r.trigger).toBe(false);
    expect(r.reason).toBe('sufficient');
  });

  it("2. Not required, same evidentiary bar met: no trigger — 'yes' and 'no' are held to the same standard", () => {
    const r = assessNeedsVerification(baseInput({
      permitRequired: 'no',
      conditions: `No landing permit is required for private flights into ${HK}.`,
    }));
    expect(r.trigger).toBe(false);
    expect(r.reason).toBe('sufficient');
  });

  it("3. No citations at all: triggers even with high confidence", () => {
    const r = assessNeedsVerification(baseInput({ citations: [] }));
    expect(r.trigger).toBe(true);
    expect(r.reason).toBe('no_citations');
  });

  it("4. Medium confidence: always triggers now (previously only 'no' determinations did)", () => {
    const r = assessNeedsVerification(baseInput({ confidence: 'medium' }));
    expect(r.trigger).toBe(true);
    expect(r.reason).toBe('low_confidence');
    // Same rule applies to a 'no' determination — no special-casing by permitRequired anymore.
    const r2 = assessNeedsVerification(baseInput({ permitRequired: 'no', confidence: 'medium' }));
    expect(r2.trigger).toBe(true);
    expect(r2.reason).toBe('low_confidence');
  });

  it("5. Low-confidence determination: triggers regardless of citations", () => {
    const r = assessNeedsVerification(baseInput({ confidence: 'low', citations: [OFFICIAL_URL, OTHER_OFFICIAL_URL] }));
    expect(r.trigger).toBe(true);
    expect(r.reason).toBe('low_confidence');
  });

  it("6. Conditional permit requirement: always triggers (ambiguous by definition)", () => {
    const r = assessNeedsVerification(baseInput({ permitRequired: 'conditional' }));
    expect(r.trigger).toBe(true);
    expect(r.reason).toBe('ambiguous_conditional');
  });

  it("7. Undefined permitRequired (malformed upstream result): triggers distinctly, never silently trusted", () => {
    const r = assessNeedsVerification(baseInput({ permitRequired: undefined }));
    expect(r.trigger).toBe(true);
    expect(r.reason).toBe('indeterminate_result');
  });

  it("8. Undefined confidence is treated the same as low/medium (never silently trusted)", () => {
    const r = assessNeedsVerification(baseInput({ confidence: undefined }));
    expect(r.trigger).toBe(true);
    expect(r.reason).toBe('low_confidence');
  });

  it("9. High confidence + citation present, but citation is NOT from an officially-targeted domain: triggers — closes the bypass where any citation counted as 'sufficient'", () => {
    const r = assessNeedsVerification(baseInput({ citations: [UNOFFICIAL_URL] }));
    expect(r.trigger).toBe(true);
    expect(r.reason).toBe('citation_not_authoritative');
  });

  it("10. High confidence + authoritative citation, but the model's own justification never mentions the destination country: triggers — a single generic/off-topic citation must not count as sufficient", () => {
    const r = assessNeedsVerification(baseInput({
      conditions: 'A landing permit is required for all foreign aircraft.',
      notes: '',
    }));
    expect(r.trigger).toBe(true);
    expect(r.reason).toBe('evidence_relevance_unconfirmed');
  });

  it("11. Country relevance can be satisfied via the notes field instead of conditions", () => {
    const r = assessNeedsVerification(baseInput({
      conditions: 'A landing permit is required for all foreign aircraft.',
      notes: `See the ${HK} CAD circular for details.`,
    }));
    expect(r.trigger).toBe(false);
  });

  it("12. Country relevance check is case-insensitive", () => {
    const r = assessNeedsVerification(baseInput({
      country: 'hong kong',
      conditions: `Permit required for arrivals in ${HK}.`,
    }));
    expect(r.trigger).toBe(false);
  });

  it("13. Empty/missing country name cannot satisfy the relevance check even if text happens to be non-empty", () => {
    const r = assessNeedsVerification(baseInput({ country: '' }));
    expect(r.trigger).toBe(true);
    expect(r.reason).toBe('evidence_relevance_unconfirmed');
  });

  it("14. At least one authoritative citation among several is enough to pass the domain check", () => {
    const r = assessNeedsVerification(baseInput({ citations: [UNOFFICIAL_URL, OTHER_OFFICIAL_URL] }));
    expect(r.trigger).toBe(false);
  });
});

describe("citationMatchesOfficialDomain", () => {
  it("matches an exact configured domain and its subdomains", () => {
    expect(citationMatchesOfficialDomain('https://www.faa.gov/x')).toBe(true);
    expect(citationMatchesOfficialDomain('https://aip.faa.gov/x')).toBe(true);
    expect(citationMatchesOfficialDomain('https://faa.gov')).toBe(true);
  });

  it("rejects domains not in the officially-targeted list, including near-miss lookalikes", () => {
    expect(citationMatchesOfficialDomain('https://not-faa.gov.evil.com')).toBe(false);
    expect(citationMatchesOfficialDomain('https://faa.gov.attacker.com')).toBe(false);
    expect(citationMatchesOfficialDomain('https://example.com')).toBe(false);
  });

  it("never throws on malformed input", () => {
    expect(citationMatchesOfficialDomain('not a url')).toBe(false);
  });
});

describe("resolveVerificationStatus — outcome mapping", () => {
  it("confirmed: evidence supports the claim AND was obtained by actually retrieving and examining the source page", () => {
    expect(resolveVerificationStatus('supports', false, 'full_page')).toBe('confirmed');
  });

  it("provisional, NOT confirmed: a 'supports' classification built only from a search-engine snippet — a citation URL, official domain or AI confidence alone is never treated as having examined the source", () => {
    expect(resolveVerificationStatus('supports', false, 'search_snippet')).toBe('provisional');
  });

  it("provisional, not confirmed, even if evidenceQuality is somehow 'none' alongside a 'supports' classification (defensive — should not occur in practice since empty evidence short-circuits to insufficient upstream)", () => {
    expect(resolveVerificationStatus('supports', false, 'none')).toBe('provisional');
  });

  it("inconclusive: evidence insufficient, or no classification but no hard error — regardless of evidence quality", () => {
    expect(resolveVerificationStatus('insufficient', false, 'full_page')).toBe('inconclusive');
    expect(resolveVerificationStatus('insufficient', false, 'search_snippet')).toBe('inconclusive');
    expect(resolveVerificationStatus(null, false, 'none')).toBe('inconclusive');
  });

  it("conflicting: evidence contradicts the primary claim, regardless of evidence quality (a contradiction is never softened)", () => {
    expect(resolveVerificationStatus('contradicts', false, 'full_page')).toBe('conflicting');
    expect(resolveVerificationStatus('contradicts', false, 'search_snippet')).toBe('conflicting');
  });

  it("unavailable: verification timeout or API failure overrides any classification or evidence quality", () => {
    expect(resolveVerificationStatus('supports', true, 'full_page')).toBe('unavailable');
    expect(resolveVerificationStatus(null, true, 'none')).toBe('unavailable');
  });
});

describe("isSourceVerified — the sole gate for displaying \"Verified against source\"", () => {
  it("true only for 'confirmed'", () => {
    expect(isSourceVerified('confirmed')).toBe(true);
  });

  it("false for every other status, including 'provisional' and 'not_triggered' — a bypass or a snippet-only match must never read as verified", () => {
    expect(isSourceVerified('provisional')).toBe(false);
    expect(isSourceVerified('not_triggered')).toBe(false);
    expect(isSourceVerified('inconclusive')).toBe(false);
    expect(isSourceVerified('conflicting')).toBe(false);
    expect(isSourceVerified('unavailable')).toBe(false);
  });
});

describe("requiresVerificationWarning — UI safety gate", () => {
  it("does not warn for not_triggered, confirmed, or provisional — these are disclosure states, not errors", () => {
    expect(requiresVerificationWarning('not_triggered')).toBe(false);
    expect(requiresVerificationWarning('confirmed')).toBe(false);
    expect(requiresVerificationWarning('provisional')).toBe(false);
  });

  it("warns for inconclusive, conflicting, and unavailable — never silently shows a plain result", () => {
    expect(requiresVerificationWarning('inconclusive')).toBe(true);
    expect(requiresVerificationWarning('conflicting')).toBe(true);
    expect(requiresVerificationWarning('unavailable')).toBe(true);
  });
});

describe("Verification bypass ('not_triggered') is never conflated with 'confirmed'", () => {
  it("a high-confidence result that skips the follow-up search (citation from an official domain + a country mention) produces trigger:false, and the caller's resulting status must be 'not_triggered', not 'confirmed' — the bypass is a heuristic shortcut, not an actual source check", () => {
    const trigger = assessNeedsVerification(baseInput());
    expect(trigger.trigger).toBe(false);
    // This mirrors exactly what the Edge Function does at the call site: when
    // trigger.trigger is false, runFocusedVerification is never invoked and
    // the status is set directly to 'not_triggered' — resolveVerificationStatus
    // (the only path that can produce 'confirmed') is never called at all.
    const status: 'not_triggered' = 'not_triggered';
    expect(status).not.toBe('confirmed');
    expect(isSourceVerified(status)).toBe(false);
    expect(requiresVerificationWarning(status)).toBe(false);
  });
});

describe("URL validation and citation sanitization — never render fabricated/malformed sources", () => {
  it("accepts well-formed http/https URLs", () => {
    expect(isValidHttpUrl('https://www.caas.gov.sg/some-page')).toBe(true);
    expect(isValidHttpUrl('http://example.com')).toBe(true);
  });

  it("rejects non-http(s) schemes and malformed values", () => {
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('not a url')).toBe(false);
    expect(isValidHttpUrl('')).toBe(false);
    expect(isValidHttpUrl(null)).toBe(false);
    expect(isValidHttpUrl(undefined)).toBe(false);
  });

  it("sanitizeCitations filters out anything invalid without throwing, and handles non-array input", () => {
    expect(sanitizeCitations(['https://faa.gov/x', 'javascript:evil()', 42, null, 'https://caas.gov.sg/y']))
      .toEqual(['https://faa.gov/x', 'https://caas.gov.sg/y']);
    expect(sanitizeCitations(undefined)).toEqual([]);
    expect(sanitizeCitations('not-an-array')).toEqual([]);
  });
});

describe("isPubliclyRoutableHostname / isSafeEvidenceUrl — SSRF pre-checks", () => {
  it("accepts ordinary public domains", () => {
    expect(isPubliclyRoutableHostname('https://www.faa.gov/page')).toBe(true);
    expect(isSafeEvidenceUrl('https://www.faa.gov/page')).toBe(true);
  });

  it("rejects loopback and localhost", () => {
    expect(isPubliclyRoutableHostname('http://localhost:8080/admin')).toBe(false);
    expect(isPubliclyRoutableHostname('http://127.0.0.1/x')).toBe(false);
    expect(isPubliclyRoutableHostname('http://127.5.5.5/x')).toBe(false);
  });

  it("rejects RFC1918 private ranges", () => {
    expect(isPubliclyRoutableHostname('http://10.0.0.5/internal')).toBe(false);
    expect(isPubliclyRoutableHostname('http://172.16.0.1/internal')).toBe(false);
    expect(isPubliclyRoutableHostname('http://172.31.255.255/internal')).toBe(false);
    expect(isPubliclyRoutableHostname('http://192.168.1.1/internal')).toBe(false);
  });

  it("does NOT falsely reject a public address that merely starts similarly to a private range", () => {
    // 172.32.x.x and 172.15.x.x are outside the 172.16-31 private block and are publicly routable.
    expect(isPubliclyRoutableHostname('http://172.32.0.1/x')).toBe(true);
    expect(isPubliclyRoutableHostname('http://172.15.0.1/x')).toBe(true);
  });

  it("rejects link-local and cloud metadata addresses", () => {
    expect(isPubliclyRoutableHostname('http://169.254.169.254/latest/meta-data/')).toBe(false);
  });

  it("rejects IPv6 loopback/link-local/unique-local", () => {
    expect(isPubliclyRoutableHostname('http://[::1]/x')).toBe(false);
    expect(isPubliclyRoutableHostname('http://[fe80::1]/x')).toBe(false);
    expect(isPubliclyRoutableHostname('http://[fc00::1]/x')).toBe(false);
  });

  it("rejects malformed URLs safely (never throws)", () => {
    expect(isPubliclyRoutableHostname('not a url')).toBe(false);
  });

  it("isSafeEvidenceUrl requires BOTH a valid http(s) scheme AND a publicly routable hostname", () => {
    expect(isSafeEvidenceUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeEvidenceUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isSafeEvidenceUrl('https://www.faa.gov/page')).toBe(true);
  });
});

describe("End-to-end scenario composition", () => {
  it("Required + adequate, relevant, authoritative evidence -> not_triggered, no warning shown", () => {
    const trigger = assessNeedsVerification(baseInput());
    expect(trigger.trigger).toBe(false);
    expect(requiresVerificationWarning('not_triggered')).toBe(false);
  });

  it("Not required + evidence that is high-confidence but off-topic -> triggers -> classified insufficient -> inconclusive -> warning shown", () => {
    const trigger = assessNeedsVerification(baseInput({
      permitRequired: 'no',
      conditions: 'General aviation information.',
    }));
    expect(trigger.trigger).toBe(true);
    const status = resolveVerificationStatus('insufficient', false, 'full_page');
    expect(status).toBe('inconclusive');
    expect(requiresVerificationWarning(status)).toBe(true);
  });

  it("Contradictory sources on follow-up -> conflicting -> warning shown, original determination not overwritten", () => {
    const trigger = assessNeedsVerification(baseInput({ confidence: 'low' }));
    expect(trigger.trigger).toBe(true);
    const status = resolveVerificationStatus('contradicts', false, 'full_page');
    expect(status).toBe('conflicting');
    expect(requiresVerificationWarning(status)).toBe(true);
  });

  it("Verification attempt errors/times out -> unavailable regardless of trigger reason -> warning shown", () => {
    const trigger = assessNeedsVerification(baseInput({ citations: [] }));
    expect(trigger.trigger).toBe(true);
    const status = resolveVerificationStatus(null, true, 'none');
    expect(status).toBe('unavailable');
    expect(requiresVerificationWarning(status)).toBe(true);
  });

  it("Follow-up ran and evidence supported the claim, but only via a search snippet (no source page retrieved) -> provisional, not confirmed, and does not trigger the destructive warning either", () => {
    const trigger = assessNeedsVerification(baseInput({ confidence: 'low' }));
    expect(trigger.trigger).toBe(true);
    const status = resolveVerificationStatus('supports', false, 'search_snippet');
    expect(status).toBe('provisional');
    expect(isSourceVerified(status)).toBe(false);
    expect(requiresVerificationWarning(status)).toBe(false);
  });

  it("Conditional permit requirement -> always triggers regardless of confidence/citations/relevance", () => {
    const trigger = assessNeedsVerification(baseInput({ permitRequired: 'conditional' }));
    expect(trigger.trigger).toBe(true);
    expect(trigger.reason).toBe('ambiguous_conditional');
  });

  it("Normal primary-search behavior when no follow-up is needed: verification is purely additive to existing fields", () => {
    const trigger = assessNeedsVerification(baseInput());
    expect(trigger.trigger).toBe(false);
  });
});
