// Flight-Specific NOTAM Impact Analysis — core type definitions.
//
// ARCHITECTURAL NOTE (do not remove without re-reading): this module and
// its sibling engine.ts do NOT fetch NOTAM data themselves. Airflow
// Intelligence's get_airport_context tool is an MCP tool available to
// Claude in a conversation; a deployed Supabase Edge Function has no way
// to invoke it, and no confirmed direct REST API credential (the
// airflow_pk_... key path) exists for this application as of this
// writing. Until that is resolved, real NOTAM data reaches this module
// only via a Claude-mediated workflow that has already called the MCP
// tool and passes its result in as plain data. This module is written so
// that swapping in a real edge-function fetch later requires zero changes
// here — only a new caller.
//
// Deno-free, React-free — pure TypeScript, mirroring src/lib/frat/'s
// separation of pure logic from I/O and presentation.

import type { LegData, RunwayResult, AirportHoursResult } from '../../components/tripTypes';

// ── Airflow's raw NOTAM report shape ─────────────────────────────────────
// Field names and meanings verified directly against two live
// get_airport_context(facet: "notams") calls (KJFK and WSSS) during this
// investigation, not assumed from documentation alone.

export type AirflowImpactBand = 'HIGH' | 'MEDIUM' | 'LOW';
export type AirflowTemporalStatus = 'IN_EFFECT' | 'UPCOMING' | 'EXPIRED' | 'UNKNOWN';
export type AirflowEffectiveToStatus = 'BOUNDED' | 'SOURCE_TEXT_ONLY' | 'UNKNOWN';
/** Verified as genuinely distinct provenance values across the two live test calls — STORED_IMPACT_NODE (KJFK) vs HEURISTIC_FALLBACK (WSSS). Never treat these as equally authoritative; surface which one applies. */
export type AirflowImpactSource = 'STORED_IMPACT_NODE' | 'HEURISTIC_FALLBACK' | string;

export interface AirflowNotamReport {
  notamId: string;
  jeppNumber?: string;
  airportIcao: string;
  sourceText: string;
  runwayIds: string[];
  effectiveFromUtc: string;
  effectiveToUtc?: string;
  effectiveToStatus: AirflowEffectiveToStatus;
  temporalStatus: AirflowTemporalStatus;
  receivedAtUtc?: string;
  scope?: string;
  impact: {
    band: AirflowImpactBand;
    confidence: number;
    restrictionType?: string;
    whyThisMatters?: string;
    recommendedActions?: string[];
    source: AirflowImpactSource;
  };
}

/** The retrieval-completeness envelope Airflow returns alongside the report list itself — this is the data the mandatory coverage disclosure is built from. Field names match context.facet.data.details.overview.* verified live. */
export interface AirflowNotamRetrieval {
  airportIcao: string;
  /** How many active NOTAM source records Airflow's ranking considered — verified NOT always the airport's true total (KJFK's own wording: "the 50 MOST RECENTLY RECEIVED active NOTAM source records"). */
  candidateCount: number;
  /** True when candidateCount itself is a recency-windowed subset rather than the confirmed full active population (observed true for KJFK, false for WSSS in live testing — this genuinely varies per airport/query). */
  candidateWindowTruncated: boolean;
  /** How many reports were actually returned in this call (observed fixed at 10 in both live tests; the 'limit' parameter was directly tested and confirmed REJECTED for this facet — see engine.ts's coverage logic). */
  returnedCount: number;
  /** True whenever returnedCount < candidateCount, or candidateWindowTruncated is true. */
  hasMore: boolean;
  reports: AirflowNotamReport[];
  retrievedAtUtc: string;
}

/** Represents a failed or unavailable retrieval attempt — kept as its own type so a caller can never confuse "Airflow returned nothing" with "no NOTAMs exist." See engine.ts's handling: this must never be silently treated as an empty, clean NOTAM set. */
export interface AirflowNotamRetrievalFailure {
  airportIcao: string;
  reason: 'timeout' | 'mcp_error' | 'malformed_response' | 'not_yet_queried';
  detail?: string;
}

export type AirflowNotamOutcome =
  | { ok: true; retrieval: AirflowNotamRetrieval }
  | { ok: false; failure: AirflowNotamRetrievalFailure };

// ── Flight context (per the corrected, registration-free design) ────────

/**
 * Normalized per-leg flight context for NOTAM cross-referencing. Built
 * ONLY from fields that actually exist in this repository's LegData/trip
 * state — verified by direct inspection, not assumed from an idealized
 * schema. Aircraft registration/tail number is deliberately NOT a field
 * here: aircraft type is the aircraft-specific context for this feature,
 * per explicit instruction. route/waypoints/firs/cruiseAltitude/sid/star/
 * approach/selectedRunway are also absent because no such data exists
 * anywhere in this codebase (confirmed by direct inspection) — they are
 * NOT modeled as null placeholders here; a field that can never be
 * populated by this application isn't part of its real type, and adding
 * one would invite a caller to treat "always null" as "not yet fetched."
 */
export interface NotamFlightContext {
  icao: string;
  role: 'departure' | 'destination' | 'alternate';
  /** UTC ISO timestamp. Undefined when the leg has no date/time entered yet — never fabricated. */
  operationTimeUtc: string | undefined;
  aircraftType: string;
  runwayResult: RunwayResult | null;
  airportHoursResult: AirportHoursResult | null;
}

// ── Cross-reference classifications ──────────────────────────────────────

export type TimeApplicability = 'ACTIVE_AT_OPERATION' | 'STARTS_SOON_AFTER' | 'ENDS_SHORTLY_BEFORE' | 'NOT_ACTIVE' | 'UNKNOWN';

export type RunwayRelationship = 'DIRECT_MATCH' | 'VIABLE_RUNWAY_IMPACT' | 'OTHER_RUNWAY_IMPACT' | 'UNKNOWN_RUNWAY_APPLICABILITY';

export type FlightPhase = 'DEPARTURE' | 'ARRIVAL' | 'ALTERNATE' | 'ENROUTE' | 'GROUND' | 'MULTIPLE' | 'UNKNOWN';

export type FlightApplicability = 'DIRECTLY_RELEVANT' | 'POTENTIALLY_RELEVANT' | 'INFORMATIONAL' | 'NOT_CURRENTLY_APPLICABLE' | 'UNDETERMINED';

// ── The final, per-NOTAM analysis record ─────────────────────────────────

export interface TripNotamAnalysis {
  notamId: string;
  airport: string;
  rawText: string;
  runwayIds: string[];
  effectiveStart: string;
  effectiveEnd?: string;
  effectiveToStatus: AirflowEffectiveToStatus;

  // Airflow's own interpretation — preserved verbatim, clearly attributed,
  // never overwritten by this application's own scoring.
  airflowImpact: AirflowImpactBand;
  airflowConfidence: number;
  airflowExplanation?: string;
  airflowRecommendedActions?: string[];
  airflowImpactSource: AirflowImpactSource;

  // This application's own, separately-derived applicability layer.
  flightApplicability: FlightApplicability;
  flightSpecificReason: string;
  flightPhase: FlightPhase[];
  runwayRelationship: RunwayRelationship;
  timeRelationship: TimeApplicability;
  delayExposureMinutes?: number;

  requiresHumanReview: boolean;
  source: 'airflow';
  provenance: AirflowImpactSource;
}

/** The mandatory, always-visible retrieval-completeness statement — see engine.ts's deriveCoverageStatement for the exact wording rules this must satisfy (never "all NOTAMs reviewed" unless provably true). */
export interface NotamCoverageStatement {
  airportIcao: string;
  analyzedCount: number;
  candidateCount: number | undefined;
  isCompleteRetrieval: boolean;
  statement: string;
}

export interface LegNotamAnalysisResult {
  legIcao: string;
  role: 'departure' | 'destination' | 'alternate';
  coverage: NotamCoverageStatement;
  analyses: TripNotamAnalysis[];
  retrievalFailed: boolean;
  retrievalFailureReason?: string;
}
