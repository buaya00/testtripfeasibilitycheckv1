import { describe, it, expect, vi } from "vitest";
import { searchIndustryEvidence } from "../../supabase/functions/_shared/industry-evidence-search";

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body } as Response;
}

describe("searchIndustryEvidence", () => {
  it("returns null without calling fetch when no Firecrawl key is configured", async () => {
    const fetchImpl = vi.fn();
    const result = await searchIndustryEvidence('LFPB customs', undefined, fetchImpl as unknown as typeof fetch);
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls Firecrawl's search endpoint with the given query", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.firecrawl.dev/v1/search');
      return jsonResponse({ data: [] });
    });
    await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns the first result whose URL is on the curated industry domain list", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: [
        { url: 'https://www.universalweather.com/blog/france-business-aviation-destination-guide/', markdown: 'Universal Weather guidance on LFPB customs, at least fifty one characters long.' },
      ],
    }));
    const result = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(result).not.toBeNull();
    expect(result!.sourceUrl).toBe('https://www.universalweather.com/blog/france-business-aviation-destination-guide/');
    expect(result!.content).toContain('Universal Weather guidance');
  });

  it("skips a non-curated result even if it ranks first, and returns the first curated one instead", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: [
        { url: 'https://some-random-blog.example.com/lfpb-guide', markdown: 'Some unrelated blog content that is definitely more than fifty characters long here.' },
        { url: 'https://ops.group/blog/lfpb-update/', markdown: 'OPSGROUP update on LFPB, also more than fifty characters long for this test case.' },
      ],
    }));
    const result = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(result).not.toBeNull();
    expect(result!.sourceUrl).toBe('https://ops.group/blog/lfpb-update/');
  });

  it("returns null when no result is from a curated domain — never falls back to an uncurated result", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: [
        { url: 'https://some-random-blog.example.com/lfpb-guide', markdown: 'Some unrelated blog content that is definitely more than fifty characters long here.' },
      ],
    }));
    const result = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it("skips a curated-domain result whose content is too short to be useful", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: [
        { url: 'https://ops.group/blog/short/', markdown: 'too short' },
      ],
    }));
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

  it("handles a response shaped with 'results' instead of 'data'", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [
        { url: 'https://nbaa.org/some-page', markdown: 'NBAA content that is long enough to pass the fifty character minimum threshold.' },
      ],
    }));
    const result = await searchIndustryEvidence('LFPB customs', 'key', fetchImpl as unknown as typeof fetch);
    expect(result?.sourceUrl).toBe('https://nbaa.org/some-page');
  });
});
