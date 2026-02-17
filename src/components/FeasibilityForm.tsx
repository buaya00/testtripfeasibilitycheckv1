import { useState, useCallback } from "react";
import { format } from "date-fns";
import { CalendarIcon, Plane, CheckCircle2, XCircle, AlertTriangle, Search, Loader2, ExternalLink, Ruler } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { AIRCRAFT_RUNWAY_REQ, AIRCRAFT_CATEGORIES } from "@/data/aircraftData";
import { SelectGroup, SelectLabel } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

// ── Types ──────────────────────────────────────────────────

interface FeasibilityData {
  aircraftType: string;
  airportIcao: string;
  arrivalDate: Date | undefined;
  arrivalTime: string;
  departureDate: Date | undefined;
  departureTime: string;
  permitRequired: boolean;
  pprRequired: boolean;
  customsAvailable: boolean;
  runwayOverrideFt: string; // manual override
}

interface FeasibilityResult {
  feasible: boolean;
  issues: string[];
  notes: string[];
}

interface OperatingHours {
  open: string;
  close: string;
  days: string;
  notes: string;
  raw: string;
}

interface CbpResult {
  success: boolean;
  found: boolean;
  icao: string;
  airportName: string | null;
  customsAvailable: boolean;
  detailUrl: string | null;
  pdfUrl: string | null;
  message: string;
  operatingHours: OperatingHours | null;
  error?: string;
}

interface RunwayInfo {
  id: string;
  lengthFt: number;
  widthFt: number;
  surface: string;
  lighted: boolean;
  ident: string;
}

interface RunwayResult {
  success: boolean;
  found: boolean;
  icao: string;
  airportName: string | null;
  runways: RunwayInfo[];
  longestRunwayFt: number | null;
  message: string;
  error?: string;
}

// Aircraft data imported from @/data/aircraftData

// ── Helpers ────────────────────────────────────────────────

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

function evaluateFeasibility(
  data: FeasibilityData,
  cbpHours: OperatingHours | null,
  runwayLengthFt: number | null,
): FeasibilityResult {
  const issues: string[] = [];
  const notes: string[] = [];

  if (!data.aircraftType) issues.push("Aircraft type not specified");
  if (!data.airportIcao) issues.push("Airport ICAO code not specified");
  if (data.airportIcao && !/^[A-Z]{4}$/.test(data.airportIcao.toUpperCase())) issues.push("ICAO code must be exactly 4 letters");
  if (!data.arrivalDate) issues.push("Arrival date not set");
  if (!data.departureDate) issues.push("Departure date not set");
  if (!data.arrivalTime) issues.push("Arrival time not set");
  if (!data.departureTime) issues.push("Departure time not set");

  if (data.arrivalDate && data.departureDate && data.arrivalDate > data.departureDate) {
    issues.push("Departure date is before arrival date");
  }

  if (data.permitRequired) notes.push("Landing permit must be obtained prior to ops");
  if (data.pprRequired) notes.push("Prior Permission Required — contact airport ops");
  if (!data.customsAvailable) issues.push("Customs not available at this airport");

  // CBP hours check
  if (cbpHours && cbpHours.open && cbpHours.close && data.customsAvailable) {
    if (data.arrivalTime && !isTimeInRange(data.arrivalTime, cbpHours.open, cbpHours.close)) {
      issues.push(`Arrival time ${data.arrivalTime} is outside CBP hours (${cbpHours.open}–${cbpHours.close})`);
    }
    if (data.departureTime && !isTimeInRange(data.departureTime, cbpHours.open, cbpHours.close)) {
      issues.push(`Departure time ${data.departureTime} is outside CBP hours (${cbpHours.open}–${cbpHours.close})`);
    }
    if (cbpHours.notes) {
      notes.push(`CBP note: ${cbpHours.notes}`);
    }
  }

  // Runway length check
  const requiredFt = data.aircraftType ? AIRCRAFT_RUNWAY_REQ[data.aircraftType] : undefined;
  if (requiredFt && runwayLengthFt) {
    if (runwayLengthFt < requiredFt) {
      issues.push(
        `Runway too short: ${runwayLengthFt.toLocaleString()} ft available, ${data.aircraftType} requires ~${requiredFt.toLocaleString()} ft`
      );
    } else {
      const margin = runwayLengthFt - requiredFt;
      notes.push(
        `Runway OK: ${runwayLengthFt.toLocaleString()} ft available (${margin.toLocaleString()} ft margin for ${data.aircraftType})`
      );
    }
  } else if (requiredFt && !runwayLengthFt) {
    notes.push(`${data.aircraftType} requires ~${requiredFt.toLocaleString()} ft — runway data not available, verify manually`);
  } else if (data.aircraftType === "Other") {
    notes.push("Runway requirement unknown for custom aircraft — verify manually");
  }

  if (data.customsAvailable && (data.permitRequired || data.pprRequired)) {
    notes.push("Allow additional lead time for permit/PPR processing");
  }

  return {
    feasible: issues.length === 0,
    issues,
    notes,
  };
}

// ── Constants ──────────────────────────────────────────────

const TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});

// ── Component ──────────────────────────────────────────────

export default function FeasibilityForm() {
  const [data, setData] = useState<FeasibilityData>({
    aircraftType: "",
    airportIcao: "",
    arrivalDate: undefined,
    arrivalTime: "",
    departureDate: undefined,
    departureTime: "",
    permitRequired: false,
    pprRequired: false,
    customsAvailable: true,
    runwayOverrideFt: "",
  });

  const [result, setResult] = useState<FeasibilityResult | null>(null);
  const [cbpResult, setCbpResult] = useState<CbpResult | null>(null);
  const [cbpLoading, setCbpLoading] = useState(false);
  const [runwayResult, setRunwayResult] = useState<RunwayResult | null>(null);
  const [runwayLoading, setRunwayLoading] = useState(false);

  const handleCbpLookup = useCallback(async () => {
    if (data.airportIcao.length !== 4) return;
    setCbpLoading(true);
    setCbpResult(null);
    try {
      const { data: res, error } = await supabase.functions.invoke('cbp-lookup', {
        body: { icao: data.airportIcao },
      });
      if (error) {
        setCbpResult({ success: false, found: false, icao: data.airportIcao, airportName: null, customsAvailable: false, detailUrl: null, pdfUrl: null, message: '', operatingHours: null, error: error.message });
      } else {
        setCbpResult(res as CbpResult);
        if (res?.found !== undefined) {
          setData(prev => ({ ...prev, customsAvailable: res.customsAvailable }));
        }
      }
    } catch (e) {
      setCbpResult({ success: false, found: false, icao: data.airportIcao, airportName: null, customsAvailable: false, detailUrl: null, pdfUrl: null, message: '', operatingHours: null, error: 'Failed to connect' });
    } finally {
      setCbpLoading(false);
    }
  }, [data.airportIcao]);

  const handleRunwayLookup = useCallback(async () => {
    if (data.airportIcao.length !== 4) return;
    setRunwayLoading(true);
    setRunwayResult(null);
    try {
      const { data: res, error } = await supabase.functions.invoke('runway-lookup', {
        body: { icao: data.airportIcao },
      });
      if (error) {
        setRunwayResult({ success: false, found: false, icao: data.airportIcao, airportName: null, runways: [], longestRunwayFt: null, message: '', error: error.message });
      } else {
        setRunwayResult(res as RunwayResult);
      }
    } catch {
      setRunwayResult({ success: false, found: false, icao: data.airportIcao, airportName: null, runways: [], longestRunwayFt: null, message: '', error: 'Failed to connect' });
    } finally {
      setRunwayLoading(false);
    }
  }, [data.airportIcao]);

  const handleLookupAll = useCallback(async () => {
    if (data.airportIcao.length !== 4) return;
    handleCbpLookup();
    handleRunwayLookup();
  }, [data.airportIcao, handleCbpLookup, handleRunwayLookup]);

  const effectiveRunwayFt: number | null =
    data.runwayOverrideFt && parseInt(data.runwayOverrideFt, 10) > 0
      ? parseInt(data.runwayOverrideFt, 10)
      : runwayResult?.longestRunwayFt ?? null;

  const handleCheck = () => {
    setResult(evaluateFeasibility(data, cbpResult?.operatingHours ?? null, effectiveRunwayFt));
  };

  const handleReset = () => {
    setData({
      aircraftType: "",
      airportIcao: "",
      arrivalDate: undefined,
      arrivalTime: "",
      departureDate: undefined,
      departureTime: "",
      permitRequired: false,
      pprRequired: false,
      customsAvailable: true,
      runwayOverrideFt: "",
    });
    setResult(null);
    setCbpResult(null);
    setRunwayResult(null);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
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

      <main className="container mx-auto max-w-3xl px-6 py-8">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Flight Operations Check</CardTitle>
            <p className="text-sm text-muted-foreground">
              Enter flight details to assess operational feasibility.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Aircraft Type */}
            <div className="space-y-2">
              <Label htmlFor="aircraft">Aircraft Type</Label>
              <Select
                value={data.aircraftType}
                onValueChange={(v) => setData({ ...data, aircraftType: v })}
              >
                <SelectTrigger id="aircraft">
                  <SelectValue placeholder="Select aircraft type" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {AIRCRAFT_CATEGORIES.map((cat) => (
                    <SelectGroup key={cat.label}>
                      <SelectLabel className="text-xs font-semibold text-muted-foreground">{cat.label}</SelectLabel>
                      {cat.types.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              {data.aircraftType && AIRCRAFT_RUNWAY_REQ[data.aircraftType] && (
                <p className="text-xs text-muted-foreground">
                  Takeoff distance required: ~{AIRCRAFT_RUNWAY_REQ[data.aircraftType].toLocaleString()} ft
                </p>
              )}
            </div>

            {/* Airport ICAO */}
            <div className="space-y-2">
              <Label htmlFor="icao">Airport ICAO Code</Label>
              <div className="flex gap-2">
                <Input
                  id="icao"
                  placeholder="e.g. KJFK"
                  maxLength={4}
                  value={data.airportIcao}
                  onChange={(e) => {
                    setData({ ...data, airportIcao: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") });
                    setCbpResult(null);
                    setRunwayResult(null);
                  }}
                  className="font-mono uppercase tracking-widest"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleLookupAll}
                  disabled={data.airportIcao.length !== 4 || cbpLoading || runwayLoading}
                  className="shrink-0"
                >
                  {(cbpLoading || runwayLoading) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  <span className="ml-1.5">Lookup</span>
                </Button>
              </div>

              {/* CBP Result */}
              {cbpResult && (
                <div className={cn(
                  "rounded-md border p-3 text-sm space-y-1.5",
                  cbpResult.found ? "border-success/30 bg-success/5" : "border-muted bg-muted/50"
                )}>
                  <div className="flex items-center gap-1.5 font-medium">
                    {cbpResult.found ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                    )}
                    {cbpResult.airportName
                      ? `${cbpResult.airportName} (${cbpResult.icao})`
                      : cbpResult.icao}
                  </div>
                   <p className="text-muted-foreground text-xs">{cbpResult.message}</p>
                   {cbpResult.operatingHours && (
                     <div className="rounded bg-background/50 px-2 py-1.5 text-xs space-y-0.5">
                       <p className="font-medium">CBP Operating Hours:</p>
                       <p>{cbpResult.operatingHours.open}–{cbpResult.operatingHours.close} ({cbpResult.operatingHours.days})</p>
                       {cbpResult.operatingHours.notes && (
                         <p className="text-muted-foreground italic">{cbpResult.operatingHours.notes}</p>
                       )}
                       {cbpResult.operatingHours.raw && (
                         <p className="text-muted-foreground">Source: "{cbpResult.operatingHours.raw}"</p>
                       )}
                     </div>
                   )}
                   {cbpResult.detailUrl && (
                     <a
                       href={cbpResult.detailUrl}
                       target="_blank"
                       rel="noopener noreferrer"
                       className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                     >
                       View CBP Fact Sheet <ExternalLink className="h-3 w-3" />
                     </a>
                   )}
                   {cbpResult.error && (
                     <p className="text-xs text-destructive">{cbpResult.error}</p>
                   )}
                </div>
              )}

              {/* Runway Result */}
              {runwayResult && (
                <div className={cn(
                  "rounded-md border p-3 text-sm space-y-1.5",
                  runwayResult.found ? "border-success/30 bg-success/5" : "border-muted bg-muted/50"
                )}>
                  <div className="flex items-center gap-1.5 font-medium">
                    <Ruler className="h-3.5 w-3.5 text-primary" />
                    Runway Data
                  </div>
                  <p className="text-muted-foreground text-xs">{runwayResult.message}</p>
                  {runwayResult.runways.length > 0 && (
                    <div className="rounded bg-background/50 px-2 py-1.5 text-xs space-y-0.5">
                      {runwayResult.runways.map((rwy, i) => (
                        <p key={i}>
                          <span className="font-mono font-medium">{rwy.ident}</span>
                          {" — "}
                          {rwy.lengthFt.toLocaleString()} ft × {rwy.widthFt} ft
                          {" · "}{rwy.surface}
                          {rwy.lighted && " · Lighted"}
                        </p>
                      ))}
                    </div>
                  )}
                  {runwayResult.error && (
                    <p className="text-xs text-destructive">{runwayResult.error}</p>
                  )}
                </div>
              )}
            </div>

            {/* Runway Override */}
            <div className="space-y-2">
              <Label htmlFor="runway-override">Runway Length Override (ft)</Label>
              <Input
                id="runway-override"
                type="number"
                placeholder={runwayResult?.longestRunwayFt ? `Auto: ${runwayResult.longestRunwayFt.toLocaleString()} ft` : "Enter runway length in feet"}
                value={data.runwayOverrideFt}
                onChange={(e) => setData({ ...data, runwayOverrideFt: e.target.value })}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                {data.runwayOverrideFt
                  ? `Using manual override: ${parseInt(data.runwayOverrideFt, 10).toLocaleString()} ft`
                  : runwayResult?.longestRunwayFt
                    ? `Using auto-fetched longest runway: ${runwayResult.longestRunwayFt.toLocaleString()} ft`
                    : "Enter an ICAO code and run lookup, or enter runway length manually"}
              </p>
            </div>

            <Separator />

            {/* Arrival */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Arrival
              </Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="arr-date" className="text-xs">Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        id="arr-date"
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !data.arrivalDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {data.arrivalDate ? format(data.arrivalDate, "dd MMM yyyy") : "Select date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={data.arrivalDate}
                        onSelect={(d) => setData({ ...data, arrivalDate: d })}
                        initialFocus
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="arr-time" className="text-xs">Time (UTC)</Label>
                  <Select
                    value={data.arrivalTime}
                    onValueChange={(v) => setData({ ...data, arrivalTime: v })}
                  >
                    <SelectTrigger id="arr-time">
                      <SelectValue placeholder="HH:MM" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMES.map((t) => (
                        <SelectItem key={`arr-${t}`} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Departure */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Departure
              </Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="dep-date" className="text-xs">Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        id="dep-date"
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !data.departureDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {data.departureDate ? format(data.departureDate, "dd MMM yyyy") : "Select date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={data.departureDate}
                        onSelect={(d) => setData({ ...data, departureDate: d })}
                        initialFocus
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="dep-time" className="text-xs">Time (UTC)</Label>
                  <Select
                    value={data.departureTime}
                    onValueChange={(v) => setData({ ...data, departureTime: v })}
                  >
                    <SelectTrigger id="dep-time">
                      <SelectValue placeholder="HH:MM" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMES.map((t) => (
                        <SelectItem key={`dep-${t}`} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            {/* Toggles */}
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label htmlFor="permit" className="font-medium">Permit Required</Label>
                  <p className="text-xs text-muted-foreground">Landing/overflight permit needed</p>
                </div>
                <Switch
                  id="permit"
                  checked={data.permitRequired}
                  onCheckedChange={(v) => setData({ ...data, permitRequired: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label htmlFor="ppr" className="font-medium">PPR Required</Label>
                  <p className="text-xs text-muted-foreground">Prior Permission Required from airport</p>
                </div>
                <Switch
                  id="ppr"
                  checked={data.pprRequired}
                  onCheckedChange={(v) => setData({ ...data, pprRequired: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label htmlFor="customs" className="font-medium">Customs Available</Label>
                  <p className="text-xs text-muted-foreground">Customs & immigration services at airport</p>
                </div>
                <Switch
                  id="customs"
                  checked={data.customsAvailable}
                  onCheckedChange={(v) => setData({ ...data, customsAvailable: v })}
                />
              </div>
            </div>

            <Separator />

            {/* Actions */}
            <div className="flex gap-3">
              <Button onClick={handleCheck} className="flex-1">
                Check Feasibility
              </Button>
              <Button variant="outline" onClick={handleReset}>
                Reset
              </Button>
            </div>

            {/* Result */}
            {result && (
              <div
                className={cn(
                  "rounded-lg border-2 p-5 space-y-3",
                  result.feasible
                    ? "border-success/40 bg-success/5"
                    : "border-destructive/40 bg-destructive/5"
                )}
              >
                <div className="flex items-center gap-2">
                  {result.feasible ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                  <span className="font-semibold">
                    {result.feasible ? "Operations Feasible" : "Issues Detected"}
                  </span>
                </div>

                {result.issues.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {result.issues.map((issue, i) => (
                      <li key={i} className="flex items-start gap-2 text-destructive">
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {issue}
                      </li>
                    ))}
                  </ul>
                )}

                {result.notes.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {result.notes.map((note, i) => (
                      <li key={i} className="flex items-start gap-2 text-warning">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {note}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
