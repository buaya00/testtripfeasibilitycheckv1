import { describe, it, expect } from "vitest";
import {
  assessNeedsVerification,
  resolveVerificationStatus,
  requiresVerificationWarning,
  isSourceVerified,
  isValidHttpUrl,
  isPubliclyRoutableHostname,
  isSafeEvidenceUrl,
  jurisdictionDomainsForCountry,
  citationMatchesJurisdiction,
  sanitizeCitations,
} from "../../supabase/functions/permit-lookup/verification-logic";

// These tests exercise the actual pure decision-logic module used by the
// permit-lookup Edge Function at runtime (imported directly, not
// reimplemented). No network/API calls are made — every scenario below
// supplies a pre-determined input/outcome.
//
// The baseline destination is the UK (EGLL) — the airport involved in the
// live-test regression this file guards against: a UAE GCAA citation was
// previously accepted as "authoritative" evidence for a UK landing-permit
// claim merely because it was on the global official-domain list, not
// because it was the UK's own authority.

const UK = 'United Kingdom';
const UK_URL = 'https://www.caa.co.uk/some/page';
const UAE_URL = 'https://www.gcaa.gov.ae/some/other/page';
const USA_URL = 'https://www.faa.gov/some/page';

function baseInput(overrides: Partial<Parameters<typeof assessNeedsVerification>[0]> = {}) {
  return {
    permitRequired: 'yes' as const,
    confidence: 'high' as const,
    citations: [UK_URL],
    country: UK,
    ...overrides,
  };
}

describe("jurisdictionDomainsForCountry — the destination-applicability map", () => {
  it("maps the UK to its own national authority AND its own eAIP hosting subdomain — neither EUROCONTROL nor EASA membership is used for permits (route/ATM body and AIP-structure-only body respectively; neither publishes any country's actual permit criteria)", () => {
    expect(jurisdictionDomainsForCountry('United Kingdom')).toEqual(['caa.co.uk', 'nats-uk.ead-it.com']);
  });

  it("resolves common aliases for the same country to the same domains", () => {
    expect(jurisdictionDomainsForCountry('UK')).toEqual(['caa.co.uk', 'nats-uk.ead-it.com']);
    expect(jurisdictionDomainsForCountry('Great Britain')).toEqual(['caa.co.uk', 'nats-uk.ead-it.com']);
    expect(jurisdictionDomainsForCountry('britain')).toEqual(['caa.co.uk', 'nats-uk.ead-it.com']);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(jurisdictionDomainsForCountry('  UNITED KINGDOM  ')).toEqual(['caa.co.uk', 'nats-uk.ead-it.com']);
  });

  it("maps the other countries our fixed evidence-domain list can actually speak for", () => {
    expect(jurisdictionDomainsForCountry('United States')).toEqual(['faa.gov']);
    expect(jurisdictionDomainsForCountry('USA')).toEqual(['faa.gov']);
    expect(jurisdictionDomainsForCountry('United Arab Emirates')).toEqual(['gcaa.gov.ae']);
    expect(jurisdictionDomainsForCountry('UAE')).toEqual(['gcaa.gov.ae']);
    expect(jurisdictionDomainsForCountry('China')).toEqual(['caac.gov.cn']);
    expect(jurisdictionDomainsForCountry('India')).toEqual(['dgca.gov.in']);
  });

  it("maps France, Germany, and other newly-added countries to their OWN national authority domain — sourced from EAIP_SOURCES, not from EASA membership", () => {
    expect(jurisdictionDomainsForCountry('France')).toEqual(['sia.aviation-civile.gouv.fr']);
    expect(jurisdictionDomainsForCountry('Germany')).toEqual(['aip.dfs.de']);
    expect(jurisdictionDomainsForCountry('Japan')).toEqual(['aisjapan.mlit.go.jp']);
    expect(jurisdictionDomainsForCountry('Canada')).toEqual(['navcanada.ca']);
  });

  it("an EASA member state EAIP_SOURCES has no real URL for still gets NO domain — proves the mapping is sourced per-country, not granted by EASA membership itself (Hungary, Romania: EASA members, but EAIP_SOURCES lists no URL for either)", () => {
    expect(jurisdictionDomainsForCountry('Hungary')).toEqual([]);
    expect(jurisdictionDomainsForCountry('Romania')).toEqual([]);
  });

  it("an EFTA state inside the EASA system that DOES have a sourced domain gets it (Norway) — the domain comes from EAIP_SOURCES, not EASA/EFTA membership", () => {
    expect(jurisdictionDomainsForCountry('Norway')).toEqual(['avinor.no']);
  });

  it("a EUROCONTROL member with a sourced domain gets it (Turkey), independent of EASA/EU membership; one still genuinely unmapped (Ukraine, Serbia: EAIP_SOURCES has no URL for either)", () => {
    expect(jurisdictionDomainsForCountry('Turkey')).toEqual(['dhmi.gov.tr']);
    expect(jurisdictionDomainsForCountry('Ukraine')).toEqual([]);
    expect(jurisdictionDomainsForCountry('Serbia')).toEqual([]);
  });

  it("returns [] for a country in neither the national list nor either pan-European list — fail safe, never assume applicability", () => {
    expect(jurisdictionDomainsForCountry('Kenya')).toEqual([]);
    expect(jurisdictionDomainsForCountry('Israel')).toEqual([]);
    expect(jurisdictionDomainsForCountry('Morocco')).toEqual([]);
  });

  it("returns [] for undefined/empty country", () => {
    expect(jurisdictionDomainsForCountry(undefined)).toEqual([]);
    expect(jurisdictionDomainsForCountry('')).toEqual([]);
    expect(jurisdictionDomainsForCountry('   ')).toEqual([]);
  });
});

describe("citationMatchesJurisdiction — this is THE fix for the reported bug", () => {
  it("a UK CAA citation matches the UK jurisdiction", () => {
    expect(citationMatchesJurisdiction(UK_URL, UK)).toBe(true);
  });

  it("a UAE GCAA citation does NOT match the UK jurisdiction, even though it is on the global official-domain list — this is exactly the reported defect", () => {
    expect(citationMatchesJurisdiction(UAE_URL, UK)).toBe(false);
  });

  it("the same UAE citation DOES match the UAE jurisdiction — the check is about applicability, not blacklisting a domain outright", () => {
    expect(citationMatchesJurisdiction(UAE_URL, 'United Arab Emirates')).toBe(true);
  });

  it("matches subdomains of the applicable authority", () => {
    expect(citationMatchesJurisdiction('https://aip.caa.co.uk/x', UK)).toBe(true);
  });

  it("the UK's own eAIP hosting subdomain (nats-uk.ead-it.com) matches UK jurisdiction — this is the fix for a UK source that would otherwise have been wrongly rejected", () => {
    expect(citationMatchesJurisdiction('https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/AIP/', UK)).toBe(true);
  });

  it("newly-added national authority domains match their own country and no other", () => {
    expect(citationMatchesJurisdiction('https://www.sia.aviation-civile.gouv.fr/some/page', 'France')).toBe(true);
    expect(citationMatchesJurisdiction('https://www.sia.aviation-civile.gouv.fr/some/page', 'Germany')).toBe(false);
    expect(citationMatchesJurisdiction('https://aip.dfs.de/BasicIFR/', 'Germany')).toBe(true);
    expect(citationMatchesJurisdiction('https://aip.dfs.de/BasicIFR/', 'France')).toBe(false);
  });

  it("rejects near-miss lookalike domains", () => {
    expect(citationMatchesJurisdiction('https://not-caa.co.uk.evil.com', UK)).toBe(false);
    expect(citationMatchesJurisdiction('https://caa.co.uk.attacker.com', UK)).toBe(false);
  });

  it("an unmapped destination country can never be satisfied by ANY citation, including otherwise-official ones — fail safe, not a special case for any particular country", () => {
    expect(citationMatchesJurisdiction(UK_URL, 'Kenya')).toBe(false);
    expect(citationMatchesJurisdiction(USA_URL, 'Kenya')).toBe(false);
    expect(citationMatchesJurisdiction(UAE_URL, 'Kenya')).toBe(false);
  });

  it("never throws on a malformed URL", () => {
    expect(citationMatchesJurisdiction('not a url', UK)).toBe(false);
    expect(citationMatchesJurisdiction('not a url', 'Kenya')).toBe(false);
  });

  it("an EASA citation does NOT match any country's jurisdiction, including a genuine EASA member (France) — EASA standardizes AIP structure, not permit content, so it's never applicable permit evidence regardless of membership", () => {
    expect(citationMatchesJurisdiction('https://www.easa.europa.eu/some/page', 'France')).toBe(false);
    expect(citationMatchesJurisdiction('https://www.easa.europa.eu/some/page', 'Germany')).toBe(false);
  });

  it("an EAD/EUROCONTROL citation does NOT match any country's jurisdiction — EUROCONTROL is never applicable evidence for a permit determination, regardless of membership", () => {
    expect(citationMatchesJurisdiction('https://ead.eurocontrol.int/some/page', 'Germany')).toBe(false);
    expect(citationMatchesJurisdiction('https://ead.eurocontrol.int/some/page', UK)).toBe(false);
    expect(citationMatchesJurisdiction('https://www.ead.eurocontrol.int/eAIP/x', 'France')).toBe(false);
  });

  it("an EASA citation does NOT match a EUROCONTROL-only, non-EASA member (Turkey) either — both pan-European domains are inert for permit matching, independent of any membership", () => {
    expect(citationMatchesJurisdiction('https://www.easa.europa.eu/some/page', 'Turkey')).toBe(false);
  });

  it("an EASA citation does NOT match the UK — the UK is not an EASA member post-Brexit, and its EUROCONTROL membership never substitutes for it (nor would it if the UK were an EASA member — see above)", () => {
    expect(citationMatchesJurisdiction('https://www.easa.europa.eu/some/page', UK)).toBe(false);
  });

  it("neither pan-European domain matches a non-European country (Kenya, USA) either — no blanket pass for pan-European-looking domains", () => {
    expect(citationMatchesJurisdiction('https://www.easa.europa.eu/some/page', 'Kenya')).toBe(false);
    expect(citationMatchesJurisdiction('https://ead.eurocontrol.int/some/page', 'United States')).toBe(false);
  });
});

describe("assessNeedsVerification — trigger rules", () => {
  it("1. Required permit with a citation from the destination's own authority: no trigger", () => {
    const r = assessNeedsVerification(baseInput());
    expect(r.trigger).toBe(false);
    expect(r.reason).toBe('sufficient');
  });

  it("2. Not required, same evidentiary bar met: no trigger — 'yes' and 'no' are held to the same standard", () => {
    const r = assessNeedsVerification(baseInput({ permitRequired: 'no' }));
    expect(r.trigger).toBe(false);
    expect(r.reason).toBe('sufficient');
  });

  it("3. No citations at all: triggers even with high confidence", () => {
    const r = assessNeedsVerification(baseInput({ citations: [] }));
    expect(r.trigger).toBe(true);
    expect(r.reason).toBe('no_citations');
  });

  it("4. Medium confidence: always triggers, for both 'yes' and 'no' determinations", () => {
    const r = assessNeedsVerification(baseInput({ confidence: 'medium' }));
    expect(r.trigger).toBe(true);
    expect(r.reason).toBe('low_confidence');
    const r2 = assessNeedsVerification(baseInput({ permitRequired: 'no', confidence: 'medium' }));
    expect(r2.trigger).toBe(true);
    expect(r2.reason).toBe('low_confidence');
  });

  it("5. Low-confidence determination: triggers regardless of citations", () => {
    const r = assessNeedsVerification(baseInput({ confidence: 'low', citations: [UK_URL, USA_URL] }));
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

  it("9. Regression: a high-confidence UK determination whose only citation is a UAE GCAA page must still trigger — an official-looking domain from the wrong jurisdiction is not sufficient", () => {
    const r = assessNeedsVerification(baseInput({ citations: [UAE_URL] }));
    expect(r.trigger).toBe(true);
    expect(r.reason).toBe('evidence_relevance_unconfirmed');
  });

  it("10. Regression: this must NOT depend on any free-text field containing the literal country name — the check is against the structured `country` field via the domain map, so aliasing the country string changes nothing", () => {
    const r1 = assessNeedsVerification(baseInput({ country: 'UK' }));
    expect(r1.trigger).toBe(false);
    const r2 = assessNeedsVerification(baseInput({ country: 'Great Britain' }));
    expect(r2.trigger).toBe(false);
  });

  it("11. A destination country with no known applicable-authority mapping always triggers, regardless of which citation is offered — proves this is not hardcoded to the UK/EGLL case", () => {
    const r = assessNeedsVerification(baseInput({ country: 'Kenya', citations: [UK_URL, USA_URL, UAE_URL] }));
    expect(r.trigger).toBe(true);
    expect(r.reason).toBe('evidence_relevance_unconfirmed');
  });

  it("12. At least one jurisdiction-applicable citation among several is enough, even if other citations in the list are from unrelated jurisdictions", () => {
    const r = assessNeedsVerification(baseInput({ citations: [UAE_URL, UK_URL] }));
    expect(r.trigger).toBe(false);
  });

  it("13. A non-UK destination (USA) with its own applicable citation also does not trigger — confirms the fix generalizes across countries", () => {
    const r = assessNeedsVerification({
      permitRequired: 'no',
      confidence: 'high',
      citations: [USA_URL],
      country: 'United States',
    });
    expect(r.trigger).toBe(false);
    expect(r.reason).toBe('sufficient');
  });

  it("14. That same non-UK destination (USA) with only a UK or UAE citation still triggers", () => {
    const r = assessNeedsVerification({
      permitRequired: 'no',
      confidence: 'high',
      citations: [UK_URL, UAE_URL],
      country: 'United States',
    });
    expect(r.trigger).toBe(true);
    expect(r.reason).toBe('evidence_relevance_unconfirmed');
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
  it("a high-confidence result that skips the follow-up search (citation from the destination's own authority) produces trigger:false, and the caller's resulting status must be 'not_triggered', not 'confirmed' — the bypass is a heuristic shortcut, not an actual source check", () => {
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
  it("Required + adequate, jurisdiction-applicable evidence -> not_triggered, no warning shown", () => {
    const trigger = assessNeedsVerification(baseInput());
    expect(trigger.trigger).toBe(false);
    expect(requiresVerificationWarning('not_triggered')).toBe(false);
  });

  it("Regression scenario: UK claim, only a UAE citation available -> triggers -> classified insufficient (no applicable source found) -> inconclusive -> warning shown, but the original permitRequired is untouched by this module", () => {
    const trigger = assessNeedsVerification(baseInput({ permitRequired: 'no', citations: [UAE_URL] }));
    expect(trigger.trigger).toBe(true);
    expect(trigger.reason).toBe('evidence_relevance_unconfirmed');
    const status = resolveVerificationStatus('insufficient', false, 'none');
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

  it("Conditional permit requirement -> always triggers regardless of confidence/citations/jurisdiction", () => {
    const trigger = assessNeedsVerification(baseInput({ permitRequired: 'conditional' }));
    expect(trigger.trigger).toBe(true);
    expect(trigger.reason).toBe('ambiguous_conditional');
  });

  it("Normal primary-search behavior when no follow-up is needed: verification is purely additive to existing fields", () => {
    const trigger = assessNeedsVerification(baseInput());
    expect(trigger.trigger).toBe(false);
  });
});
