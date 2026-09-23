// Network orchestration for searching the curated industry evidence
// sources (see industry-evidence-sources.ts) via Firecrawl. Separate from
// that file deliberately: industry-evidence-sources.ts is pure data/
// decision logic with zero I/O (mirrors verification-logic.ts style
// modules in this codebase); this module does the actual fetch, mirroring
// verification-runtime.ts style modules. Used by lookups (like ciq-lookup)
// that have no Perplexity integration and so cannot use Perplexity's own
// search_domain_filter the way permit-lookup's industry tier does.
//
// USES FIRECRAWL'S v2 SEARCH API, NOT v1: v2's /search endpoint accepts an
// includeDomains parameter that genuinely restricts results to the given
// hostnames server-side (Firecrawl's own docs: "these fields add site:
// and -site: operators to the query internally") — a real, guaranteed
// domain restriction, not a hope that a broad, unrestricted search happens
// to rank a trusted domain highly. This replaced an earlier v1-based
// implementation that searched broadly and filtered results afterward:
// live testing found that approach unreliable even for domains already on
// the curated list — a real page existed on ops.group for a specific
// airport, but the broad search never surfaced it. v1's endpoint does not
// document this parameter; v2 does, verified directly against Firecrawl's
// own API reference (docs.firecrawl.dev/api-reference/endpoint/search)
// before implementation, including the exact response shape (results live
// under data.web, not data.data or data.results as in v1).
//
// The post-hoc isIndustryEvidenceDomain check below is kept anyway as
// defense in depth — never trust a single layer of filtering alone — but
// it is no longer the primary mechanism keeping results on-domain.

import { isIndustryEvidenceDomain } from './industry-evidence-sources.ts';
import { INDUSTRY_EVIDENCE_DOMAINS } from './industry-evidence-sources.ts';

export interface IndustrySearchResult {
  content: string;
  sourceUrl: string;
}

/**
 * Searches ONLY the curated industry domains via Firecrawl's v2 search API,
 * using includeDomains for a genuine server-side domain restriction — not a
 * broad search filtered afterward. Returns the first result with usable
 * content, still independently re-checked against the curated list before
 * being trusted (defense in depth: never rely on includeDomains alone in
 * case of any edge case on Firecrawl's side). Returns null (never throws)
 * when Firecrawl is not configured, the request fails, or no result has
 * enough content to be useful.
 */
export async function searchIndustryEvidence(
  query: string,
  firecrawlApiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
  maxResults = 5,
): Promise<IndustrySearchResult | null> {
  if (!firecrawlApiKey) return null;

  try {
    const res = await fetchImpl('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        limit: maxResults,
        includeDomains: [...INDUSTRY_EVIDENCE_DOMAINS],
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      }),
    });

    if (!res.ok) {
      console.warn('Industry evidence search failed:', res.status);
      return null;
    }

    const data = await res.json();
    // v2's results live under data.web — NOT data.data or data.results
    // (v1's shapes). Both are checked defensively in case a future
    // response variation nests them differently, but data.web is the
    // documented, expected path.
    const results: unknown[] = Array.isArray(data?.data?.web)
      ? data.data.web
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.results)
          ? data.results
          : [];
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
