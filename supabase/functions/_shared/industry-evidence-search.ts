// Network orchestration for searching the curated industry evidence
// sources (see industry-evidence-sources.ts) via Firecrawl. Separate from
// that file deliberately: industry-evidence-sources.ts is pure data/
// decision logic with zero I/O (mirrors verification-logic.ts style
// modules in this codebase); this module does the actual fetch, mirroring
// verification-runtime.ts style modules. Used by lookups (like ciq-lookup)
// that have no Perplexity integration and so cannot use Perplexity's own
// search_domain_filter the way permit-lookup's industry tier does — this
// achieves the same curated-domain restriction by searching broadly via
// Firecrawl and then strictly filtering results to the curated list
// afterward, never trusting an out-of-list result even if Firecrawl's
// search happens to rank one highly.

import { isIndustryEvidenceDomain } from './industry-evidence-sources.ts';

export interface IndustrySearchResult {
  content: string;
  sourceUrl: string;
}

/**
 * Searches broadly via Firecrawl (same /v1/search endpoint and request
 * shape as scrapeOfficialSources' own "Strategy 1" in firecrawl-scrape.ts)
 * but returns ONLY the first result whose URL is on the curated industry
 * domain list — every other result, however well it might rank, is
 * discarded. Returns null (never throws) when Firecrawl is not configured,
 * the request fails, or no result happens to be from a curated domain.
 */
export async function searchIndustryEvidence(
  query: string,
  firecrawlApiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
  maxResults = 5,
): Promise<IndustrySearchResult | null> {
  if (!firecrawlApiKey) return null;

  try {
    const res = await fetchImpl('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        limit: maxResults,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      }),
    });

    if (!res.ok) {
      console.warn('Industry evidence search failed:', res.status);
      return null;
    }

    const data = await res.json();
    const results: unknown[] = Array.isArray(data?.data) ? data.data : Array.isArray(data?.results) ? data.results : [];
    for (const r of results) {
      const url = (r as { url?: unknown })?.url;
      const markdown = (r as { markdown?: unknown })?.markdown;
      if (typeof url === 'string' && isIndustryEvidenceDomain(url) && typeof markdown === 'string' && markdown.length > 50) {
        return { content: markdown.substring(0, 3000), sourceUrl: url };
      }
    }
    return null;
  } catch (e) {
    console.warn('Industry evidence search error (non-fatal):', e);
    return null;
  }
}
