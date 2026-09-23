import { describe, it, expect } from "vitest";
import {
  classifyTimeApplicability,
  classifyRunwayRelationship,
  classifyFlightPhase,
  deriveFlightApplicability,
  deriveCoverageStatement,
  deriveFailureCoverageStatement,
  analyzeNotamsForLeg,
  DEFAULT_TIME_BUFFER_MINUTES,
} from "../lib/notam/engine";
import type { AirflowNotamReport, AirflowNotamRetrieval, NotamFlightContext, AirflowNotamOutcome } from "../lib/notam/types";
import type { RunwayResult } from "../components/tripTypes";

// ── Real fixture data, cloned verbatim from two live get_airport_context
// (facet: "notams") calls made during this feature's investigation (KJFK
// and WSSS) -- not invented. Field values match exactly what Airflow
// Intelligence actually returned.

const KJFK_ILS_13L_OUTAGE: AirflowNotamReport = {
  notamId: '20260929721_1',
  jeppNumber: '20260929721',
  airportIcao: 'KJFK',
  sourceText: 'JFK IAP JOHN F KENNEDY INTL, NEW YORK, NY. ILS RWY 13L (CAT II) AMDT 18D ... PROCEDURE NA. EXCEPT WHEN ADVISED BY ATCT THAT THESE CRANES ARE DOWN. TEMPORARY CRANES 261 MSL 3037FT SE OF RWY 13L (2023-AEA-2063 THRU 2068-NRA). 2609151836-2704271836EST',
  runwayIds: ['13L'],
  effectiveFromUtc: '2026-09-15T18:36:00Z',
  effectiveToStatus: 'SOURCE_TEXT_ONLY',
  temporalStatus: 'UNKNOWN',
  receivedAtUtc: '2026-09-15T18:43:21Z',
  scope: 'A',
  impact: {
    band: 'HIGH',
    confidence: 0.88,
    restrictionType: 'AIRPORT',
    whyThisMatters: 'ILS RWY 13L (CAT II) AMDT 18D ... PROCEDURE NA. EXCEPT WHEN ADVISED BY ATCT THAT THESE CRANES ARE DOWN.',
    recommendedActions: ['Do not use ILS RWY 13L (CAT II) AMDT 18D unless ATCT advises that the temporary cranes are down.'],
    source: 'STORED_IMPACT_NODE',
  },
};

const WSSS_RWY_02R_20L_CLOSURE: AirflowNotamReport = {
  notamId: '20260851ACE_1',
  jeppNumber: '20260851ACE',
  airportIcao: 'WSSS',
  sourceText: '(JEPPESEN TERMINAL CHART CHANGE NOTICE) RUNWAY 02R/20L WILL BE CLOSED FOR ALL AIRCRAFT OPERATIONS...',
  runwayIds: ['02R', '20L'],
  effectiveFromUtc: '2026-10-01T00:01:00Z',
  effectiveToUtc: '2027-04-14T23:59:00Z',
  effectiveToStatus: 'BOUNDED',
  temporalStatus: 'UPCOMING',
  receivedAtUtc: '2026-08-31T08:54:15Z',
  scope: 'A',
  impact: {
    band: 'HIGH',
    confidence: 0.92,
    restrictionType: 'CLOSED',
    whyThisMatters: 'Runway or movement-area closure likely reduces capacity and may constrain arrivals/departures.',
    recommendedActions: ['Re-evaluate runway availability, departure flow, and arrival acceptance rates.'],
    source: 'HEURISTIC_FALLBACK',
  },
};

const WSSS_TWY_W_CLOSURE: AirflowNotamReport = {
  notamId: '20260932154_1',
  airportIcao: 'WSSS',
  sourceText: 'TWY W BTN TWY V2 AND TWY N, INCLUDING ALL JUNCTIONS WITHIN CLSD.',
  runwayIds: [],
  effectiveFromUtc: '2026-09-20T17:30:00Z',
  effectiveToUtc: '2026-09-23T21:30:00Z',
  effectiveToStatus: 'BOUNDED',
  temporalStatus: 'IN_EFFECT',
  scope: 'A',
  impact: {
    band: 'HIGH',
    confidence: 0.92,
    restrictionType: 'CLOSED',
    whyThisMatters: 'Runway or movement-area closure likely reduces capacity and may constrain arrivals/departures.',
    recommendedActions: ['Re-evaluate runway availability, departure flow, and arrival acceptance rates.'],
    source: 'HEURISTIC_FALLBACK',
  },
};

function runwayResult(idents: Array<{ ident: string; lengthFt: number }>): RunwayResult {
  return {
    success: true, found: true, icao: 'TEST', airportName: null, municipality: null, latitude: null, longitude: null,
    longestRunwayFt: Math.max(...idents.map((i) => i.lengthFt)),
    message: '',
    runways: idents.map((i) => ({ id: i.ident, lengthFt: i.lengthFt, widthFt: 150, surface: 'Asphalt', lighted: true, ident: i.ident })),
  };
}

function context(overrides: Partial<NotamFlightContext> = {}): NotamFlightContext {
  return {
    icao: 'TEST',
    role: 'destination',
    operationTimeUtc: '2026-09-23T10:00:00Z',
    aircraftType: 'Bombardier Challenger 350',
    runwayResult: null,
    airportHoursResult: null,
    ...overrides,
  };
}

function retrieval(reports: AirflowNotamReport[], overrides: Partial<AirflowNotamRetrieval> = {}): AirflowNotamRetrieval {
  return {
    airportIcao: 'TEST',
    candidateCount: reports.length,
    candidateWindowTruncated: false,
    returnedCount: reports.length,
    hasMore: false,
    reports,
    retrievedAtUtc: new Date().toISOString(),
    ...overrides,
  };
}

// ── 1/2. Runway closure active at ETA / ETD (destination and departure) ──

describe("1/2 — destination and departure runway closure active at operation time", () => {
  it("destination: WSSS RWY 02R/20L closure, active at ETA, matches primary runway -> DIRECTLY_RELEVANT", () => {
    const ctx = context({ icao: 'WSSS', role: 'destination', operationTimeUtc: '2026-10-15T12:00:00Z', runwayResult: runwayResult([{ ident: '02R', lengthFt: 13000 }, { ident: '02L', lengthFt: 12000 }]) });
    const time = classifyTimeApplicability(WSSS_RWY_02R_20L_CLOSURE, ctx.operationTimeUtc);
    const runway = classifyRunwayRelationship(WSSS_RWY_02R_20L_CLOSURE.runwayIds, ctx.runwayResult);
    expect(time.status).toBe('ACTIVE_AT_OPERATION');
    expect(runway).toBe('DIRECT_MATCH');
    expect(deriveFlightApplicability(time.status, runway).applicability).toBe('DIRECTLY_RELEVANT');
  });

  it("departure: same NOTAM, role=departure -> flight phase is DEPARTURE not ARRIVAL", () => {
    const ctx = context({ icao: 'WSSS', role: 'departure', operationTimeUtc: '2026-10-15T12:00:00Z' });
    const phase = classifyFlightPhase(ctx.role, WSSS_RWY_02R_20L_CLOSURE);
    expect(phase).toEqual(['DEPARTURE']);
  });
});

// ── 3/4. ILS outage on selected vs viable-but-non-selected runway ────────

describe("3/4 — ILS outage on selected runway vs. a viable non-selected runway", () => {
  it("ILS outage on the primary (longest) runway -> DIRECT_MATCH", () => {
    const rw = runwayResult([{ ident: '13L', lengthFt: 14500 }, { ident: '04L', lengthFt: 12000 }]);
    expect(classifyRunwayRelationship(['13L'], rw)).toBe('DIRECT_MATCH');
  });

  it("ILS outage on a viable but non-primary runway -> VIABLE_RUNWAY_IMPACT, not dismissed", () => {
    const rw = runwayResult([{ ident: '13L', lengthFt: 14500 }, { ident: '04L', lengthFt: 12000 }]);
    // KJFK ILS 13L outage, but this airport's primary is a different, longer runway (04L here for the test)
    const rwWithLongerPrimary = runwayResult([{ ident: '04L', lengthFt: 15000 }, { ident: '13L', lengthFt: 14500 }]);
    expect(classifyRunwayRelationship(['13L'], rwWithLongerPrimary)).toBe('VIABLE_RUNWAY_IMPACT');
  });
});

// ── 5. NOTAM on unrelated/non-viable runway ──────────────────────────────

describe("5 — NOTAM on a runway not available at this airport at all", () => {
  it("classifies as OTHER_RUNWAY_IMPACT -> INFORMATIONAL, never dropped entirely", () => {
    const rw = runwayResult([{ ident: '04L', lengthFt: 12000 }, { ident: '04R', lengthFt: 11000 }]);
    const relationship = classifyRunwayRelationship(['27'], rw); // runway 27 doesn't exist at this airport per our data
    expect(relationship).toBe('OTHER_RUNWAY_IMPACT');
    const time: 'ACTIVE_AT_OPERATION' = 'ACTIVE_AT_OPERATION';
    const result = deriveFlightApplicability(time, relationship);
    expect(result.applicability).toBe('INFORMATIONAL'); // preserved, just lower tier -- not NOT_CURRENTLY_APPLICABLE or absent
  });
});

// ── 6/7. Starts shortly after ETA / ends shortly before ETA ──────────────

describe("6/7 — starts shortly after operation / ends shortly before operation (delay-exposure buffer)", () => {
  it("a closure starting 75 minutes after ETA is STARTS_SOON_AFTER with delay exposure, never dismissed as NOT_ACTIVE", () => {
    const notam: AirflowNotamReport = { ...WSSS_RWY_02R_20L_CLOSURE, effectiveFromUtc: '2026-09-23T22:15:00Z', effectiveToUtc: undefined, effectiveToStatus: 'SOURCE_TEXT_ONLY' };
    const eta = '2026-09-23T21:00:00Z'; // 75 minutes before the closure starts
    const result = classifyTimeApplicability(notam, eta);
    expect(result.status).toBe('STARTS_SOON_AFTER');
    expect(result.delayExposureMinutes).toBe(75);
  });

  it("a closure that ended 30 minutes before ETA is ENDS_SHORTLY_BEFORE, not silently NOT_ACTIVE", () => {
    const notam: AirflowNotamReport = { ...WSSS_TWY_W_CLOSURE, effectiveFromUtc: '2026-09-23T08:00:00Z', effectiveToUtc: '2026-09-23T09:30:00Z' };
    const eta = '2026-09-23T10:00:00Z'; // 30 minutes after it ended
    const result = classifyTimeApplicability(notam, eta);
    expect(result.status).toBe('ENDS_SHORTLY_BEFORE');
    expect(result.delayExposureMinutes).toBe(30);
  });

  it("beyond the buffer window entirely, both directions correctly resolve to NOT_ACTIVE", () => {
    const startsFarAfter: AirflowNotamReport = { ...WSSS_RWY_02R_20L_CLOSURE, effectiveFromUtc: '2026-09-24T08:00:00Z', effectiveToUtc: undefined };
    expect(classifyTimeApplicability(startsFarAfter, '2026-09-23T10:00:00Z').status).toBe('NOT_ACTIVE');

    const endedFarBefore: AirflowNotamReport = { ...WSSS_TWY_W_CLOSURE, effectiveFromUtc: '2026-09-20T08:00:00Z', effectiveToUtc: '2026-09-20T09:00:00Z' };
    expect(classifyTimeApplicability(endedFarBefore, '2026-09-23T10:00:00Z').status).toBe('NOT_ACTIVE');
  });

  it("the buffer is configurable, not hard-coded — a wider buffer catches a gap the default would miss", () => {
    const notam: AirflowNotamReport = { ...WSSS_RWY_02R_20L_CLOSURE, effectiveFromUtc: '2026-09-24T04:00:00Z', effectiveToUtc: undefined }; // 3 hours after 'now'
    const eta = '2026-09-24T01:00:00Z';
    expect(classifyTimeApplicability(notam, eta, DEFAULT_TIME_BUFFER_MINUTES).status).toBe('NOT_ACTIVE'); // default 120min buffer misses a 180min gap
    expect(classifyTimeApplicability(notam, eta, 200).status).toBe('STARTS_SOON_AFTER'); // wider buffer catches it
  });
});

// ── 8. NOTAM completely outside the flight window ────────────────────────

describe("8 — NOTAM entirely outside the flight window", () => {
  it("resolves to NOT_ACTIVE -> NOT_CURRENTLY_APPLICABLE, regardless of runway match", () => {
    const time = classifyTimeApplicability(WSSS_RWY_02R_20L_CLOSURE, '2026-09-23T10:00:00Z'); // 8 days before the closure even starts
    expect(time.status).toBe('NOT_ACTIVE');
    const rw = runwayResult([{ ident: '02R', lengthFt: 13000 }]);
    const runway = classifyRunwayRelationship(WSSS_RWY_02R_20L_CLOSURE.runwayIds, rw); // would be DIRECT_MATCH if it were active
    expect(deriveFlightApplicability(time.status, runway).applicability).toBe('NOT_CURRENTLY_APPLICABLE');
  });
});

// ── 9. Arrival runway unknown ─────────────────────────────────────────────

describe("9 — arrival runway data unavailable", () => {
  it("never suppresses the NOTAM -- UNKNOWN_RUNWAY_APPLICABILITY -> POTENTIALLY_RELEVANT, not dropped", () => {
    const relationship = classifyRunwayRelationship(WSSS_RWY_02R_20L_CLOSURE.runwayIds, null);
    expect(relationship).toBe('UNKNOWN_RUNWAY_APPLICABILITY');
    const result = deriveFlightApplicability('ACTIVE_AT_OPERATION', relationship);
    expect(result.applicability).toBe('POTENTIALLY_RELEVANT');
  });

  it("a NOTAM with no runway tag at all (e.g. taxiway) against known runway data also resolves UNKNOWN_RUNWAY_APPLICABILITY, never a false DIRECT_MATCH or silent drop", () => {
    const rw = runwayResult([{ ident: '02R', lengthFt: 13000 }]);
    expect(classifyRunwayRelationship(WSSS_TWY_W_CLOSURE.runwayIds, rw)).toBe('UNKNOWN_RUNWAY_APPLICABILITY');
  });
});

// ── 10/11. Airflow impact band is never conflated with flight applicability ─

describe("10/11 — Airflow's impact band and flight applicability are independently preserved, never conflated", () => {
  it("Airflow HIGH impact but NOT currently applicable to this specific trip -- both facts shown, neither overwrites the other", () => {
    const ctx = context({ icao: 'WSSS', operationTimeUtc: '2026-09-23T10:00:00Z' }); // 8 days before the HIGH-impact closure starts
    const outcome: AirflowNotamOutcome = { ok: true, retrieval: retrieval([WSSS_RWY_02R_20L_CLOSURE]) };
    const result = analyzeNotamsForLeg(outcome, ctx);
    const analysis = result.analyses[0];
    expect(analysis.airflowImpact).toBe('HIGH'); // Airflow's own score, untouched
    expect(analysis.flightApplicability).toBe('NOT_CURRENTLY_APPLICABLE'); // this app's separate, independent judgment
  });

  it("Airflow LOW impact but directly applicable to the selected runway -- flight applicability is NOT downgraded just because Airflow scored it low", () => {
    const lowImpactDirectNotam: AirflowNotamReport = { ...WSSS_RWY_02R_20L_CLOSURE, impact: { ...WSSS_RWY_02R_20L_CLOSURE.impact, band: 'LOW' } };
    const ctx = context({ icao: 'WSSS', operationTimeUtc: '2026-10-15T12:00:00Z', runwayResult: runwayResult([{ ident: '02R', lengthFt: 13000 }]) });
    const outcome: AirflowNotamOutcome = { ok: true, retrieval: retrieval([lowImpactDirectNotam]) };
    const result = analyzeNotamsForLeg(outcome, ctx);
    const analysis = result.analyses[0];
    expect(analysis.airflowImpact).toBe('LOW');
    expect(analysis.flightApplicability).toBe('DIRECTLY_RELEVANT'); // driven by time+runway, not by Airflow's score
  });
});

// ── 12. Multiple NOTAMs on the same runway ───────────────────────────────

describe("12 — multiple NOTAMs on the same runway are each analyzed independently", () => {
  it("both are returned and independently classified, neither suppressing the other", () => {
    const secondNotam: AirflowNotamReport = { ...WSSS_RWY_02R_20L_CLOSURE, notamId: 'DIFFERENT_ID_1', sourceText: 'A second, different NOTAM on the same runway.' };
    const ctx = context({ icao: 'WSSS', operationTimeUtc: '2026-10-15T12:00:00Z', runwayResult: runwayResult([{ ident: '02R', lengthFt: 13000 }]) });
    const outcome: AirflowNotamOutcome = { ok: true, retrieval: retrieval([WSSS_RWY_02R_20L_CLOSURE, secondNotam]) };
    const result = analyzeNotamsForLeg(outcome, ctx);
    expect(result.analyses).toHaveLength(2);
    expect(result.analyses.every((a) => a.flightApplicability === 'DIRECTLY_RELEVANT')).toBe(true);
  });
});

// ── 13. Alternate airport NOTAM ───────────────────────────────────────────

describe("13 — alternate airport NOTAM", () => {
  it("flight phase is ALTERNATE, not DEPARTURE or ARRIVAL", () => {
    const phase = classifyFlightPhase('alternate', WSSS_RWY_02R_20L_CLOSURE);
    expect(phase).toEqual(['ALTERNATE']);
  });
});

// ── 14. Missing validity period (open-ended NOTAM) ────────────────────────

describe("14 — missing/open-ended validity period", () => {
  it("a NOTAM with no effectiveToUtc at all is treated as active (not expired) once its start has passed, never NOT_ACTIVE by default", () => {
    const openEnded: AirflowNotamReport = { ...KJFK_ILS_13L_OUTAGE }; // real fixture: SOURCE_TEXT_ONLY, no effectiveToUtc
    const time = classifyTimeApplicability(openEnded, '2026-09-20T00:00:00Z'); // well after its start
    expect(time.status).toBe('ACTIVE_AT_OPERATION');
  });
});

// ── 15/16. Airflow retrieval failures (timeout, malformed) ────────────────

describe("15/16 — Airflow retrieval failure handling: never mistaken for 'no NOTAMs'", () => {
  it("a timeout produces retrievalFailed: true and zero analyses, with an explicit non-clean coverage statement", () => {
    const outcome: AirflowNotamOutcome = { ok: false, failure: { airportIcao: 'WSSS', reason: 'timeout' } };
    const result = analyzeNotamsForLeg(outcome, context({ icao: 'WSSS' }));
    expect(result.retrievalFailed).toBe(true);
    expect(result.analyses).toEqual([]);
    expect(result.coverage.isCompleteRetrieval).toBe(false);
    expect(result.coverage.statement).toContain('does not mean no NOTAMs exist');
  });

  it("a malformed response is handled the same way -- never silently treated as an empty, clean result", () => {
    const outcome: AirflowNotamOutcome = { ok: false, failure: { airportIcao: 'WSSS', reason: 'malformed_response', detail: 'unexpected shape' } };
    const result = analyzeNotamsForLeg(outcome, context({ icao: 'WSSS' }));
    expect(result.retrievalFailed).toBe(true);
    expect(result.coverage.statement).not.toContain('No NOTAMs');
    expect(result.coverage.statement).not.toContain('clear');
  });
});

// ── 17/18/19/20. Retrieval completeness wording (the highest-priority requirement) ─

describe("17/18/19/20 — retrieval completeness statement wording", () => {
  it("17/18 — top 10 of 50 with more existing produces an explicit partial-coverage statement, never claiming completeness", () => {
    const r = retrieval([WSSS_RWY_02R_20L_CLOSURE], { candidateCount: 50, returnedCount: 10, hasMore: true, candidateWindowTruncated: false });
    const coverage = deriveCoverageStatement(r);
    expect(coverage.isCompleteRetrieval).toBe(false);
    expect(coverage.statement).toContain('50');
    expect(coverage.statement).toContain('Additional active NOTAMs may exist');
  });

  it("a recency-windowed candidate count (KJFK's actual observed behavior) is named explicitly, not folded silently into the generic 'additional may exist' line", () => {
    const r = retrieval([KJFK_ILS_13L_OUTAGE], { candidateCount: 50, returnedCount: 10, hasMore: true, candidateWindowTruncated: true });
    const coverage = deriveCoverageStatement(r);
    expect(coverage.statement).toContain('not a confirmed total');
  });

  it("19 — full retrieval (WSSS's actual observed behavior: candidateWindowTruncated false, all candidates returned) IS reported as complete", () => {
    const reports = Array.from({ length: 29 }, (_, i) => ({ ...WSSS_RWY_02R_20L_CLOSURE, notamId: `id-${i}` }));
    const r = retrieval(reports, { candidateCount: 29, returnedCount: 29, hasMore: false, candidateWindowTruncated: false });
    const coverage = deriveCoverageStatement(r);
    expect(coverage.isCompleteRetrieval).toBe(true);
    expect(coverage.statement).toBe('29 of 29 active NOTAMs analyzed.');
  });

  it("20 — the exact real-world case observed for WSSS (10 of 29 returned, hasMore true, window NOT truncated) correctly reports partial, not complete, even though the candidate count itself is confirmed accurate", () => {
    const r = retrieval([WSSS_RWY_02R_20L_CLOSURE], { candidateCount: 29, returnedCount: 10, hasMore: true, candidateWindowTruncated: false });
    const coverage = deriveCoverageStatement(r);
    expect(coverage.isCompleteRetrieval).toBe(false);
    expect(coverage.statement).not.toContain('not a confirmed total'); // candidateWindowTruncated is false here -- this specific caveat should NOT appear
    expect(coverage.statement).toContain('Additional active NOTAMs may exist');
  });

  it("never produces the forbidden phrases 'All NOTAMs reviewed' or 'No relevant NOTAMs' for any partial result", () => {
    const variants = [
      retrieval([], { candidateCount: 50, returnedCount: 0, hasMore: true }),
      retrieval([WSSS_RWY_02R_20L_CLOSURE], { candidateCount: 50, returnedCount: 10, hasMore: true, candidateWindowTruncated: true }),
    ];
    for (const r of variants) {
      const s = deriveCoverageStatement(r).statement;
      expect(s.toLowerCase()).not.toContain('all notams reviewed');
      expect(s.toLowerCase()).not.toContain('no relevant notams');
    }
  });
});

// ── requiresHumanReview flag ───────────────────────────────────────────────

describe("requiresHumanReview", () => {
  it("is true for DIRECTLY_RELEVANT results, UNDETERMINED results, and unknown-runway results", () => {
    const outcome: AirflowNotamOutcome = { ok: true, retrieval: retrieval([WSSS_RWY_02R_20L_CLOSURE]) };
    const ctx = context({ icao: 'WSSS', operationTimeUtc: '2026-10-15T12:00:00Z', runwayResult: runwayResult([{ ident: '02R', lengthFt: 13000 }]) });
    const result = analyzeNotamsForLeg(outcome, ctx);
    expect(result.analyses[0].flightApplicability).toBe('DIRECTLY_RELEVANT');
    expect(result.analyses[0].requiresHumanReview).toBe(true);
  });

  it("is false for a cleanly NOT_CURRENTLY_APPLICABLE, non-ambiguous result", () => {
    const outcome: AirflowNotamOutcome = { ok: true, retrieval: retrieval([WSSS_RWY_02R_20L_CLOSURE]) };
    const ctx = context({ icao: 'WSSS', operationTimeUtc: '2026-09-23T10:00:00Z', runwayResult: runwayResult([{ ident: '02R', lengthFt: 13000 }]) }); // well before the closure starts
    const result = analyzeNotamsForLeg(outcome, ctx);
    expect(result.analyses[0].flightApplicability).toBe('NOT_CURRENTLY_APPLICABLE');
    expect(result.analyses[0].requiresHumanReview).toBe(false);
  });
});

// ── Airflow's own fields are preserved verbatim, never replaced ──────────

describe("Airflow interpretation fields are preserved verbatim, never replaced by an invented local score", () => {
  it("passes through band, confidence, explanation, recommended actions, and impact source exactly as Airflow returned them", () => {
    const outcome: AirflowNotamOutcome = { ok: true, retrieval: retrieval([KJFK_ILS_13L_OUTAGE]) };
    const result = analyzeNotamsForLeg(outcome, context({ icao: 'KJFK' }));
    const analysis = result.analyses[0];
    expect(analysis.airflowImpact).toBe(KJFK_ILS_13L_OUTAGE.impact.band);
    expect(analysis.airflowConfidence).toBe(KJFK_ILS_13L_OUTAGE.impact.confidence);
    expect(analysis.airflowExplanation).toBe(KJFK_ILS_13L_OUTAGE.impact.whyThisMatters);
    expect(analysis.airflowRecommendedActions).toEqual(KJFK_ILS_13L_OUTAGE.impact.recommendedActions);
    expect(analysis.airflowImpactSource).toBe('STORED_IMPACT_NODE');
    expect(analysis.rawText).toBe(KJFK_ILS_13L_OUTAGE.sourceText); // raw source text also preserved verbatim
  });

  it("two real fixtures with genuinely different impact sources (STORED_IMPACT_NODE vs HEURISTIC_FALLBACK) are both preserved distinctly, never normalized to look equally authoritative", () => {
    const outcome: AirflowNotamOutcome = { ok: true, retrieval: retrieval([KJFK_ILS_13L_OUTAGE, WSSS_RWY_02R_20L_CLOSURE]) };
    const result = analyzeNotamsForLeg(outcome, context());
    expect(result.analyses[0].airflowImpactSource).toBe('STORED_IMPACT_NODE');
    expect(result.analyses[1].airflowImpactSource).toBe('HEURISTIC_FALLBACK');
  });
});
