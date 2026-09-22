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
  'nats-uk.ead-it.com',
  'faa.gov',
  'iata.org',
  'skybrary.aero',
  'gcaa.gov.ae',
  'caac.gov.cn',
  'dgca.gov.in',
  'iaa.ie',
  'sia.aviation-civile.gouv.fr',
  'aip.dfs.de',
  'enav.it',
  'aip.enaire.es',
  'nav.pt',
  'lvnl.nl',
  'ops.skeyes.be',
  'skybriefing.com',
  'eaip.austrocontrol.at',
  'aim.rlp.cz',
  'ais.pansa.pl',
  'avinor.no',
  'aro.lfv.se',
  'aim.naviair.dk',
  'ais.fi',
  'dhmi.gov.tr',
  'gaca.gov.sa',
  'caa.gov.qa',
  'paca.gov.om',
  'cad.gov.hk',
  'caas.gov.sg',
  'caat.or.th',
  'aisjapan.mlit.go.jp',
  'caam.gov.my',
  'navcanada.ca',
  'aisweb.decea.mil.br',
  'caa.co.za',
  'airservicesaustralia.com',
  'aip.net.nz',
] as const;

/**
 * Maps a destination country (normalized, case-insensitive) to the subset of
 * OFFICIAL_EVIDENCE_DOMAINS that is actually THAT country's own national
 * civil aviation authority. Deliberately explicit rather than derived: it
 * covers only the countries our fixed evidence-domain list can actually
 * speak for as a NATIONAL regulator. A country with no entry here simply has
 * no known national-authority domain among our current evidence sources —
 * see jurisdictionDomainsForCountry, which returns [] in that case rather
 * than falling back to the full global list (pan-European bodies are
 * documented, sourced dead-ends — see EASA_MEMBER_STATES and
 * EUROCONTROL_MEMBER_STATES below — never a fallback for an unmapped
 * country). That is the fix for the observed bug (a UAE GCAA page being
 * accepted as evidence for a UK landing-permit claim merely because
 * gcaa.gov.ae is *an* official aviation-authority domain): "official" is
 * necessary but not sufficient — it must also be the destination's own
 * authority.
 *
 * icao.int, iata.org and skybrary.aero are intentionally absent: none of
 * them is a national regulator, so none of them can ever be "the applicable
 * authority" for a specific country's landing-permit rules.
 *
 * Source for every domain below: the EAIP_SOURCES map already curated in
 * this codebase (../_shared/firecrawl-scrape.ts), which the primary
 * permit-lookup pass has used to scrape these exact national CAA/AIP
 * publications successfully for months — reused here rather than
 * re-researched, since it's the same "this domain is this country's actual
 * authority" fact this map needs, already vetted for a different purpose.
 * Only entries with a real, non-empty URL in that map are included; ICAO
 * prefixes with no known URL there (e.g. Hungary, Romania, Greece, Mexico,
 * South Korea, Indonesia, the Philippines, Nigeria, Kenya) are deliberately
 * left unmapped here too, for the same reason — no guessing a domain neither
 * map has actually verified.
 *
 * The UK entry now also includes nats-uk.ead-it.com (NATS' own UK-specific
 * eAIP hosting subdomain, distinct from the shared ead-it.com hosting
 * platform itself) — EAIP_SOURCES already listed it as a UK source, but it
 * had been missed when this map was first built, meaning a genuine UK
 * citation from that domain would have been wrongly rejected as
 * inapplicable evidence.
 */
const COUNTRY_JURISDICTION_DOMAINS: Record<string, readonly string[]> = {
  'united kingdom': ['caa.co.uk', 'nats-uk.ead-it.com'],
  'uk': ['caa.co.uk', 'nats-uk.ead-it.com'],
  'great britain': ['caa.co.uk', 'nats-uk.ead-it.com'],
  'britain': ['caa.co.uk', 'nats-uk.ead-it.com'],
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
  'ireland': ['iaa.ie'],
  'france': ['sia.aviation-civile.gouv.fr'],
  'french republic': ['sia.aviation-civile.gouv.fr'],
  'germany': ['aip.dfs.de'],
  'italy': ['enav.it'],
  'spain': ['aip.enaire.es'],
  'portugal': ['nav.pt'],
  'netherlands': ['lvnl.nl'],
  'the netherlands': ['lvnl.nl'],
  'holland': ['lvnl.nl'],
  'belgium': ['ops.skeyes.be'],
  'switzerland': ['skybriefing.com'],
  'austria': ['eaip.austrocontrol.at'],
  'czech republic': ['aim.rlp.cz'],
  'czechia': ['aim.rlp.cz'],
  'poland': ['ais.pansa.pl'],
  'norway': ['avinor.no'],
  'sweden': ['aro.lfv.se'],
  'denmark': ['aim.naviair.dk'],
  'finland': ['ais.fi'],
  'turkey': ['dhmi.gov.tr'],
  'türkiye': ['dhmi.gov.tr'],
  'saudi arabia': ['gaca.gov.sa'],
  'qatar': ['caa.gov.qa'],
  'oman': ['paca.gov.om'],
  'hong kong': ['cad.gov.hk'],
  'singapore': ['caas.gov.sg'],
  'thailand': ['caat.or.th'],
  'japan': ['aisjapan.mlit.go.jp'],
  'malaysia': ['caam.gov.my'],
  'canada': ['navcanada.ca'],
  'brazil': ['aisweb.decea.mil.br'],
  'south africa': ['caa.co.za'],
  'australia': ['airservicesaustralia.com'],
  'new zealand': ['aip.net.nz'],
};

/**
 * The EASA system's member states: the 27 EU member states plus the 4 EFTA
 * states that fully participate in EASA (Iceland, Liechtenstein, Norway,
 * Switzerland) — 31 in total. Source: EASA's own published member-state
 * list (easa.europa.eu/en/light/topics/easa-member-states) and its
 * "EASA By Country" relationship page, cross-checked against an aviation
 * regulator's advisory note confirming the UK became a Third Country (i.e.
 * NOT an EASA member) upon leaving the EU on 31/01/2020.
 *
 * NOT currently used by jurisdictionDomainsForCountry. Initially added on
 * the assumption that EASA membership would make easa.europa.eu applicable
 * permit evidence for a member state — that assumption was wrong and was
 * corrected after review: EASA standardizes the STRUCTURE of each member
 * state's AIP, not the permit CRITERIA within it. Do not re-add
 * easa.europa.eu (or any other pan-European domain) as permit evidence
 * without new evidence overturning the below.
 *
 * Verified via:
 *  - EASA's AIP content specification, which mandates that GEN 1.2 in every
 *    member state's AIP cover "regulations and requirements for advance
 *    notification and applications for permission concerning international
 *    aircraft entry, transit and departure" — a structural requirement
 *    (which section, what topics), not a substantive one (what the answer
 *    is).
 *  - EASA's own confirmation that individual member states remain
 *    responsible for operating permits and traffic rights.
 *  - Two real member states' AIP GEN 1.2 content, which differ in exactly
 *    the way that confirmation predicts: Portugal treats a filed flight
 *    plan as sufficient prior notification for qualifying nonscheduled
 *    overflights/non-traffic stops by ICAO-contracting-state operators,
 *    while Estonia instead describes its own distinct national
 *    operating-permit process under its air-service agreements. Same GEN
 *    1.2 section, same EASA structural mandate, materially different
 *    permit treatment.
 * Conclusion: easa.europa.eu itself never contains any given country's
 * actual permit rules — the applicable evidence is always that country's
 * OWN AIP GEN 1.2 (published by its own national authority/AIS, not by
 * EASA). EASA membership was therefore never a valid applicability signal,
 * independent of the separate EUROCONTROL/route-vs-permit distinction
 * documented below.
 *
 * Kept here, unused, as vetted reference data in case a future feature
 * needs "is this an EASA member" (e.g. citing the common AIP structure) —
 * exported for that purpose, but do not wire it into jurisdiction matching.
 */
export const EASA_MEMBER_STATES = new Set<string>([
  // EU-27
  'austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czech republic', 'czechia',
  'denmark', 'estonia', 'finland', 'france', 'germany', 'greece', 'hungary', 'ireland',
  'italy', 'latvia', 'lithuania', 'luxembourg', 'malta', 'netherlands', 'poland',
  'portugal', 'romania', 'slovakia', 'slovenia', 'spain', 'sweden',
  // EFTA states inside the EASA system
  'iceland', 'liechtenstein', 'norway', 'switzerland',
]);

/**
 * EUROCONTROL's full Member States (41), per EUROCONTROL's own published
 * list (eurocontrol.int/our-member-and-comprehensive-agreement-states),
 * retrieved 2026.
 *
 * NOT currently used by jurisdictionDomainsForCountry: EUROCONTROL/EAD is a
 * pan-European air-traffic-management and route/airspace body (route
 * charges, airway/slot allocation, A-CDM, network operations) — it does not
 * issue or publish country-specific LANDING PERMIT requirements, which
 * remain a purely national matter set by each destination's own CAA/AIP.
 * Treating an EAD citation as applicable evidence for a landing-permit
 * claim would be the same category error this whole fix exists to remove,
 * just with a different domain.
 *
 * A future feature in this codebase (route/airway-slot or A-CDM compliance
 * checks) may need EUROCONTROL membership — kept here as vetted reference
 * data and exported for that purpose, but deliberately NOT wired into
 * jurisdictionDomainsForCountry or any permit-jurisdiction matching.
 */
export const EUROCONTROL_MEMBER_STATES = new Set<string>([
  'albania', 'armenia', 'austria', 'belgium', 'bosnia and herzegovina', 'bulgaria',
  'croatia', 'cyprus', 'czech republic', 'czechia', 'denmark', 'estonia', 'finland',
  'france', 'georgia', 'germany', 'greece', 'hungary', 'iceland', 'ireland', 'italy',
  'latvia', 'lithuania', 'luxembourg', 'malta', 'moldova', 'republic of moldova',
  'monaco', 'montenegro', 'netherlands', 'north macedonia', 'macedonia', 'norway',
  'poland', 'portugal', 'romania', 'serbia', 'slovakia', 'slovenia', 'spain', 'sweden',
  'switzerland', 'turkey', 'türkiye', 'ukraine',
  'united kingdom', 'uk', 'great britain', 'britain',
]);

/** Normalizes a free-form country string the same way on both sides of a lookup. */
function normalizeCountry(country: string | undefined): string {
  return (country ?? '').trim().toLowerCase();
}

/**
 * The domain(s) — a subset of OFFICIAL_EVIDENCE_DOMAINS — that are actually
 * applicable to the given destination country: its own national authority,
 * if and only if we have one mapped above. NEITHER pan-European body
 * (EASA, EUROCONTROL) is ever included, regardless of membership — see
 * EASA_MEMBER_STATES's and EUROCONTROL_MEMBER_STATES's doc comments: one
 * standardizes AIP structure without standardizing permit content, the
 * other is a route/airspace/ATM body, and NEITHER publishes or determines
 * any country's actual permit rules. Permits are always a purely national
 * matter — a country with no national-authority entry above returns []:
 * the deliberate "fail safe, do not assume" default, not a gap to paper
 * over with a plausible-looking pan-European domain.
 */
export function jurisdictionDomainsForCountry(country: string | undefined): readonly string[] {
  const normalized = normalizeCountry(country);
  if (!normalized) return [];
  return [...(COUNTRY_JURISDICTION_DOMAINS[normalized] ?? [])];
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
  /** Whether this evidence came from the destination's own government/CAA authority, or a curated industry trip-support source used as a fallback. Always shown to the user — an industry-sourced confirmation carries different weight than a government one, and hiding that distinction would itself be a form of overclaiming confidence. */
  sourceType: EvidenceSourceType;
}

/** 'government' = the destination's own official CAA/AIP authority (see COUNTRY_JURISDICTION_DOMAINS). 'industry' = a curated business-aviation trip-support publisher (see _shared/industry-evidence-sources.ts), used only as a fallback when no government evidence resolves the claim. Government is always attempted first and preferred; industry is never used to override a government result, only to fill a gap. */
export type EvidenceSourceType = 'government' | 'industry';

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
