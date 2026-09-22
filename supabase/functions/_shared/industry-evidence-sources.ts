// Curated, real, verified business-aviation industry sources usable as
// FALLBACK evidence when a destination's own government/CAA source (see
// COUNTRY_JURISDICTION_DOMAINS in permit-lookup/verification-logic.ts) is
// unmapped, unreachable, or doesn't specifically address the exact claim
// being checked. Deliberately Deno-free (zero Deno-specific imports/
// globals) so this exact module is importable by any Edge Function's Deno
// runtime and by the Vite/vitest test suite — same pattern as every other
// pure-logic module in this codebase.
//
// WHY THIS EXISTS: government sources are strongly preferred and tried
// first everywhere this is used — they remain the authoritative answer
// when they address the claim. But a government portal's own page is often
// a generic homepage that doesn't spell out permit/CIQ specifics for a
// narrow case (e.g. Part 91 private GA), while established, purpose-built
// industry trip-support publishers routinely do — that's the whole reason
// they exist as a business. Excluding them entirely (the original design)
// meant many correct, findable, real-world answers were never reachable,
// even when a plain web search would surface them immediately.
//
// WHY THIS IS A NAMED, CURATED LIST — NOT "search the open web": the
// original bug this whole verification system was built to fix was
// trusting an official-LOOKING source that wasn't actually applicable.
// Broadening to "any web result" would reopen that exact failure mode in a
// new form (an unrelated blog, an outdated aggregator, a low-quality SEO
// page). Every domain below is a real, independently-verified company or
// organization with an actual, ongoing business/mission specifically in
// international business-aviation trip support or advocacy — not merely a
// page that happened to rank well for a search query.
//
// Country/airport specificity for an industry citation is NOT decided by
// this list (unlike government sources, one industry domain covers many
// countries) — it is enforced by the same strict AI classifier every
// evidence path already uses, whose instructions require the evidence to
// specifically address the same country, airport, and flight type as the
// claim, or be classified 'insufficient'. This list only decides whether a
// domain is a *type* of source worth classifying at all.

export interface IndustryEvidenceSource {
  domain: string;
  /** Human-readable name for UI display — e.g. "Universal Weather & Aviation" rather than the bare domain. */
  name: string;
}

/**
 * Verified via direct research (web search, not recalled from training
 * data) on 2026-09-22 — see the accompanying PR discussion for the exact
 * pages checked for each entry:
 *
 * - Universal Weather & Aviation: 45+ years in business, an actual
 *   physical FBO at LFPB (Paris Le Bourget) under Universal Aviation
 *   France, destination guides written by named staff (e.g. Sandrine
 *   Jackson, Paris Managing Director) covering permits, PPR, customs, and
 *   more, per-country and per-airport.
 * - OPSGROUP (ops.group): purpose-built for exactly this — a real,
 *   from-scratch international-ops airport database (AOE/customs status,
 *   runway/instrument-approach data) and "Permit Book" built and used by
 *   working pilots, dispatchers, and ops controllers; public blog content
 *   covers real-time regulatory changes per country.
 * - NBAA (National Business Aviation Association): major, long-established
 *   US industry trade association with a dedicated International
 *   Operators Committee and substantial public content on customs and
 *   international regulatory issues.
 * - World Fuel / World Kinect: major, currently-active global trip-support
 *   provider with a dedicated aviation regulatory-services team managing
 *   permits, entry authorizations, and compliance documentation worldwide.
 *
 * Explicitly considered and EXCLUDED after checking:
 * - Air Routing International (airrouting.com): defunct since 2010,
 *   acquired by Rockwell Collins — no longer an independently operating
 *   source.
 * - baseops.net: verified via direct check to have pivoted to a military
 *   aviation community site — no longer a business-aviation permits/
 *   customs resource despite the name suggesting otherwise.
 * - Various smaller permit-coordination sites surfaced in research (e.g.
 *   permit2fly.com) were not included: real businesses, but without the
 *   same weight of independent verification (company history, named
 *   staff, physical presence, long operating track record) applied to the
 *   four above. Omission here is "not yet verified to this bar", not "known
 *   to be unreliable" — a candidate for later addition if independently
 *   verified, never a reason to add it speculatively now.
 */
export const INDUSTRY_EVIDENCE_SOURCES: readonly IndustryEvidenceSource[] = [
  { domain: 'universalweather.com', name: 'Universal Weather & Aviation' },
  { domain: 'universalaviation.aero', name: 'Universal Weather & Aviation' },
  { domain: 'ops.group', name: 'OPSGROUP' },
  { domain: 'nbaa.org', name: 'National Business Aviation Association (NBAA)' },
  { domain: 'world-kinect.com', name: 'World Fuel / World Kinect' },
];

/** Flat domain list for callers that just need the domains (e.g. a search-engine domain filter parameter). */
export const INDUSTRY_EVIDENCE_DOMAINS: readonly string[] = INDUSTRY_EVIDENCE_SOURCES.map((s) => s.domain);

/** True if the URL's hostname is exactly one of the curated industry domains, or a subdomain of one — never a substring/fuzzy match (which would be spoofable, e.g. "universalweather.com.evil.com"). */
export function isIndustryEvidenceDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return INDUSTRY_EVIDENCE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/** The curated source's human-readable name for a URL already confirmed via isIndustryEvidenceDomain, or null if it doesn't match any (callers should check isIndustryEvidenceDomain first; this never guesses a name for an unrecognized domain). */
export function industryEvidenceSourceName(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const match = INDUSTRY_EVIDENCE_SOURCES.find((s) => host === s.domain || host.endsWith(`.${s.domain}`));
    return match ? match.name : null;
  } catch {
    return null;
  }
}
