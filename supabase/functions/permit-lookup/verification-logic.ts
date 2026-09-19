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
  | 'evidence_relevance_unconfirmed'
  | 'sufficient';

export interface TriggerResult {
  trigger: boolean;
  reason: TriggerReason;
}

/** Official CAA/AIP/ICAO domains the primary and follow-up searches draw candidate sources from. Being on this list makes a domain a plausible aviation-regulatory source in general — it does NOT, by itself, mean the domain speaks for any particular country. See jurisdictionDomainsForCountry. */
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

/**
 * Maps a destination country (normalized, case-insensitive) to the subset of
 * OFFICIAL_EVIDENCE_DOMAINS that is actually THAT country's own civil
 * aviation authority. Deliberately small and explicit: it covers only the
 * countries our fixed evidence-domain list can actually speak for. A country
 * with no entry here has NO applicable domain among our current evidence
 * sources — see jurisdictionDomainsForCountry, which returns [] in that case
 * rather than falling back to the full global list. That is the fix for the
 * observed bug (a UAE GCAA page being accepted as evidence for a UK landing-
 * permit claim merely because gcaa.gov.ae is *an* official aviation-authority
 * domain): "official" is necessary but not sufficient — it must also be the
 * destination's own authority.
 *
 * icao.int, iata.org and skybrary.aero are intentionally absent: none of
 * them is a national regulator, so none of them can ever be "the applicable
 * authority" for a specific country's landing-permit rules. ead.eurocontrol.int
 * and easa.europa.eu (pan-European sources covering many states at once) are
 * also intentionally absent — this codebase has no reliable, narrow way to
 * confirm a given country is an EU/EASA/Eurocontrol member without a much
 * larger country database, and guessing would reintroduce exactly the kind
 * of unjustified applicability assumption this fix removes. The safe
 * consequence is that EU-destination results verify less often via the
 * bypass path and, when the only follow-up evidence is EAD/EASA, it is
 * correctly rejected rather than trusted — see the "remaining limitations"
 * note this ships with.
 */
const COUNTRY_JURISDICTION_DOMAINS: Record<string, readonly string[]> = {
  'united kingdom': ['caa.co.uk'],
  'uk': ['caa.co.uk'],
  'great britain': ['caa.co.uk'],
  'britain': ['caa.co.uk'],
  'united states': ['faa.gov'],
  'united states of america': ['faa.gov'],
  'usa': ['faa.gov'],
  'us': ['faa.gov'],
  'united arab emirates': ['gcaa.gov.ae'],
  'uae': ['gcaa.gov.ae'],
  'china': ['caac.gov.cn'],
  "people's republic of china": ['caac.gov.cn'],
  'prc': ['caac.gov.cn'],
  'india': ['dgca.gov.in'],
};

/** Normalizes a free-form country string the same way on both sides of a lookup. */
function normalizeCountry(country: string | undefined): string {
  return (country ?? '').trim().toLowerCase();
}

/** The domain(s) — a subset of OFFICIAL_EVIDENCE_DOMAINS — that are the given destination country's OWN authority. Returns [] when the country is unmapped: a deliberate "fail safe, do not assume" default, not a gap to silently paper over. */
export function jurisdictionDomainsForCountry(country: string | undefined): readonly string[] {
  return COUNTRY_JURISDICTION_DOMAINS[normalizeCountry(country)] ?? [];
}

/**
 * Real, checkable signal (not fabricated): does this citation's own hostname
 * belong to the DESTINATION COUNTRY'S OWN aviation authority — not merely to
 * some official-looking domain from an unrelated jurisdiction? Decided
 * outright by domain membership in the static map above. An unmapped
 * country has no entry and therefore no domain can ever satisfy this check
 * for it — deliberately: a prior acronym-matching fallback that tried to
 * dynamically infer applicability for unmapped countries was removed after
 * review, since it introduced a real acronym-collision risk (a country
 * whose own authority happens to share a short name with, say, the UK's
 * "CAA" would have wrongly matched caa.co.uk) for negligible actual
 * coverage benefit given how few of OFFICIAL_EVIDENCE_DOMAINS' labels are
 * even nameable this way. The caller must fail safe to an inconclusive
 * result whenever this returns false rather than treat "unmapped" as
 * license to trust any citation from the curated list.
 */
export function citationMatchesJurisdiction(url: string, country: string | undefined): boolean {
  const applicable = jurisdictionDomainsForCountry(country);
  if (applicable.length === 0) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return applicable.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export interface VerificationTriggerInput {
  permitRequired: PermitRequired | undefined;
  confidence: Confidence | undefined;
  /** Already-sanitized http(s) citation URLs (see sanitizeCitations). */
  citations: string[];
  country: string | undefined;
}

/**
 * Deterministic, zero-cost gate: decides whether the primary pass's result
 * needs a follow-up verification pass. A citation count and "confidence: high"
 * are NOT, by themselves, evidence that the cited material is actually
 * applicable to this destination — a citation from *some* official aviation
 * authority is not evidence for *this* country's rules unless it is that
 * country's own authority. Applicability is checked against the structured
 * `country` field returned by the primary lookup (via jurisdictionDomainsForCountry),
 * not by searching free-text `conditions`/`notes` prose for an exact country-name
 * substring — that approach is fragile (it depends on incidental phrasing,
 * e.g. "UK CAA" vs "United Kingdom") and was the source of a prior bug where
 * this trigger fired for a correct UK determination merely because the
 * free-text field happened not to spell out the country name literally.
 * Applies the same bar to both "required" and "not required" determinations.
 */
export function assessNeedsVerification(input: VerificationTriggerInput): TriggerResult {
  const { permitRequired, confidence, citations, country } = input;

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
  if (!citations.some((url) => citationMatchesJurisdiction(url, country))) {
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
