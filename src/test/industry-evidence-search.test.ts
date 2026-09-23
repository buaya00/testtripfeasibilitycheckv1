import { describe, it, expect, vi } from "vitest";
import { searchIndustryEvidence } from "../../supabase/functions/_shared/industry-evidence-search";

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body } as Response;
}

/** v2's documented response shape: results live under data.web. */
function v2Response(webResults: Array<{ url: string; markdown?: string }>) {
  return jsonResponse({ success: true, data: { web: webResults } });
}

describe("searchIndustryEvidence", () => {
  it("returns an empty array without calling fetch when no Firecrawl key is configured", async () => {
    const fetchImpl = vi.fn();
    const result = await searchIndustryEvidence('LFPB customs', undefined, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls Firecrawl's v2 search endpoint (not v1) with the given query and a genuine includeDomains restriction", async () => {
    let capturedBody: string | undefined;
    const fetchImpl = vi.fn(async (url: string, options?: RequestInit) => {
      expect(url).toBe('https://api.firecrawl.dev/v2/search');
      capturedBody = options?.body as string;
      return v2Response([]);
    });
    await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.query).toBe('LFPB customs');
    expect(Array.isArray(parsed.includeDomains)).toBe(true);
    expect(parsed.includeDomains).toContain('ops.group');
    expect(parsed.includeDomains).toContain('acukwik.com');
    expect(parsed.includeDomains.length).toBeGreaterThanOrEqual(6);
  });

  it("returns ALL curated-domain results with usable content, not just the first — this is the fix for a real bug where a generic country-level guide ranked first and a specific, airport-level page ranked lower was never even tried", async () => {
    const fetchImpl = vi.fn(async () => v2Response([
      { url: 'https://www.universalweather.com/blog/united-kingdom-business-aviation-destination-guide/', markdown: 'Generic UK-wide customs and GAR filing procedures, well over fifty characters, never names any specific airport.' },
      { url: 'https://www.universalweather.com/blog/london-business-jet-destination-guide/', markdown: 'London-area airport comparison table including Luton hours, well over fifty characters of real content here.' },
      { url: 'https://www.universalweather.com/airports/EGGW-LTN-LUTON-AIRPORT-LONDON-LUTON-ENGLAND-UNITED-KINGDOM/', markdown: 'Customs Immigration Agriculture: Customs Available: Yes. Specific EGGW airport profile page, more than fifty characters.' },
    ]));
    const results = await searchIndustryEvidence('EGGW customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(results).toHaveLength(3);
    expect(results[0].sourceUrl).toContain('united-kingdom-business-aviation-destination-guide');
    expect(results[2].sourceUrl).toContain('EGGW-LTN-LUTON-AIRPORT');
    expect(results[2].content).toContain('Customs Available: Yes');
  });

  it("preserves the search API's own ranked order (does not re-sort)", async () => {
    const fetchImpl = vi.fn(async () => v2Response([
      { url: 'https://ops.group/blog/first/', markdown: 'First result content that is definitely more than fifty characters long here for sure.' },
      { url: 'https://acukwik.com/Airport-Info/EGGW', markdown: 'Second result AC-U-KWIK content also well over the fifty character minimum threshold.' },
    ]));
    const results = await searchIndustryEvidence('EGGW customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(results.map((r) => r.sourceUrl)).toEqual([
      'https://ops.group/blog/first/',
      'https://acukwik.com/Airport-Info/EGGW',
    ]);
  });

  it("still defends in depth: skips a non-curated result even if Firecrawl somehow returns one despite includeDomains, keeping only curated-domain results", async () => {
    const fetchImpl = vi.fn(async () => v2Response([
      { url: 'https://some-random-blog.example.com/lfpb-guide', markdown: 'Some unrelated blog content that is definitely more than fifty characters long here.' },
      { url: 'https://ops.group/blog/lfpb-update/', markdown: 'OPSGROUP update on LFPB, also more than fifty characters long for this test case.' },
    ]));
    const results = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(results).toHaveLength(1);
    expect(results[0].sourceUrl).toBe('https://ops.group/blog/lfpb-update/');
  });

  it("returns an empty array when no result is from a curated domain — never falls back to an uncurated result", async () => {
    const fetchImpl = vi.fn(async () => v2Response([
      { url: 'https://some-random-blog.example.com/lfpb-guide', markdown: 'Some unrelated blog content that is definitely more than fifty characters long here.' },
    ]));
    const results = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(results).toEqual([]);
  });

  it("skips a curated-domain result whose content is too short to be useful, keeping only the usable ones", async () => {
    const fetchImpl = vi.fn(async () => v2Response([
      { url: 'https://ops.group/blog/short/', markdown: 'too short' },
      { url: 'https://ops.group/blog/long-enough/', markdown: 'This one is long enough to pass the fifty character minimum content threshold easily.' },
    ]));
    const results = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(results).toHaveLength(1);
    expect(results[0].sourceUrl).toBe('https://ops.group/blog/long-enough/');
  });

  it("returns an empty array gracefully when Firecrawl itself returns a failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500));
    const results = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(results).toEqual([]);
  });

  it("returns an empty array gracefully on a network-level throw, never propagates", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network error'); });
    const results = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(results).toEqual([]);
  });

  it("falls back to parsing a v1-style data.data array shape defensively, in case a response is ever nested that way", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: [{ url: 'https://nbaa.org/some-page', markdown: 'NBAA content that is long enough to pass the fifty character minimum threshold.' }],
    }));
    const results = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(results[0]?.sourceUrl).toBe('https://nbaa.org/some-page');
  });

  it("falls back to parsing a top-level results array shape defensively", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [{ url: 'https://nbaa.org/some-other-page', markdown: 'More NBAA content that is also well over the fifty character minimum threshold.' }],
    }));
    const results = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(results[0]?.sourceUrl).toBe('https://nbaa.org/some-other-page');
  });
});
