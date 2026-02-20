import { useMemo, useState } from "react";
import { Fuel, TrendingDown, TrendingUp, Minus, ChevronDown, ChevronUp, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  estimateBlockFuelGallons,
  calculateTankering,
  type TankeringAnalysis,
} from "@/lib/flightCalculations";
import { AIRCRAFT_CRUISE_KTAS } from "@/data/aircraftPerformance";
import { AIRCRAFT_MTOW_KG } from "@/data/aircraftData";
import type { LegData } from "./tripTypes";
import type { FlightLegCalculation } from "@/lib/flightCalculations";

interface FuelStop {
  icao: string;
  priceUsd: number | null;
  priceNote: string;
}

interface TankeringRow {
  fromIcao: string;
  toIcao: string;
  distanceNm: number;
  blockFuelGallons: number | null;
  priceAtDep: number | null;
  priceAtDest: number | null;
  analysis: TankeringAnalysis | null;
}

interface Props {
  legs: LegData[];
  flightCalcs: Record<number, FlightLegCalculation>;
  aircraftType: string;
  onUpdateLegFuelPrice: (legIndex: number, priceUsd: number | null, note: string) => void;
}

export default function FuelTankeringPanel({
  legs,
  flightCalcs,
  aircraftType,
  onUpdateLegFuelPrice,
}: Props) {
  const [expanded, setExpanded] = useState(true);

  const cruiseKtas = aircraftType ? AIRCRAFT_CRUISE_KTAS[aircraftType] : undefined;
  const mtowKg = aircraftType ? AIRCRAFT_MTOW_KG[aircraftType] : undefined;

  // Build per-leg tankering rows
  const rows: TankeringRow[] = useMemo(() => {
    const result: TankeringRow[] = [];
    for (let i = 0; i < legs.length - 1; i++) {
      const from = legs[i];
      const to = legs[i + 1];
      const calc = flightCalcs[i];
      if (!calc) continue;

      const blockFuelGallons =
        aircraftType && cruiseKtas
          ? estimateBlockFuelGallons(aircraftType, calc.distanceNm, cruiseKtas)
          : null;

      const priceAtDep = from.fuelPriceUsd;
      const priceAtDest = to.fuelPriceUsd;

      let analysis: TankeringAnalysis | null = null;
      if (
        blockFuelGallons &&
        priceAtDep != null &&
        priceAtDest != null &&
        mtowKg != null
      ) {
        analysis = calculateTankering(blockFuelGallons, priceAtDep, priceAtDest, mtowKg);
      }

      result.push({
        fromIcao: from.airportIcao || `Stop ${i + 1}`,
        toIcao: to.airportIcao || `Stop ${i + 2}`,
        distanceNm: calc.distanceNm,
        blockFuelGallons,
        priceAtDep,
        priceAtDest,
        analysis,
      });
    }
    return result;
  }, [legs, flightCalcs, aircraftType, cruiseKtas, mtowKg]);

  // Only show if there are multiple legs (at least one flight segment)
  if (legs.length < 2) return null;

  const hasAnyAnalysis = rows.some(r => r.analysis !== null);
  const totalSavingUsd = rows.reduce((sum, r) => sum + (r.analysis?.netSavingUsd ?? 0), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <CardTitle className="text-base flex items-center gap-2">
            <Fuel className="h-4 w-4 text-primary" />
            Fuel Tankering Analysis
            {hasAnyAnalysis && (
              <span className={cn(
                "ml-2 text-xs font-normal px-2 py-0.5 rounded-full",
                totalSavingUsd > 50
                  ? "bg-success/15 text-success"
                  : totalSavingUsd < -50
                    ? "bg-destructive/15 text-destructive"
                    : "bg-muted text-muted-foreground"
              )}>
                {totalSavingUsd > 50
                  ? `Tanker saves ~$${totalSavingUsd.toLocaleString()}`
                  : totalSavingUsd < -50
                    ? `Buy local saves ~$${Math.abs(totalSavingUsd).toLocaleString()}`
                    : "Prices similar — no clear advantage"}
              </span>
            )}
          </CardTitle>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <p className="text-xs text-muted-foreground mt-1">
          Enter posted fuel prices at each stop to see whether tankering is economical.
          {!aircraftType && " Select an aircraft type to enable block fuel estimates."}
        </p>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          {/* API placeholder notice */}
          <div className="flex items-start gap-2 rounded-md bg-muted/50 border px-3 py-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              <span className="font-medium text-foreground">AEG Fuels API — coming soon.</span>{" "}
              Prices will be fetched automatically once the AEG Fuels API integration is enabled.
              For now, enter prices manually below.
            </span>
          </div>

          {/* Fuel price inputs per stop */}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">All-Inclusive Fuel Prices (USD / US gallon)</Label>
              <p className="text-xs text-muted-foreground">Enter the total price including all taxes, fees, and VAT.</p>
            </div>
            <div className="grid gap-2">
              {legs.map((leg, idx) => (
                <div key={leg.id} className="flex items-center gap-2">
                  <span className="text-xs font-mono w-12 shrink-0 text-muted-foreground">
                    {leg.airportIcao || `Leg ${idx + 1}`}
                  </span>
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      placeholder="All-in price incl. tax"
                      value={leg.fuelPriceUsd ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        onUpdateLegFuelPrice(
                          idx,
                          v === "" ? null : parseFloat(v),
                          leg.fuelPriceNote,
                        );
                      }}
                      className="pl-6 text-sm h-8"
                    />
                  </div>
                  <Input
                    placeholder="Source / notes (optional)"
                    value={leg.fuelPriceNote}
                    onChange={(e) => onUpdateLegFuelPrice(idx, leg.fuelPriceUsd, e.target.value)}
                    className="text-xs h-8 flex-[2]"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Tankering analysis rows */}
          {rows.length > 0 && (
            <div className="space-y-3">
              <Separator />
              <Label className="text-xs font-semibold">Leg-by-Leg Analysis</Label>
              {rows.map((row, i) => (
                <TankeringLegRow key={i} row={row} />
              ))}
            </div>
          )}

          {/* Overall summary */}
          {hasAnyAnalysis && (
            <>
              <Separator />
              <TankeringSummary rows={rows} />
            </>
          )}

          <p className="text-xs text-muted-foreground border-t pt-2">
            Prices entered should be all-inclusive (base price + taxes + VAT). Block fuel estimates
            are derived from aircraft type and leg distance. Weight penalty uses a 4% burn factor
            for carrying extra fuel. Always verify with your fuel supplier and dispatcher before tankering.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

// ── Sub-components ───────────────────────────────────────────

function TankeringLegRow({ row }: { row: TankeringRow }) {
  const a = row.analysis;

  const recColor = a
    ? a.recommendation === 'tanker'
      ? "border-success/30 bg-success/5"
      : a.recommendation === 'buy_local'
        ? "border-destructive/30 bg-destructive/5"
        : "border-muted bg-muted/30"
    : "border-muted bg-muted/20";

  const RecIcon = a
    ? a.recommendation === 'tanker'
      ? TrendingDown
      : a.recommendation === 'buy_local'
        ? TrendingUp
        : Minus
    : Minus;

  const recLabel = a
    ? a.recommendation === 'tanker'
      ? "Tanker recommended"
      : a.recommendation === 'buy_local'
        ? "Buy at destination"
        : "Neutral — marginal difference"
    : "Enter prices to analyse";

  const recTextColor = a
    ? a.recommendation === 'tanker'
      ? "text-success"
      : a.recommendation === 'buy_local'
        ? "text-destructive"
        : "text-muted-foreground"
    : "text-muted-foreground";

  return (
    <div className={cn("rounded-md border p-3 text-xs space-y-2", recColor)}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">
          {row.fromIcao} → {row.toIcao}
        </span>
        <span className="text-muted-foreground">{row.distanceNm.toLocaleString()} nm</span>
      </div>

      {/* Prices + block fuel */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-muted-foreground">Dep price</p>
          <p className="font-mono font-medium">
            {row.priceAtDep != null ? `$${row.priceAtDep.toFixed(2)}/gal` : <span className="text-muted-foreground italic">not set</span>}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Dest price</p>
          <p className="font-mono font-medium">
            {row.priceAtDest != null ? `$${row.priceAtDest.toFixed(2)}/gal` : <span className="text-muted-foreground italic">not set</span>}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Est. block fuel</p>
          <p className="font-mono font-medium">
            {row.blockFuelGallons != null ? `${row.blockFuelGallons.toLocaleString()} gal` : <span className="text-muted-foreground italic">N/A</span>}
          </p>
        </div>
      </div>

      {/* Analysis results */}
      {a ? (
        <>
          <Separator />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Price spread:</span>
              <span className={cn("font-mono", a.spreadPerGallon > 0 ? "text-success" : "text-destructive")}>
                {a.spreadPerGallon > 0 ? "+" : ""}{a.spreadPerGallon.toFixed(2)}/gal
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Break-even spread:</span>
              <span className="font-mono">${a.breakEvenSpreadUsd.toFixed(2)}/gal</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Weight penalty:</span>
              <span className="font-mono">{a.weightPenaltyGallons} gal</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Net saving:</span>
              <span className={cn("font-mono font-semibold", a.netSavingUsd > 0 ? "text-success" : a.netSavingUsd < 0 ? "text-destructive" : "text-muted-foreground")}>
                {a.netSavingUsd > 0 ? "+" : ""}${a.netSavingUsd.toLocaleString()}
              </span>
            </div>
          </div>
          <div className={cn("flex items-center gap-1.5 font-semibold mt-1", recTextColor)}>
            <RecIcon className="h-3.5 w-3.5" />
            {recLabel}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Minus className="h-3.5 w-3.5" />
          Enter fuel prices at both stops to calculate
        </div>
      )}
    </div>
  );
}

function TankeringSummary({ rows }: { rows: TankeringRow[] }) {
  const analysedRows = rows.filter(r => r.analysis !== null);
  const totalSavingUsd = analysedRows.reduce((s, r) => s + (r.analysis!.netSavingUsd), 0);
  const totalPenaltyGal = analysedRows.reduce((s, r) => s + (r.analysis!.weightPenaltyGallons), 0);

  return (
    <div className="rounded-md bg-background/60 border px-3 py-2 text-xs space-y-1">
      <p className="font-semibold text-sm">Trip Fuel Summary</p>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Legs analysed:</span>
        <span className="font-mono">{analysedRows.length} / {rows.length}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Total weight penalty (tankering):</span>
        <span className="font-mono">{totalPenaltyGal.toLocaleString()} gal</span>
      </div>
      <Separator className="my-1" />
      <div className="flex justify-between font-semibold">
        <span>Net tankering saving / cost:</span>
        <span className={cn("font-mono",
          totalSavingUsd > 50 ? "text-success" : totalSavingUsd < -50 ? "text-destructive" : "text-muted-foreground"
        )}>
          {totalSavingUsd > 0 ? "+" : ""}${totalSavingUsd.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
