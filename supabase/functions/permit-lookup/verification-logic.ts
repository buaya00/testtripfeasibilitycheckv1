// Pure, side-effect-free decision logic for the permit-lookup verification
// pass. Deliberately has ZERO Deno-specific imports/globals so the exact
// same module can be imported both by the Deno Edge Function at runtime and
// by the Vite/vitest test suite for automated testing without a Deno runtime
// or any live/paid API calls.

export type PermitRequired = 'yes' | 'no' | 'conditional';
export type Confidence = 'high' | 'medium' | 'low';

export type VerificationStatus =
  | 'not_triggered'
  | 'confirmed'
  | 'provisional'
  | 'inconclusive'
  | 'conflicting'
  | 'unavailable';

/**
 * How the evidence classified as 'supports'/'contradicts' was actually
 * obtained. 'full_page' means real source-page content was retrieved
 * (via Firecrawl) and examined. 'search_snippet' means only the search
 * engine's own AI-generated summary text was available — this is a second
 * AI's characterization of a source, not the source itself, and must never
 * be treated as equivalent to having actually examined the source. 'none'
 * means no evidence text was available at all.
 */
export type EvidenceQuality = 'full_page' | 'search_snippet' | 'none';

export type TriggerReason =
  | 'low_confidence'
  | 'no_citations'
  | 'ambiguous_conditional'
  | 'indeterminate_result'
  | 'citation_not_authoritative'
  | 'evidence_relevance_unconfirmed'
  | 'sufficient';

export interface TriggerResult {
  trigger: boolean;
  reason: TriggerReason;
}

/** Official CAA/AIP/ICAO domains the primary and follow-up searches are restricted to. */
export const OFFICIAL_EVIDENCE_DOMAINS = [
  'ead.eurocontrol.int',
  'icao.int',
  'easa.europa.eu',
  'caa.co.uk',
  'faa.gov',
  'iata.org',
  'skybrary.aero',
  'gcaa.gov.ae',
  'caac.gov.cn',
  'dgca.gov.in',
] as const;

/** Real, checkable signal (not fabricated): does this citation's own hostname match one of the officially-targeted domains? */
export function citationMatchesOfficialDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_EVIDENCE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function textMentionsCountry(text: string | undefined, country: string | undefined): boolean {
  const needle = country?.trim().toLowerCase();
  if (!text || !needle) return false;
  return text.toLowerCase().includes(needle);
}

export interface VerificationTriggerInput {
  permitRequired: PermitRequired | undefined;
  confidence: Confidence | undefined;
  /** Already-sanitized http(s) citation URLs (see sanitizeCitations). */
  citations: string[];
  country: string | undefined;
  conditions?: string;
  notes?: string;
}

/**
 * Deterministic, zero-cost gate: decides whether the primary pass's result
 * needs a follow-up verification pass. A citation count and "confidence: high"
 * are NOT, by themselves, evidence that the cited material is actually about
 * this country/airport/flight type — a single generic or off-topic citation
 * must not let a determination skip verification. Applies the same bar to
 * both "required" and "not required" determinations; only skips verification
 * when the citation evidence is both authoritative (from an officially-
 * targeted domain) AND demonstrably about the specific case (the model's own
 * stated justification names the destination country).
 */
export function assessNeedsVerification(input: VerificationTriggerInput): TriggerResult {
  const { permitRequired, confidence, citations, country, conditions, notes } = input;

  if (confidence !== 'high') {
    return { trigger: true, reason: 'low_confidence' };
  }
  if (!citations || citations.length === 0) {
    return { trigger: true, reason: 'no_citations' };
  }
  if (permitRequired === undefined) {
    return { trigger: true, reason: 'indeterminate_result' };
  }
  if (permitRequired === 'conditional') {
    return { trigger: true, reason: 'ambiguous_conditional' };
  }
  if (!citations.some(citationMatchesOfficialDomain)) {
    return { trigger: true, reason: 'citation_not_authoritative' };
  }
  if (!textMentionsCountry(conditions, country) && !textMentionsCountry(notes, country)) {
    return { trigger: true, reason: 'evidence_relevance_unconfirmed' };
  }
  return { trigger: false, reason: 'sufficient' };
}

export type EvidenceClassification = 'supports' | 'contradicts' | 'insufficient';

/**
 * Maps the outcome of the follow-up verification attempt to a final status.
 * `hadError` covers network/API failure or timeout during the verification
 * attempt itself — distinct from `insufficient`, which means the attempt
 * completed but found no adequate evidence either way. Never maps a
 * disagreement straight into overwriting the primary determination — the
 * caller is expected to keep the original `permitRequired` value and only
 * change how it is *displayed*.
 *
 * Critically, 'confirmed' ("Verified against source") is ONLY reachable when
 * real source-page content was retrieved and examined (evidenceQuality ===
 * 'full_page'). A 'supports' classification built only from a search-engine
 * snippet — i.e. no actual source page was ever fetched — maps to
 * 'provisional' instead: the claim looks supported, but this has not been
 * independently checked against the source itself.
 */
export function resolveVerificationStatus(
  classification: EvidenceClassification | null,
  hadError: boolean,
  evidenceQuality: EvidenceQuality,
): VerificationStatus {
  if (hadError) return 'unavailable';
  if (classification === 'contradicts') return 'conflicting';
  if (classification === 'supports') {
    return evidenceQuality === 'full_page' ? 'confirmed' : 'provisional';
  }
  return 'inconclusive'; // classification === 'insufficient' or null
}

/**
 * Statuses for which the UI must not display an unqualified green/red/
 * yellow permit determination and must instead show a prominent
 * "verification required" warning. 'provisional' and 'not_triggered' are
 * deliberately excluded: the underlying determination may well be correct,
 * it just hasn't been independently confirmed against source content — that
 * distinction is surfaced as a neutral disclosure, not a destructive warning.
 */
export function requiresVerificationWarning(status: VerificationStatus): boolean {
  return status === 'inconclusive' || status === 'conflicting' || status === 'unavailable';
}

/** True only for a genuinely source-examined, supporting result — the sole case where "Verified against source" may be displayed. */
export function isSourceVerified(status: VerificationStatus): boolean {
  return status === 'confirmed';
}

/** Validates a string is a well-formed http(s) URL before it is ever rendered as a link or fetched. */
export function isValidHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Syntactic pre-check against the most common SSRF targets (loopback,
// RFC1918 private ranges, link-local/cloud-metadata, IPv6 equivalents).
// Deliberately string/regex-based and NOT a DNS lookup: this module has zero
// I/O by design. It cannot catch DNS rebinding (a normal-looking hostname
// resolving to an internal IP at fetch time) — that residual risk is why the
// verification runtime never fetches an AI-supplied URL directly at all; it
// delegates retrieval to Firecrawl, which performs the actual outbound
// request on its own infrastructure. This check is an extra, redundant gate
// on top of that, not the primary defense.
const PRIVATE_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // link-local, includes cloud metadata endpoints (e.g. 169.254.169.254)
  /^::1$/,
  /^fc[0-9a-f]{2}:/, // IPv6 unique local
  /^fe80:/, // IPv6 link-local
];

/** True only if the URL's hostname does not look like a loopback/private/link-local/metadata address. */
export function isPubliclyRoutableHostname(rawUrl: string): boolean {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const bare = host.replace(/^\[/, '').replace(/\]$/, '');
  return !PRIVATE_HOSTNAME_PATTERNS.some((re) => re.test(bare));
}

/** Combines the two checks that must both pass before any evidence-retrieval attempt is made against a URL. */
export function isSafeEvidenceUrl(url: string): boolean {
  return isValidHttpUrl(url) && isPubliclyRoutableHostname(url);
}

export interface VerificationSource {
  url: string;
  supports: EvidenceClassification;
  retrievedAt: string; // ISO timestamp — always the real time the check ran, never invented
  evidenceQuality: EvidenceQuality;
}

export interface PermitVerification {
  status: VerificationStatus;
  reason: TriggerReason;
  checkedAt?: string; // ISO timestamp of when the follow-up ran; absent if not_triggered
  sources?: VerificationSource[];
}

/** Filters a raw citation list down to only well-formed http(s) URLs, never inventing or dropping silently in a way the caller can't see (returns count too). */
export function sanitizeCitations(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string' && isValidHttpUrl(c));
}
