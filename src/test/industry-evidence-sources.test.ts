import { describe, it, expect } from "vitest";
import {
  INDUSTRY_EVIDENCE_SOURCES,
  INDUSTRY_EVIDENCE_DOMAINS,
  isIndustryEvidenceDomain,
  industryEvidenceSourceName,
} from "../../supabase/functions/_shared/industry-evidence-sources";

describe("isIndustryEvidenceDomain", () => {
  it("matches every curated domain exactly", () => {
    for (const domain of INDUSTRY_EVIDENCE_DOMAINS) {
      expect(isIndustryEvidenceDomain(`https://${domain}/some/page`)).toBe(true);
    }
  });

  it("matches subdomains of a curated domain", () => {
    expect(isIndustryEvidenceDomain('https://www.universalweather.com/blog/france-business-aviation-destination-guide/')).toBe(true);
    expect(isIndustryEvidenceDomain('https://shop.ops.group/online/database')).toBe(true);
  });

  it("rejects an unrelated domain, even a plausible-looking one", () => {
    expect(isIndustryEvidenceDomain('https://example.com/business-aviation-guide')).toBe(false);
  });

  it("rejects a spoofing lookalike domain — never a substring match", () => {
    expect(isIndustryEvidenceDomain('https://universalweather.com.evil.com/')).toBe(false);
    expect(isIndustryEvidenceDomain('https://not-ops.group.attacker.net/')).toBe(false);
  });

  it("never throws on a malformed URL", () => {
    expect(isIndustryEvidenceDomain('not a url')).toBe(false);
  });

  it("explicitly excluded sources do NOT match — defunct or insufficiently-verified sources stay out", () => {
    expect(isIndustryEvidenceDomain('https://www.airrouting.com/')).toBe(false);
    expect(isIndustryEvidenceDomain('https://www.baseops.net/')).toBe(false);
    expect(isIndustryEvidenceDomain('https://permit2fly.com/')).toBe(false);
  });
});

describe("industryEvidenceSourceName", () => {
  it("returns the human-readable name for a recognized domain", () => {
    expect(industryEvidenceSourceName('https://www.universalweather.com/blog/x')).toBe('Universal Weather & Aviation');
    expect(industryEvidenceSourceName('https://ops.group/blog/x')).toBe('OPSGROUP');
    expect(industryEvidenceSourceName('https://nbaa.org/x')).toBe('National Business Aviation Association (NBAA)');
    expect(industryEvidenceSourceName('https://www.world-kinect.com/x')).toBe('World Fuel / World Kinect');
    expect(industryEvidenceSourceName('https://acukwik.com/Airport-Info/EGGW')).toBe('AC-U-KWIK');
  });

  it("returns null for an unrecognized domain — never guesses a name", () => {
    expect(industryEvidenceSourceName('https://example.com/')).toBeNull();
  });

  it("returns null for a malformed URL", () => {
    expect(industryEvidenceSourceName('not a url')).toBeNull();
  });
});

describe("INDUSTRY_EVIDENCE_SOURCES — dataset shape sanity", () => {
  it("covers exactly the 5 verified companies/organizations (6 domains — Universal has two) — a change here should be a deliberate, reviewed addition", () => {
    const names = new Set(INDUSTRY_EVIDENCE_SOURCES.map((s) => s.name));
    expect(names.size).toBe(5);
    expect(INDUSTRY_EVIDENCE_DOMAINS.length).toBe(6);
  });

  it("every entry has a non-empty domain and name", () => {
    for (const source of INDUSTRY_EVIDENCE_SOURCES) {
      expect(source.domain).toBeTruthy();
      expect(source.name).toBeTruthy();
    }
  });
});
