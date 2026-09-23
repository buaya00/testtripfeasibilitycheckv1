import { useState } from "react";
import { cn } from "@/lib/utils";
import type { LegNotamAnalysisResult, TripNotamAnalysis, FlightApplicability } from "@/lib/notam/types";

// Presentational only — accepts already-computed analysis results as
// props. Does NOT fetch NOTAM data itself; see src/lib/notam/types.ts's
// top-of-file note on why (no edge-function-callable path to Airflow
// exists yet, only a Claude-mediated one). Wiring this into
// TripLegCard.tsx's live data flow is the next step once that gap is
// resolved, not part of this component.

const APPLICABILITY_ORDER: FlightApplicability[] = ['DIRECTLY_RELEVANT', 'POTENTIALLY_RELEVANT', 'INFORMATIONAL', 'UNDETERMINED', 'NOT_CURRENTLY_APPLICABLE'];

const APPLICABILITY_LABEL: Record<FlightApplicability, string> = {
  DIRECTLY_RELEVANT: 'Directly Relevant',
  POTENTIALLY_RELEVANT: 'Potentially Relevant',
  INFORMATIONAL: 'Informational',
  UNDETERMINED: 'Undetermined — Requires Review',
  NOT_CURRENTLY_APPLICABLE: 'Not Currently Applicable',
};

const IMPACT_BORDER_CLASS: Record<string, string> = {
  HIGH: 'border-l-destructive',
  MEDIUM: 'border-l-warning',
  LOW: 'border-l-muted-foreground/40',
};

function sortAnalyses(analyses: TripNotamAnalysis[]): TripNotamAnalysis[] {
  const impactRank: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return [...analyses].sort((a, b) => {
    const appDiff = APPLICABILITY_ORDER.indexOf(a.flightApplicability) - APPLICABILITY_ORDER.indexOf(b.flightApplicability);
    if (appDiff !== 0) return appDiff;
    return (impactRank[a.airflowImpact] ?? 3) - (impactRank[b.airflowImpact] ?? 3);
  });
}

function NotamRow({ analysis }: { analysis: TripNotamAnalysis }) {
  const [expanded, setExpanded] = useState(false);
  const isDeemphasized = analysis.flightApplicability === 'NOT_CURRENTLY_APPLICABLE';

  return (
    <div
      className={cn(
        'rounded-md border-l-4 border border-border p-3 text-sm space-y-2',
        isDeemphasized ? 'border-l-muted-foreground/30 opacity-70' : IMPACT_BORDER_CLASS[analysis.airflowImpact] ?? 'border-l-border',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium">
          {analysis.airport} — {analysis.notamId}
          {analysis.runwayIds.length > 0 && <span className="text-muted-foreground font-normal"> · RWY {analysis.runwayIds.join(', ')}</span>}
        </div>
        <span className={cn('text-xs font-semibold rounded px-1.5 py-0.5 whitespace-nowrap',
          analysis.flightApplicability === 'DIRECTLY_RELEVANT' ? 'bg-destructive/15 text-destructive'
          : analysis.flightApplicability === 'POTENTIALLY_RELEVANT' || analysis.flightApplicability === 'UNDETERMINED' ? 'bg-warning/15 text-warning'
          : 'bg-muted text-muted-foreground')}>
          {APPLICABILITY_LABEL[analysis.flightApplicability]}
        </span>
      </div>

      <div className="text-xs text-muted-foreground">
        Active: {new Date(analysis.effectiveStart).toUTCString()}
        {analysis.effectiveEnd ? ` – ${new Date(analysis.effectiveEnd).toUTCString()}` : ' (no confirmed end time)'}
        {analysis.delayExposureMinutes != null && (
          <span className="ml-1">· {analysis.delayExposureMinutes} min from your operation time</span>
        )}
      </div>

      {/* Flight-specific analysis -- this application's own layer, visually separated from Airflow's interpretation below */}
      <div className="rounded bg-muted/40 p-2 space-y-0.5">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Flight-Specific Analysis</div>
        <div>{analysis.flightSpecificReason}</div>
        <div className="text-xs text-muted-foreground">
          Phase: {analysis.flightPhase.join(' + ')} · Runway relationship: {analysis.runwayRelationship.replace(/_/g, ' ').toLowerCase()}
        </div>
      </div>

      {/* Airflow's own interpretation -- preserved verbatim, clearly attributed, never merged with the above */}
      <div className="rounded border border-border/60 p-2 space-y-0.5">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Airflow Analysis</div>
        <div>
          Impact: <span className="font-medium">{analysis.airflowImpact}</span> ({Math.round(analysis.airflowConfidence * 100)}% confidence)
          {analysis.airflowImpactSource === 'HEURISTIC_FALLBACK' && (
            <span className="text-xs text-muted-foreground"> — heuristic-derived, not a stored authoritative record</span>
          )}
        </div>
        {analysis.airflowExplanation && <div>{analysis.airflowExplanation}</div>}
        {analysis.airflowRecommendedActions && analysis.airflowRecommendedActions.length > 0 && (
          <ul className="list-disc list-inside">
            {analysis.airflowRecommendedActions.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        )}
      </div>

      <button type="button" onClick={() => setExpanded((e) => !e)} className="text-xs text-primary underline underline-offset-2">
        {expanded ? 'Hide source NOTAM' : 'View source NOTAM'}
      </button>
      {expanded && (
        <div className="rounded bg-muted/60 p-2 font-mono text-xs whitespace-pre-wrap">{analysis.rawText}</div>
      )}
    </div>
  );
}

export function NotamImpactAnalysis({ results }: { results: LegNotamAnalysisResult[] }) {
  return (
    <div className="space-y-4">
      {results.map((result) => (
        <div key={`${result.legIcao}-${result.role}`} className="space-y-2">
          <div className="font-semibold text-sm">
            NOTAM Impact Analysis — {result.legIcao} ({result.role})
          </div>

          {/* Coverage/completeness statement: MUST be immediately visible, never in a tooltip or collapsed section — highest-priority requirement for this feature. */}
          <div
            className={cn(
              'rounded-md border-l-4 border border-border p-2 text-xs font-medium',
              result.retrievalFailed ? 'border-l-destructive bg-destructive/5'
              : result.coverage.isCompleteRetrieval ? 'border-l-success bg-success/5'
              : 'border-l-warning bg-warning/5',
            )}
          >
            NOTAM COVERAGE: {result.coverage.statement}
          </div>

          {result.retrievalFailed ? (
            <div className="text-sm text-muted-foreground italic">Manual NOTAM review required for {result.legIcao} — automated analysis is unavailable.</div>
          ) : result.analyses.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">No NOTAMs were returned by Airflow for {result.legIcao} in this query.</div>
          ) : (
            <div className="space-y-2">
              {sortAnalyses(result.analyses).map((analysis) => (
                <NotamRow key={analysis.notamId} analysis={analysis} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default NotamImpactAnalysis;
