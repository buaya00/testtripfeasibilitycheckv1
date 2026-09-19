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
// delegated to Firecrawl's hosted scrape API, which performs the actual
// outbound request on its own infrastructure. This is the same trust
// boundary the rest of this codebase already relies on for the primary
// permit-lookup pass (see ../_shared/firecrawl-scrape.ts) — not a new one.
// If Firecrawl is not configured, this module falls back to the search
// snippet already returned in the Perplexity response body; it never
// substitutes a raw fetch of the citation URL as a fallback.

import {
  isSafeEvidenceUrl,
  isValidHttpUrl,
  type EvidenceClassification,
  type EvidenceQuality,
} from './verification-logic.ts';

export type FetchLike = typeof fetch;

export interface FirecrawlEvidenceResult {
  text: string;
  quality: 'full_page' | 'none';
}

/** Retrieves page content for a specific URL via Firecrawl instead of fetching it directly. */
export async function fetchEvidenceViaFirecrawl(
  url: string,
  firecrawlApiKey: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<FirecrawlEvidenceResult> {
  if (!firecrawlApiKey) return { text: '', quality: 'none' };
  if (!isSafeEvidenceUrl(url)) return { text: '', quality: 'none' };

  try {
    const res = await fetchImpl('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${firecrawlApiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, waitFor: 3000 }),
    });
    if (!res.ok) return { text: '', quality: 'none' };
    const data = await res.json();
    const markdown = data?.data?.markdown || data?.markdown || '';
    if (typeof markdown !== 'string' || markdown.trim().length === 0) return { text: '', quality: 'none' };
    return { text: markdown.trim().slice(0, 4000), quality: 'full_page' };
  } catch {
    return { text: '', quality: 'none' };
  }
}

export interface FocusedVerificationParams {
  icao: string;
  flightTypeLabel: string;
  aircraftNationality?: string;
  resolvedAirportName: string;
  permitRequired: 'yes' | 'no' | 'conditional' | undefined;
  perplexityApiKey: string | undefined;
  lovableApiKey: string;
  firecrawlApiKey: string | undefined;
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
    icao, flightTypeLabel, aircraftNationality, resolvedAirportName, permitRequired,
    perplexityApiKey, lovableApiKey, firecrawlApiKey, topCitation,
  } = params;
  const claimText = `A landing permit is ${permitRequired === 'no' ? 'NOT required' : permitRequired === 'yes' ? 'required' : 'conditionally required'} for a ${flightTypeLabel} flight${aircraftNationality ? ` (aircraft registered in ${aircraftNationality})` : ''} at ${icao}${resolvedAirportName ? ` (${resolvedAirportName})` : ''}.`;

  try {
    let verifyContext = '';
    let verifyCitation: string | undefined = topCitation && isValidHttpUrl(topCitation) ? topCitation : undefined;

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
          search_domain_filter: ['ead.eurocontrol.int', 'icao.int', 'easa.europa.eu', 'caa.co.uk', 'faa.gov', 'iata.org', 'skybrary.aero', 'gcaa.gov.ae', 'caac.gov.cn', 'dgca.gov.in'],
          search_recency_filter: 'year',
          max_tokens: 500,
        }),
      });
      if (verifyRes.ok) {
        const verifyData = await verifyRes.json();
        verifyContext = typeof verifyData?.choices?.[0]?.message?.content === 'string' ? verifyData.choices[0].message.content : '';
        const verifyCitations: unknown[] = Array.isArray(verifyData?.citations) ? verifyData.citations : [];
        const firstValid = verifyCitations.find((c): c is string => typeof c === 'string' && isValidHttpUrl(c));
        if (firstValid) verifyCitation = firstValid;
      }
    }

    // Retrieve full page content via Firecrawl only — never a direct fetch
    // of the AI-supplied citation URL from this runtime.
    let evidenceText = '';
    let evidenceQuality: EvidenceQuality = 'none';
    if (verifyCitation) {
      const firecrawlResult = await fetchEvidenceViaFirecrawl(verifyCitation, firecrawlApiKey, fetchImpl);
      if (firecrawlResult.text) {
        evidenceText = firecrawlResult.text;
        evidenceQuality = 'full_page';
      }
    }
    if (!evidenceText && verifyContext.trim()) {
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
