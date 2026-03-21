import { useCallback, useState, useEffect } from "react";
import { format } from "date-fns";
import {
  CalendarIcon, CheckCircle2, XCircle, AlertTriangle, Search, Loader2,
  ExternalLink, PlaneLanding, Shield, DollarSign, Clock, ChevronDown, ChevronUp,
  FileText, Plus, Trash2, Tag, ShieldCheck, ClipboardList, Building2, Timer, RefreshCw, Plane,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { AIRCRAFT_RUNWAY_REQ, AIRCRAFT_MTOW_KG, getMtowCategory } from "@/data/aircraftData";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type {
  LegData, CbpResult, RunwayResult, PermitResult, CiqResult,
  ChargesResult, PprResult, FeasibilityResult, OperatingHours,
  AirportHoursResult, AegAdHocService, OverflightResult,
} from "./tripTypes";

// ── Feature flag: set to true to show AEG Set Up Fees section ──
const SHOW_AEG_FEES = false;

// ── AEG RSP (Registered Service Provider) airports ──
const AEG_RSP_AIRPORTS = new Set([
  'KSJC','KRNO','KBDL','KAUS','KCHS','KTPA','KSLC','KTEB','KOKC','KFPR',
  'KFOK','KFRG','KISP','KLAX','KMDW','KILG','KCLT','KCLE','KIND','KMEM',
  'KOPF','KPBI','KPDX','KHPN','KBGR','KDEN','PAFA','KFTY','KIAH','KSAV',
  'KCMH','KMSY','KTMB','KBNA','KMCO','KPHX','KSAT','KSFO','KRSW','KHUM',
  'KBFI','KCVG','KBOS','KPDK','KBWI','KDSM','KOMA','KGYY','KGRR','KMKE',
  'KJAX','KOAK','KMSP','KNUQ','KPIT','KMCI','PHOG','KMKC','PHKO','KSDF',
  'KBTR','KRDU','KSTP','KICT','KABQ','KATL','KLGA','KBHM','KGTF','KTUL',
  'KSUS','KALB','KLIT','KBTV','KPIA','KABE','KPVD','KSTL','KPAE','KDLH',
  'KHEF','KPWM','KPSM','KGEG','KILM','KRYY','KRAC','KJFK','KDTW','KGPT',
  'KHIO','KIAD','KMBS','KRIC','KSDM','KRFD','KBUF','KORD','KMDT','KMOT',
  'KTYS','KLUK','KCPR','KAZO','TJSJ','TIST','KFXE','KGSO','KFAR','KNEW',
  'KNYL','KTUS','KSMF','PANC','KEWR','KPHL','KHOU','KBRO','KELP','KGPI',
  'KDRT','KMFE','KEYW','KBOI','KPIE','KSEA',
]);

// ── Constants ──────────────────────────────────────────────
const TIMES = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, "0");
  const m = ["00", "15", "30", "45"][i % 4];
  return `${h}:${m}`;
});

// ── UTC ↔ Local conversion helpers ─────────────────────────
function utcToLocal(utcTime: string, offsetHours: number): string {
  if (!utcTime) return "";
  const [h, m] = utcTime.split(":").map(Number);
  const totalMin = h * 60 + m + Math.round(offsetHours * 60);
  const wrapped = ((totalMin % 1440) + 1440) % 1440;
  const lh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const lm = String(wrapped % 60).padStart(2, "0");
  return `${lh}:${lm}`;
}

function localToUtc(localTime: string, offsetHours: number): string {
  if (!localTime) return "";
  const [h, m] = localTime.split(":").map(Number);
  const totalMin = h * 60 + m - Math.round(offsetHours * 60);
  const wrapped = ((totalMin % 1440) + 1440) % 1440;
  const uh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const um = String(wrapped % 60).padStart(2, "0");
  return `${uh}:${um}`;
}

function formatOffset(offsetHours: number): string {
  if (isNaN(offsetHours) || offsetHours === 0) return "Local";
  const sign = offsetHours > 0 ? "+" : "−";
  const abs = Math.abs(offsetHours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, "0")}`;
}

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

/** Returns true if the given date+utcTime combination is in the past */
function isDateTimeInPast(date: Date | undefined, utcTime: string): boolean {
  if (!date || !utcTime) return false;
  const now = new Date();
  const [h, m] = utcTime.split(':').map(Number);
  const dt = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), h, m));
  return dt.getTime() < now.getTime();
}

/** Returns true if a date is before today (UTC) */
function isDateInPast(date: Date): boolean {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dateUtc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  return dateUtc.getTime() < todayUtc.getTime();
}

const PAST_DATE_MSG = "Past dates and times are not allowed. Please select a current or future value.";

function isUsAirport(icao: string) {
  return icao.startsWith('K') || icao.startsWith('PA') || icao.startsWith('PH') || icao.startsWith('PG') || icao.startsWith('TJ');
}

// UK ICAO prefix: EG
// EU member state ICAO prefixes (ICAO Doc 7910 regions)
const UK_EU_PREFIXES = [
  'EG',                          // United Kingdom
  'EB',                          // Belgium
  'ED', 'ET',                    // Germany
  'EE',                          // Estonia
  'EF',                          // Finland
  'EH',                          // Netherlands
  'EI',                          // Ireland
  'EK',                          // Denmark
  'EL',                          // Luxembourg
  'EP',                          // Poland
  'ES',                          // Sweden
  'EV',                          // Latvia
  'EY',                          // Lithuania
  'LB',                          // Bulgaria
  'LC',                          // Cyprus
  'LD',                          // Croatia
  'LE',                          // Spain
  'LF',                          // France
  'LG',                          // Greece
  'LH',                          // Hungary
  'LI',                          // Italy
  'LJ',                          // Slovenia
  'LK',                          // Czech Republic
  'LO',                          // Austria
  'LP',                          // Portugal
  'LR',                          // Romania
  'LZ',                          // Slovakia
  'LX',                          // Gibraltar (UK)
];

function isUkOrEuAirport(icao: string): boolean {
  if (!icao || icao.length < 2) return false;
  const upper = icao.toUpperCase();
  return UK_EU_PREFIXES.some(prefix => upper.startsWith(prefix));
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

  // Past date/time validation
  if (showArrival && leg.arrivalDate && isDateInPast(leg.arrivalDate)) {
    issues.push("Arrival date is in the past");
  } else if (showArrival && leg.arrivalDate && leg.arrivalTime && isDateTimeInPast(leg.arrivalDate, leg.arrivalTime)) {
    issues.push("Arrival date/time is in the past");
  }
  if (showDeparture && leg.departureDate && isDateInPast(leg.departureDate)) {
    issues.push("Departure date is in the past");
  } else if (showDeparture && leg.departureDate && leg.departureTime && isDateTimeInPast(leg.departureDate, leg.departureTime)) {
    issues.push("Departure date/time is in the past");
  }

  const isUs = leg.airportIcao ? isUsAirport(leg.airportIcao.toUpperCase()) : false;

  if (leg.permitRequired) notes.push("Landing permit must be obtained prior to ops");
  if (leg.pprRequired) notes.push("Prior Permission Required — contact airport ops");
  if (leg.slotRequired) notes.push("Slot coordination required — book slot in advance");
  // Only flag customs as unavailable if a lookup has actually completed (CBP or CIQ)
  // Skip customs availability check for first-leg US departures (no inbound CIQ needed)
  const isFirstLegUsDep = isFirstLeg && totalLegs > 1 && leg.airportIcao && isUsAirport(leg.airportIcao.toUpperCase());
  const customsLookupDone = !!(leg.cbpResult || leg.ciqResult);
  if (!isFirstLegUsDep && customsLookupDone && !leg.customsAvailable) issues.push("Customs not available at this airport");

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
  aircraftNationality?: string;
  overflightResult?: OverflightResult | null;
  previousLegDepartureDate?: Date;
  nextLegIcao?: string;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  onUpdateLeg: (index: number, updates: Partial<LegData>) => void;
  onRemoveLeg: (index: number) => void;
  onRegisterLookup?: (index: number, fn: (() => void) | null) => void;
  onNavigateLeg?: (toIndex: number) => void;
  onRefreshLeg?: (index: number) => void;
  arrivalAutoCalculated?: boolean;
}

export default function TripLegCard({
  leg, legIndex, totalLegs, aircraftType, flightType, aircraftNationality, overflightResult, previousLegDepartureDate, nextLegIcao, expanded: expandedProp, onToggleExpanded, onUpdateLeg, onRemoveLeg, onRegisterLookup, onNavigateLeg, onRefreshLeg, arrivalAutoCalculated,
}: TripLegCardProps) {
  const [localExpanded, setLocalExpanded] = useState(true);
  const expanded = expandedProp !== undefined ? expandedProp : localExpanded;
  const setExpanded = (val: boolean) => {
    if (onToggleExpanded) { onToggleExpanded(); } else { setLocalExpanded(val); }
  };
  const [aegFeesExpanded, setAegFeesExpanded] = useState(false);
  const [cbpLoading, setCbpLoading] = useState(false);
  const [runwayLoading, setRunwayLoading] = useState(false);
  const [permitLoading, setPermitLoading] = useState(false);
  const [ciqLoading, setCiqLoading] = useState(false);
  const [chargesLoading, setChargesLoading] = useState(false);
  const [pprLoading, setPprLoading] = useState(false);
  const [hoursLoading, setHoursLoading] = useState(false);

  const anyLoading = cbpLoading || runwayLoading || permitLoading || ciqLoading || chargesLoading || pprLoading || hoursLoading;

  const update = (updates: Partial<LegData>) => onUpdateLeg(legIndex, updates);

  // Ensure aegServices is initialised (handles legs created before this field existed)
  useEffect(() => {
    if (!leg.aegServices || leg.aegServices.length === 0) {
      import("./tripTypes").then(({ createDefaultAegServices }) => {
        update({ aegServices: createDefaultAegServices(), aegAdHocServices: leg.aegAdHocServices ?? [] });
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legIndex]);

  // Auto-fetch city name as soon as a valid 4-char ICAO is entered
  useEffect(() => {
    if (leg.airportIcao.length !== 4) {
      if (leg.airportCity !== null) update({ airportCity: null });
      return;
    }
    let cancelled = false;
    supabase.functions.invoke('airport-info', { body: { icao: leg.airportIcao } })
      .then(({ data }) => {
        if (!cancelled && data) {
          const updates: Partial<LegData> = {};
          if (data.municipality) updates.airportCity = data.municipality;
          // Use real timezone offset returned by the edge function
          if (typeof data.utcOffsetHours === 'number') {
            updates.utcOffsetHours = data.utcOffsetHours;
          }
          if (Object.keys(updates).length) update(updates);
        }
      })
      .catch(() => {/* silent */});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leg.airportIcao]);

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
        update({ runwayResult: { success: false, found: false, icao: leg.airportIcao, airportName: null, municipality: null, latitude: null, longitude: null, runways: [], longestRunwayFt: null, message: '', error: error.message } });
      } else { update({ runwayResult: res as RunwayResult }); }
    } catch { update({ runwayResult: { success: false, found: false, icao: leg.airportIcao, airportName: null, municipality: null, latitude: null, longitude: null, runways: [], longestRunwayFt: null, message: '', error: 'Failed to connect' } }); }
    finally { setRunwayLoading(false); }
  }, [leg.airportIcao]);

  const handlePermitLookup = useCallback(async () => {
    if (leg.airportIcao.length !== 4) return;
    setPermitLoading(true);
    update({ permitResult: null });
    try {
      const { data: res, error } = await supabase.functions.invoke('permit-lookup', {
        body: {
          icao: leg.airportIcao,
          flightType: flightType || undefined,
          aircraftNationality: aircraftNationality || undefined,
        },
      });
      if (error) {
        let errorMsg = error.message;
        try { const t = await (error as any).context?.text?.(); if (t) { const p = JSON.parse(t); if (p.error) errorMsg = p.error; } } catch { /* ignore */ }
        update({ permitResult: { success: false, icao: leg.airportIcao, error: errorMsg } });
      } else {
        const permitRes = res as PermitResult;
        // Iceland: no landing permit required for private & non-scheduled commercial
        const isIceland = /iceland/i.test(permitRes.country || '');
        const isPrivateOrCharter = flightType === 'private' || flightType === 'non-scheduled-commercial';
        if (isIceland && isPrivateOrCharter && (permitRes.permitRequired === 'yes' || permitRes.permitRequired === 'conditional')) {
          permitRes.permitRequired = 'no';
          permitRes.notes = permitRes.notes
            ? `${permitRes.notes}. No landing permit required for private/non-scheduled commercial flights.`
            : 'No landing permit required for private/non-scheduled commercial flights.';
        }
        // 'conditional' means PPR/slot requirements only — no formal permit required
        update({ permitResult: permitRes, permitRequired: permitRes.permitRequired === 'yes' });
      }
    } catch { update({ permitResult: { success: false, icao: leg.airportIcao, error: 'Failed to connect' } }); }
    finally { setPermitLoading(false); }
  }, [leg.airportIcao, flightType, aircraftNationality]);

  const handleCiqLookup = useCallback(async () => {
    if (leg.airportIcao.length !== 4) return;
    setCiqLoading(true);
    update({ ciqResult: null });
    try {
      const { data: res, error } = await supabase.functions.invoke('ciq-lookup', { body: { icao: leg.airportIcao } });
      if (error) {
        let errorMsg = error.message;
        try { const t = await (error as any).context?.text?.(); if (t) { const p = JSON.parse(t); if (p.error) errorMsg = p.error; } } catch { /* ignore */ }
        update({ ciqResult: { success: false, icao: leg.airportIcao, error: errorMsg } });
      } else { update({ ciqResult: res as CiqResult, ...(res?.ciqAvailable === 'yes' ? { customsAvailable: true } : res?.ciqAvailable === 'no' ? { customsAvailable: false } : {}) }); }
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
      if (error) {
        let errorMsg = error.message;
        try { const t = await (error as any).context?.text?.(); if (t) { const p = JSON.parse(t); if (p.error) errorMsg = p.error; } } catch { /* ignore */ }
        update({ chargesResult: { success: false, icao: leg.airportIcao, error: errorMsg } });
      } else { update({ chargesResult: res as ChargesResult }); }
    } catch { update({ chargesResult: { success: false, icao: leg.airportIcao, error: 'Failed to connect' } }); }
    finally { setChargesLoading(false); }
  }, [leg.airportIcao, aircraftType, leg.arrivalDate, leg.arrivalTime, leg.departureDate, leg.departureTime]);

  const handlePprLookup = useCallback(async () => {
    if (leg.airportIcao.length !== 4) return;
    setPprLoading(true);
    update({ pprResult: null });
    try {
      const { data: res, error } = await supabase.functions.invoke('ppr-lookup', { body: { icao: leg.airportIcao, flightType: flightType || undefined, aircraftType: aircraftType || undefined, airportName: leg.airportCity || undefined } });
      if (error) {
        let errorMsg = error.message;
        try { const t = await (error as any).context?.text?.(); if (t) { const p = JSON.parse(t); if (p.error) errorMsg = p.error; } } catch { /* ignore */ }
        update({ pprResult: { success: false, icao: leg.airportIcao, error: errorMsg } });
      } else {
        const pprRes = res as PprResult;
        // US airports: slots are not required
        if (isUsAirport(leg.airportIcao)) {
          pprRes.slotRequired = false;
        }
        update({ pprResult: pprRes, ...(pprRes?.pprRequired === 'yes' ? { pprRequired: true } : pprRes?.pprRequired === 'no' ? { pprRequired: false } : {}), ...(pprRes?.slotRequired === true ? { slotRequired: true } : pprRes?.slotRequired === false ? { slotRequired: false } : {}) });
      }
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
      if (error) {
        let errorMsg = error.message;
        try { const t = await (error as any).context?.text?.(); if (t) { const p = JSON.parse(t); if (p.error) errorMsg = p.error; } } catch { /* ignore */ }
        update({ airportHoursResult: { success: false, icao: leg.airportIcao, error: errorMsg } });
      } else { update({ airportHoursResult: res as AirportHoursResult }); }
    } catch { update({ airportHoursResult: { success: false, icao: leg.airportIcao, error: 'Failed to connect' } }); }
    finally { setHoursLoading(false); }
  }, [leg.airportIcao, leg.arrivalDate, leg.arrivalTime, leg.departureDate, leg.departureTime, aircraftType, flightType]);

  const isFirstLegUsDeparture = legIndex === 0 && totalLegs > 1 && leg.airportIcao.length === 4 && isUsAirport(leg.airportIcao);
  const isCommercialFlight = flightType === 'non-scheduled-commercial' || flightType === 'commercial';
  const isPrivateFlight = flightType === 'private';
  const isUsDeparture = leg.airportIcao.length === 4 && isUsAirport(leg.airportIcao);
  const isDomesticUsLeg = isUsDeparture && !!nextLegIcao && nextLegIcao.length === 4 && isUsAirport(nextLegIcao);

  const handleLookupAll = useCallback(() => {
    if (leg.airportIcao.length !== 4) return;

    if (isDomesticUsLeg) {
      // Domestic US leg: no customs required
      update({
        cbpResult: null,
        ciqResult: {
          success: true,
          icao: leg.airportIcao,
          country: 'United States',
          airportName: leg.airportCity || leg.airportIcao,
          ciqAvailable: 'yes',
          notes: 'Not Required',
        },
        customsAvailable: true,
      });
    } else if (isUsDeparture) {
      if (isPrivateFlight) {
        // Private flights departing US to non-US: no outbound customs notification required
        update({
          cbpResult: null,
          ciqResult: {
            success: true,
            icao: leg.airportIcao,
            country: 'United States',
            airportName: leg.airportCity || leg.airportIcao,
            ciqAvailable: 'yes',
            notes: 'Outbound US Customs notification is not required for private flights. eAPIS outbound filing is required prior to departure.',
          },
          customsAvailable: true,
        });
      } else if (isCommercialFlight && isFirstLegUsDeparture) {
        // Commercial first-leg US departure: outbound customs + eAPIS
        update({
          cbpResult: null,
          ciqResult: {
            success: true,
            icao: leg.airportIcao,
            country: 'United States',
            airportName: leg.airportCity || leg.airportIcao,
            ciqAvailable: 'yes',
            notes: 'Outbound US Customs notification is required. eAPIS (electronic Advance Passenger Information System) filing must be submitted prior to departure.',
          },
          customsAvailable: true,
        });
      } else {
        // Other flight types at US airports: do normal CBP lookup
        handleCbpLookup();
      }
    } else {
      update({ cbpResult: null });
      handleCiqLookup();
    }

    handleRunwayLookup();
    handlePermitLookup();
    handleChargesLookup();
    handlePprLookup();
    handleAirportHoursLookup();
  }, [leg.airportIcao, isDomesticUsLeg, isUsDeparture, isPrivateFlight, isFirstLegUsDeparture, isCommercialFlight, leg.airportCity, handleCbpLookup, handleCiqLookup, handleRunwayLookup, handlePermitLookup, handleChargesLookup, handlePprLookup, handleAirportHoursLookup]);

  // Register lookup function with parent
  useEffect(() => {
    onRegisterLookup?.(legIndex, handleLookupAll);
    return () => onRegisterLookup?.(legIndex, null);
  }, [legIndex, handleLookupAll, onRegisterLookup]);

  // Ground handling data from invoice database
  interface GroundHandlingQuote {
    id: string;
    provider_name: string;
    aircraft_type: string | null;
    currency: string;
    grand_total: number | null;
    quote_date: string | null;
    line_items: { service_category: string; description: string; quantity: number; unit_price: number; vat_rate: number; subtotal: number; unit?: string | null }[];
  }
  const [groundHandlingQuotes, setGroundHandlingQuotes] = useState<GroundHandlingQuote[]>([]);
  const [ghLoading, setGhLoading] = useState(false);

  // Determine MTOW category for the selected aircraft
  const mtowKg = aircraftType ? AIRCRAFT_MTOW_KG[aircraftType] : undefined;
  const mtowCat = mtowKg ? getMtowCategory(mtowKg) : undefined;

  // Compute ground time in minutes from arrival→departure
  const groundTimeMinutes = (() => {
    if (!leg.arrivalTime || !leg.departureTime) return null;
    const arr = timeToMinutes(leg.arrivalTime);
    let dep = timeToMinutes(leg.departureTime);
    // Handle overnight: if departure is earlier, add 24h
    if (dep <= arr) dep += 24 * 60;
    return dep - arr;
  })();

  // Determine which service type to show based on ground time
  // ≥120 min → stay/stay over; <120 min → transit/turnaround/technical
  const isStayOver = groundTimeMinutes !== null ? groundTimeMinutes >= 120 : null;

  // Filter line items by MTOW weight range AND service type (stay vs transit)
  const filterLineItems = (items: GroundHandlingQuote['line_items']): GroundHandlingQuote['line_items'] => {
    if (!mtowCat) return items;
    const mtowKg = mtowCat.mtowTonnes * 1000;

    const parseMtowRange = (desc: string): { min: number; max: number } | null => {
      const rangeMatch = desc.match(/MTOW\s+([\d.]+)\s*-\s*([\d.]+)\s*t/i);
      if (rangeMatch) return { min: parseFloat(rangeMatch[1]) * 1000, max: parseFloat(rangeMatch[2]) * 1000 };
      const plusMatch = desc.match(/MTOW\s+([\d.]+)\s*t\+/i);
      if (plusMatch) return { min: parseFloat(plusMatch[1]) * 1000, max: Infinity };
      return null;
    };

    // Classify a line item's service type from its description
    const getServiceType = (desc: string): 'stay' | 'transit' | 'technical' | null => {
      const d = desc.toLowerCase();
      if (d.includes('stay over') || d.includes('stay-over') || d.includes('full stay') || d.includes('– stay')) return 'stay';
      if (d.includes('technical')) return 'technical';
      if (d.includes('transit') || d.includes('turnaround')) return 'transit';
      return null;
    };

    return items.filter(item => {
      // 1. Filter by MTOW
      const range = parseMtowRange(item.description);
      if (range && (mtowKg < range.min || mtowKg > range.max)) return false;

      // 2. Filter by service type if ground time is known
      // <2hrs → transit only; ≥2hrs → stay over only
      if (isStayOver !== null) {
        const svcType = getServiceType(item.description);
        if (!isStayOver && (svcType === 'stay' || svcType === 'technical')) return false;
        if (isStayOver && (svcType === 'transit' || svcType === 'technical')) return false;
      }

      return true;
    }).map(item => {
      const range = parseMtowRange(item.description);
      if (range && range.max === Infinity) {
        const actualPrice = item.unit_price * mtowCat.mtowTonnes;
        return { ...item, subtotal: actualPrice };
      }
      return item;
    });
  };

  useEffect(() => {
    if (leg.airportIcao.length !== 4) { setGroundHandlingQuotes([]); return; }
    const icao = leg.airportIcao.toUpperCase();
    let cancelled = false;
    setGhLoading(true);
    (async () => {
      try {
        const { data: quotes, error } = await supabase
          .from('ground_handling_quotes')
          .select('id, provider_id, aircraft_type, currency, grand_total, quote_date')
          .eq('icao', icao);
        if (error || !quotes || quotes.length === 0) { if (!cancelled) { setGroundHandlingQuotes([]); setGhLoading(false); } return; }

        // Get provider names
        const providerIds = [...new Set(quotes.map(q => q.provider_id).filter(Boolean))];
        const { data: providers } = providerIds.length > 0
          ? await supabase.from('ground_handling_providers').select('id, name').in('id', providerIds)
          : { data: [] };
        const providerMap = new Map((providers || []).map(p => [p.id, p.name]));

        // Get line items for all quotes
        const quoteIds = quotes.map(q => q.id);
        const { data: items } = await supabase
          .from('ground_handling_line_items')
          .select('quote_id, service_category, description, quantity, unit_price, vat_rate, subtotal, unit')
          .in('quote_id', quoteIds);

        const result: GroundHandlingQuote[] = quotes.map(q => ({
          id: q.id,
          provider_name: providerMap.get(q.provider_id) || 'Unknown',
          aircraft_type: q.aircraft_type,
          currency: q.currency,
          grand_total: q.grand_total,
          quote_date: q.quote_date,
          line_items: (items || []).filter(i => i.quote_id === q.id),
        }));
        if (!cancelled) setGroundHandlingQuotes(result);
      } catch { if (!cancelled) setGroundHandlingQuotes([]); }
      finally { if (!cancelled) setGhLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [leg.airportIcao]);

  const feasResult = leg.feasibilityResult;

  // Determine card style from feasibility result — bold left border
  const cardClass = feasResult
    ? feasResult.feasible
      ? "rounded-lg border border-l-4 border-l-success bg-card shadow-sm"
      : "rounded-lg border border-l-4 border-l-destructive bg-card shadow-sm"
    : "rounded-lg border bg-card shadow-sm";

  return (
    <div className={cardClass}>
      {/* Header */}
      <div className="flex w-full items-center justify-between px-4 py-3">
        <button
          type="button"
          className="flex flex-1 items-center gap-2.5 flex-wrap text-left min-w-0"
          onClick={() => setExpanded(!expanded)}
        >
          {/* Leg number pill */}
          <span className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shrink-0",
            feasResult
              ? feasResult.feasible
                ? "bg-success text-success-foreground"
                : "bg-destructive text-destructive-foreground"
              : "bg-primary text-primary-foreground"
          )}>
            {legIndex + 1}
          </span>

          {/* Airport + city */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-semibold text-sm">
              {leg.airportIcao ? `Leg ${legIndex + 1} — ${leg.airportIcao}` : `Leg ${legIndex + 1}`}
            </span>
            {(leg.airportCity || leg.runwayResult?.municipality) && (
              <span className="text-xs text-muted-foreground font-normal truncate">
                {leg.airportCity || leg.runwayResult?.municipality}
              </span>
            )}
          </div>

          {/* Status badge */}
          {feasResult ? (
            feasResult.feasible ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success border border-success/30 shrink-0">
                <CheckCircle2 className="h-3 w-3" /> Pass
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive border border-destructive/30 shrink-0">
                <XCircle className="h-3 w-3" /> Fail
              </span>
            )
          ) : null}

          {/* Date range */}
          {(leg.arrivalDate || leg.departureDate) && (
            <span className="text-xs text-muted-foreground shrink-0">
              {leg.arrivalDate && leg.departureDate
                ? `${format(leg.arrivalDate, "dd MMM")} – ${format(leg.departureDate, "dd MMM")}`
                : leg.departureDate
                  ? `DEP ${format(leg.departureDate, "dd MMM")}`
                  : leg.arrivalDate
                    ? `ARR ${format(leg.arrivalDate, "dd MMM")}`
                    : ''}
            </span>
          )}

          {/* Issues preview when collapsed */}
          {!expanded && feasResult && !feasResult.feasible && feasResult.issues.length > 0 && (
            <span className="hidden sm:inline text-xs text-destructive truncate max-w-[200px]">
              {feasResult.issues[0]}{feasResult.issues.length > 1 ? ` +${feasResult.issues.length - 1} more` : ''}
            </span>
          )}

          <ChevronUp className={cn("h-4 w-4 ml-auto shrink-0 text-muted-foreground transition-transform", !expanded && "rotate-180")} />
        </button>
        {/* Next destination label */}
        {nextLegIcao && (
          <div className="flex flex-col items-end mr-3 shrink-0">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none">Destination</span>
            <span className="text-sm font-semibold text-foreground leading-tight">{nextLegIcao}</span>
          </div>
        )}
        {/* Refresh button — re-runs all lookups for this leg */}
        <div className="flex items-center gap-1 ml-3 shrink-0">
          <button
            type="button"
            disabled={anyLoading || leg.airportIcao.length !== 4}
            onClick={() => {
              handleLookupAll();
              onRefreshLeg?.(legIndex);
            }}
            className="flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Refresh this leg"
          >
            {anyLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />
            }
          </button>

          {/* Leg navigation arrows — only shown when there are multiple legs */}
          {totalLegs > 1 && onNavigateLeg && (
            <>
              <button
                type="button"
                disabled={legIndex === 0}
                onClick={() => onNavigateLeg(legIndex - 1)}
                className="flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Previous leg"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={legIndex === totalLegs - 1}
                onClick={() => onNavigateLeg(legIndex + 1)}
                className="flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Next leg"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

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
                  airportCity: null,
                  arrivalDate: undefined,
                  arrivalTime: "",
                  departureDate: undefined,
                  departureTime: "",
                  utcOffsetHours: 0,
                  cbpResult: null, runwayResult: null, permitResult: null,
                  ciqResult: null, chargesResult: null, pprResult: null,
                  airportHoursResult: null, feasibilityResult: null,
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

          {/* UTC Offset — read-only, auto-detected from longitude */}
          {leg.utcOffsetHours !== 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" />
              <span>Local timezone auto-detected: <span className="font-medium text-foreground">{formatOffset(leg.utcOffsetHours)}</span></span>
            </div>
          )}

          {/* Arrival / Departure */}
          <div className="grid grid-cols-2 gap-4">
            {/* Arrival fields — hidden for the first leg when multi-leg */}
            {(totalLegs === 1 || legIndex > 0) && (
              <>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs">Arrival Date</Label>
                    {arrivalAutoCalculated && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary border border-primary/20">
                        <Plane className="h-2.5 w-2.5" />
                        Auto
                      </span>
                    )}
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !leg.arrivalDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                        {leg.arrivalDate ? (
                          <span className="flex flex-col leading-tight">
                            <span className="text-sm font-semibold">{format(leg.arrivalDate, "dd MMM")}</span>
                            <span className="text-[10px] text-muted-foreground">{format(leg.arrivalDate, "yyyy")}</span>
                          </span>
                        ) : <span className="text-xs">Select date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={leg.arrivalDate} onSelect={(d) => update({ arrivalDate: d, arrivalManuallyEdited: true })} initialFocus defaultMonth={leg.arrivalDate ?? previousLegDepartureDate} className="p-3 pointer-events-auto" disabled={(date) => isDateInPast(date)} />
                    </PopoverContent>
                  </Popover>
                  {leg.arrivalDate && isDateInPast(leg.arrivalDate) && (
                    <p className="text-[11px] text-destructive mt-0.5">{PAST_DATE_MSG}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs">Arrival Time</Label>
                    {arrivalAutoCalculated && (
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary border border-primary/20 cursor-help">
                              <Plane className="h-2.5 w-2.5" />
                              Calculated
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[220px] text-xs">
                            Auto-calculated from previous leg departure time + estimated flight duration. You can override this manually.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">UTC</span>
                      <Select value={leg.arrivalTime} onValueChange={(v) => update({ arrivalTime: v, arrivalManuallyEdited: true })}>
                        <SelectTrigger className="text-xs h-8"><SelectValue placeholder="HH:MM" /></SelectTrigger>
                        <SelectContent>{TIMES.map((t) => <SelectItem key={`a-utc-${t}`} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Local</span>
                      <Select
                        value={leg.arrivalTime ? utcToLocal(leg.arrivalTime, leg.utcOffsetHours) : ""}
                        onValueChange={(v) => update({ arrivalTime: localToUtc(v, leg.utcOffsetHours), arrivalManuallyEdited: true })}
                      >
                        <SelectTrigger className="text-xs h-8"><SelectValue placeholder="HH:MM" /></SelectTrigger>
                        <SelectContent>{TIMES.map((t) => <SelectItem key={`a-lcl-${t}`} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    {leg.arrivalDate && leg.arrivalTime && isDateTimeInPast(leg.arrivalDate, leg.arrivalTime) && !isDateInPast(leg.arrivalDate) && (
                      <p className="text-[11px] text-destructive">{PAST_DATE_MSG}</p>
                    )}
                  </div>
                </div>
                {/* Arrival auto-calc hint — shown when both arrival fields are empty */}
                {!leg.arrivalDate && !leg.arrivalTime && (
                  <p className="col-span-2 text-[11px] text-muted-foreground italic flex items-center gap-1">
                    <Plane className="h-3 w-3 shrink-0" />
                    Leave arrival fields blank to auto-calculate date &amp; time based on Great Circle routing.
                  </p>
                )}
              </>
            )}
            {/* Departure fields — hidden for the last leg when multi-leg */}
            {(totalLegs === 1 || legIndex < totalLegs - 1) && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Departure Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !leg.departureDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                        {leg.departureDate ? (
                          <span className="flex flex-col leading-tight">
                            <span className="text-sm font-semibold">{format(leg.departureDate, "dd MMM")}</span>
                            <span className="text-[10px] text-muted-foreground">{format(leg.departureDate, "yyyy")}</span>
                          </span>
                        ) : <span className="text-xs">Select date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={leg.departureDate} onSelect={(d) => update({ departureDate: d })} initialFocus defaultMonth={leg.departureDate ?? leg.arrivalDate ?? previousLegDepartureDate} className="p-3 pointer-events-auto" disabled={(date) => isDateInPast(date)} />
                    </PopoverContent>
                  </Popover>
                  {leg.departureDate && isDateInPast(leg.departureDate) && (
                    <p className="text-[11px] text-destructive mt-0.5">{PAST_DATE_MSG}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Departure Time</Label>
                  <div className="space-y-1.5">
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">UTC</span>
                      <Select value={leg.departureTime} onValueChange={(v) => update({ departureTime: v })}>
                        <SelectTrigger className="text-xs h-8"><SelectValue placeholder="HH:MM" /></SelectTrigger>
                        <SelectContent>{TIMES.map((t) => <SelectItem key={`d-utc-${t}`} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Local</span>
                      <Select
                        value={leg.departureTime ? utcToLocal(leg.departureTime, leg.utcOffsetHours) : ""}
                        onValueChange={(v) => update({ departureTime: localToUtc(v, leg.utcOffsetHours) })}
                      >
                        <SelectTrigger className="text-xs h-8"><SelectValue placeholder="HH:MM" /></SelectTrigger>
                        <SelectContent>{TIMES.map((t) => <SelectItem key={`d-lcl-${t}`} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    {leg.departureDate && leg.departureTime && isDateTimeInPast(leg.departureDate, leg.departureTime) && !isDateInPast(leg.departureDate) && (
                      <p className="text-[11px] text-destructive">{PAST_DATE_MSG}</p>
                    )}
                  </div>
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {/* Permit */}
            <button
              type="button"
              onClick={() => update({ permitRequired: !leg.permitRequired })}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-center transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                leg.permitRequired
                  ? "border-warning bg-warning/10 text-warning-foreground"
                  : "border-border bg-muted/30 text-muted-foreground hover:border-border/80 hover:bg-muted/50"
              )}
            >
              <ShieldCheck className={cn("h-4 w-4", leg.permitRequired ? "text-warning" : "text-muted-foreground")} />
              <span className="text-[11px] font-semibold leading-tight">Permit</span>
              <span className={cn("text-[10px] leading-tight", leg.permitRequired ? "text-warning font-medium" : "text-muted-foreground")}>
                {leg.permitRequired ? "Required" : "Not required"}
              </span>
            </button>

            {/* PPR */}
            <button
              type="button"
              onClick={() => update({ pprRequired: !leg.pprRequired })}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-center transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                leg.pprRequired
                  ? "border-warning bg-warning/10 text-warning-foreground"
                  : "border-border bg-muted/30 text-muted-foreground hover:border-border/80 hover:bg-muted/50"
              )}
            >
              <ClipboardList className={cn("h-4 w-4", leg.pprRequired ? "text-warning" : "text-muted-foreground")} />
              <span className="text-[11px] font-semibold leading-tight">PPR</span>
              <span className={cn("text-[10px] leading-tight", leg.pprRequired ? "text-warning font-medium" : "text-muted-foreground")}>
                {leg.pprRequired ? "Required" : "Not required"}
              </span>
            </button>

            {/* Customs */}
            <button
              type="button"
              onClick={() => update({ customsAvailable: !leg.customsAvailable })}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-center transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                leg.customsAvailable
                  ? "border-success/60 bg-success/10 text-foreground"
                  : "border-destructive/40 bg-destructive/5 text-muted-foreground hover:bg-destructive/10"
              )}
            >
              <Building2 className={cn("h-4 w-4", leg.customsAvailable ? "text-success" : "text-destructive/60")} />
              <span className="text-[11px] font-semibold leading-tight">Customs</span>
              <span className={cn("text-[10px] leading-tight font-medium", leg.customsAvailable ? "text-success" : "text-destructive/70")}>
                {leg.customsAvailable ? "Available" : "Not available"}
              </span>
            </button>

            {/* Slot */}
            <button
              type="button"
              onClick={() => update({ slotRequired: !leg.slotRequired })}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-center transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                leg.slotRequired
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border bg-muted/30 text-muted-foreground hover:border-border/80 hover:bg-muted/50"
              )}
            >
              <Timer className={cn("h-4 w-4", leg.slotRequired ? "text-primary" : "text-muted-foreground")} />
              <span className="text-[11px] font-semibold leading-tight">Slot</span>
              <span className={cn("text-[10px] leading-tight", leg.slotRequired ? "text-primary font-medium" : "text-muted-foreground")}>
                {leg.slotRequired ? "Required" : "Not required"}
              </span>
            </button>
          </div>

          {/* Lookup Results */}
          <div className="space-y-2">
            {/* CBP */}
            {leg.cbpResult && (
              <div className={cn("rounded-md border-l-4 border border-border p-3 text-sm space-y-1.5", leg.cbpResult.found ? "border-l-success" : "border-l-warning bg-muted/30")}>
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 font-medium">
                    {leg.cbpResult.found ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <AlertTriangle className="h-3.5 w-3.5 text-warning" />}
                    CIQ — {leg.cbpResult.airportName ? `${leg.cbpResult.airportName} (${leg.cbpResult.icao})` : leg.cbpResult.icao}
                  </div>
                  {AEG_RSP_AIRPORTS.has(leg.cbpResult.icao?.toUpperCase()) && (
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center rounded bg-success/15 border border-success/30 px-2 py-0.5 text-[10px] font-semibold text-success whitespace-nowrap cursor-help">
                            CBP RSP Available
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[220px] text-xs">
                          AEG is able to arrange for after hours CIQ at this location with prior notice
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">{leg.cbpResult.message}</p>
                {leg.cbpResult.operatingHours && (
                  <div className="rounded bg-muted/40 px-2 py-1.5 text-xs space-y-0.5">
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
              <div className={cn("rounded-md border-l-4 border border-border p-3 text-sm space-y-1.5",
                leg.ciqResult.ciqAvailable === 'yes' ? "border-l-success" : leg.ciqResult.ciqAvailable === 'no' ? "border-l-destructive" : "border-l-warning"
              )}>
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 font-medium">
                    {leg.ciqResult.ciqAvailable === 'yes' ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : leg.ciqResult.ciqAvailable === 'no' ? <XCircle className="h-3.5 w-3.5 text-destructive" /> : <AlertTriangle className="h-3.5 w-3.5 text-warning" />}
                    CIQ — {leg.ciqResult.airportName || leg.ciqResult.country || leg.ciqResult.icao}
                  </div>
                  {AEG_RSP_AIRPORTS.has(leg.ciqResult.icao?.toUpperCase()) && (
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center rounded bg-success/15 border border-success/30 px-2 py-0.5 text-[10px] font-semibold text-success whitespace-nowrap cursor-help">
                            CBP RSP Available
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[220px] text-xs">
                          AEG is able to arrange for after hours CIQ at this location with prior notice
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <div className="rounded bg-muted/40 px-2 py-1.5 text-xs space-y-0.5">
                  {leg.ciqResult.operatingHours && <p><span className="font-medium">Hours:</span> {leg.ciqResult.operatingHours}</p>}
                  {leg.ciqResult.advanceNotice && <p><span className="font-medium">Notice:</span> {leg.ciqResult.advanceNotice}</p>}
                  {leg.ciqResult.notes && <p className="text-muted-foreground italic">{leg.ciqResult.notes}</p>}
                </div>
              </div>
            )}

            {/* Permit */}
            {permitLoading && <div className="rounded-md border p-3 text-sm flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Permit lookup…</div>}
            {leg.permitResult && !permitLoading && (
              <div className={cn("rounded-md border-l-4 border border-border p-3 text-sm space-y-2",
                leg.permitResult.permitRequired === 'no' ? "border-l-success" : leg.permitResult.permitRequired === 'yes' ? "border-l-warning" : "border-l-muted-foreground/40"
              )}>
                <div className="flex items-center gap-1.5 font-medium">
                  <Shield className="h-3.5 w-3.5 text-primary" />
                  Permit Requirements — {leg.permitResult.country || leg.permitResult.icao}
                </div>

                {/* Landing Permit */}
                <div className="rounded bg-muted/40 px-2 py-1.5 text-xs space-y-0.5">
                  <p className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Landing Permit</p>
                  <p className="font-medium">
                    {leg.permitResult.permitRequired === 'yes' && '⚠️ Required'}
                    {leg.permitResult.permitRequired === 'no' && '✅ Not required'}
                    {leg.permitResult.permitRequired === 'conditional' && '⚠️ Conditionally required'}
                  </p>
                  {leg.permitResult.permitType && <p><span className="font-medium">Type:</span> {leg.permitResult.permitType}</p>}
                  {leg.permitResult.leadTimeDays != null && <p><span className="font-medium">Lead time:</span> {leg.permitResult.leadTimeDays} business days</p>}
                  {leg.permitResult.issuingAuthority && <p><span className="font-medium">Authority:</span> {leg.permitResult.issuingAuthority}</p>}
                  {leg.permitResult.conditions && <p><span className="font-medium">Conditions:</span> {leg.permitResult.conditions}</p>}
                </div>

                {/* TCO Authorization — only relevant for UK/EU destinations */}
                {leg.permitResult.tcoRequired && leg.permitResult.tcoRequired !== 'not_applicable' && isUkOrEuAirport(leg.airportIcao) && (
                  <div className={cn("rounded px-2 py-1.5 text-xs space-y-0.5",
                    leg.permitResult.tcoRequired === 'yes' ? "bg-destructive/10 border border-destructive/20" : leg.permitResult.tcoRequired === 'conditional' ? "bg-warning/10 border border-warning/20" : "bg-success/10 border border-success/20"
                  )}>
                    <p className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground mb-1">TCO Authorization (Third Country Operator)</p>
                    <p className="font-medium">
                      {leg.permitResult.tcoRequired === 'yes' && '🔴 TCO authorization required'}
                      {leg.permitResult.tcoRequired === 'no' && '✅ TCO not required'}
                      {leg.permitResult.tcoRequired === 'conditional' && '⚠️ TCO conditionally required'}
                    </p>
                    {leg.permitResult.tcoAuthority && <p><span className="font-medium">Issued by:</span> {leg.permitResult.tcoAuthority}</p>}
                    {leg.permitResult.tcoLeadTimeDays != null && <p><span className="font-medium">Lead time:</span> {leg.permitResult.tcoLeadTimeDays} days (initial approval)</p>}
                    {leg.permitResult.tcoNotes && <p className="text-muted-foreground italic">{leg.permitResult.tcoNotes}</p>}
                  </div>
                )}

                {/* Bilateral Agreements */}
                {leg.permitResult.bilateralAgreement && (
                  <div className="rounded bg-muted/40 px-2 py-1.5 text-xs space-y-0.5">
                    <p className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Air Service Agreement</p>
                    <p><span className="font-medium">Agreement:</span> {leg.permitResult.bilateralAgreement}</p>
                    {leg.permitResult.bilateralImpact && <p className="text-muted-foreground italic">{leg.permitResult.bilateralImpact}</p>}
                  </div>
                )}

                {/* Charter Permit */}
                {leg.permitResult.charterPermitRequired && leg.permitResult.charterPermitRequired !== 'not_applicable' && (
                  <div className={cn("rounded px-2 py-1.5 text-xs space-y-0.5",
                    leg.permitResult.charterPermitRequired === 'yes' ? "bg-warning/10 border border-warning/20" : leg.permitResult.charterPermitRequired === 'conditional' ? "bg-warning/5 border border-warning/20" : "bg-success/10 border border-success/20"
                  )}>
                    <p className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Charter / Non-Scheduled Permit</p>
                    <p className="font-medium">
                      {leg.permitResult.charterPermitRequired === 'yes' && '⚠️ Charter permit required'}
                      {leg.permitResult.charterPermitRequired === 'no' && '✅ No charter permit required'}
                      {leg.permitResult.charterPermitRequired === 'conditional' && '⚠️ Charter permit conditionally required'}
                    </p>
                    {leg.permitResult.charterPermitAuthority && <p><span className="font-medium">Authority:</span> {leg.permitResult.charterPermitAuthority}</p>}
                    {leg.permitResult.charterLeadTimeDays != null && <p><span className="font-medium">Lead time:</span> {leg.permitResult.charterLeadTimeDays} business days</p>}
                    {leg.permitResult.charterPermitNotes && <p className="text-muted-foreground italic">{leg.permitResult.charterPermitNotes}</p>}
                  </div>
                )}

                {/* Regulatory Warnings */}
                {leg.permitResult.regulatoryWarnings && leg.permitResult.regulatoryWarnings.length > 0 && (
                  <div className="rounded bg-destructive/5 border border-destructive/20 px-2 py-1.5 text-xs space-y-0.5">
                    <p className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Regulatory Warnings</p>
                    {leg.permitResult.regulatoryWarnings.map((warning, i) => (
                      <p key={i} className="text-destructive/90">⚠ {warning}</p>
                    ))}
                  </div>
                )}

                {/* General Notes */}
                {leg.permitResult.notes && (
                  <p className="text-xs text-muted-foreground italic px-1">{leg.permitResult.notes}</p>
                )}

                {/* Confidence + data source */}
                <div className="flex items-center gap-2 flex-wrap">
                  {leg.permitResult.confidence && (
                    <p className="text-[10px] text-muted-foreground">Confidence: {leg.permitResult.confidence}</p>
                  )}
                  {leg.permitResult.groundedByPerplexity ? (
                    <span className="text-[10px] bg-primary/10 text-primary rounded-full px-2 py-0.5 font-medium">
                      ✓ Grounded by real-time search
                    </span>
                  ) : (
                    <span className="text-[10px] bg-muted text-muted-foreground rounded-full px-2 py-0.5">
                      AI estimate — verify with official sources
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* PPR */}
            {pprLoading && <div className="rounded-md border p-3 text-sm flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />PPR lookup…</div>}
            {leg.pprResult && !pprLoading && (
              <div className={cn("rounded-md border-l-4 border border-border p-3 text-sm space-y-1.5",
                leg.pprResult.pprRequired === 'no' ? "border-l-success" : leg.pprResult.pprRequired === 'yes' ? "border-l-warning" : "border-l-muted-foreground/40"
              )}>
                <div className="flex items-center gap-1.5 font-medium">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  PPR — {leg.pprResult.airportName || leg.pprResult.icao}
                </div>
                <div className="rounded bg-muted/40 px-2 py-1.5 text-xs space-y-0.5">
                  {leg.pprResult.advanceNoticePeriod && <p><span className="font-medium">Notice:</span> {leg.pprResult.advanceNoticePeriod}</p>}
                  {leg.pprResult.contactDetails && <p><span className="font-medium">Contact:</span> {leg.pprResult.contactDetails}</p>}
                  {/* Slot info moved to dedicated card below */}
                  {leg.pprResult.notes && <p className="text-muted-foreground italic">{leg.pprResult.notes}</p>}
                </div>
              </div>
            )}

            {/* Slot Coordination */}
            {leg.pprResult && !pprLoading && leg.pprResult.slotRequired !== undefined && (
              <div className={cn("rounded-md border-l-4 border border-border p-3 text-sm space-y-1.5",
                leg.pprResult.slotRequired ? "border-l-warning" : "border-l-success"
              )}>
                <div className="flex items-center gap-1.5 font-medium">
                  <Timer className="h-3.5 w-3.5 text-primary" />
                  Slot Coordination — {leg.pprResult.airportName || leg.pprResult.icao}
                </div>
                <div className="rounded bg-muted/40 px-2 py-1.5 text-xs space-y-0.5">
                  <p className="font-medium">
                    {leg.pprResult.slotRequired ? '⚠️ Slot coordination required' : '✅ No slot coordination required'}
                  </p>
                  {leg.pprResult.slotRequired && leg.pprResult.contactMethod && (
                    <p><span className="font-medium">How to book:</span> {leg.pprResult.contactMethod}</p>
                  )}
                  {leg.pprResult.slotRequired && leg.pprResult.contactDetails && (
                    <p><span className="font-medium">Contact:</span> {leg.pprResult.contactDetails}</p>
                  )}
                  {leg.pprResult.slotRequired && leg.pprResult.operatingRestrictions && (
                    <p><span className="font-medium">Restrictions:</span> {leg.pprResult.operatingRestrictions}</p>
                  )}
                </div>
              </div>
            )}

            {/* Runway */}
            {leg.runwayResult && (
              <div className={cn("rounded-md border-l-4 border border-border p-3 text-sm space-y-1.5", leg.runwayResult.found ? "border-l-success" : "border-l-muted-foreground/40")}>
                <div className="flex items-center gap-1.5 font-medium">
                  <PlaneLanding className="h-3.5 w-3.5 text-primary" />
                  Runway Data
                </div>
                <p className="text-muted-foreground text-xs">{leg.runwayResult.message}</p>
                {leg.runwayResult.runways.length > 0 && (
                  <div className="rounded bg-muted/40 px-2 py-1.5 text-xs space-y-0.5">
                    {leg.runwayResult.runways.map((rwy, i) => (
                      <p key={i}><span className="font-mono font-medium">{rwy.ident}</span> — {rwy.lengthFt.toLocaleString()} ft × {rwy.widthFt} ft · {rwy.surface}{rwy.lighted && " · Lighted"}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Ground Handling (from invoice database) */}
            {ghLoading && <div className="rounded-md border p-3 text-sm flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading ground handling data…</div>}
            {groundHandlingQuotes.length > 0 && !ghLoading && groundHandlingQuotes.map((ghq) => {
              const filteredItems = filterLineItems(ghq.line_items);
              if (filteredItems.length === 0) return null;
              // Calculate total from filtered items
              const filteredTotal = filteredItems.reduce((sum, item) => sum + (item.subtotal ?? 0), 0);
              return (
              <div key={ghq.id} className="rounded-md border-l-4 border-l-accent border border-border p-3 text-sm space-y-1.5">
                <div className="flex items-center gap-1.5 font-medium">
                  <FileText className="h-3.5 w-3.5 text-accent-foreground" />
                  Ground Handling — {ghq.provider_name}
                </div>
                {mtowCat && (
                  <p className="text-[10px] text-muted-foreground">
                    Aircraft: {aircraftType} — MTOW {mtowCat.mtowTonnes.toFixed(1)}t — Category {mtowCat.category} ({mtowCat.label})
                    {groundTimeMinutes !== null && (
                      <span className="ml-1">— Ground time: {Math.floor(groundTimeMinutes / 60)}h{String(groundTimeMinutes % 60).padStart(2, '0')}m → {isStayOver ? 'Stay Over' : 'Transit'} rates</span>
                    )}
                  </p>
                )}
                {ghq.quote_date && <p className="text-[10px] text-muted-foreground">Tariff effective: {ghq.quote_date}</p>}
                <div className="rounded bg-muted/40 px-2 py-1.5 text-xs space-y-0.5">
                  {Object.entries(
                    filteredItems.reduce<Record<string, typeof filteredItems>>((acc, item) => {
                      (acc[item.service_category] ??= []).push(item);
                      return acc;
                    }, {})
                  ).map(([cat, items]) => (
                    <div key={cat} className="space-y-0.5">
                      <p className="font-medium text-muted-foreground pt-1 first:pt-0">{cat}</p>
                      {items.map((item, i) => (
                        <div key={i} className="grid grid-cols-[1fr_auto] gap-x-4">
                          <span>{item.description.replace(/\s*[-–]\s*Cat [A-Z]\s*[:(]\s*MTOW[\s\d.\-t+]+\)?/i, '')}{item.quantity > 1 ? ` ×${item.quantity}` : ''}{item.unit ? ` (${item.unit})` : ''}</span>
                          <span className="text-right font-mono">
                            {ghq.currency === 'USD' ? '$' : ghq.currency === 'EUR' ? '€' : ghq.currency === 'GBP' ? '£' : ghq.currency + ' '}
                            {(item.subtotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            {item.vat_rate > 0 && <span className="text-muted-foreground ml-1 text-[10px]">+{item.vat_rate}%</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                  <div className="pt-1 border-t mt-1 flex justify-between font-medium">
                    <span>Estimated Total (excl. pax fees):</span>
                    <span className="font-mono text-accent-foreground">
                      {ghq.currency === 'USD' ? '$' : ghq.currency === 'EUR' ? '€' : ghq.currency === 'GBP' ? '£' : ghq.currency + ' '}
                      {filteredTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground italic">Source: TAG Bologna tariff schedule</p>
              </div>
              );
            })}

            {/* Airport Hours */}
            {hoursLoading && <div className="rounded-md border p-3 text-sm flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking airport hours & NOTAMs…</div>}
            {leg.airportHoursResult && !hoursLoading && (
              <div className={cn("rounded-md border-l-4 border border-border p-3 text-sm space-y-1.5",
                leg.airportHoursResult.success
                  ? (leg.airportHoursResult.arrivalOutsideHours || leg.airportHoursResult.departureOutsideHours || leg.airportHoursResult.arrivalDuringCurfew || leg.airportHoursResult.departureDuringCurfew)
                    ? "border-l-destructive"
                    : "border-l-success"
                  : "border-l-muted-foreground/40"
              )}>
                <div className="flex items-center gap-1.5 font-medium">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  Airport Hours and Services — {leg.airportHoursResult.airportName || leg.airportHoursResult.icao}
                  {leg.airportHoursResult.hasLiveNotamData && (
                    <span className="text-[10px] font-normal bg-primary/10 text-primary px-1.5 py-0.5 rounded">Live NOTAMs</span>
                  )}
                </div>

                {leg.airportHoursResult.success && (
                  <div className="rounded bg-muted/40 px-2 py-1.5 text-xs space-y-1">
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

                    {/* Deicing availability */}
                    {leg.airportHoursResult.deicingAvailable && leg.airportHoursResult.deicingAvailable !== 'unknown' && (
                      <div className={cn("rounded px-2 py-1 border-l-2",
                        leg.airportHoursResult.deicingAvailable === 'yes' ? "bg-success/10 border-l-success" :
                        leg.airportHoursResult.deicingAvailable === 'limited' ? "bg-warning/10 border-l-warning" :
                        "bg-destructive/10 border-l-destructive"
                      )}>
                        <p className="font-medium">
                          {leg.airportHoursResult.deicingAvailable === 'yes' ? '✅' : leg.airportHoursResult.deicingAvailable === 'limited' ? '⚠️' : '❌'} Deicing: {leg.airportHoursResult.deicingAvailable === 'yes' ? 'Available' : leg.airportHoursResult.deicingAvailable === 'limited' ? 'Limited' : 'Not Available'}
                          {leg.airportHoursResult.deicingProvider && ` — ${leg.airportHoursResult.deicingProvider}`}
                        </p>
                        {leg.airportHoursResult.deicingNotes && (
                          <p className="text-muted-foreground">{leg.airportHoursResult.deicingNotes}</p>
                        )}
                      </div>
                    )}

                    {/* Fire Category (ARFF) */}
                    {leg.airportHoursResult.fireCategory != null && leg.airportHoursResult.fireCategory > 0 && (
                      <div className="rounded px-2 py-1 border-l-2 bg-muted/30 border-l-primary">
                        <p className="font-medium">
                          🚒 Fire Category: {leg.airportHoursResult.fireCategory}
                          {leg.airportHoursResult.fireCategoryUpgradable && (
                            <span className="ml-1.5 text-[10px] font-normal bg-success/15 text-success px-1.5 py-0.5 rounded">Upgradable</span>
                          )}
                          {leg.airportHoursResult.fireCategoryUpgradable === false && (
                            <span className="ml-1.5 text-[10px] font-normal bg-muted px-1.5 py-0.5 rounded text-muted-foreground">Not upgradable</span>
                          )}
                        </p>
                        {leg.airportHoursResult.fireCategoryNotes && (
                          <p className="text-muted-foreground">{leg.airportHoursResult.fireCategoryNotes}</p>
                        )}
                      </div>
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

            {/* Charges */}
            {chargesLoading && <div className="rounded-md border p-3 text-sm flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Estimating charges…</div>}
            {leg.chargesResult && !chargesLoading && (
              <div className={cn("rounded-md border-l-4 border border-border p-3 text-sm space-y-1.5", leg.chargesResult.success ? "border-l-primary" : "border-l-muted-foreground/40")}>
                <div className="flex items-center gap-1.5 font-medium">
                  <DollarSign className="h-3.5 w-3.5 text-primary" />
                  Charges — {leg.chargesResult.airportName || leg.chargesResult.icao}
                </div>
                {leg.chargesResult.success && (
                  <div className="rounded bg-muted/40 px-2 py-1.5 text-xs space-y-0.5">
                    {leg.chargesResult.mtowKg && <p className="text-muted-foreground">MTOW: {leg.chargesResult.mtowKg.toLocaleString()} kg</p>}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1">
                      <p><span className="font-medium">Landing:</span></p>
                      <p className="text-right font-mono">${leg.chargesResult.landingFeeUsd?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—'}</p>
                      {leg.chargesResult.parkingDays != null && leg.chargesResult.totalParkingUsd != null ? (
                        <>
                          <p><span className="font-medium">Parking ({leg.chargesResult.parkingDays}d):</span></p>
                          <p className="text-right font-mono">${leg.chargesResult.totalParkingUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                        </>
                      ) : (
                        <>
                          <p><span className="font-medium">Parking/day:</span></p>
                          <p className="text-right font-mono">${leg.chargesResult.parkingPerDayUsd?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—'}</p>
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
                    <p className="text-muted-foreground italic pt-2 border-t mt-1 text-[10px] leading-tight">⚠️ Parking fees listed reflect airport‑published rates and do not apply to aircraft parked at FBOs. Individual FBOs may have their own rates for parking.</p>
                  </div>
                )}
                {leg.chargesResult.error && <p className="text-xs text-destructive">{leg.chargesResult.error}</p>}
              </div>
            )}
          </div>

          {/* AEG Set Up Fees */}
          {SHOW_AEG_FEES && (() => {
            // Count how many overflight permits are needed for the departing sector,
            // excluding the departure and arrival countries (they are not overflown).
            const originCountry = overflightResult?.originCountry ?? null;
            const destinationCountry = overflightResult?.destinationCountry ?? null;
            const overflightCountriesNeeding = overflightResult?.countries?.filter(
              c =>
                (c.overflightPermitRequired === 'yes' || c.overflightPermitRequired === 'conditional') &&
                c.country !== originCountry &&
                c.country !== destinationCountry
            ) ?? [];
            const overflightPermitsNeeded = overflightCountriesNeeding.length;

            // Compute effective cost per service (overflight permit scales by permit count)
            const getEffectiveCost = (service: { id: string; costUsd: number; selected: boolean }) => {
              if (service.id === 'overflight-permit' && overflightPermitsNeeded > 1) {
                return service.costUsd * overflightPermitsNeeded;
              }
              return service.costUsd;
            };

            const selectedPredefined = (leg.aegServices || []).filter(s => s.selected);
            const adHocItems = (leg.aegAdHocServices || []);
            const predefinedTotal = selectedPredefined.reduce((sum, s) => sum + getEffectiveCost(s), 0);
            const adHocTotal = adHocItems.reduce((sum, s) => {
              const v = parseFloat(String(s.costUsd));
              return sum + (isNaN(v) ? 0 : v);
            }, 0);
            const aegTotal = predefinedTotal + adHocTotal;

            const toggleService = (id: string, checked: boolean) => {
              update({
                aegServices: (leg.aegServices || []).map(s => s.id === id ? { ...s, selected: checked } : s),
              });
            };

            const addAdHoc = () => {
              update({
                aegAdHocServices: [
                  ...(leg.aegAdHocServices || []),
                  { id: crypto.randomUUID(), name: '', costUsd: '', notes: '' },
                ],
              });
            };

            const updateAdHoc = (id: string, changes: Partial<AegAdHocService>) => {
              update({
                aegAdHocServices: (leg.aegAdHocServices || []).map(s => s.id === id ? { ...s, ...changes } : s),
              });
            };

            const removeAdHoc = (id: string) => {
              update({
                aegAdHocServices: (leg.aegAdHocServices || []).filter(s => s.id !== id),
              });
            };

            return (
              <div className="rounded-md border border-primary/20 bg-primary/5 text-sm">
                {/* Collapsible header */}
                <button
                  type="button"
                  className="w-full flex items-center justify-between p-3 hover:bg-primary/10 transition-colors rounded-md"
                  onClick={() => setAegFeesExpanded(prev => !prev)}
                >
                  <div className="flex items-center gap-1.5 font-medium">
                    <Tag className="h-3.5 w-3.5 text-primary" />
                    AEG Set Up Fees
                  </div>
                  <div className="flex items-center gap-2">
                    {aegTotal > 0 && (
                      <span className="text-xs font-mono font-semibold text-primary">
                        ${aegTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                    )}
                    {aegFeesExpanded
                      ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    }
                  </div>
                </button>

                {aegFeesExpanded && (
                  <div className="px-3 pb-3 space-y-3 border-t border-primary/10 pt-3">
                    {/* Predefined services */}
                    <div className="grid grid-cols-1 gap-1.5">
                      {(leg.aegServices || []).map(service => {
                        const isOverflight = service.id === 'overflight-permit';
                        const permitsNeeded = isOverflight && overflightPermitsNeeded > 0 ? overflightPermitsNeeded : null;
                        const effectiveCost = getEffectiveCost(service);

                        return (
                          <label key={service.id} className="flex items-start justify-between gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-primary/10 transition-colors">
                            <div className="flex items-start gap-2">
                              <Checkbox
                                className="mt-0.5"
                                checked={service.selected}
                                onCheckedChange={(checked) => toggleService(service.id, checked === true)}
                              />
                              <div>
                                <span className={cn("text-xs", service.selected ? "text-foreground font-medium" : "text-muted-foreground")}>
                                  {service.name}
                                </span>
                                {isOverflight && permitsNeeded !== null && (
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    {permitsNeeded === 0
                                      ? 'No overflight permits required for this sector'
                                      : permitsNeeded === 1
                                        ? '1 permit required'
                                        : `${permitsNeeded} permits required`}
                                    {overflightCountriesNeeding.length > 0 && (
                                      <span className="ml-1">({overflightCountriesNeeding.map(c => c.country).join(', ')})</span>
                                    )}
                                  </p>
                                )}
                                {isOverflight && !overflightResult && (
                                  <p className="text-[10px] text-muted-foreground/70 mt-0.5 italic">Run overflight lookup to auto-calculate</p>
                                )}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              {isOverflight && permitsNeeded != null && permitsNeeded > 1 ? (
                                <div className="text-right">
                                  <span className={cn("text-xs font-mono", service.selected ? "text-foreground" : "text-muted-foreground/60")}>
                                    ${effectiveCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                  </span>
                                  <p className="text-[10px] text-muted-foreground">${service.costUsd} × {permitsNeeded}</p>
                                </div>
                              ) : (
                                <span className={cn("text-xs font-mono", service.selected ? "text-foreground" : "text-muted-foreground/60")}>
                                  ${service.costUsd}
                                </span>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    {/* Ad-hoc services */}
                    {adHocItems.length > 0 && (
                      <div className="space-y-2 pt-1 border-t">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ad-hoc Services</p>
                        {adHocItems.map(item => (
                          <div key={item.id} className="rounded border bg-background/60 p-2 space-y-1.5">
                            <div className="flex gap-2">
                              <Input
                                placeholder="Service name"
                                value={item.name}
                                onChange={e => updateAdHoc(item.id, { name: e.target.value })}
                                className="h-7 text-xs flex-1"
                              />
                              <div className="relative w-24 shrink-0">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                                <Input
                                  placeholder="0"
                                  type="number"
                                  min="0"
                                  value={item.costUsd}
                                  onChange={e => updateAdHoc(item.id, { costUsd: e.target.value })}
                                  className="h-7 text-xs pl-5 font-mono"
                                />
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                                onClick={() => removeAdHoc(item.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            <Textarea
                              placeholder="Notes (optional)"
                              value={item.notes}
                              onChange={e => updateAdHoc(item.id, { notes: e.target.value })}
                              className="min-h-[44px] text-xs resize-none"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full h-7 text-xs gap-1.5"
                      onClick={addAdHoc}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Ad-hoc Service
                    </Button>

                    {/* Total */}
                    {aegTotal > 0 && (
                      <div className="pt-2 border-t flex justify-between items-center text-xs font-medium">
                        <span>AEG Set Up Total:</span>
                        <span className="font-mono text-primary text-sm">
                          ${aegTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

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
