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

import {
  isSafeEvidenceUrl,
  isValidHttpUrl,
  citationMatchesJurisdiction,
  jurisdictionDomainsForCountry,
  OFFICIAL_EVIDENCE_DOMAINS,
  type EvidenceClassification,
  type EvidenceQuality,
} from './verification-logic.ts';

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
 * Retrieves full-page evidence for a single, already jurisdiction-approved
 * URL: Firecrawl first; ZenRows only if Firecrawl did not produce usable
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
  sources: { url: string; supports: EvidenceClassification; retrievedAt: string; evidenceQuality: EvidenceQuality }[];
  hadError: boolean;
}

/** Single bounded attempt per external call (no retry loop) — a slow/failed check degrades to hadError rather than hanging or silently guessing. */
export async function runFocusedVerification(
  params: FocusedVerificationParams,
  fetchImpl: FetchLike = fetch,
): Promise<FocusedVerificationResult> {
  const {
    icao, flightTypeLabel, aircraftNationality, resolvedAirportName, permitRequired, country,
    perplexityApiKey, lovableApiKey, firecrawlApiKey, zenrowsApiKey, topCitation,
  } = params;
  const claimText = `A landing permit is ${permitRequired === 'no' ? 'NOT required' : permitRequired === 'yes' ? 'required' : 'conditionally required'} for a ${flightTypeLabel} flight${aircraftNationality ? ` (aircraft registered in ${aircraftNationality})` : ''} at ${icao}${resolvedAirportName ? ` (${resolvedAirportName})` : ''}.`;

  try {
    // Jurisdiction gate #1: the citation handed in by the caller (typically
    // the primary lookup's top citation) is only trusted if it is valid AND
    // is the DESTINATION COUNTRY's own authority — never merely "some
    // official aviation domain". This module never re-derives or guesses a
    // jurisdiction; it only ever checks a URL against jurisdictionDomainsForCountry(country).
    let verifyCitation: string | undefined = topCitation && isValidHttpUrl(topCitation) && citationMatchesJurisdiction(topCitation, country)
      ? topCitation
      : undefined;
    // The search snippet is only safe to use as fallback evidence when it is
    // the AI's own summary of the specific citation we ended up accepting —
    // never a snippet detached from (or describing a different source than)
    // the citation actually in play.
    let verifyContext = '';
    let verifyContextBackedByCitation = false;

    // Scope the follow-up search itself to the destination's own authority
    // when known, instead of the full global candidate-domain list — this
    // reduces the chance of an irrelevant-jurisdiction citation being
    // returned at all, rather than relying solely on filtering it out after
    // the fact. When the country is unmapped, fall back to the broader
    // global list (we have no narrower candidate set to offer); the
    // deterministic jurisdiction check below still rejects anything that
    // isn't the destination's own authority either way.
    const jurisdictionDomains = jurisdictionDomainsForCountry(country);
    const searchDomainFilter = jurisdictionDomains.length > 0 ? jurisdictionDomains : OFFICIAL_EVIDENCE_DOMAINS;

    if (perplexityApiKey) {
      const verifyRes = await fetchImpl('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${perplexityApiKey}`, 'Content-Type': 'application/json' },
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
        // override the citation selected above — never just the first valid
        // URL regardless of what it is. This is the direct fix for citation
        // ordering/selection picking an unrelated-jurisdiction source.
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

    // No jurisdiction-applicable citation could be established from either
    // the caller-supplied top citation or this call's own results — fail
    // safe rather than broadening to an unrelated authority. No Firecrawl
    // call and no classification call are made: there is nothing applicable
    // to classify, and skipping both avoids spending API calls on evidence
    // that can never legitimately produce a verdict.
    if (!verifyCitation) {
      return { classification: 'insufficient', evidenceQuality: 'none', sources: [], hadError: false };
    }

    // Retrieve full page content via Firecrawl, then ZenRows as a fallback
    // for this SAME url only — never a direct fetch of the AI-supplied
    // citation URL from this runtime, and never a broadened search.
    let evidenceText = '';
    let evidenceQuality: EvidenceQuality = 'none';
    const retrieval = await retrieveFullPageEvidence(verifyCitation, { firecrawlApiKey, zenrowsApiKey }, fetchImpl);
    if (retrieval.text) {
      evidenceText = retrieval.text;
      evidenceQuality = 'full_page';
    }
    if (!evidenceText && verifyContextBackedByCitation && verifyContext.trim()) {
      evidenceText = verifyContext.slice(0, 4000);
      evidenceQuality = 'search_snippet';
    }

    if (!evidenceText.trim()) {
      return { classification: 'insufficient', evidenceQuality: 'none', sources: [], hadError: false };
    }

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

    if (!classifyRes.ok) return { classification: null, evidenceQuality, sources: [], hadError: true };
    const classifyData = await classifyRes.json();
    const toolCall = classifyData?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) return { classification: null, evidenceQuality, sources: [], hadError: true };

    let parsed: { classification?: unknown };
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch {
      return { classification: null, evidenceQuality, sources: [], hadError: true };
    }
    const classification = parsed.classification;
    if (classification !== 'supports' && classification !== 'contradicts' && classification !== 'insufficient') {
      return { classification: null, evidenceQuality, sources: [], hadError: true };
    }

    return {
      classification,
      evidenceQuality,
      sources: verifyCitation ? [{ url: verifyCitation, supports: classification, retrievedAt: new Date().toISOString(), evidenceQuality }] : [],
      hadError: false,
    };
  } catch (e) {
    console.warn('permit-lookup: verification pass failed (non-fatal):', e);
    return { classification: null, evidenceQuality: 'none', sources: [], hadError: true };
  }
}
