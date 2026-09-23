// Flight-Specific NOTAM Impact Analysis — deterministic cross-reference
// engine.
//
// Pure functions only: no I/O, no LLM call, no randomness. Per the
// explicit requirement, this uses ONLY deterministic cross-referencing
// (time, runway, airport, leg, phase) and does not send Airflow's
// already-interpreted NOTAMs into a second AI pass. Airflow's own impact/
// confidence/explanation/recommendedActions are preserved verbatim and
// never overwritten or duplicated by an invented local score.
//
// THE SINGLE MOST IMPORTANT RULE THIS FILE ENFORCES: retrieval
// completeness is never conflated with relevance. A NOTAM Airflow didn't
// return is never treated as "not relevant" -- it's absent, and the
// coverage statement says so explicitly every time.

import type {
  AirflowNotamOutcome,
  AirflowNotamReport,
  AirflowNotamRetrieval,
  AirflowNotamRetrievalFailure,
  NotamFlightContext,
  NotamCoverageStatement,
  LegNotamAnalysisResult,
  TripNotamAnalysis,
  TimeApplicability,
  RunwayRelationship,
  FlightApplicability,
  FlightPhase,
} from './types';
import type { RunwayResult } from '../../components/tripTypes';

/**
 * How close to a NOTAM's start/end (in minutes) counts as "starts soon
 * after" / "ends shortly before" rather than a clean NOT_ACTIVE. A
 * sensible, documented default -- centrally configurable per the same
 * principle used for FRAT's risk bands, not a magic number buried in the
 * comparison logic itself.
 */
export const DEFAULT_TIME_BUFFER_MINUTES = 120;

// ── Time applicability ───────────────────────────────────────────────────

export function classifyTimeApplicability(
  notam: AirflowNotamReport,
  operationTimeUtc: string | undefined,
  bufferMinutes: number = DEFAULT_TIME_BUFFER_MINUTES,
): { status: TimeApplicability; delayExposureMinutes?: number } {
  if (!operationTimeUtc) return { status: 'UNKNOWN' };
  const opTime = new Date(operationTimeUtc).getTime();
  if (Number.isNaN(opTime)) return { status: 'UNKNOWN' };

  const start = new Date(notam.effectiveFromUtc).getTime();
  if (Number.isNaN(start)) return { status: 'UNKNOWN' };

  let end: number | undefined;
  if (notam.effectiveToUtc) {
    end = new Date(notam.effectiveToUtc).getTime();
    if (Number.isNaN(end)) return { status: 'UNKNOWN' };
  }

  const bufferMs = bufferMinutes * 60000;

  if (opTime < start) {
    const gapMinutes = Math.round((start - opTime) / 60000);
    return gapMinutes <= bufferMinutes
      ? { status: 'STARTS_SOON_AFTER', delayExposureMinutes: gapMinutes }
      : { status: 'NOT_ACTIVE' };
  }

  if (end !== undefined && opTime > end) {
    const gapMinutes = Math.round((opTime - end) / 60000);
    return gapMinutes <= bufferMinutes
      ? { status: 'ENDS_SHORTLY_BEFORE', delayExposureMinutes: gapMinutes }
      : { status: 'NOT_ACTIVE' };
  }

  // start <= opTime, and either no end (open-ended / SOURCE_TEXT_ONLY --
  // never assumed expired just because we don't know when it ends) or
  // opTime <= end.
  return { status: 'ACTIVE_AT_OPERATION' };
}

// ── Runway relationship ──────────────────────────────────────────────────

/** Strips a leading zero from the numeric part of a runway ident while preserving the L/C/R suffix, so "02C" and "2C" compare equal. */
function normalizeRunwayIdent(ident: string): string {
  const match = /^0*(\d+)([A-Za-z]?)$/.exec(ident.trim());
  return match ? `${match[1]}${match[2].toUpperCase()}` : ident.trim().toUpperCase();
}

/**
 * Classifies how a NOTAM's affected runway(s) relate to the leg's known
 * runway data -- NEVER used to filter out a NOTAM, only to classify it
 * (see the explicit "do not filter only by the current runway"
 * requirement). "Primary" here means the longest-runway auto-pick this
 * app already computes for feasibility purposes -- the closest honest
 * analog to an ATC/wind-based "selected runway," which this app does not
 * have (see types.ts's documented gap).
 */
export function classifyRunwayRelationship(notamRunwayIds: string[], runwayResult: RunwayResult | null): RunwayRelationship {
  if (notamRunwayIds.length === 0) return 'UNKNOWN_RUNWAY_APPLICABILITY';
  if (!runwayResult || !runwayResult.runways || runwayResult.runways.length === 0) return 'UNKNOWN_RUNWAY_APPLICABILITY';

  const availableIdents = new Set(runwayResult.runways.map((r) => normalizeRunwayIdent(r.ident)));
  const notamIdents = notamRunwayIds.map(normalizeRunwayIdent);

  const primary = [...runwayResult.runways].sort((a, b) => b.lengthFt - a.lengthFt)[0];
  const primaryIdent = primary ? normalizeRunwayIdent(primary.ident) : null;

  if (primaryIdent && notamIdents.includes(primaryIdent)) return 'DIRECT_MATCH';
  if (notamIdents.some((id) => availableIdents.has(id))) return 'VIABLE_RUNWAY_IMPACT';
  return 'OTHER_RUNWAY_IMPACT';
}

// ── Flight phase ──────────────────────────────────────────────────────────

/** Conservative: GROUND is only added when the NOTAM has no runway tag AND its text unambiguously names ground infrastructure. Never invents ENROUTE — no route/FIR NOTAM capability or route data exists anywhere in this app (see Phase 1 findings); enroute NOTAMs are simply out of scope, not silently assumed absent. */
export function classifyFlightPhase(role: 'departure' | 'destination' | 'alternate', report: AirflowNotamReport): FlightPhase[] {
  const base: FlightPhase = role === 'departure' ? 'DEPARTURE' : role === 'destination' ? 'ARRIVAL' : 'ALTERNATE';
  const isGroundOnly = report.runwayIds.length === 0 && /\b(TWY|TAXIWAY|STAND|APRON|TAXILANE)\b/i.test(report.sourceText);
  return isGroundOnly ? [base, 'GROUND'] : [base];
}

// ── Flight applicability (combines time + runway, never Airflow's own impact band) ─

interface ApplicabilityResult {
  applicability: FlightApplicability;
  reasonKey: 'time_unknown' | 'not_active' | 'direct_active' | 'direct_soon' | 'viable_runway' | 'runway_unknown' | 'other_runway';
}

/**
 * Deliberately does NOT take Airflow's impact band as an input — flight
 * applicability is a genuinely separate classification, never collapsed
 * with Airflow's own score (see the explicit requirement: "Airflow
 * impact: HIGH / Flight applicability: NOT_CURRENTLY_APPLICABLE" must
 * remain a valid, displayable combination).
 */
export function deriveFlightApplicability(time: TimeApplicability, runway: RunwayRelationship): ApplicabilityResult {
  if (time === 'UNKNOWN') return { applicability: 'UNDETERMINED', reasonKey: 'time_unknown' };
  if (time === 'NOT_ACTIVE') return { applicability: 'NOT_CURRENTLY_APPLICABLE', reasonKey: 'not_active' };

  // time is ACTIVE_AT_OPERATION, STARTS_SOON_AFTER, or ENDS_SHORTLY_BEFORE from here on.
  if (runway === 'DIRECT_MATCH') {
    return { applicability: 'DIRECTLY_RELEVANT', reasonKey: time === 'ACTIVE_AT_OPERATION' ? 'direct_active' : 'direct_soon' };
  }
  if (runway === 'VIABLE_RUNWAY_IMPACT') return { applicability: 'POTENTIALLY_RELEVANT', reasonKey: 'viable_runway' };
  if (runway === 'UNKNOWN_RUNWAY_APPLICABILITY') return { applicability: 'POTENTIALLY_RELEVANT', reasonKey: 'runway_unknown' };
  // OTHER_RUNWAY_IMPACT: preserved and shown, but lower tier than the above -- never dropped.
  return { applicability: 'INFORMATIONAL', reasonKey: 'other_runway' };
}

function buildFlightSpecificReason(
  reasonKey: ApplicabilityResult['reasonKey'],
  report: AirflowNotamReport,
  role: 'departure' | 'destination' | 'alternate',
  timeResult: { status: TimeApplicability; delayExposureMinutes?: number },
): string {
  const opDesc = role === 'departure' ? 'departure' : role === 'destination' ? 'arrival' : 'alternate use';
  switch (reasonKey) {
    case 'time_unknown':
      return `Could not determine whether this NOTAM is active for your ${opDesc} — effective time data was unparseable or missing.`;
    case 'not_active':
      return `Not active during your ${opDesc} window, based on its effective period.`;
    case 'direct_active':
      return `Active during your ${opDesc} and directly affects the runway this app has identified as primary for ${report.airportIcao}.`;
    case 'direct_soon': {
      const timing = timeResult.status === 'STARTS_SOON_AFTER'
        ? `Begins ${timeResult.delayExposureMinutes} minute(s) after`
        : `Ended only ${timeResult.delayExposureMinutes} minute(s) before`;
      return `${timing} your ${opDesc} and directly affects the primary runway — a modest delay could bring this into effect.`;
    }
    case 'viable_runway':
      return `Active during your ${opDesc} and affects a runway available at ${report.airportIcao}, even though not the one currently auto-selected — runway assignments can change (wind, ATC, traffic).`;
    case 'runway_unknown':
      return `Active during your ${opDesc}; this NOTAM does not specify an affected runway, or runway data for ${report.airportIcao} is unavailable, so runway-specific relevance can't be ruled out.`;
    case 'other_runway':
      return `Active during your ${opDesc} but affects a runway not currently listed as available at ${report.airportIcao} — lower applicability, but the source record is preserved rather than dropped.`;
    default:
      return 'Applicability determined from time and runway cross-reference.';
  }
}

// ── Retrieval coverage (the highest-priority requirement) ────────────────

/**
 * Implements the exact, mandatory wording rules: never "all NOTAMs
 * reviewed" or "no relevant NOTAMs" unless the complete active candidate
 * set was both known and fully retrieved. candidateWindowTruncated=true
 * means even the reported candidateCount is itself a recency-windowed cap
 * (verified true for KJFK, false for WSSS in live testing), so that case
 * is called out by name, not silently folded into "additional may exist."
 */
export function deriveCoverageStatement(retrieval: AirflowNotamRetrieval): NotamCoverageStatement {
  const isCompleteRetrieval = !retrieval.candidateWindowTruncated && !retrieval.hasMore && retrieval.returnedCount >= retrieval.candidateCount;

  const statement = isCompleteRetrieval
    ? `${retrieval.returnedCount} of ${retrieval.candidateCount} active NOTAMs analyzed.`
    : `${retrieval.returnedCount} prioritized NOTAM(s) analyzed. Airflow reports ${retrieval.candidateCount} active NOTAM record(s)` +
      (retrieval.candidateWindowTruncated ? ' — itself a recency-windowed count, not a confirmed total.' : '.') +
      ' Additional active NOTAMs may exist and were not included in this automated analysis.';

  return { airportIcao: retrieval.airportIcao, analyzedCount: retrieval.returnedCount, candidateCount: retrieval.candidateCount, isCompleteRetrieval, statement };
}

/** A failed/unavailable retrieval is NEVER represented as "no NOTAMs" — see the explicit requirement. */
export function deriveFailureCoverageStatement(failure: AirflowNotamRetrievalFailure): NotamCoverageStatement {
  return {
    airportIcao: failure.airportIcao,
    analyzedCount: 0,
    candidateCount: undefined,
    isCompleteRetrieval: false,
    statement: `NOTAM analysis unavailable for ${failure.airportIcao} (${failure.reason}). This does not mean no NOTAMs exist — manual review required.`,
  };
}

// ── Per-NOTAM and per-leg orchestration ───────────────────────────────────

function analyzeOneNotam(report: AirflowNotamReport, context: NotamFlightContext, bufferMinutes: number): TripNotamAnalysis {
  const timeResult = classifyTimeApplicability(report, context.operationTimeUtc, bufferMinutes);
  const runwayRelationship = classifyRunwayRelationship(report.runwayIds, context.runwayResult);
  const { applicability, reasonKey } = deriveFlightApplicability(timeResult.status, runwayRelationship);
  const flightPhase = classifyFlightPhase(context.role, report);
  const flightSpecificReason = buildFlightSpecificReason(reasonKey, report, context.role, timeResult);
  const requiresHumanReview =
    applicability === 'UNDETERMINED' ||
    applicability === 'DIRECTLY_RELEVANT' ||
    timeResult.status === 'UNKNOWN' ||
    runwayRelationship === 'UNKNOWN_RUNWAY_APPLICABILITY';

  return {
    notamId: report.notamId,
    airport: report.airportIcao,
    rawText: report.sourceText,
    runwayIds: report.runwayIds,
    effectiveStart: report.effectiveFromUtc,
    effectiveEnd: report.effectiveToUtc,
    effectiveToStatus: report.effectiveToStatus,
    airflowImpact: report.impact.band,
    airflowConfidence: report.impact.confidence,
    airflowExplanation: report.impact.whyThisMatters,
    airflowRecommendedActions: report.impact.recommendedActions,
    airflowImpactSource: report.impact.source,
    flightApplicability: applicability,
    flightSpecificReason,
    flightPhase,
    runwayRelationship,
    timeRelationship: timeResult.status,
    delayExposureMinutes: timeResult.delayExposureMinutes,
    requiresHumanReview,
    source: 'airflow',
    provenance: report.impact.source,
  };
}

/**
 * Top-level entry point. Takes an AirflowNotamOutcome — the result of a
 * Claude-mediated get_airport_context(facet: "notams") call, or a real
 * edge-function fetch once that path exists — and the leg's flight
 * context, and returns the full per-leg analysis. Never fabricates
 * retrieval: a failed outcome produces retrievalFailed: true and zero
 * analyses, not an empty-but-implicitly-clean result.
 */
/** Explicit type guard — sidesteps a control-flow-narrowing quirk observed with this discriminated-union shape (boolean `ok` field) in this TS configuration; using this instead of relying on if/else narrowing keeps the type checker happy without changing runtime behavior. */
function isFailedOutcome(outcome: AirflowNotamOutcome): outcome is { ok: false; failure: AirflowNotamRetrievalFailure } {
  return outcome.ok === false;
}

export function analyzeNotamsForLeg(
  outcome: AirflowNotamOutcome,
  context: NotamFlightContext,
  bufferMinutes: number = DEFAULT_TIME_BUFFER_MINUTES,
): LegNotamAnalysisResult {
  if (isFailedOutcome(outcome)) {
    return {
      legIcao: context.icao,
      role: context.role,
      coverage: deriveFailureCoverageStatement(outcome.failure),
      analyses: [],
      retrievalFailed: true,
      retrievalFailureReason: outcome.failure.reason,
    };
  }

  const analyses = outcome.retrieval.reports.map((report) => analyzeOneNotam(report, context, bufferMinutes));
  return {
    legIcao: context.icao,
    role: context.role,
    coverage: deriveCoverageStatement(outcome.retrieval),
    analyses,
    retrievalFailed: false,
  };
}
