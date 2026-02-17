import { useState, useCallback } from "react";
import { format } from "date-fns";
import {
  Plane, Loader2, Navigation, Globe, Plus, X, DollarSign,
  CheckCircle2, XCircle, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { AIRCRAFT_CATEGORIES } from "@/data/aircraftData";
import { COUNTRIES } from "@/data/countries";
import { SelectGroup, SelectLabel } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import TripLegCard, { evaluateLegFeasibility } from "./TripLegCard";
import type {
  LegData, OverflightResult, VisaCheckResult,
} from "./tripTypes";
import { createEmptyLeg } from "./tripTypes";

export default function FeasibilityForm() {
  const [aircraftType, setAircraftType] = useState("");
  const [flightType, setFlightType] = useState("");
  const [legs, setLegs] = useState<LegData[]>([createEmptyLeg()]);

  // Overflight results keyed by "legIdx" (between leg legIdx and legIdx+1)
  const [overflightResults, setOverflightResults] = useState<Record<number, OverflightResult | null>>({});
  const [overflightLoading, setOverflightLoading] = useState<Record<number, boolean>>({});

  // Visa
  const [visaNationalities, setVisaNationalities] = useState<string[]>([""]);
  const [visaDestination, setVisaDestination] = useState("");
  const [visaResult, setVisaResult] = useState<VisaCheckResult | null>(null);
  const [visaLoading, setVisaLoading] = useState(false);

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

  // Check feasibility for all legs
  const handleCheckAll = useCallback(() => {
    setLegs(prev => prev.map((leg, idx) => ({
      ...leg,
      feasibilityResult: evaluateLegFeasibility(leg, aircraftType, idx, prev.length),
    })));
  }, [aircraftType]);

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

  // Visa check
  const handleVisaCheck = useCallback(async () => {
    const validNationalities = visaNationalities.filter(n => n.length > 0);
    const destination = visaDestination || undefined;
    if (validNationalities.length === 0) return;

    // If no manual destination, use first leg's country from permit/CIQ result
    const destinationCountry = destination
      || legs.find(l => l.permitResult?.country)?.permitResult?.country
      || legs.find(l => l.ciqResult?.country)?.ciqResult?.country;

    if (!destinationCountry) return;

    setVisaLoading(true);
    setVisaResult(null);
    try {
      const { data: res, error } = await supabase.functions.invoke('visa-check', {
        body: { nationalities: validNationalities, destinationCountry },
      });
      if (error) { setVisaResult({ success: false, error: error.message }); }
      else { setVisaResult(res as VisaCheckResult); }
    } catch { setVisaResult({ success: false, error: 'Failed to connect' }); }
    finally { setVisaLoading(false); }
  }, [visaNationalities, visaDestination, legs]);

  // Reset
  const handleReset = () => {
    setAircraftType("");
    setFlightType("");
    setLegs([createEmptyLeg()]);
    setOverflightResults({});
    setOverflightLoading({});
    setVisaNationalities([""]);
    setVisaDestination("");
    setVisaResult(null);
  };

  // Compute trip totals
  const totalCharges = legs.reduce((sum, l) => sum + (l.chargesResult?.totalEstimateUsd ?? 0), 0);
  const totalOverflightCharges = Object.values(overflightResults).reduce(
    (sum, r) => sum + (r?.totalOverflightChargesUsd ?? 0), 0
  );
  const allFeasible = legs.every(l => l.feasibilityResult?.feasible !== false);
  const anyChecked = legs.some(l => l.feasibilityResult != null);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-primary">
        <div className="container mx-auto flex items-center gap-3 px-6 py-4">
          <Plane className="h-6 w-6 text-primary-foreground" />
          <h1 className="text-lg font-semibold tracking-tight text-primary-foreground">
            Airport Ops Feasibility
          </h1>
          <span className="ml-auto font-mono text-xs text-primary-foreground/60">
            {format(new Date(), "dd MMM yyyy HH:mm")} UTC
          </span>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-6 py-8 space-y-6">
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
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={addLeg}>
                <Plus className="h-4 w-4 mr-1" /> Add Leg
              </Button>
            </div>
          </div>

          {legs.map((leg, idx) => (
            <div key={leg.id}>
              <TripLegCard
                leg={leg}
                legIndex={idx}
                totalLegs={legs.length}
                aircraftType={aircraftType}
                flightType={flightType}
                onUpdateLeg={updateLeg}
                onRemoveLeg={removeLeg}
              />

              {/* Overflight between this leg and next */}
              {idx < legs.length - 1 && (
                <div className="my-3 ml-6 pl-4 border-l-2 border-dashed border-muted-foreground/30 space-y-2">
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
            </div>
          ))}
        </div>

        {/* Visa Requirements */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4" /> Visa Requirements
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Destination Country</Label>
              <Select value={visaDestination} onValueChange={(v) => { setVisaDestination(v); setVisaResult(null); }}>
                <SelectTrigger><SelectValue placeholder="Select destination country" /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

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
                      setVisaResult(null);
                    }}
                  >
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select nationality" /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      {COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {visaNationalities.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" className="shrink-0 h-9 w-9"
                      onClick={() => { setVisaNationalities(visaNationalities.filter((_, i) => i !== idx)); setVisaResult(null); }}>
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
              disabled={!visaDestination || visaNationalities.filter(n => n).length === 0 || visaLoading}
              className="w-full">
              {visaLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Globe className="h-4 w-4 mr-1.5" />}
              Check Visa Requirements
            </Button>

            {visaLoading && (
              <div className="rounded-md border p-3 text-sm flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking visa requirements…
              </div>
            )}

            {visaResult && !visaLoading && (
              <div className={cn("rounded-md border p-3 text-sm space-y-2", visaResult.success ? "border-primary/30 bg-primary/5" : "border-muted bg-muted/50")}>
                <div className="flex items-center gap-1.5 font-medium">
                  <Globe className="h-3.5 w-3.5 text-primary" />
                  Visa — {visaResult.destinationCountry}
                </div>
                {visaResult.results?.map((r, i) => (
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
                {visaResult.error && <p className="text-xs text-destructive">{visaResult.error}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex gap-3">
              <Button onClick={handleCheckAll} className="flex-1">
                Check All Legs
              </Button>
              {legs.length > 1 && (
                <Button variant="secondary" onClick={handleAllOverflights} className="flex-1">
                  <Navigation className="h-4 w-4 mr-1.5" /> All Overflight Permits
                </Button>
              )}
              <Button variant="outline" onClick={handleReset}>
                Reset
              </Button>
            </div>

            {/* Trip Summary */}
            {(anyChecked || totalCharges > 0 || totalOverflightCharges > 0) && (
              <div className={cn("rounded-lg border-2 p-5 space-y-3",
                allFeasible && anyChecked ? "border-success/40 bg-success/5" : anyChecked ? "border-destructive/40 bg-destructive/5" : "border-muted"
              )}>
                <div className="flex items-center gap-2">
                  {anyChecked && (allFeasible
                    ? <><CheckCircle2 className="h-5 w-5 text-success" /><span className="font-semibold">All Legs Feasible</span></>
                    : <><XCircle className="h-5 w-5 text-destructive" /><span className="font-semibold">Issues Detected</span></>
                  )}
                </div>

                {(totalCharges > 0 || totalOverflightCharges > 0) && (
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
                    <Separator />
                    <div className="flex justify-between font-semibold">
                      <span>Estimated total:</span>
                      <span className="font-mono text-primary">${(totalCharges + totalOverflightCharges).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
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
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
