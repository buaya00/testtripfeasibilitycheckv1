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
  it("returns null without calling fetch when no Firecrawl key is configured", async () => {
    const fetchImpl = vi.fn();
    const result = await searchIndustryEvidence('LFPB customs', undefined, fetchImpl as unknown as typeof fetch);
    expect(result).toBeNull();
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

  it("returns the first result whose URL is on the curated industry domain list, parsed from v2's data.web shape", async () => {
    const fetchImpl = vi.fn(async () => v2Response([
      { url: 'https://www.universalweather.com/blog/france-business-aviation-destination-guide/', markdown: 'Universal Weather guidance on LFPB customs, at least fifty one characters long.' },
    ]));
    const result = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(result).not.toBeNull();
    expect(result!.sourceUrl).toBe('https://www.universalweather.com/blog/france-business-aviation-destination-guide/');
    expect(result!.content).toContain('Universal Weather guidance');
  });

  it("finds a result from the newly-added AC-U-KWIK domain", async () => {
    const fetchImpl = vi.fn(async () => v2Response([
      { url: 'https://acukwik.com/Airport-Info/EGGW', markdown: 'AC-U-KWIK EGGW customs and FBO data, well over fifty characters of real content here.' },
    ]));
    const result = await searchIndustryEvidence('EGGW customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(result?.sourceUrl).toBe('https://acukwik.com/Airport-Info/EGGW');
  });

  it("still defends in depth: skips a non-curated result even if Firecrawl somehow returns one despite includeDomains, and returns the first curated one instead", async () => {
    const fetchImpl = vi.fn(async () => v2Response([
      { url: 'https://some-random-blog.example.com/lfpb-guide', markdown: 'Some unrelated blog content that is definitely more than fifty characters long here.' },
      { url: 'https://ops.group/blog/lfpb-update/', markdown: 'OPSGROUP update on LFPB, also more than fifty characters long for this test case.' },
    ]));
    const result = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(result).not.toBeNull();
    expect(result!.sourceUrl).toBe('https://ops.group/blog/lfpb-update/');
  });

  it("returns null when no result is from a curated domain — never falls back to an uncurated result", async () => {
    const fetchImpl = vi.fn(async () => v2Response([
      { url: 'https://some-random-blog.example.com/lfpb-guide', markdown: 'Some unrelated blog content that is definitely more than fifty characters long here.' },
    ]));
    const result = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it("skips a curated-domain result whose content is too short to be useful", async () => {
    const fetchImpl = vi.fn(async () => v2Response([
      { url: 'https://ops.group/blog/short/', markdown: 'too short' },
    ]));
    const result = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it("returns null gracefully when Firecrawl itself returns a failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500));
    const result = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it("returns null gracefully on a network-level throw, never propagates", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network error'); });
    const result = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it("falls back to parsing a v1-style data.data array shape defensively, in case a response is ever nested that way", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: [{ url: 'https://nbaa.org/some-page', markdown: 'NBAA content that is long enough to pass the fifty character minimum threshold.' }],
    }));
    const result = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(result?.sourceUrl).toBe('https://nbaa.org/some-page');
  });

  it("falls back to parsing a top-level results array shape defensively", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [{ url: 'https://nbaa.org/some-other-page', markdown: 'More NBAA content that is also well over the fifty character minimum threshold.' }],
    }));
    const result = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(result?.sourceUrl).toBe('https://nbaa.org/some-other-page');
  });
});
