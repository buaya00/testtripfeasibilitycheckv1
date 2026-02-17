import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Plane, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

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
}

interface FeasibilityResult {
  feasible: boolean;
  issues: string[];
  notes: string[];
}

function evaluateFeasibility(data: FeasibilityData): FeasibilityResult {
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

  if (data.customsAvailable && (data.permitRequired || data.pprRequired)) {
    notes.push("Allow additional lead time for permit/PPR processing");
  }

  return {
    feasible: issues.length === 0,
    issues,
    notes,
  };
}

const AIRCRAFT_TYPES = [
  "A320", "A330", "A340", "A350", "A380",
  "B737", "B747", "B757", "B767", "B777", "B787",
  "CRJ-200", "CRJ-700", "CRJ-900",
  "ERJ-145", "E170", "E190",
  "ATR 42", "ATR 72",
  "Cessna 172", "Cessna Citation",
  "Gulfstream G550", "Gulfstream G650",
  "Bombardier Global 6000",
  "Pilatus PC-12",
  "Other",
];

const TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});

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
  });

  const [result, setResult] = useState<FeasibilityResult | null>(null);

  const handleCheck = () => {
    setResult(evaluateFeasibility(data));
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
    });
    setResult(null);
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
                <SelectContent>
                  {AIRCRAFT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Airport ICAO */}
            <div className="space-y-2">
              <Label htmlFor="icao">Airport ICAO Code</Label>
              <Input
                id="icao"
                placeholder="e.g. EGLL"
                maxLength={4}
                value={data.airportIcao}
                onChange={(e) =>
                  setData({ ...data, airportIcao: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })
                }
                className="font-mono uppercase tracking-widest"
              />
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
