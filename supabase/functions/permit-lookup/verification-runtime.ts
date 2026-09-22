// Network-and-classification orchestration for the permit-lookup follow-up
// verification pass. Uses ONLY portable APIs (fetch, AbortSignal, URL, JSON)
// — no Deno-only globals — so this exact module runs both inside the Deno
// Edge Function at runtime and under the vitest suite with a mocked `fetch`,
// giving real integration-style coverage of the actual production code
// (retrieval, fallback, classification) rather than a reimplementation.
//
// Security note: this module NEVER calls fetch() on a citation URL supplied
// by an upstream AI response. That URL is untrusted (it could, by model
// error or an unusual API response, point at an internal address, e.g. a
// cloud metadata endpoint) — classic SSRF surface. Retrieval is instead
// delegated to a hosted scraping provider (Firecrawl, then ZenRows as a
// fallback for the SAME already-approved URL — see retrieveFullPageEvidence),
// which performs the actual outbound request on its own infrastructure.
// This is the same trust boundary the rest of this codebase already relies
// on for the primary permit-lookup pass (see ../_shared/firecrawl-scrape.ts)
// — not a new one. If neither provider is configured or both fail, this
// module falls back to the search snippet already returned in the
// Perplexity response body; it never substitutes a raw fetch of the
// citation URL as a fallback.
//
// TWO-TIER EVIDENCE MODEL (government, then industry):
// Government/CAA sources are ALWAYS attempted first and preferred — see
// attemptGovernmentTier. Only when government evidence is unavailable
// (unmapped country, no matching citation, retrieval failure) OR present
// but genuinely insufficient (the classifier finds it doesn't specifically
// address the claim) does attemptIndustryTier run, searching a small,
// independently-verified list of business-aviation trip-support publishers
// (see ../_shared/industry-evidence-sources.ts). Industry evidence NEVER
// overrides a government result — it only fills a gap government evidence
// left open. Every returned source carries an explicit sourceType so the
// caller/UI can always distinguish "confirmed by the destination's own
// authority" from "confirmed by an industry publisher" — collapsing that
// distinction would itself overstate confidence.

import {
  isSafeEvidenceUrl,
  isValidHttpUrl,
  citationMatchesJurisdiction,
  jurisdictionDomainsForCountry,
  OFFICIAL_EVIDENCE_DOMAINS,
  type EvidenceClassification,
  type EvidenceQuality,
  type EvidenceSourceType,
} from './verification-logic.ts';
import {
  INDUSTRY_EVIDENCE_DOMAINS,
  isIndustryEvidenceDomain,
} from '../_shared/industry-evidence-sources.ts';

export type FetchLike = typeof fetch;

/**
 * Sanitized, non-sensitive categorization of why a retrieval attempt did or
 * didn't produce usable evidence. Never derived from or containing page
 * content or API keys — safe to log and to compare across providers.
 */
export type RetrievalStatusCategory =
  | 'success'
  | 'not_configured'
  | 'unsafe_url'
  | 'payment_required'
  | 'auth_error'
  | 'rate_limited'
  | 'timeout'
  | 'unusable_content'
  | 'network_error'
  | 'http_error';

/** Provider-independent result of a single retrieval attempt against one URL. */
export interface ProviderEvidenceResult {
  text: string;
  quality: 'full_page' | 'none';
  statusCategory: RetrievalStatusCategory;
  httpStatus?: number;
}

/** True only for genuinely present content — deliberately just the emptiness check already used before this change, not a new arbitrary length threshold (which would have silently reclassified several already-short, legitimate evidence fixtures elsewhere). */
function isUsableEvidenceText(text: unknown): text is string {
  return typeof text === 'string' && text.trim().length > 0;
}

/** Maps an HTTP failure status to a sanitized category shared by every provider — no provider-specific branching needed by callers. */
function categorizeHttpFailure(status: number): RetrievalStatusCategory {
  if (status === 402) return 'payment_required';
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 429) return 'rate_limited';
  if (status === 504) return 'timeout'; // ZenRows reports a server-side operation-timeout via 504; Firecrawl has no documented equivalent, but the mapping is harmless either way.
  return 'http_error';
}

/** Maps a thrown/network-level failure (including our own AbortSignal.timeout firing) to a sanitized category — never logs the error's message, which could echo back request details. */
function categorizeThrownError(e: unknown): RetrievalStatusCategory {
  // DOMException (what AbortSignal.timeout's abort reason actually throws)
  // does NOT extend Error, so `e instanceof Error` alone would silently miss
  // every real timeout here — check `.name` on the thrown value directly.
  const name = (e as { name?: unknown } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';
  const message = e instanceof Error ? e.message : '';
  if (/timeout/i.test(message)) return 'timeout';
  return 'network_error';
}

/** Retrieves page content for a specific URL via Firecrawl instead of fetching it directly. */
export async function fetchEvidenceViaFirecrawl(
  url: string,
  firecrawlApiKey: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderEvidenceResult> {
  if (!firecrawlApiKey) return { text: '', quality: 'none', statusCategory: 'not_configured' };
  if (!isSafeEvidenceUrl(url)) return { text: '', quality: 'none', statusCategory: 'unsafe_url' };

  try {
    const res = await fetchImpl('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${firecrawlApiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, waitFor: 3000 }),
    });
    if (!res.ok) {
      return { text: '', quality: 'none', statusCategory: categorizeHttpFailure(res.status), httpStatus: res.status };
    }
    const data = await res.json();
    const markdown = data?.data?.markdown || data?.markdown || '';
    if (!isUsableEvidenceText(markdown)) {
      return { text: '', quality: 'none', statusCategory: 'unusable_content', httpStatus: res.status };
    }
    return { text: markdown.trim().slice(0, 4000), quality: 'full_page', statusCategory: 'success', httpStatus: res.status };
  } catch (e) {
    return { text: '', quality: 'none', statusCategory: categorizeThrownError(e) };
  }
}

/**
 * Retrieves page content for a specific URL via ZenRows — used ONLY as a
 * fallback for the SAME already-approved URL when Firecrawl could not
 * produce usable content (see retrieveFullPageEvidence). Never used to
 * broaden retrieval to a different or additional source.
 *
 * ZenRows' request/response shape is NOT Firecrawl-compatible and is not
 * assumed to be: authentication is a query parameter (`apikey`), not a
 * Bearer header; the endpoint is a single unified `GET /v1/` (not a
 * dedicated `/scrape` path); and `response_type=markdown` returns the
 * markdown as the raw response body (`res.text()`), not wrapped in JSON.
 * Verified against ZenRows' own documentation (docs.zenrows.com) before
 * implementation — see the accompanying report for the exact pages checked.
 *
 * js_render and premium_proxy are deliberately left at their default
 * (false/off): enabling either multiplies the credit cost of a successful
 * request (5x and 10x respectively, 25x combined) and is not demonstrably
 * necessary for the static government/CAA publication pages this fallback
 * targets. response_type=markdown itself carries no extra cost.
 */
export async function fetchEvidenceViaZenRows(
  url: string,
  zenrowsApiKey: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderEvidenceResult> {
  if (!zenrowsApiKey) return { text: '', quality: 'none', statusCategory: 'not_configured' };
  if (!isSafeEvidenceUrl(url)) return { text: '', quality: 'none', statusCategory: 'unsafe_url' };

  try {
    const endpoint = new URL('https://api.zenrows.com/v1/');
    endpoint.searchParams.set('url', url);
    endpoint.searchParams.set('apikey', zenrowsApiKey);
    endpoint.searchParams.set('response_type', 'markdown');
    const res = await fetchImpl(endpoint.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { text: '', quality: 'none', statusCategory: categorizeHttpFailure(res.status), httpStatus: res.status };
    }
    const text = await res.text();
    if (!isUsableEvidenceText(text)) {
      return { text: '', quality: 'none', statusCategory: 'unusable_content', httpStatus: res.status };
    }
    return { text: text.trim().slice(0, 4000), quality: 'full_page', statusCategory: 'success', httpStatus: res.status };
  } catch (e) {
    return { text: '', quality: 'none', statusCategory: categorizeThrownError(e) };
  }
}

export type EvidenceProvider = 'firecrawl' | 'zenrows';

export interface EvidenceRetrievalOutcome {
  text: string;
  quality: 'full_page' | 'none';
  /** Which provider actually produced the returned text, if any. */
  provider: EvidenceProvider | null;
  /** True whenever a ZenRows attempt was made at all, regardless of whether it succeeded. */
  fallbackOccurred: boolean;
}

/** Sanitized, structured diagnostic line — provider, outcome category, HTTP status if any, duration. Never the API key, the constructed request URL (which embeds ZenRows' key as a query param), or any page content. */
function logRetrievalAttempt(provider: EvidenceProvider, result: ProviderEvidenceResult, durationMs: number, isFallback: boolean): void {
  console.log(JSON.stringify({
    scope: 'permit-verification-evidence-retrieval',
    provider,
    isFallback,
    succeeded: result.quality === 'full_page',
    statusCategory: result.statusCategory,
    httpStatus: result.httpStatus,
    durationMs,
  }));
}

/**
 * Retrieves full-page evidence for a single, already-approved URL:
 * Firecrawl first; ZenRows only if Firecrawl did not produce usable
 * content, and only for that SAME url — at most one fallback attempt, never
 * a broader or different source. If ZENROWS_API_KEY is not configured,
 * ZenRows is never invoked at all (not even a no-op call) — behavior is
 * byte-for-byte the pre-ZenRows Firecrawl-only path.
 */
export async function retrieveFullPageEvidence(
  url: string,
  keys: { firecrawlApiKey: string | undefined; zenrowsApiKey: string | undefined },
  fetchImpl: FetchLike = fetch,
): Promise<EvidenceRetrievalOutcome> {
  // Checked once, up front: an unsafe URL is a terminal state, not a
  // per-provider failure to fall back from. Both provider functions also
  // independently re-check this (defense in depth), but short-circuiting
  // here avoids a redundant, pointless "attempt" against the fallback
  // provider for a URL that was never going to be fetched either way.
  if (!isSafeEvidenceUrl(url)) {
    return { text: '', quality: 'none', provider: null, fallbackOccurred: false };
  }

  const firecrawlStart = Date.now();
  const firecrawl = await fetchEvidenceViaFirecrawl(url, keys.firecrawlApiKey, fetchImpl);
  logRetrievalAttempt('firecrawl', firecrawl, Date.now() - firecrawlStart, false);
  if (firecrawl.quality === 'full_page') {
    return { text: firecrawl.text, quality: 'full_page', provider: 'firecrawl', fallbackOccurred: false };
  }

  if (!keys.zenrowsApiKey) {
    return { text: '', quality: 'none', provider: null, fallbackOccurred: false };
  }

  const zenrowsStart = Date.now();
  const zenrows = await fetchEvidenceViaZenRows(url, keys.zenrowsApiKey, fetchImpl);
  logRetrievalAttempt('zenrows', zenrows, Date.now() - zenrowsStart, true);
  if (zenrows.quality === 'full_page') {
    return { text: zenrows.text, quality: 'full_page', provider: 'zenrows', fallbackOccurred: true };
  }

  return { text: '', quality: 'none', provider: null, fallbackOccurred: true };
}

export interface FocusedVerificationParams {
  icao: string;
  flightTypeLabel: string;
  aircraftNationality?: string;
  resolvedAirportName: string;
  permitRequired: 'yes' | 'no' | 'conditional' | undefined;
  /** Destination country as returned by the primary lookup — used to enforce jurisdiction applicability, never inferred or guessed here. */
  country: string | undefined;
  perplexityApiKey: string | undefined;
  lovableApiKey: string;
  firecrawlApiKey: string | undefined;
  /** Optional fallback provider — only ever invoked for the SAME url after Firecrawl fails to produce usable content. Omit/undefined preserves the exact pre-ZenRows Firecrawl-only behavior. */
  zenrowsApiKey?: string;
  /** Must already be jurisdiction-applicable if the caller can determine that; this module re-checks it anyway and never trusts it blindly. */
  topCitation: string | undefined;
}

export interface FocusedVerificationResult {
  classification: EvidenceClassification | null;
  /** How the classified evidence was obtained — 'search_snippet' must never be treated as equivalent to 'full_page' by the caller. */
  evidenceQuality: EvidenceQuality;
  sources: { url: string; supports: EvidenceClassification; retrievedAt: string; evidenceQuality: EvidenceQuality; sourceType: EvidenceSourceType }[];
  hadError: boolean;
  /** Which tier actually produced the returned classification, when one was produced — undefined when both tiers came back insufficient/no-citation. */
  sourceType?: EvidenceSourceType;
}

/** Internal shape shared by both tiers before being wrapped into the final result. */
interface TierOutcome {
  classification: EvidenceClassification | null;
  evidenceQuality: EvidenceQuality;
  citation: string | undefined;
  hadError: boolean;
}

const NO_VERDICT: TierOutcome = { classification: 'insufficient', evidenceQuality: 'none', citation: undefined, hadError: false };

/** The one shared classifier call both tiers use — same strict system prompt, same country/airport/flight-type specificity requirement, regardless of which tier's evidence is being checked. */
async function classifyEvidence(
  claimText: string,
  evidenceText: string,
  evidenceQuality: EvidenceQuality,
  lovableApiKey: string,
  fetchImpl: FetchLike,
): Promise<{ classification: EvidenceClassification | null; hadError: boolean }> {
  const classifyRes = await fetchImpl('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${lovableApiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are a strict fact-checker. Classify ONLY whether the provided evidence supports, contradicts, or fails to establish the specific claim. Use only the provided evidence, not outside knowledge. The evidence must specifically address the same country, airport and flight type named in the claim — if it discusses a different country, airport, or a materially different flight type, classify as insufficient. If the evidence does not clearly and specifically address the claim, classify as insufficient. Evidence quality: ${evidenceQuality}.`,
        },
        { role: 'user', content: `Claim: ${claimText}\n\nEvidence:\n${evidenceText}` },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'classify_evidence',
          description: 'Classify whether evidence supports, contradicts, or fails to establish a specific regulatory claim.',
          parameters: {
            type: 'object',
            properties: { classification: { type: 'string', enum: ['supports', 'contradicts', 'insufficient'] } },
            required: ['classification'],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: 'function', function: { name: 'classify_evidence' } },
    }),
  });

  if (!classifyRes.ok) return { classification: null, hadError: true };
  const classifyData = await classifyRes.json();
  const toolCall = classifyData?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) return { classification: null, hadError: true };

  let parsed: { classification?: unknown };
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch {
    return { classification: null, hadError: true };
  }
  const classification = parsed.classification;
  if (classification !== 'supports' && classification !== 'contradicts' && classification !== 'insufficient') {
    return { classification: null, hadError: true };
  }
  return { classification, hadError: false };
}

/**
 * TIER 1 — government/CAA evidence. Always attempted first. Identical logic
 * to the pre-industry-tier implementation: jurisdiction-gated citation
 * selection (caller-supplied top citation, then this tier's own
 * government-domain-restricted Perplexity search), retrieval via
 * retrieveFullPageEvidence, then classification. Returns NO_VERDICT
 * (classification 'insufficient', hadError false) when no jurisdiction-
 * applicable citation could be established at all — this is the case that
 * always falls through to the industry tier, not a terminal failure.
 */
async function attemptGovernmentTier(
  claimText: string,
  country: string | undefined,
  keys: { perplexityApiKey: string | undefined; lovableApiKey: string; firecrawlApiKey: string | undefined; zenrowsApiKey: string | undefined },
  topCitation: string | undefined,
  fetchImpl: FetchLike,
): Promise<TierOutcome> {
  // Jurisdiction gate #1: the citation handed in by the caller (typically
  // the primary lookup's top citation) is only trusted if it is valid AND
  // is the DESTINATION COUNTRY's own authority — never merely "some
  // official aviation domain".
  let verifyCitation: string | undefined = topCitation && isValidHttpUrl(topCitation) && citationMatchesJurisdiction(topCitation, country)
    ? topCitation
    : undefined;
  let verifyContext = '';
  let verifyContextBackedByCitation = false;

  // Scope the follow-up search itself to the destination's own authority
  // when known, instead of the full global candidate-domain list.
  const jurisdictionDomains = jurisdictionDomainsForCountry(country);
  const searchDomainFilter = jurisdictionDomains.length > 0 ? jurisdictionDomains : OFFICIAL_EVIDENCE_DOMAINS;

  if (keys.perplexityApiKey) {
    const verifyRes = await fetchImpl('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${keys.perplexityApiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          { role: 'system', content: 'You are verifying a specific aviation regulatory claim against official sources only. Cite the exact official CAA/AIP source that confirms or contradicts the claim. Do not hedge.' },
          { role: 'user', content: `Verify this claim against official sources: ${claimText}` },
        ],
        search_domain_filter: [...searchDomainFilter],
        search_recency_filter: 'year',
        max_tokens: 500,
      }),
    });
    if (verifyRes.ok) {
      const verifyData = await verifyRes.json();
      const rawContext = typeof verifyData?.choices?.[0]?.message?.content === 'string' ? verifyData.choices[0].message.content : '';
      const verifyCitations: unknown[] = Array.isArray(verifyData?.citations) ? verifyData.citations : [];
      // Jurisdiction gate #2: among THIS call's own citations, only the
      // first one that is both a valid URL and jurisdiction-applicable may
      // override the citation selected above.
      const firstApplicable = verifyCitations.find(
        (c): c is string => typeof c === 'string' && isValidHttpUrl(c) && citationMatchesJurisdiction(c, country),
      );
      if (firstApplicable) {
        verifyCitation = firstApplicable;
        verifyContext = rawContext;
        verifyContextBackedByCitation = true;
      }
    }
  }

  if (!verifyCitation) {
    return NO_VERDICT;
  }

  let evidenceText = '';
  let evidenceQuality: EvidenceQuality = 'none';
  const retrieval = await retrieveFullPageEvidence(verifyCitation, { firecrawlApiKey: keys.firecrawlApiKey, zenrowsApiKey: keys.zenrowsApiKey }, fetchImpl);
  if (retrieval.text) {
    evidenceText = retrieval.text;
    evidenceQuality = 'full_page';
  }
  if (!evidenceText && verifyContextBackedByCitation && verifyContext.trim()) {
    evidenceText = verifyContext.slice(0, 4000);
    evidenceQuality = 'search_snippet';
  }

  if (!evidenceText.trim()) {
    return { classification: 'insufficient', evidenceQuality: 'none', citation: verifyCitation, hadError: false };
  }

  const { classification, hadError } = await classifyEvidence(claimText, evidenceText, evidenceQuality, keys.lovableApiKey, fetchImpl);
  if (hadError) {
    return { classification: null, evidenceQuality, citation: verifyCitation, hadError: true };
  }
  return { classification, evidenceQuality, citation: verifyCitation, hadError: false };
}

/**
 * TIER 2 — curated industry evidence. Only ever invoked when the
 * government tier did not produce a 'supports'/'contradicts' verdict (see
 * runFocusedVerification). Searches ONLY the independently-verified
 * business-aviation trip-support publishers in
 * ../_shared/industry-evidence-sources.ts — never the open web — via
 * Perplexity's own domain filter, mirroring exactly how the government
 * tier restricts its search. Country/airport/flight-type specificity is
 * enforced by the SAME strict classifier used for government evidence, not
 * by domain membership (one industry domain legitimately covers many
 * countries, unlike a government domain).
 */
async function attemptIndustryTier(
  claimText: string,
  keys: { perplexityApiKey: string | undefined; lovableApiKey: string; firecrawlApiKey: string | undefined; zenrowsApiKey: string | undefined },
  fetchImpl: FetchLike,
): Promise<TierOutcome> {
  if (!keys.perplexityApiKey) {
    return NO_VERDICT;
  }

  let industryCitation: string | undefined;
  let industryContext = '';

  const verifyRes = await fetchImpl('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${keys.perplexityApiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        { role: 'system', content: 'You are verifying a specific aviation regulatory claim against established business-aviation trip-support publishers. Cite the exact source page that confirms or contradicts the claim. Do not hedge.' },
        { role: 'user', content: `Verify this claim against these trip-support sources: ${claimText}` },
      ],
      search_domain_filter: [...INDUSTRY_EVIDENCE_DOMAINS],
      search_recency_filter: 'year',
      max_tokens: 500,
    }),
  });
  if (verifyRes.ok) {
    const verifyData = await verifyRes.json();
    const rawContext = typeof verifyData?.choices?.[0]?.message?.content === 'string' ? verifyData.choices[0].message.content : '';
    const verifyCitations: unknown[] = Array.isArray(verifyData?.citations) ? verifyData.citations : [];
    // Defense in depth: even though the request itself was domain-filtered,
    // never trust a returned citation without independently re-checking it
    // against the curated list here too.
    const firstApplicable = verifyCitations.find(
      (c): c is string => typeof c === 'string' && isValidHttpUrl(c) && isIndustryEvidenceDomain(c),
    );
    if (firstApplicable) {
      industryCitation = firstApplicable;
      industryContext = rawContext;
    }
  }

  if (!industryCitation) {
    return NO_VERDICT;
  }

  let evidenceText = '';
  let evidenceQuality: EvidenceQuality = 'none';
  const retrieval = await retrieveFullPageEvidence(industryCitation, { firecrawlApiKey: keys.firecrawlApiKey, zenrowsApiKey: keys.zenrowsApiKey }, fetchImpl);
  if (retrieval.text) {
    evidenceText = retrieval.text;
    evidenceQuality = 'full_page';
  }
  if (!evidenceText && industryContext.trim()) {
    evidenceText = industryContext.slice(0, 4000);
    evidenceQuality = 'search_snippet';
  }

  if (!evidenceText.trim()) {
    return { classification: 'insufficient', evidenceQuality: 'none', citation: industryCitation, hadError: false };
  }

  const { classification, hadError } = await classifyEvidence(claimText, evidenceText, evidenceQuality, keys.lovableApiKey, fetchImpl);
  if (hadError) {
    return { classification: null, evidenceQuality, citation: industryCitation, hadError: true };
  }
  return { classification, evidenceQuality, citation: industryCitation, hadError: false };
}

/**
 * Single bounded attempt per external call per tier (no retry loop within a
 * tier) — a slow/failed check degrades to hadError rather than hanging or
 * silently guessing. Tries the government tier first; only falls through to
 * the industry tier when government did not produce a definitive verdict
 * (no applicable citation, retrieval failure, or classified insufficient —
 * including when the government classifier call itself errored). A
 * definitive government verdict (supports/contradicts) is returned
 * immediately and the industry tier is never even attempted.
 */
export async function runFocusedVerification(
  params: FocusedVerificationParams,
  fetchImpl: FetchLike = fetch,
): Promise<FocusedVerificationResult> {
  const {
    icao, flightTypeLabel, aircraftNationality, resolvedAirportName, permitRequired, country,
    perplexityApiKey, lovableApiKey, firecrawlApiKey, zenrowsApiKey, topCitation,
  } = params;
  const claimText = `A landing permit is ${permitRequired === 'no' ? 'NOT required' : permitRequired === 'yes' ? 'required' : 'conditionally required'} for a ${flightTypeLabel} flight${aircraftNationality ? ` (aircraft registered in ${aircraftNationality})` : ''} at ${icao}${resolvedAirportName ? ` (${resolvedAirportName})` : ''}.`;
  const keys = { perplexityApiKey, lovableApiKey, firecrawlApiKey, zenrowsApiKey };

  try {
    const government = await attemptGovernmentTier(claimText, country, keys, topCitation, fetchImpl);
    console.log(`Government evidence tier: classification=${government.classification}, citation=${government.citation ?? '(none)'}, hadError=${government.hadError}`);

    if (government.classification === 'supports' || government.classification === 'contradicts') {
      return {
        classification: government.classification,
        evidenceQuality: government.evidenceQuality,
        sourceType: 'government',
        sources: government.citation
          ? [{ url: government.citation, supports: government.classification, retrievedAt: new Date().toISOString(), evidenceQuality: government.evidenceQuality, sourceType: 'government' }]
          : [],
        hadError: false,
      };
    }

    // Government tier did not resolve the claim — try the curated industry
    // tier before giving up. This runs whether government found nothing at
    // all, failed retrieval, classified insufficient, or even errored.
    const industry = await attemptIndustryTier(claimText, keys, fetchImpl);
    console.log(`Industry evidence tier: classification=${industry.classification}, citation=${industry.citation ?? '(none)'}, hadError=${industry.hadError}`);

    if (industry.classification === 'supports' || industry.classification === 'contradicts') {
      return {
        classification: industry.classification,
        evidenceQuality: industry.evidenceQuality,
        sourceType: 'industry',
        sources: industry.citation
          ? [{ url: industry.citation, supports: industry.classification, retrievedAt: new Date().toISOString(), evidenceQuality: industry.evidenceQuality, sourceType: 'industry' }]
          : [],
        hadError: false,
      };
    }

    // Neither tier resolved the claim. Preserve a real error from either
    // tier if one occurred (more actionable than a plain "insufficient");
    // otherwise report a clean insufficient/no-error result. Prefer
    // whichever tier actually retrieved real evidence for evidenceQuality,
    // even though neither resolved the claim — "we found and examined a
    // page but it didn't address the claim" (full_page) is strictly more
    // informative than "we found nothing at all" (none), and the caller/UI
    // should be able to tell those apart.
    const hadError = government.hadError || industry.hadError;
    const evidenceQuality = government.evidenceQuality !== 'none' ? government.evidenceQuality : industry.evidenceQuality;
    return { classification: null, evidenceQuality, sources: [], hadError };
  } catch (e) {
    console.warn('permit-lookup: verification pass failed (non-fatal):', e);
    return { classification: null, evidenceQuality: 'none', sources: [], hadError: true };
  }
}
