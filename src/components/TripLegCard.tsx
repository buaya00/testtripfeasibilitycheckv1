import { useCallback, useState, useEffect } from "react";
import { format } from "date-fns";
import {
  CalendarIcon, CheckCircle2, XCircle, AlertTriangle, Search, Loader2,
  ExternalLink, Ruler, Shield, DollarSign, Clock, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { AIRCRAFT_RUNWAY_REQ } from "@/data/aircraftData";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type {
  LegData, CbpResult, RunwayResult, PermitResult, CiqResult,
  ChargesResult, PprResult, FeasibilityResult, OperatingHours,
  AirportHoursResult,
} from "./tripTypes";

// ── Constants ──────────────────────────────────────────────
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function isTimeInRange(time: string, open: string, close: string): boolean {
  if (!time || !open || !close) return true;
  const t = timeToMinutes(time);
  const o = timeToMinutes(open);
  const c = timeToMinutes(close);
  if (c > o) return t >= o && t <= c;
  return t >= o || t <= c;
}

function isUsAirport(icao: string) {
  return icao.startsWith('K') || icao.startsWith('PA') || icao.startsWith('PH') || icao.startsWith('PG') || icao.startsWith('TJ');
}

export function evaluateLegFeasibility(
  leg: LegData,
  aircraftType: string,
  legIndex: number = 0,
  totalLegs: number = 1,
): FeasibilityResult {
  const issues: string[] = [];
  const notes: string[] = [];

  const isFirstLeg = legIndex === 0;
  const isLastLeg = legIndex === totalLegs - 1;

  if (!aircraftType) issues.push("Aircraft type not specified");
  if (!leg.airportIcao) issues.push("Airport ICAO code not specified");
  if (leg.airportIcao && !/^[A-Z]{4}$/.test(leg.airportIcao.toUpperCase())) issues.push("ICAO code must be exactly 4 letters");
  const showArrival = totalLegs === 1 || !isFirstLeg;
  const showDeparture = totalLegs === 1 || !isLastLeg;

  if (showArrival && !leg.arrivalDate) issues.push("Arrival date not set");
  if (showDeparture && !leg.departureDate) issues.push("Departure date not set");
  if (showArrival && !leg.arrivalTime) issues.push("Arrival time not set");
  if (showDeparture && !leg.departureTime) issues.push("Departure time not set");

  // Skip arrival-based checks for first leg and departure-based checks for last leg in multi-leg trips
  const checkArrival = showArrival;
  const checkDeparture = showDeparture;

  if (leg.arrivalDate && leg.departureDate && leg.arrivalDate > leg.departureDate) {
    issues.push("Departure date is before arrival date");
  }

  const isUs = leg.airportIcao ? isUsAirport(leg.airportIcao.toUpperCase()) : false;

  if (leg.permitRequired) notes.push("Landing permit must be obtained prior to ops");
  if (leg.pprRequired) notes.push("Prior Permission Required — contact airport ops");
  if (!leg.customsAvailable) issues.push("Customs not available at this airport");

  // Permit lead time check — for US airports, only add as guidance notes, not feasibility issues
  if (checkArrival && leg.arrivalDate && leg.permitResult?.success && leg.permitResult.permitRequired === 'yes' && leg.permitResult.leadTimeDays != null && leg.permitResult.leadTimeDays > 0) {
    const now = new Date();
    const daysUntilArrival = Math.floor((leg.arrivalDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilArrival < leg.permitResult.leadTimeDays) {
      const msg = `Insufficient lead time for landing permit: ${daysUntilArrival} day${daysUntilArrival !== 1 ? 's' : ''} until arrival, but ${leg.permitResult.leadTimeDays} business days required (${leg.permitResult.issuingAuthority || 'issuing authority'}). Contact the service provider to validate.`;
      if (isUs) {
        notes.push(msg);
      } else {
        issues.push(msg);
      }
    }
  }

  // PPR lead time check
  if (checkArrival && leg.arrivalDate && leg.pprResult?.success && leg.pprResult.pprRequired === 'yes' && leg.pprResult.advanceNoticePeriod) {
    const noticeDays = parseInt(leg.pprResult.advanceNoticePeriod, 10);
    if (!isNaN(noticeDays) && noticeDays > 0) {
      const now = new Date();
      const daysUntilArrival = Math.floor((leg.arrivalDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntilArrival < noticeDays) {
        issues.push(
          `Insufficient lead time for PPR: ${daysUntilArrival} day${daysUntilArrival !== 1 ? 's' : ''} until arrival, but ${leg.pprResult.advanceNoticePeriod} advance notice required. Contact airport operations to validate.`
        );
      }
    }
  }

  // CBP hours check
  const cbpHours = leg.cbpResult?.operatingHours ?? null;
  if (cbpHours && cbpHours.open && cbpHours.close && leg.customsAvailable) {
    if (checkArrival && leg.arrivalTime && !isTimeInRange(leg.arrivalTime, cbpHours.open, cbpHours.close)) {
      issues.push(`Arrival time ${leg.arrivalTime} is outside CBP hours (${cbpHours.open}–${cbpHours.close})`);
    }
    if (checkDeparture && leg.departureTime && !isTimeInRange(leg.departureTime, cbpHours.open, cbpHours.close)) {
      issues.push(`Departure time ${leg.departureTime} is outside CBP hours (${cbpHours.open}–${cbpHours.close})`);
    }
    if (cbpHours.notes) notes.push(`CBP note: ${cbpHours.notes}`);
  }

  // Runway length check
  const effectiveRunwayFt = leg.runwayOverrideFt && parseInt(leg.runwayOverrideFt, 10) > 0
    ? parseInt(leg.runwayOverrideFt, 10)
    : leg.runwayResult?.longestRunwayFt ?? null;
  const requiredFt = aircraftType ? AIRCRAFT_RUNWAY_REQ[aircraftType] : undefined;
  if (requiredFt && effectiveRunwayFt) {
    if (effectiveRunwayFt < requiredFt) {
      issues.push(`Runway too short: ${effectiveRunwayFt.toLocaleString()} ft available, ${aircraftType} requires ~${requiredFt.toLocaleString()} ft`);
    } else {
      const margin = effectiveRunwayFt - requiredFt;
      notes.push(`Runway OK: ${effectiveRunwayFt.toLocaleString()} ft available (${margin.toLocaleString()} ft margin for ${aircraftType})`);
    }
  } else if (requiredFt && !effectiveRunwayFt) {
    notes.push(`${aircraftType} requires ~${requiredFt.toLocaleString()} ft — runway data not available, verify manually`);
  } else if (aircraftType === "Other") {
    notes.push("Runway requirement unknown for custom aircraft — verify manually");
  }

  if (leg.customsAvailable && (leg.permitRequired || leg.pprRequired)) {
    notes.push("Allow additional lead time for permit/PPR processing");
  }

  // Airport operating hours check
  const hrs = leg.airportHoursResult;
  if (hrs?.success) {
    if (checkArrival && hrs.arrivalOutsideHours) {
      issues.push(`Arrival time is outside airport operating hours${hrs.operatingHoursOpen && hrs.operatingHoursClose ? ` (${hrs.operatingHoursOpen}–${hrs.operatingHoursClose} UTC)` : ''}`);
    }
    if (checkDeparture && hrs.departureOutsideHours) {
      issues.push(`Departure time is outside airport operating hours${hrs.operatingHoursOpen && hrs.operatingHoursClose ? ` (${hrs.operatingHoursOpen}–${hrs.operatingHoursClose} UTC)` : ''}`);
    }
    if (checkArrival && hrs.arrivalDuringCurfew) {
      issues.push(`Arrival falls during airport curfew${hrs.curfewStart && hrs.curfewEnd ? ` (${hrs.curfewStart}–${hrs.curfewEnd} UTC)` : ''}${hrs.curfewNotes ? ': ' + hrs.curfewNotes : ''}`);
    }
    if (checkDeparture && hrs.departureDuringCurfew) {
      issues.push(`Departure falls during airport curfew${hrs.curfewStart && hrs.curfewEnd ? ` (${hrs.curfewStart}–${hrs.curfewEnd} UTC)` : ''}${hrs.curfewNotes ? ': ' + hrs.curfewNotes : ''}`);
    }
    // Flag NOTAMs that affect operations
    const affectingNotams = hrs.activeNotams?.filter(n => n.affectsOperations) || [];
    for (const notam of affectingNotams) {
      if (notam.type === 'closure') {
        issues.push(`NOTAM: Airport closure — ${notam.summary}`);
      } else {
        notes.push(`NOTAM (${notam.type}): ${notam.summary}`);
      }
    }
    if (hrs.seasonalRestrictions) {
      notes.push(`Seasonal restriction: ${hrs.seasonalRestrictions}`);
    }
    if (hrs.is24Hours) {
      notes.push('Airport operates 24 hours');
    } else if (hrs.operatingHoursOpen && hrs.operatingHoursClose) {
      notes.push(`Airport hours: ${hrs.operatingHoursOpen}–${hrs.operatingHoursClose} UTC (${hrs.operatingDays || 'Daily'})`);
    }
  }

  return { feasible: issues.length === 0, issues, notes };
}

interface TripLegCardProps {
  leg: LegData;
  legIndex: number;
  totalLegs: number;
  aircraftType: string;
  flightType: string;
  onUpdateLeg: (index: number, updates: Partial<LegData>) => void;
  onRemoveLeg: (index: number) => void;
  onRegisterLookup?: (index: number, fn: (() => void) | null) => void;
}

export default function TripLegCard({
  leg, legIndex, totalLegs, aircraftType, flightType, onUpdateLeg, onRemoveLeg, onRegisterLookup,
}: TripLegCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [cbpLoading, setCbpLoading] = useState(false);
  const [runwayLoading, setRunwayLoading] = useState(false);
  const [permitLoading, setPermitLoading] = useState(false);
  const [ciqLoading, setCiqLoading] = useState(false);
  const [chargesLoading, setChargesLoading] = useState(false);
  const [pprLoading, setPprLoading] = useState(false);
  const [hoursLoading, setHoursLoading] = useState(false);

  const anyLoading = cbpLoading || runwayLoading || permitLoading || ciqLoading || chargesLoading || pprLoading || hoursLoading;

  const update = (updates: Partial<LegData>) => onUpdateLeg(legIndex, updates);

  const handleCbpLookup = useCallback(async () => {
    if (leg.airportIcao.length !== 4) return;
    setCbpLoading(true);
    update({ cbpResult: null });
    try {
      const { data: res, error } = await supabase.functions.invoke('cbp-lookup', { body: { icao: leg.airportIcao } });
      if (error) {
        update({ cbpResult: { success: false, found: false, icao: leg.airportIcao, airportName: null, customsAvailable: false, detailUrl: null, pdfUrl: null, message: '', operatingHours: null, error: error.message } });
      } else {
        update({ cbpResult: res as CbpResult, ...(res?.found !== undefined ? { customsAvailable: res.customsAvailable } : {}) });
      }
    } catch { update({ cbpResult: { success: false, found: false, icao: leg.airportIcao, airportName: null, customsAvailable: false, detailUrl: null, pdfUrl: null, message: '', operatingHours: null, error: 'Failed to connect' } }); }
    finally { setCbpLoading(false); }
  }, [leg.airportIcao]);

  const handleRunwayLookup = useCallback(async () => {
    if (leg.airportIcao.length !== 4) return;
    setRunwayLoading(true);
    update({ runwayResult: null });
    try {
      const { data: res, error } = await supabase.functions.invoke('runway-lookup', { body: { icao: leg.airportIcao } });
      if (error) {
        update({ runwayResult: { success: false, found: false, icao: leg.airportIcao, airportName: null, runways: [], longestRunwayFt: null, message: '', error: error.message } });
      } else { update({ runwayResult: res as RunwayResult }); }
    } catch { update({ runwayResult: { success: false, found: false, icao: leg.airportIcao, airportName: null, runways: [], longestRunwayFt: null, message: '', error: 'Failed to connect' } }); }
    finally { setRunwayLoading(false); }
  }, [leg.airportIcao]);

  const handlePermitLookup = useCallback(async () => {
    if (leg.airportIcao.length !== 4) return;
    setPermitLoading(true);
    update({ permitResult: null });
    try {
      const { data: res, error } = await supabase.functions.invoke('permit-lookup', { body: { icao: leg.airportIcao, flightType: flightType || undefined } });
      if (error) { update({ permitResult: { success: false, icao: leg.airportIcao, error: error.message } }); }
      else {
        update({ permitResult: res as PermitResult, ...(res?.permitRequired === 'yes' ? { permitRequired: true } : res?.permitRequired === 'no' ? { permitRequired: false } : {}) });
      }
    } catch { update({ permitResult: { success: false, icao: leg.airportIcao, error: 'Failed to connect' } }); }
    finally { setPermitLoading(false); }
  }, [leg.airportIcao, flightType]);

  const handleCiqLookup = useCallback(async () => {
    if (leg.airportIcao.length !== 4) return;
    setCiqLoading(true);
    update({ ciqResult: null });
    try {
      const { data: res, error } = await supabase.functions.invoke('ciq-lookup', { body: { icao: leg.airportIcao } });
      if (error) { update({ ciqResult: { success: false, icao: leg.airportIcao, error: error.message } }); }
      else { update({ ciqResult: res as CiqResult, ...(res?.ciqAvailable === 'yes' ? { customsAvailable: true } : res?.ciqAvailable === 'no' ? { customsAvailable: false } : {}) }); }
    } catch { update({ ciqResult: { success: false, icao: leg.airportIcao, error: 'Failed to connect' } }); }
    finally { setCiqLoading(false); }
  }, [leg.airportIcao]);

  const handleChargesLookup = useCallback(async () => {
    if (leg.airportIcao.length !== 4) return;
    setChargesLoading(true);
    update({ chargesResult: null });
    try {
      const { data: res, error } = await supabase.functions.invoke('charges-lookup', {
        body: {
          icao: leg.airportIcao,
          aircraftType: aircraftType || undefined,
          arrivalDate: leg.arrivalDate?.toISOString(),
          arrivalTime: leg.arrivalTime || undefined,
          departureDate: leg.departureDate?.toISOString(),
          departureTime: leg.departureTime || undefined,
        },
      });
      if (error) { update({ chargesResult: { success: false, icao: leg.airportIcao, error: error.message } }); }
      else { update({ chargesResult: res as ChargesResult }); }
    } catch { update({ chargesResult: { success: false, icao: leg.airportIcao, error: 'Failed to connect' } }); }
    finally { setChargesLoading(false); }
  }, [leg.airportIcao, aircraftType, leg.arrivalDate, leg.arrivalTime, leg.departureDate, leg.departureTime]);

  const handlePprLookup = useCallback(async () => {
    if (leg.airportIcao.length !== 4) return;
    setPprLoading(true);
    update({ pprResult: null });
    try {
      const { data: res, error } = await supabase.functions.invoke('ppr-lookup', { body: { icao: leg.airportIcao, flightType: flightType || undefined, aircraftType: aircraftType || undefined } });
      if (error) { update({ pprResult: { success: false, icao: leg.airportIcao, error: error.message } }); }
      else { update({ pprResult: res as PprResult, ...(res?.pprRequired === 'yes' ? { pprRequired: true } : res?.pprRequired === 'no' ? { pprRequired: false } : {}) }); }
    } catch { update({ pprResult: { success: false, icao: leg.airportIcao, error: 'Failed to connect' } }); }
    finally { setPprLoading(false); }
  }, [leg.airportIcao, flightType, aircraftType]);

  const handleAirportHoursLookup = useCallback(async () => {
    if (leg.airportIcao.length !== 4) return;
    setHoursLoading(true);
    update({ airportHoursResult: null });
    try {
      const { data: res, error } = await supabase.functions.invoke('airport-hours-notam', {
        body: {
          icao: leg.airportIcao,
          arrivalDate: leg.arrivalDate?.toISOString(),
          arrivalTime: leg.arrivalTime || undefined,
          departureDate: leg.departureDate?.toISOString(),
          departureTime: leg.departureTime || undefined,
          aircraftType: aircraftType || undefined,
          flightType: flightType || undefined,
        },
      });
      if (error) { update({ airportHoursResult: { success: false, icao: leg.airportIcao, error: error.message } }); }
      else { update({ airportHoursResult: res as AirportHoursResult }); }
    } catch { update({ airportHoursResult: { success: false, icao: leg.airportIcao, error: 'Failed to connect' } }); }
    finally { setHoursLoading(false); }
  }, [leg.airportIcao, leg.arrivalDate, leg.arrivalTime, leg.departureDate, leg.departureTime, aircraftType, flightType]);

  const handleLookupAll = useCallback(() => {
    if (leg.airportIcao.length !== 4) return;
    if (isUsAirport(leg.airportIcao)) { handleCbpLookup(); } else { update({ cbpResult: null }); handleCiqLookup(); }
    handleRunwayLookup();
    handlePermitLookup();
    handleChargesLookup();
    handlePprLookup();
    handleAirportHoursLookup();
  }, [leg.airportIcao, handleCbpLookup, handleCiqLookup, handleRunwayLookup, handlePermitLookup, handleChargesLookup, handlePprLookup, handleAirportHoursLookup]);

  // Register lookup function with parent
  useEffect(() => {
    onRegisterLookup?.(legIndex, handleLookupAll);
    return () => onRegisterLookup?.(legIndex, null);
  }, [legIndex, handleLookupAll, onRegisterLookup]);

  const feasResult = leg.feasibilityResult;

  return (
    <div className="rounded-lg border bg-card">
      {/* Header */}
      <button
        type="button"
        className="flex w-full items-center justify-between p-4 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
            {legIndex + 1}
          </span>
          <span className="font-semibold text-sm">
            {leg.airportIcao ? `Leg ${legIndex + 1} — ${leg.airportIcao}` : `Leg ${legIndex + 1}`}
          </span>
          {feasResult && (
            feasResult.feasible
              ? <CheckCircle2 className="h-4 w-4 text-success" />
              : <XCircle className="h-4 w-4 text-destructive" />
          )}
          {(leg.arrivalDate || leg.departureDate) && (
            <span className="text-xs text-muted-foreground">
              {leg.arrivalDate && leg.departureDate
                ? `${format(leg.arrivalDate, "dd MMM")} – ${format(leg.departureDate, "dd MMM")}`
                : leg.departureDate
                  ? `DEP ${format(leg.departureDate, "dd MMM")}`
                  : leg.arrivalDate
                    ? `ARR ${format(leg.arrivalDate, "dd MMM")}`
                    : ''}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-4">
          {/* Airport ICAO + Lookup */}
          <div className="space-y-2">
            <Label className="text-xs">Airport ICAO Code</Label>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. KJFK"
                maxLength={4}
                value={leg.airportIcao}
                onChange={(e) => update({
                  airportIcao: e.target.value.toUpperCase().replace(/[^A-Z]/g, ""),
                  cbpResult: null, runwayResult: null, permitResult: null,
                  ciqResult: null, chargesResult: null, pprResult: null,
                })}
                className="font-mono uppercase tracking-widest"
              />
              <Button
                type="button" variant="secondary"
                onClick={handleLookupAll}
                disabled={leg.airportIcao.length !== 4 || anyLoading}
                className="shrink-0"
              >
                {anyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                <span className="ml-1.5">Lookup</span>
              </Button>
            </div>
          </div>

          {/* Arrival / Departure */}
          <div className="grid grid-cols-2 gap-4">
            {/* Arrival fields — hidden for the first leg when multi-leg */}
            {(totalLegs === 1 || legIndex > 0) && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Arrival Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal text-xs", !leg.arrivalDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                        {leg.arrivalDate ? format(leg.arrivalDate, "dd MMM yyyy") : "Select"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={leg.arrivalDate} onSelect={(d) => update({ arrivalDate: d })} initialFocus className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Arrival Time (UTC)</Label>
                  <Select value={leg.arrivalTime} onValueChange={(v) => update({ arrivalTime: v })}>
                    <SelectTrigger className="text-xs"><SelectValue placeholder="HH:MM" /></SelectTrigger>
                    <SelectContent>{TIMES.map((t) => <SelectItem key={`a-${t}`} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </>
            )}
            {/* Departure fields — hidden for the last leg when multi-leg */}
            {(totalLegs === 1 || legIndex < totalLegs - 1) && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Departure Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal text-xs", !leg.departureDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                        {leg.departureDate ? format(leg.departureDate, "dd MMM yyyy") : "Select"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={leg.departureDate} onSelect={(d) => update({ departureDate: d })} initialFocus className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Departure Time (UTC)</Label>
                  <Select value={leg.departureTime} onValueChange={(v) => update({ departureTime: v })}>
                    <SelectTrigger className="text-xs"><SelectValue placeholder="HH:MM" /></SelectTrigger>
                    <SelectContent>{TIMES.map((t) => <SelectItem key={`d-${t}`} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>

          {/* Runway Override */}
          <div className="space-y-1">
            <Label className="text-xs">Runway Override (ft)</Label>
            <Input
              type="number"
              placeholder={leg.runwayResult?.longestRunwayFt ? `Auto: ${leg.runwayResult.longestRunwayFt.toLocaleString()} ft` : "Manual override"}
              value={leg.runwayOverrideFt}
              onChange={(e) => update({ runwayOverrideFt: e.target.value })}
              className="font-mono text-xs"
            />
          </div>

          {/* Toggles */}
          <div className="grid grid-cols-3 gap-2">
            <div className="flex items-center gap-2 rounded border p-2">
              <Switch checked={leg.permitRequired} onCheckedChange={(v) => update({ permitRequired: v })} className="scale-75" />
              <Label className="text-xs">Permit</Label>
            </div>
            <div className="flex items-center gap-2 rounded border p-2">
              <Switch checked={leg.pprRequired} onCheckedChange={(v) => update({ pprRequired: v })} className="scale-75" />
              <Label className="text-xs">PPR</Label>
            </div>
            <div className="flex items-center gap-2 rounded border p-2">
              <Switch checked={leg.customsAvailable} onCheckedChange={(v) => update({ customsAvailable: v })} className="scale-75" />
              <Label className="text-xs">Customs</Label>
            </div>
          </div>

          {/* Lookup Results */}
          <div className="space-y-2">
            {/* CBP */}
            {leg.cbpResult && (
              <div className={cn("rounded-md border p-3 text-sm space-y-1.5", leg.cbpResult.found ? "border-success/30 bg-success/5" : "border-muted bg-muted/50")}>
                <div className="flex items-center gap-1.5 font-medium">
                  {leg.cbpResult.found ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <AlertTriangle className="h-3.5 w-3.5 text-warning" />}
                  {leg.cbpResult.airportName ? `${leg.cbpResult.airportName} (${leg.cbpResult.icao})` : leg.cbpResult.icao}
                </div>
                <p className="text-muted-foreground text-xs">{leg.cbpResult.message}</p>
                {leg.cbpResult.operatingHours && (
                  <div className="rounded bg-background/50 px-2 py-1.5 text-xs space-y-0.5">
                    <p className="font-medium">CBP Hours:</p>
                    <p>{leg.cbpResult.operatingHours.open}–{leg.cbpResult.operatingHours.close} ({leg.cbpResult.operatingHours.days})</p>
                  </div>
                )}
                {leg.cbpResult.detailUrl && (
                  <a href={leg.cbpResult.detailUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    View CBP Fact Sheet <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}

            {/* CIQ */}
            {ciqLoading && <div className="rounded-md border p-3 text-sm flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Looking up CIQ…</div>}
            {leg.ciqResult && !ciqLoading && (
              <div className={cn("rounded-md border p-3 text-sm space-y-1.5",
                leg.ciqResult.ciqAvailable === 'yes' ? "border-success/30 bg-success/5" : leg.ciqResult.ciqAvailable === 'no' ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5"
              )}>
                <div className="flex items-center gap-1.5 font-medium">
                  {leg.ciqResult.ciqAvailable === 'yes' ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : leg.ciqResult.ciqAvailable === 'no' ? <XCircle className="h-3.5 w-3.5 text-destructive" /> : <AlertTriangle className="h-3.5 w-3.5 text-warning" />}
                  CIQ — {leg.ciqResult.airportName || leg.ciqResult.country || leg.ciqResult.icao}
                </div>
                <div className="rounded bg-background/50 px-2 py-1.5 text-xs space-y-0.5">
                  {leg.ciqResult.operatingHours && <p><span className="font-medium">Hours:</span> {leg.ciqResult.operatingHours}</p>}
                  {leg.ciqResult.advanceNotice && <p><span className="font-medium">Notice:</span> {leg.ciqResult.advanceNotice}</p>}
                  {leg.ciqResult.notes && <p className="text-muted-foreground italic">{leg.ciqResult.notes}</p>}
                </div>
              </div>
            )}

            {/* Permit */}
            {permitLoading && <div className="rounded-md border p-3 text-sm flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Permit lookup…</div>}
            {leg.permitResult && !permitLoading && (
              <div className={cn("rounded-md border p-3 text-sm space-y-1.5",
                leg.permitResult.permitRequired === 'no' ? "border-success/30 bg-success/5" : leg.permitResult.permitRequired === 'yes' ? "border-warning/30 bg-warning/5" : "border-muted bg-muted/50"
              )}>
                <div className="flex items-center gap-1.5 font-medium">
                  <Shield className="h-3.5 w-3.5 text-primary" />
                  Landing Permit — {leg.permitResult.country || leg.permitResult.icao}
                </div>
                <p className="text-xs font-medium">
                  {leg.permitResult.permitRequired === 'yes' && '⚠️ Landing permit required'}
                  {leg.permitResult.permitRequired === 'no' && '✅ No landing permit required'}
                  {leg.permitResult.permitRequired === 'conditional' && '⚠️ Conditionally required'}
                </p>
                <div className="rounded bg-background/50 px-2 py-1.5 text-xs space-y-0.5">
                  {leg.permitResult.permitType && <p><span className="font-medium">Type:</span> {leg.permitResult.permitType}</p>}
                  {leg.permitResult.leadTimeDays != null && <p><span className="font-medium">Lead time:</span> {leg.permitResult.leadTimeDays} days</p>}
                  {leg.permitResult.issuingAuthority && <p><span className="font-medium">Authority:</span> {leg.permitResult.issuingAuthority}</p>}
                  {leg.permitResult.conditions && <p><span className="font-medium">Conditions:</span> {leg.permitResult.conditions}</p>}
                  {leg.permitResult.notes && <p className="text-muted-foreground italic">{leg.permitResult.notes}</p>}
                </div>
              </div>
            )}

            {/* PPR */}
            {pprLoading && <div className="rounded-md border p-3 text-sm flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />PPR lookup…</div>}
            {leg.pprResult && !pprLoading && (
              <div className={cn("rounded-md border p-3 text-sm space-y-1.5",
                leg.pprResult.pprRequired === 'no' ? "border-success/30 bg-success/5" : leg.pprResult.pprRequired === 'yes' ? "border-warning/30 bg-warning/5" : "border-muted bg-muted/50"
              )}>
                <div className="flex items-center gap-1.5 font-medium">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  PPR — {leg.pprResult.airportName || leg.pprResult.icao}
                </div>
                <div className="rounded bg-background/50 px-2 py-1.5 text-xs space-y-0.5">
                  {leg.pprResult.advanceNoticePeriod && <p><span className="font-medium">Notice:</span> {leg.pprResult.advanceNoticePeriod}</p>}
                  {leg.pprResult.contactDetails && <p><span className="font-medium">Contact:</span> {leg.pprResult.contactDetails}</p>}
                  {leg.pprResult.slotRequired !== undefined && <p><span className="font-medium">Slot:</span> {leg.pprResult.slotRequired ? 'Required' : 'Not required'}</p>}
                  {leg.pprResult.notes && <p className="text-muted-foreground italic">{leg.pprResult.notes}</p>}
                </div>
              </div>
            )}

            {/* Runway */}
            {leg.runwayResult && (
              <div className={cn("rounded-md border p-3 text-sm space-y-1.5", leg.runwayResult.found ? "border-success/30 bg-success/5" : "border-muted bg-muted/50")}>
                <div className="flex items-center gap-1.5 font-medium">
                  <Ruler className="h-3.5 w-3.5 text-primary" />
                  Runway Data
                </div>
                <p className="text-muted-foreground text-xs">{leg.runwayResult.message}</p>
                {leg.runwayResult.runways.length > 0 && (
                  <div className="rounded bg-background/50 px-2 py-1.5 text-xs space-y-0.5">
                    {leg.runwayResult.runways.map((rwy, i) => (
                      <p key={i}><span className="font-mono font-medium">{rwy.ident}</span> — {rwy.lengthFt.toLocaleString()} ft × {rwy.widthFt} ft · {rwy.surface}{rwy.lighted && " · Lighted"}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Charges */}
            {chargesLoading && <div className="rounded-md border p-3 text-sm flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Estimating charges…</div>}
            {leg.chargesResult && !chargesLoading && (
              <div className={cn("rounded-md border p-3 text-sm space-y-1.5", leg.chargesResult.success ? "border-primary/30 bg-primary/5" : "border-muted bg-muted/50")}>
                <div className="flex items-center gap-1.5 font-medium">
                  <DollarSign className="h-3.5 w-3.5 text-primary" />
                  Charges — {leg.chargesResult.airportName || leg.chargesResult.icao}
                </div>
                {leg.chargesResult.success && (
                  <div className="rounded bg-background/50 px-2 py-1.5 text-xs space-y-0.5">
                    {leg.chargesResult.mtowKg && <p className="text-muted-foreground">MTOW: {leg.chargesResult.mtowKg.toLocaleString()} kg</p>}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1">
                      <p><span className="font-medium">Landing:</span></p>
                      <p className="text-right font-mono">${leg.chargesResult.landingFeeUsd?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—'}</p>
                      <p><span className="font-medium">Parking/day:</span></p>
                      <p className="text-right font-mono">${leg.chargesResult.parkingPerDayUsd?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—'}</p>
                      {leg.chargesResult.parkingDays != null && leg.chargesResult.totalParkingUsd != null && (
                        <>
                          <p><span className="font-medium">Parking ({leg.chargesResult.parkingDays}d):</span></p>
                          <p className="text-right font-mono">${leg.chargesResult.totalParkingUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                        </>
                      )}
                    </div>
                    {leg.chargesResult.surcharges && <p className="pt-1"><span className="font-medium">Surcharges:</span> {leg.chargesResult.surcharges}</p>}
                    {leg.chargesResult.nightSurchargeApplies && <p className="text-warning text-xs">⚠️ Night surcharge applies</p>}
                    <div className="pt-1 border-t mt-1 flex justify-between font-medium">
                      <span>Total:</span>
                      <span className="font-mono text-primary">${leg.chargesResult.totalEstimateUsd?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—'}</span>
                    </div>
                    {leg.chargesResult.notes && <p className="text-muted-foreground italic pt-1">{leg.chargesResult.notes}</p>}
                  </div>
                )}
                {leg.chargesResult.error && <p className="text-xs text-destructive">{leg.chargesResult.error}</p>}
              </div>
            )}

            {/* Airport Hours & NOTAMs */}
            {hoursLoading && <div className="rounded-md border p-3 text-sm flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking airport hours & NOTAMs…</div>}
            {leg.airportHoursResult && !hoursLoading && (
              <div className={cn("rounded-md border p-3 text-sm space-y-1.5",
                leg.airportHoursResult.success
                  ? (leg.airportHoursResult.arrivalOutsideHours || leg.airportHoursResult.departureOutsideHours || leg.airportHoursResult.arrivalDuringCurfew || leg.airportHoursResult.departureDuringCurfew)
                    ? "border-destructive/30 bg-destructive/5"
                    : "border-success/30 bg-success/5"
                  : "border-muted bg-muted/50"
              )}>
                <div className="flex items-center gap-1.5 font-medium">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  Airport Hours — {leg.airportHoursResult.airportName || leg.airportHoursResult.icao}
                  {leg.airportHoursResult.hasLiveNotamData && (
                    <span className="text-[10px] font-normal bg-primary/10 text-primary px-1.5 py-0.5 rounded">Live NOTAMs</span>
                  )}
                </div>

                {leg.airportHoursResult.success && (
                  <div className="rounded bg-background/50 px-2 py-1.5 text-xs space-y-1">
                    {leg.airportHoursResult.is24Hours ? (
                      <p className="text-success font-medium">✅ 24-hour operations</p>
                    ) : leg.airportHoursResult.operatingHoursOpen && leg.airportHoursResult.operatingHoursClose ? (
                      <p><span className="font-medium">Hours:</span> {leg.airportHoursResult.operatingHoursOpen}–{leg.airportHoursResult.operatingHoursClose} UTC ({leg.airportHoursResult.operatingDays})</p>
                    ) : null}

                    {leg.airportHoursResult.curfewStart && leg.airportHoursResult.curfewEnd && (
                      <p className="text-warning"><span className="font-medium">⚠️ Curfew:</span> {leg.airportHoursResult.curfewStart}–{leg.airportHoursResult.curfewEnd} UTC{leg.airportHoursResult.curfewNotes ? ` — ${leg.airportHoursResult.curfewNotes}` : ''}</p>
                    )}

                    {leg.airportHoursResult.arrivalOutsideHours && (
                      <p className="text-destructive font-medium">❌ Arrival is outside operating hours</p>
                    )}
                    {leg.airportHoursResult.departureOutsideHours && (
                      <p className="text-destructive font-medium">❌ Departure is outside operating hours</p>
                    )}
                    {leg.airportHoursResult.arrivalDuringCurfew && (
                      <p className="text-destructive font-medium">❌ Arrival falls during curfew</p>
                    )}
                    {leg.airportHoursResult.departureDuringCurfew && (
                      <p className="text-destructive font-medium">❌ Departure falls during curfew</p>
                    )}

                    {/* Active NOTAMs */}
                    {leg.airportHoursResult.activeNotams && leg.airportHoursResult.activeNotams.length > 0 && (
                      <div className="space-y-1 pt-1 border-t mt-1">
                        <p className="font-medium">Active NOTAMs ({leg.airportHoursResult.activeNotams.length}):</p>
                        {leg.airportHoursResult.activeNotams.map((notam, ni) => (
                          <div key={ni} className={cn("rounded px-2 py-1",
                            notam.affectsOperations ? "bg-warning/10 border-l-2 border-l-warning" : "bg-muted/30 border-l-2 border-l-muted-foreground/30"
                          )}>
                            <p className="font-medium">
                              {notam.type === 'closure' ? '🔴' : notam.type === 'restriction' ? '🟡' : notam.type === 'runway_closure' ? '🟠' : 'ℹ️'} {notam.summary}
                            </p>
                            {(notam.effectiveFrom || notam.effectiveTo) && (
                              <p className="text-muted-foreground">{notam.effectiveFrom || '?'} → {notam.effectiveTo || 'UFN'}</p>
                            )}
                            {notam.id && <p className="text-muted-foreground text-[10px]">ID: {notam.id}</p>}
                          </div>
                        ))}
                      </div>
                    )}

                    {leg.airportHoursResult.seasonalRestrictions && (
                      <p className="text-warning"><span className="font-medium">Seasonal:</span> {leg.airportHoursResult.seasonalRestrictions}</p>
                    )}
                    {leg.airportHoursResult.notes && <p className="text-muted-foreground italic">{leg.airportHoursResult.notes}</p>}
                  </div>
                )}

                {leg.airportHoursResult.confidence && (
                  <p className="text-[10px] text-muted-foreground">Confidence: {leg.airportHoursResult.confidence}</p>
                )}
                {leg.airportHoursResult.error && <p className="text-xs text-destructive">{leg.airportHoursResult.error}</p>}
              </div>
            )}
          </div>

          {/* Feasibility Result */}
          {feasResult && (
            <div className={cn("rounded-lg border-2 p-4 space-y-2", feasResult.feasible ? "border-success/40 bg-success/5" : "border-destructive/40 bg-destructive/5")}>
              <div className="flex items-center gap-2">
                {feasResult.feasible ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
                <span className="font-semibold text-sm">{feasResult.feasible ? "Feasible" : "Flight is not feasible based on published information. Contact your service provider to validate information."}</span>
              </div>
              {feasResult.issues.map((issue, i) => (
                <p key={i} className="flex items-start gap-2 text-xs text-destructive"><XCircle className="mt-0.5 h-3 w-3 shrink-0" />{issue}</p>
              ))}
              {feasResult.notes.map((note, i) => (
                <p key={i} className="flex items-start gap-2 text-xs text-warning"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{note}</p>
              ))}
            </div>
          )}

          {/* Remove Leg */}
          {totalLegs > 1 && (
            <>
              <Separator />
              <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveLeg(legIndex)} className="text-xs text-destructive hover:text-destructive">
                Remove Leg {legIndex + 1}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
