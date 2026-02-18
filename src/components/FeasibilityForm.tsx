import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { format } from "date-fns";
import {
  Plane, Loader2, Navigation, Globe, Plus, X, DollarSign,
  CheckCircle2, XCircle, AlertTriangle, Printer, FileDown, PawPrint,
  Clock, Ruler, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { AIRCRAFT_CATEGORIES } from "@/data/aircraftData";
import { AIRCRAFT_RANGE_NM, AIRCRAFT_CRUISE_KTAS } from "@/data/aircraftPerformance";
import { calculateFlightLeg, type FlightLegCalculation } from "@/lib/flightCalculations";
import { COUNTRIES } from "@/data/countries";
import { SelectGroup, SelectLabel } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import TripLegCard, { evaluateLegFeasibility } from "./TripLegCard";
import type {
  LegData, OverflightResult, VisaCheckResult, PetCheckResult,
} from "./tripTypes";
import { createEmptyLeg } from "./tripTypes";
import { generatePrintableHtml } from "./PrintableReport";
import aegLogo from "@/assets/aeg-logo.png";

export default function FeasibilityForm() {
  const [logoDataUrl, setLogoDataUrl] = useState<string>("");
  const [aircraftType, setAircraftType] = useState("");
  const [flightType, setFlightType] = useState("");
  const [legs, setLegs] = useState<LegData[]>([createEmptyLeg()]);
  // Convert logo to data URL for printable reports
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      setLogoDataUrl(canvas.toDataURL("image/png"));
    };
    img.src = aegLogo;
  }, []);

  
  // Overflight results keyed by "legIdx" (between leg legIdx and legIdx+1)
  const [overflightResults, setOverflightResults] = useState<Record<number, OverflightResult | null>>({});
  const [overflightLoading, setOverflightLoading] = useState<Record<number, boolean>>({});

  // Visa — results keyed by ICAO code
  const [visaNationalities, setVisaNationalities] = useState<string[]>([""]);
  const [visaResults, setVisaResults] = useState<Record<string, VisaCheckResult | null>>({});
  const [visaLoading, setVisaLoading] = useState<Record<string, boolean>>({});

  // Pet travel — results keyed by ICAO code
  const [petTypes, setPetTypes] = useState<string[]>([]);
  const [petResults, setPetResults] = useState<Record<string, PetCheckResult | null>>({});
  const [petLoading, setPetLoading] = useState<Record<string, boolean>>({});

  const updateLeg = useCallback((index: number, updates: Partial<LegData>) => {
    setLegs(prev => prev.map((leg, i) => i === index ? { ...leg, ...updates } : leg));
  }, []);

  const removeLeg = useCallback((index: number) => {
    setLegs(prev => prev.filter((_, i) => i !== index));
    // Clean up overflight results
    setOverflightResults(prev => {
      const next: Record<number, OverflightResult | null> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = Number(k);
        if (ki < index - 1) next[ki] = v;
        else if (ki > index) next[ki - 1] = v;
      });
      return next;
    });
  }, []);

  const addLeg = useCallback(() => {
    setLegs(prev => [...prev, createEmptyLeg()]);
  }, []);

  // Refs for triggering lookup on each leg
  const legLookupRefs = React.useRef<Record<number, (() => void) | null>>({});

  const registerLegLookup = useCallback((index: number, fn: (() => void) | null) => {
    legLookupRefs.current[index] = fn;
  }, []);

  // Track whether a check-all has been triggered so we can re-evaluate on lookup completion
  const feasibilityTriggered = useRef(false);

  // Check feasibility for all legs
  const handleCheckAll = useCallback(() => {
    feasibilityTriggered.current = true;
    // Trigger lookup on each leg
    Object.values(legLookupRefs.current).forEach(fn => fn?.());
    // Initial evaluation with current data
    setLegs(prev => prev.map((leg, idx) => ({
      ...leg,
      feasibilityResult: evaluateLegFeasibility(leg, aircraftType, idx, prev.length),
    })));
  }, [aircraftType]);

  // Re-evaluate feasibility whenever lookup results change (permits, PPR, etc.)
  useEffect(() => {
    if (!feasibilityTriggered.current) return;
    // Check if any leg has a feasibilityResult already (means we've run check-all)
    const anyEvaluated = legs.some(l => l.feasibilityResult != null);
    if (!anyEvaluated) return;

    // Re-evaluate with latest lookup data
    setLegs(prev => {
      const updated = prev.map((leg, idx) => ({
        ...leg,
        feasibilityResult: evaluateLegFeasibility(leg, aircraftType, idx, prev.length),
      }));
      // Only update if results actually changed to avoid infinite loop
      const changed = updated.some((u, i) =>
        u.feasibilityResult?.feasible !== prev[i].feasibilityResult?.feasible ||
        u.feasibilityResult?.issues.length !== prev[i].feasibilityResult?.issues.length
      );
      return changed ? updated : prev;
    });
  }, [
    // Re-run when any lookup result changes
    ...legs.map(l => l.permitResult),
    ...legs.map(l => l.pprResult),
    ...legs.map(l => l.cbpResult),
    ...legs.map(l => l.runwayResult),
    ...legs.map(l => l.ciqResult),
    ...legs.map(l => l.airportHoursResult),
    aircraftType,
  ]);

  // Overflight between consecutive legs
  const handleOverflightBetweenLegs = useCallback(async (fromIdx: number) => {
    const fromLeg = legs[fromIdx];
    const toLeg = legs[fromIdx + 1];
    if (!fromLeg || !toLeg) return;
    if (fromLeg.airportIcao.length !== 4 || toLeg.airportIcao.length !== 4) return;

    setOverflightLoading(prev => ({ ...prev, [fromIdx]: true }));
    setOverflightResults(prev => ({ ...prev, [fromIdx]: null }));

    try {
      const { data: res, error } = await supabase.functions.invoke('overflight-permits', {
        body: {
          originIcao: fromLeg.airportIcao,
          destinationIcao: toLeg.airportIcao,
          flightType: flightType || undefined,
          aircraftType: aircraftType || undefined,
        },
      });
      if (error) {
        setOverflightResults(prev => ({ ...prev, [fromIdx]: { success: false, error: error.message } }));
      } else {
        setOverflightResults(prev => ({ ...prev, [fromIdx]: res as OverflightResult }));
      }
    } catch {
      setOverflightResults(prev => ({ ...prev, [fromIdx]: { success: false, error: 'Failed to connect' } }));
    } finally {
      setOverflightLoading(prev => ({ ...prev, [fromIdx]: false }));
    }
  }, [legs, flightType, aircraftType]);

  // Check all overflight routes
  const handleAllOverflights = useCallback(async () => {
    for (let i = 0; i < legs.length - 1; i++) {
      handleOverflightBetweenLegs(i);
    }
  }, [legs.length, handleOverflightBetweenLegs]);

  // Auto-derive unique destination ICAOs from legs (skip first leg = departure origin when multi-leg)
  const destinationIcaos = useMemo(() => {
    const icaos = legs
      .filter((l, i) => l.airportIcao.length === 4 && (legs.length === 1 || i > 0))
      .map(l => l.airportIcao);
    return [...new Set(icaos)];
  }, [legs]);

  // Visa check — runs for all destination ICAOs
  const handleVisaCheck = useCallback(async () => {
    const validNationalities = visaNationalities.filter(n => n.length > 0);
    if (validNationalities.length === 0 || destinationIcaos.length === 0) return;

    // Set all loading
    const loadingState: Record<string, boolean> = {};
    destinationIcaos.forEach(icao => { loadingState[icao] = true; });
    setVisaLoading(loadingState);
    setVisaResults({});

    // Fire all checks in parallel
    await Promise.all(destinationIcaos.map(async (icao) => {
      try {
        const { data: res, error } = await supabase.functions.invoke('visa-check', {
          body: { nationalities: validNationalities, destinationIcao: icao },
        });
        if (error) {
          setVisaResults(prev => ({ ...prev, [icao]: { success: false, error: error.message } }));
        } else {
          setVisaResults(prev => ({ ...prev, [icao]: res as VisaCheckResult }));
        }
      } catch {
        setVisaResults(prev => ({ ...prev, [icao]: { success: false, error: 'Failed to connect' } }));
      } finally {
        setVisaLoading(prev => ({ ...prev, [icao]: false }));
      }
    }));
  }, [visaNationalities, destinationIcaos]);

  // Pet requirements check
  const handlePetCheck = useCallback(async () => {
    if (petTypes.length === 0 || destinationIcaos.length === 0) return;

    const loadingState: Record<string, boolean> = {};
    destinationIcaos.forEach(icao => { loadingState[icao] = true; });
    setPetLoading(loadingState);
    setPetResults({});

    const originIcao = legs.length > 1 ? legs[0].airportIcao : undefined;

    await Promise.all(destinationIcaos.map(async (icao) => {
      try {
        const { data: res, error } = await supabase.functions.invoke('pet-requirements', {
          body: { petTypes, destinationIcao: icao, originIcao },
        });
        if (error) {
          setPetResults(prev => ({ ...prev, [icao]: { success: false, error: error.message } }));
        } else {
          setPetResults(prev => ({ ...prev, [icao]: res as PetCheckResult }));
        }
      } catch {
        setPetResults(prev => ({ ...prev, [icao]: { success: false, error: 'Failed to connect' } }));
      } finally {
        setPetLoading(prev => ({ ...prev, [icao]: false }));
      }
    }));
  }, [petTypes, destinationIcaos, legs]);

  // Reset
  const handleReset = () => {
    setAircraftType("");
    setFlightType("");
    setLegs([createEmptyLeg()]);
    setOverflightResults({});
    setOverflightLoading({});
    setVisaNationalities([""]);
    setVisaResults({});
    setVisaLoading({});
    setPetTypes([]);
    setPetResults({});
    setPetLoading({});
  };

  // Compute flight leg calculations between consecutive legs
  const flightCalcs = useMemo(() => {
    const calcs: Record<number, FlightLegCalculation> = {};
    const rangeNm = aircraftType ? AIRCRAFT_RANGE_NM[aircraftType] : undefined;
    const cruiseKtas = aircraftType ? AIRCRAFT_CRUISE_KTAS[aircraftType] : undefined;
    for (let i = 0; i < legs.length - 1; i++) {
      const from = legs[i];
      const to = legs[i + 1];
      const lat1 = from.runwayResult?.latitude;
      const lon1 = from.runwayResult?.longitude;
      const lat2 = to.runwayResult?.latitude;
      const lon2 = to.runwayResult?.longitude;
      if (lat1 != null && lon1 != null && lat2 != null && lon2 != null) {
        calcs[i] = calculateFlightLeg(lat1, lon1, lat2, lon2, rangeNm, cruiseKtas);
      }
    }
    return calcs;
  }, [legs, aircraftType]);

  // Compute trip totals
  const totalCharges = legs.reduce((sum, l) => sum + (l.chargesResult?.totalEstimateUsd ?? 0), 0);
  const totalOverflightCharges = Object.values(overflightResults).reduce(
    (sum, r) => sum + (r?.totalOverflightChargesUsd ?? 0), 0
  );
  const totalAegFees = legs.reduce((sum, leg) => {
    const overflightResult = overflightResults[legs.indexOf(leg)] ?? null;
    const originCountry = overflightResult?.originCountry ?? null;
    const destinationCountry = overflightResult?.destinationCountry ?? null;
    const overflightPermitsNeeded = overflightResult?.countries?.filter(
      c =>
        (c.overflightPermitRequired === 'yes' || c.overflightPermitRequired === 'conditional') &&
        c.country !== originCountry &&
        c.country !== destinationCountry
    ).length ?? 0;
    const predefined = (leg.aegServices || [])
      .filter(s => s.selected)
      .reduce((s, svc) => {
        const cost = svc.id === 'overflight-permit' && overflightPermitsNeeded > 1
          ? svc.costUsd * overflightPermitsNeeded
          : svc.costUsd;
        return s + cost;
      }, 0);
    const adHoc = (leg.aegAdHocServices || []).reduce((s, item) => {
      const v = parseFloat(String(item.costUsd));
      return s + (isNaN(v) ? 0 : v);
    }, 0);
    return sum + predefined + adHoc;
  }, 0);
  const totalDistanceNm = Object.values(flightCalcs).reduce((sum, c) => sum + c.distanceNm, 0);
  const totalFlightTimeMin = Object.values(flightCalcs).reduce((sum, c) => sum + c.flightTimeMinutes, 0);
  const anyOutOfRange = Object.values(flightCalcs).some(c => !c.withinRange);
  const allFeasible = legs.every(l => l.feasibilityResult?.feasible !== false) && !anyOutOfRange;
  const anyChecked = legs.some(l => l.feasibilityResult != null);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-white">
        <div className="container mx-auto flex items-center gap-3 px-6 py-4">
          <img src={aegLogo} alt="AEG Fuels" className="h-[104px] w-auto" />
          <Separator orientation="vertical" className="h-6 bg-border" />
          <Plane className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold text-primary">
            Trip Feasibility Check
          </span>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-6 py-8 pb-32 space-y-6">
        {/* Shared Trip Config */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Trip Configuration</CardTitle>
            <p className="text-sm text-muted-foreground">
              Set aircraft and flight type, then add legs for each stop.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Aircraft Type</Label>
                <Select value={aircraftType} onValueChange={setAircraftType}>
                  <SelectTrigger><SelectValue placeholder="Select aircraft" /></SelectTrigger>
                  <SelectContent className="max-h-80">
                    {AIRCRAFT_CATEGORIES.map((cat) => (
                      <SelectGroup key={cat.label}>
                        <SelectLabel className="text-xs font-semibold text-muted-foreground">{cat.label}</SelectLabel>
                        {cat.types.map((type) => (
                          <SelectItem key={type} value={type}>{type}</SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Flight Type</Label>
                <Select value={flightType} onValueChange={setFlightType}>
                  <SelectTrigger><SelectValue placeholder="Select flight type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">Private (Non-Commercial)</SelectItem>
                    <SelectItem value="non-scheduled-commercial">Non-Scheduled Commercial</SelectItem>
                    <SelectItem value="commercial">Commercial (Scheduled)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Trip Legs */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Trip Legs</h2>
          </div>

          {legs.map((leg, idx) => (
            <div key={leg.id}>
              <TripLegCard
                leg={leg}
                legIndex={idx}
                totalLegs={legs.length}
                aircraftType={aircraftType}
                flightType={flightType}
                overflightResult={overflightResults[idx] ?? null}
                onUpdateLeg={updateLeg}
                onRemoveLeg={removeLeg}
                onRegisterLookup={registerLegLookup}
              />

              {/* Overflight between this leg and next */}
              {idx < legs.length - 1 && (
                <div className="my-3 ml-6 pl-4 border-l-2 border-dashed border-muted-foreground/30 space-y-2">
                  {/* Flight info between legs */}
                  {flightCalcs[idx] && (
                    <div className={cn("rounded-md border px-3 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1",
                      !flightCalcs[idx].withinRange ? "border-destructive/40 bg-destructive/5" : "border-muted bg-muted/30"
                    )}>
                      <span className="flex items-center gap-1 font-medium">
                        <Ruler className="h-3 w-3 text-muted-foreground" />
                        {flightCalcs[idx].distanceNm.toLocaleString()} nm
                      </span>
                      {flightCalcs[idx].cruiseSpeedKtas && (
                        <span className="flex items-center gap-1 font-medium">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          {flightCalcs[idx].flightTimeFormatted}
                        </span>
                      )}
                      {flightCalcs[idx].cruiseSpeedKtas && (
                        <span className="text-muted-foreground">
                          @ {flightCalcs[idx].cruiseSpeedKtas} KTAS
                        </span>
                      )}
                      {flightCalcs[idx].rangeNm && (
                        <span className={cn("font-medium", !flightCalcs[idx].withinRange ? "text-destructive" : "text-muted-foreground")}>
                          {!flightCalcs[idx].withinRange
                            ? `❌ Exceeds range (${flightCalcs[idx].rangeNm!.toLocaleString()} nm max)`
                            : `✅ Within range (${flightCalcs[idx].rangeNm!.toLocaleString()} nm max)`}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Navigation className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">
                      {leg.airportIcao && legs[idx + 1]?.airportIcao
                        ? `Overflight: ${leg.airportIcao} → ${legs[idx + 1].airportIcao}`
                        : 'Overflight route'}
                    </span>
                    <Button
                      type="button" variant="ghost" size="sm"
                      onClick={() => handleOverflightBetweenLegs(idx)}
                      disabled={leg.airportIcao.length !== 4 || legs[idx + 1]?.airportIcao.length !== 4 || overflightLoading[idx]}
                      className="text-xs h-7"
                    >
                      {overflightLoading[idx] ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Navigation className="h-3 w-3 mr-1" />}
                      Check
                    </Button>
                  </div>

                  {overflightLoading[idx] && (
                    <div className="rounded-md border p-2 text-xs flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Analyzing overflight route…
                    </div>
                  )}

                  {overflightResults[idx] && !overflightLoading[idx] && (
                    <div className={cn("rounded-md border p-3 text-xs space-y-1.5",
                      overflightResults[idx]!.success ? "border-primary/30 bg-primary/5" : "border-muted bg-muted/50"
                    )}>
                      {overflightResults[idx]!.routeSummary && (
                        <p className="text-muted-foreground">{overflightResults[idx]!.routeSummary}</p>
                      )}
                      {overflightResults[idx]!.totalPermitsNeeded != null && (
                        <p className="font-medium">
                          {overflightResults[idx]!.totalPermitsNeeded === 0
                            ? '✅ No permits required'
                            : `⚠️ ${overflightResults[idx]!.totalPermitsNeeded} permit${overflightResults[idx]!.totalPermitsNeeded! > 1 ? 's' : ''} required`}
                        </p>
                      )}
                      {overflightResults[idx]!.totalOverflightChargesUsd != null && (
                        <p className="font-medium flex items-center gap-1">
                          <DollarSign className="h-3 w-3 text-primary" />
                          Overflight charges: ${overflightResults[idx]!.totalOverflightChargesUsd!.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD
                        </p>
                      )}
                      {overflightResults[idx]!.countries && (
                        <div className="space-y-1">
                          {overflightResults[idx]!.countries!.map((c, ci) => (
                            <div key={ci} className={cn("rounded bg-background/50 px-2 py-1 space-y-0.5",
                              c.overflightPermitRequired === 'yes' ? "border-l-2 border-l-warning" : c.overflightPermitRequired === 'no' ? "border-l-2 border-l-success" : "border-l-2 border-l-muted-foreground"
                            )}>
                              <p className="font-medium">
                                {c.overflightPermitRequired === 'yes' ? '⚠️' : '✅'} {c.country}
                                <span className="font-normal text-muted-foreground ml-1">
                                  — {c.overflightPermitRequired === 'yes' ? 'Permit required' : c.overflightPermitRequired === 'no' ? 'No permit' : 'Conditional'}
                                </span>
                              </p>
                              {c.leadTimeDays != null && <p>Lead time: {c.leadTimeDays}d</p>}
                              {c.overflightChargeUsd != null && <p>Charge: ~${c.overflightChargeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD</p>}
                              {c.notes && <p className="text-muted-foreground italic">{c.notes}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                      {overflightResults[idx]!.error && (
                        <p className="text-destructive">{overflightResults[idx]!.error}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Add Leg button after each leg */}
              <div className="flex justify-center mt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addLeg}
                  className="text-xs border-dashed"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Leg
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Trip Summary */}
        {(anyChecked || totalCharges > 0 || totalOverflightCharges > 0) && (
          <Card>
            <CardContent className="pt-6">
              <div className={cn("rounded-lg border-2 p-5 space-y-3",
                allFeasible && anyChecked ? "border-success/40 bg-success/5" : anyChecked ? "border-destructive/40 bg-destructive/5" : "border-muted"
              )}>
                <div className="flex items-center gap-2">
                  {anyChecked && (allFeasible
                    ? <><CheckCircle2 className="h-5 w-5 text-success" /><span className="font-semibold">All Legs Feasible</span></>
                    : <><XCircle className="h-5 w-5 text-destructive" /><span className="font-semibold">Issues Detected</span></>
                  )}
                </div>

                {/* Flight Summary */}
                {totalDistanceNm > 0 && (
                  <div className="rounded bg-background/50 px-3 py-2 text-sm space-y-1">
                    <p className="font-semibold">Flight Summary</p>
                    <div className="flex justify-between">
                      <span>Total distance:</span>
                      <span className="font-mono">{totalDistanceNm.toLocaleString()} nm</span>
                    </div>
                    {totalFlightTimeMin > 0 && (
                      <div className="flex justify-between">
                        <span>Estimated total flight time:</span>
                        <span className="font-mono">{Math.floor(totalFlightTimeMin / 60)}h {totalFlightTimeMin % 60}m</span>
                      </div>
                    )}
                    {anyOutOfRange && (
                      <p className="text-destructive font-medium text-xs mt-1">⚠️ One or more legs exceed aircraft range</p>
                    )}
                  </div>
                )}

                {(totalCharges > 0 || totalOverflightCharges > 0 || totalAegFees > 0) && (
                  <div className="rounded bg-background/50 px-3 py-2 text-sm space-y-1">
                    <p className="font-semibold">Trip Cost Summary</p>
                    {totalCharges > 0 && (
                      <div className="flex justify-between">
                        <span>Airport charges ({legs.length} leg{legs.length > 1 ? 's' : ''}):</span>
                        <span className="font-mono">${totalCharges.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      </div>
                    )}
                    {totalOverflightCharges > 0 && (
                      <div className="flex justify-between">
                        <span>Overflight charges:</span>
                        <span className="font-mono">${totalOverflightCharges.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      </div>
                    )}
                    {totalAegFees > 0 && (
                      <div className="flex justify-between">
                        <span>AEG set up fees:</span>
                        <span className="font-mono">${totalAegFees.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      </div>
                    )}
                    <Separator />
                    <div className="flex justify-between font-semibold">
                      <span>Estimated total:</span>
                      <span className="font-mono text-primary">${(totalCharges + totalOverflightCharges + totalAegFees).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </div>
                  </div>
                )}

                {anyChecked && legs.map((leg, i) => (
                  leg.feasibilityResult && !leg.feasibilityResult.feasible && (
                    <div key={i} className="text-sm">
                      <p className="font-medium text-destructive">Leg {i + 1} — {leg.airportIcao}:</p>
                      {leg.feasibilityResult.issues.map((issue, j) => (
                        <p key={j} className="flex items-start gap-2 text-xs text-destructive ml-4">
                          <XCircle className="mt-0.5 h-3 w-3 shrink-0" />{issue}
                        </p>
                      ))}
                    </div>
                  )
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Visa Requirements */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4" /> Visa Requirements
            </CardTitle>
            {destinationIcaos.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Destinations detected: {destinationIcaos.join(', ')}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs">Passenger Nationalities</Label>
              {visaNationalities.map((nat, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <Select
                    value={nat}
                    onValueChange={(v) => {
                      const updated = [...visaNationalities];
                      updated[idx] = v;
                      setVisaNationalities(updated);
                      setVisaResults({});
                    }}
                  >
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select nationality" /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      <SelectItem value="United States of America">United States of America</SelectItem>
                      <Separator className="my-1" />
                      {COUNTRIES.filter(c => c !== "United States of America").map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {visaNationalities.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" className="shrink-0 h-9 w-9"
                      onClick={() => { setVisaNationalities(visaNationalities.filter((_, i) => i !== idx)); setVisaResults({}); }}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setVisaNationalities([...visaNationalities, ""])} className="text-xs">
                <Plus className="h-3 w-3 mr-1" /> Add Passenger
              </Button>
            </div>

            <Button type="button" variant="secondary" onClick={handleVisaCheck}
              disabled={destinationIcaos.length === 0 || visaNationalities.filter(n => n).length === 0 || Object.values(visaLoading).some(Boolean)}
              className="w-full">
              {Object.values(visaLoading).some(Boolean) ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Globe className="h-4 w-4 mr-1.5" />}
              Check Visa Requirements ({destinationIcaos.length} destination{destinationIcaos.length !== 1 ? 's' : ''})
            </Button>

            {/* Results per destination */}
            {destinationIcaos.map(icao => (
              <div key={icao}>
                {visaLoading[icao] && (
                  <div className="rounded-md border p-3 text-sm flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking visa for {icao}…
                  </div>
                )}

                {visaResults[icao] && !visaLoading[icao] && (
                  <div className={cn("rounded-md border p-3 text-sm space-y-2", visaResults[icao]!.success ? "border-primary/30 bg-primary/5" : "border-muted bg-muted/50")}>
                    <div className="flex items-center gap-1.5 font-medium">
                      <Globe className="h-3.5 w-3.5 text-primary" />
                      {icao} — {visaResults[icao]!.destinationCountry || 'Unknown'}
                    </div>
                    {visaResults[icao]!.results?.map((r, i) => (
                      <div key={i} className={cn("rounded bg-background/50 px-2 py-1.5 text-xs space-y-0.5",
                        r.visaRequired === 'yes' ? "border-l-2 border-l-destructive" : r.visaRequired === 'no' ? "border-l-2 border-l-success" : "border-l-2 border-l-warning"
                      )}>
                        <p className="font-medium">
                          {r.visaRequired === 'yes' ? '❌' : r.visaRequired === 'no' ? '✅' : '⚠️'} {r.nationality}
                          <span className="font-normal text-muted-foreground ml-1">
                            — {r.visaRequired === 'yes' ? 'Visa required' : r.visaRequired === 'no' ? 'Visa-free' : 'Conditional'}
                          </span>
                        </p>
                        {r.visaType && <p><span className="font-medium">Type:</span> {r.visaType}</p>}
                        {r.visaOnArrival && <p className="text-success">✅ Visa on arrival</p>}
                        {r.eVisaAvailable && <p className="text-success">✅ e-Visa available</p>}
                        {r.maxStayDays != null && <p><span className="font-medium">Max stay:</span> {r.maxStayDays} days</p>}
                        {r.processingTimeDays != null && <p><span className="font-medium">Processing:</span> ~{r.processingTimeDays} days</p>}
                        {r.transitVisaRequired && <p className="text-warning">⚠️ Transit visa required</p>}
                        {r.conditions && <p><span className="font-medium">Conditions:</span> {r.conditions}</p>}
                        {r.notes && <p className="text-muted-foreground italic">{r.notes}</p>}
                      </div>
                    ))}
                    {visaResults[icao]!.error && <p className="text-xs text-destructive">{visaResults[icao]!.error}</p>}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Pet Travel Requirements */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <PawPrint className="h-4 w-4" /> Pet Travel Requirements
            </CardTitle>
            {destinationIcaos.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Destinations detected: {destinationIcaos.join(', ')}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs">Pet Types</Label>
              <div className="flex flex-wrap gap-4">
                {['Dog', 'Cat', 'Other'].map(type => (
                  <div key={type} className="flex items-center gap-2">
                    <Checkbox
                      id={`pet-${type}`}
                      checked={petTypes.includes(type)}
                      onCheckedChange={(checked) => {
                        setPetTypes(prev =>
                          checked ? [...prev, type] : prev.filter(t => t !== type)
                        );
                        setPetResults({});
                      }}
                    />
                    <Label htmlFor={`pet-${type}`} className="text-xs cursor-pointer">{type}</Label>
                  </div>
                ))}
              </div>
            </div>

            <Button type="button" variant="secondary" onClick={handlePetCheck}
              disabled={destinationIcaos.length === 0 || petTypes.length === 0 || Object.values(petLoading).some(Boolean)}
              className="w-full">
              {Object.values(petLoading).some(Boolean) ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <PawPrint className="h-4 w-4 mr-1.5" />}
              Check Pet Requirements ({destinationIcaos.length} destination{destinationIcaos.length !== 1 ? 's' : ''})
            </Button>

            {/* Results per destination */}
            {destinationIcaos.map(icao => (
              <div key={icao}>
                {petLoading[icao] && (
                  <div className="rounded-md border p-3 text-sm flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking pet requirements for {icao}…
                  </div>
                )}

                {petResults[icao] && !petLoading[icao] && (
                  <div className={cn("rounded-md border p-3 text-sm space-y-2", petResults[icao]!.success ? "border-primary/30 bg-primary/5" : "border-muted bg-muted/50")}>
                    <div className="flex items-center gap-1.5 font-medium">
                      <PawPrint className="h-3.5 w-3.5 text-primary" />
                      {icao} — {petResults[icao]!.destinationCountry || 'Unknown'}
                    </div>
                    {petResults[icao]!.results?.map((r, i) => (
                      <div key={i} className={cn("rounded bg-background/50 px-2 py-1.5 text-xs space-y-1",
                        r.importAllowed === 'no' ? "border-l-2 border-l-destructive" : r.importAllowed === 'yes' ? "border-l-2 border-l-success" : "border-l-2 border-l-warning"
                      )}>
                        <p className="font-medium">
                          {r.importAllowed === 'no' ? '❌' : r.importAllowed === 'yes' ? '✅' : '⚠️'} {r.petType}
                          <span className="font-normal text-muted-foreground ml-1">
                            — {r.importAllowed === 'no' ? 'Import not allowed' : r.importAllowed === 'yes' ? 'Import allowed' : 'Conditional'}
                          </span>
                        </p>
                        {r.healthCertificate && <p><span className="font-medium">Health Certificate:</span> {r.healthCertificate}</p>}
                        {r.vaccinations && <p><span className="font-medium">Vaccinations:</span> {r.vaccinations}</p>}
                        {r.microchipRequired != null && <p><span className="font-medium">Microchip:</span> {r.microchipRequired ? 'Required (ISO 11784/11785)' : 'Not required'}</p>}
                        {r.quarantine && <p><span className="font-medium">Quarantine:</span> {r.quarantine}</p>}
                        {r.bloodTests && <p><span className="font-medium">Blood Tests:</span> {r.bloodTests}</p>}
                        {r.importPermit && <p><span className="font-medium">Import Permit:</span> {r.importPermit}</p>}
                        {r.leadTimeDays != null && <p><span className="font-medium">Lead Time:</span> {r.leadTimeDays} days recommended</p>}
                        {r.breedRestrictions && <p><span className="font-medium">Breed Restrictions:</span> {r.breedRestrictions}</p>}
                        {r.documentsRequired && <p><span className="font-medium">Documents:</span> {r.documentsRequired}</p>}
                        {r.advanceNotification && <p><span className="font-medium">Advance Notice:</span> {r.advanceNotification}</p>}
                        {r.privateAviationNotes && <p className="text-primary"><span className="font-medium">Private Aviation:</span> {r.privateAviationNotes}</p>}
                        {r.estimatedFeesUsd != null && <p><span className="font-medium">Estimated Fees:</span> ~${r.estimatedFeesUsd.toLocaleString()} USD</p>}
                        {r.preparationTimeline && <p><span className="font-medium">Timeline:</span> {r.preparationTimeline}</p>}
                        {r.notes && <p className="text-muted-foreground italic">{r.notes}</p>}
                      </div>
                    ))}
                    {petResults[icao]!.generalNotes && (
                      <p className="text-xs text-muted-foreground italic">{petResults[icao]!.generalNotes}</p>
                    )}
                    {petResults[icao]!.error && <p className="text-xs text-destructive">{petResults[icao]!.error}</p>}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </main>

      {/* Floating action toolbar */}
      {legs.some(l => l.airportIcao.length === 4) && (
        <div className="fixed bottom-6 right-6 z-50">
          <div className="flex flex-col gap-1 bg-background/95 backdrop-blur-sm border rounded-xl shadow-xl p-2 min-w-[160px]">
            <Button
              size="sm"
              className="justify-start gap-2 w-full"
              onClick={() => { handleCheckAll(); if (legs.length > 1) handleAllOverflights(); }}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh All
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="justify-start gap-2 w-full"
              onClick={handleCheckAll}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Check All Legs
            </Button>
            {legs.length > 1 && (
              <Button
                variant="secondary"
                size="sm"
                className="justify-start gap-2 w-full"
                onClick={handleAllOverflights}
              >
                <Navigation className="h-3.5 w-3.5" /> Overflights
              </Button>
            )}
            {anyChecked && (
              <>
                <Separator className="my-0.5" />
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start gap-2 w-full"
                  onClick={() => {
                    const html = generatePrintableHtml({
                      aircraftType, flightType, legs, overflightResults,
                      visaNationalities, visaResults, totalCharges, totalOverflightCharges, petTypes, petResults, logoDataUrl, flightCalcs,
                    });
                    const w = window.open("", "_blank");
                    if (w) { w.document.write(html); w.document.close(); }
                  }}
                >
                  <Printer className="h-3.5 w-3.5" /> Print Report
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start gap-2 w-full"
                  onClick={() => {
                    const html = generatePrintableHtml({
                      aircraftType, flightType, legs, overflightResults,
                      visaNationalities, visaResults, totalCharges, totalOverflightCharges, petTypes, petResults, logoDataUrl, flightCalcs,
                    });
                    const w = window.open("", "_blank");
                    if (w) {
                      w.document.write(html);
                      w.document.close();
                      setTimeout(() => w.print(), 500);
                    }
                  }}
                >
                  <FileDown className="h-3.5 w-3.5" /> Save as PDF
                </Button>
              </>
            )}
            <Separator className="my-0.5" />
            <Button
              variant="ghost"
              size="sm"
              className="justify-start gap-2 w-full text-muted-foreground hover:text-destructive"
              onClick={handleReset}
            >
              <X className="h-3.5 w-3.5" /> Reset
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
