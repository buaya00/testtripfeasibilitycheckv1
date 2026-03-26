import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { format } from "date-fns";
import {
  Plane, Loader2, Navigation, Globe, Plus, X, DollarSign,
  CheckCircle2, XCircle, AlertTriangle, Printer, FileDown, PawPrint,
  Clock, Ruler, RefreshCw, Upload, ChevronLeft, ChevronRight, Shield,
} from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { AircraftTypeCombobox } from "@/components/AircraftTypeCombobox";
import { NationalityCombobox } from "@/components/NationalityCombobox";
import { AIRCRAFT_RANGE_NM, AIRCRAFT_CRUISE_KTAS } from "@/data/aircraftPerformance";
import { calculateFlightLeg, type FlightLegCalculation } from "@/lib/flightCalculations";
import { COUNTRIES } from "@/data/countries";

import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import TripLegCard, { evaluateLegFeasibility } from "./TripLegCard";
import RouteMapPreview from "./RouteMapPreview";
import FuelTankeringPanel from "./FuelTankeringPanel";
import type {
  LegData, OverflightResult, VisaCheckResult, PetCheckResult, CabotageResult,
} from "./tripTypes";
import { createEmptyLeg } from "./tripTypes";
import { generatePrintableHtml } from "./PrintableReport";
import aegLogo from "@/assets/aeg-logo.png";
import VideoModal from "./VideoModal";

export default function FeasibilityForm() {
  const [logoDataUrl, setLogoDataUrl] = useState<string>("");
  const [aircraftType, setAircraftType] = useState("");
  const [flightType, setFlightType] = useState("");
  const [aircraftNationality, setAircraftNationality] = useState("");
  const [legs, setLegs] = useState<LegData[]>([createEmptyLeg()]);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [checkAllError, setCheckAllError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const dragCounter = useRef(0);
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

  


  // Overflight toggle — when true, overflights auto-run as part of 'Run Feasibility Check'
  const [autoRunOverflights, setAutoRunOverflights] = useState(false);

  const [currentLegIndex, setCurrentLegIndex] = useState(0);

  // Clamp currentLegIndex when legs change
  useEffect(() => {
    if (currentLegIndex >= legs.length) setCurrentLegIndex(Math.max(0, legs.length - 1));
  }, [legs.length, currentLegIndex]);

  const [expandedLegs, setExpandedLegs] = useState<Record<number, boolean>>({});
  const isLegExpanded = (idx: number) => expandedLegs[idx] !== false; // default true
  const toggleLegExpanded = (idx: number) =>
    setExpandedLegs(prev => ({ ...prev, [idx]: !isLegExpanded(idx) }));

  // Overflight results keyed by "legIdx" (between leg legIdx and legIdx+1)
  const [overflightResults, setOverflightResults] = useState<Record<number, OverflightResult | null>>({});
  const [overflightLoading, setOverflightLoading] = useState<Record<number, boolean>>({});

  // Visa — passenger results keyed by ICAO code
  const [visaNationalities, setVisaNationalities] = useState<string[]>([""]);
  const [visaResults, setVisaResults] = useState<Record<string, VisaCheckResult | null>>({});
  const [visaLoading, setVisaLoading] = useState<Record<string, boolean>>({});

  // Visa — aircrew results keyed by ICAO code
  const [aircrewNationalities, setAircrewNationalities] = useState<string[]>([""]);
  const [aircrewVisaResults, setAircrewVisaResults] = useState<Record<string, VisaCheckResult | null>>({});
  const [aircrewVisaLoading, setAircrewVisaLoading] = useState<Record<string, boolean>>({});

  // Pet travel — results keyed by ICAO code
  const [petTypes, setPetTypes] = useState<string[]>([]);
  const [petResults, setPetResults] = useState<Record<string, PetCheckResult | null>>({});
  const [petLoading, setPetLoading] = useState<Record<string, boolean>>({});

  // Cabotage analysis — route-level check
  const [cabotageResult, setCabotageResult] = useState<CabotageResult | null>(null);
  const [cabotageLoading, setCabotageLoading] = useState(false);

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

  const insertLegAfter = useCallback((index: number) => {
    setLegs(prev => {
      const next = [...prev];
      next.splice(index + 1, 0, createEmptyLeg());
      return next;
    });
  }, []);

  // Refs for triggering lookup on each leg
  const legLookupRefs = React.useRef<Record<number, (() => void) | null>>({});

  const registerLegLookup = useCallback((index: number, fn: (() => void) | null) => {
    legLookupRefs.current[index] = fn;
  }, []);

  // Track whether a check-all has been triggered so we can re-evaluate on lookup completion
  const feasibilityTriggered = useRef(false);

  // Refs so handleCheckAll can call handlers without forward-reference issues
  const handleAllOverflightsRef = useRef<(() => void) | null>(null);
  const handleCabotageCheckRef = useRef<(() => void) | null>(null);

  // Check feasibility for all legs
  const handleCheckAll = useCallback(() => {
    if (!aircraftType || !flightType) {
      setCheckAllError("Please select an Aircraft Type and Flight Type before running the feasibility check.");
      return;
    }
    setCheckAllError(null);
    feasibilityTriggered.current = true;
    // Trigger lookup on each leg
    Object.values(legLookupRefs.current).forEach(fn => fn?.());
    // Initial evaluation with current data
    setLegs(prev => prev.map((leg, idx) => ({
      ...leg,
      feasibilityResult: evaluateLegFeasibility(leg, aircraftType, idx, prev.length, idx > 0 ? prev[idx - 1].airportIcao : undefined),
    })));
    // If overflight toggle is on, also run overflight checks for all leg pairs
    if (autoRunOverflights) {
      handleAllOverflightsRef.current?.();
    }
    // Auto-run cabotage check for multi-leg trips
    if (legs.length >= 2) {
      // Delay slightly to let country data populate from other lookups
      setTimeout(() => handleCabotageCheckRef.current?.(), 2000);
    }
  }, [aircraftType, flightType, autoRunOverflights, legs.length]);

  // Stable snapshot of lookup results used as a dependency (avoids hooks array-size violation)
  const lookupSnapshot = useMemo(() => legs.map(l => [
    l.permitResult, l.pprResult, l.cbpResult, l.runwayResult, l.ciqResult, l.airportHoursResult,
  ].map(r => (r ? JSON.stringify(r) : null)).join('|')).join('||'), [legs]);

  // Re-evaluate feasibility whenever lookup results change (permits, PPR, etc.)
  useEffect(() => {
    if (!feasibilityTriggered.current) return;
    const anyEvaluated = legs.some(l => l.feasibilityResult != null);
    if (!anyEvaluated) return;

    setLegs(prev => {
      const updated = prev.map((leg, idx) => ({
        ...leg,
        feasibilityResult: evaluateLegFeasibility(leg, aircraftType, idx, prev.length, idx > 0 ? prev[idx - 1].airportIcao : undefined),
      }));
      const changed = updated.some((u, i) =>
        u.feasibilityResult?.feasible !== prev[i].feasibilityResult?.feasible ||
        u.feasibilityResult?.issues.join('|') !== prev[i].feasibilityResult?.issues.join('|') ||
        u.feasibilityResult?.notes.join('|') !== prev[i].feasibilityResult?.notes.join('|')
      );
      return changed ? updated : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupSnapshot, aircraftType]);

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
        // Normalize: if permit is "required" only for non-ICAO member countries, treat as not required
        const result = res as OverflightResult;
        if (result.countries) {
          const icaoExemptPattern = /non[- ]?icao\s+member/i;
          const isPrivateOrCharter = flightType === 'private' || flightType === 'non-scheduled-commercial';
          result.countries = result.countries.map(c => {
            // Iceland: no permit needed for private & non-scheduled commercial
            if (
              (c.overflightPermitRequired === 'yes' || c.overflightPermitRequired === 'conditional') &&
              isPrivateOrCharter &&
              /iceland/i.test(c.country)
            ) {
              return {
                ...c,
                overflightPermitRequired: 'no' as const,
                notes: c.notes
                  ? `${c.notes} (No permit required for private/non-scheduled commercial flights)`
                  : 'No permit required for private/non-scheduled commercial flights',
              };
            }
            // Non-ICAO member exemption
            if (
              (c.overflightPermitRequired === 'yes' || c.overflightPermitRequired === 'conditional') &&
              (icaoExemptPattern.test(c.conditions || '') || icaoExemptPattern.test(c.notes || ''))
            ) {
              return {
                ...c,
                overflightPermitRequired: 'no' as const,
                notes: c.notes
                  ? `${c.notes} (Permit only required for non-ICAO member states)`
                  : 'Permit only required for non-ICAO member states',
              };
            }
            return c;
          });
          // Recalculate totals
          result.totalPermitsNeeded = result.countries.filter(
            c => c.overflightPermitRequired === 'yes' || c.overflightPermitRequired === 'conditional'
          ).length;
        }
        setOverflightResults(prev => ({ ...prev, [fromIdx]: result }));
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

  // Keep the refs in sync so handleCheckAll can call them without forward-reference issues
  useEffect(() => { handleAllOverflightsRef.current = handleAllOverflights; }, [handleAllOverflights]);
  

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
          // Try to extract the actual error message from the response body
          let errorMsg = error.message;
          try {
            const bodyText = await (error as any).context?.text?.();
            if (bodyText) {
              const parsed = JSON.parse(bodyText);
              if (parsed.error) errorMsg = parsed.error;
            }
          } catch { /* ignore parse errors */ }
          setVisaResults(prev => ({ ...prev, [icao]: { success: false, error: errorMsg } }));
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

  // Aircrew visa check — runs for all destination ICAOs with isAircrew flag
  const handleAircrewVisaCheck = useCallback(async () => {
    const validNationalities = aircrewNationalities.filter(n => n.length > 0);
    if (validNationalities.length === 0 || destinationIcaos.length === 0) return;

    const loadingState: Record<string, boolean> = {};
    destinationIcaos.forEach(icao => { loadingState[icao] = true; });
    setAircrewVisaLoading(loadingState);
    setAircrewVisaResults({});

    await Promise.all(destinationIcaos.map(async (icao) => {
      try {
        const { data: res, error } = await supabase.functions.invoke('visa-check', {
          body: { nationalities: validNationalities, destinationIcao: icao, isAircrew: true },
        });
        if (error) {
          // Try to extract the actual error message from the response body
          let errorMsg = error.message;
          try {
            const bodyText = await (error as any).context?.text?.();
            if (bodyText) {
              const parsed = JSON.parse(bodyText);
              if (parsed.error) errorMsg = parsed.error;
            }
          } catch { /* ignore parse errors */ }
          setAircrewVisaResults(prev => ({ ...prev, [icao]: { success: false, error: errorMsg } }));
        } else {
          setAircrewVisaResults(prev => ({ ...prev, [icao]: res as VisaCheckResult }));
        }
      } catch {
        setAircrewVisaResults(prev => ({ ...prev, [icao]: { success: false, error: 'Failed to connect' } }));
      } finally {
        setAircrewVisaLoading(prev => ({ ...prev, [icao]: false }));
      }
    }));
  }, [aircrewNationalities, destinationIcaos]);

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

  // Cabotage check — route-level analysis
  const handleCabotageCheck = useCallback(async () => {
    if (legs.length < 2) return;
    const validLegs = legs.filter(l => l.airportIcao.length === 4);
    if (validLegs.length < 2) return;

    setCabotageLoading(true);
    setCabotageResult(null);

    try {
      const legData = validLegs.map(l => ({
        icao: l.airportIcao,
        country: l.ciqResult?.country || l.permitResult?.country || l.airportHoursResult?.country || undefined,
      }));

      const { data: res, error } = await supabase.functions.invoke('cabotage-check', {
        body: {
          legs: legData,
          aircraftNationality: aircraftNationality || undefined,
          flightType: flightType || undefined,
          aircraftType: aircraftType || undefined,
        },
      });

      if (error) {
        let errorMsg = error.message;
        try { const t = await (error as any).context?.text?.(); if (t) { const p = JSON.parse(t); if (p.error) errorMsg = p.error; } } catch { /* ignore */ }
        setCabotageResult({ success: false, error: errorMsg });
      } else {
        setCabotageResult(res as CabotageResult);
      }
    } catch {
      setCabotageResult({ success: false, error: 'Failed to connect' });
    } finally {
      setCabotageLoading(false);
    }
  }, [legs, aircraftNationality, flightType, aircraftType]);

  useEffect(() => { handleCabotageCheckRef.current = handleCabotageCheck; }, [handleCabotageCheck]);

  const handleDocumentUpload = useCallback(async (file: File) => {
    setUploadLoading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data: res, error } = await supabase.functions.invoke("parse-trip-document", {
        body: form,
      });
      if (error) throw new Error(error.message);
      if (!res?.success) throw new Error(res?.error || "Failed to parse document");

      const parsedLegs: Array<{
        icao: string;
        arrivalDate?: string;
        arrivalTime?: string;
        departureDate?: string;
        departureTime?: string;
      }> = res.legs || [];

      if (parsedLegs.length === 0) {
        setUploadError("No valid airport ICAO codes found in the document. Please check the file format.");
        return;
      }

      const newLegs: LegData[] = parsedLegs.map((pl) => ({
        ...createEmptyLeg(),
        airportIcao: pl.icao.toUpperCase(),
        arrivalDate: pl.arrivalDate ? new Date(pl.arrivalDate) : undefined,
        arrivalTime: pl.arrivalTime || "",
        departureDate: pl.departureDate ? new Date(pl.departureDate) : undefined,
        departureTime: pl.departureTime || "",
      }));

      setLegs(newLegs);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  // Update fuel price for a specific leg
  const handleUpdateLegFuelPrice = useCallback((legIndex: number, priceUsd: number | null, note: string) => {
    setLegs(prev => prev.map((leg, i) =>
      i === legIndex ? { ...leg, fuelPriceUsd: priceUsd, fuelPriceNote: note } : leg
    ));
  }, []);

  // Reset
  const handleReset = () => {
    setAircraftType("");
    setFlightType("");
    setAircraftNationality("");
    setLegs([createEmptyLeg()]);
    setOverflightResults({});
    setOverflightLoading({});
    setVisaNationalities([""]);
    setVisaResults({});
    setVisaLoading({});
    setAircrewNationalities([""]);
    setAircrewVisaResults({});
    setAircrewVisaLoading({});
    setPetTypes([]);
    setPetResults({});
    setPetLoading({});
    setCabotageResult(null);
    setCabotageLoading(false);
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

  // Track which legs have auto-calculated arrival times
  const [autoCalcLegs, setAutoCalcLegs] = useState<Set<number>>(new Set());

  // Auto-populate arrival date/time for each leg from previous leg's departure + flight time
  useEffect(() => {
    if (legs.length < 2) return;
    const newAutoCalc = new Set<number>();
    let needsUpdate = false;
    const updates: { idx: number; arrivalDate: Date; arrivalTime: string }[] = [];

    for (let i = 1; i < legs.length; i++) {
      const currentLeg = legs[i];
      // Skip legs where the user has manually edited arrival fields
      if (currentLeg.arrivalManuallyEdited) continue;

      const prevLeg = legs[i - 1];
      const calc = flightCalcs[i - 1];
      if (!prevLeg.departureDate || !prevLeg.departureTime || !calc || calc.flightTimeMinutes <= 0) continue;

      // Compute arrival = departure + flight time
      const [dh, dm] = prevLeg.departureTime.split(':').map(Number);
      const depUtc = new Date(Date.UTC(
        prevLeg.departureDate.getFullYear(),
        prevLeg.departureDate.getMonth(),
        prevLeg.departureDate.getDate(),
        dh, dm,
      ));
      const arrUtc = new Date(depUtc.getTime() + calc.flightTimeMinutes * 60 * 1000);

      const arrDate = new Date(arrUtc.getUTCFullYear(), arrUtc.getUTCMonth(), arrUtc.getUTCDate());

      // Round to nearest 15 min
      const totalMin = arrUtc.getUTCHours() * 60 + arrUtc.getUTCMinutes();
      const rounded = Math.round(totalMin / 15) * 15;
      const wrappedMin = ((rounded % 1440) + 1440) % 1440;
      const roundedTime = `${String(Math.floor(wrappedMin / 60)).padStart(2, '0')}:${String(wrappedMin % 60).padStart(2, '0')}`;
      // If rounded past midnight, adjust date
      const finalDate = rounded >= 1440 ? new Date(arrDate.getTime() + 86400000) : arrDate;
      const finalTime = roundedTime;

      // Only auto-populate if different from current value
      const currentArrDateStr = currentLeg.arrivalDate?.toDateString();
      const newArrDateStr = finalDate.toDateString();
      if (currentArrDateStr !== newArrDateStr || currentLeg.arrivalTime !== finalTime) {
        updates.push({ idx: i, arrivalDate: finalDate, arrivalTime: finalTime });
      }
      newAutoCalc.add(i);
    }

    setAutoCalcLegs(newAutoCalc);

    if (updates.length > 0) {
      setLegs(prev => prev.map((leg, i) => {
        const upd = updates.find(u => u.idx === i);
        if (!upd) return leg;
        return { ...leg, arrivalDate: upd.arrivalDate, arrivalTime: upd.arrivalTime };
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // Re-run when departure times, dates, or flight calcs change
    ...legs.map(l => l.departureTime),
    ...legs.map(l => l.departureDate?.getTime()),
    JSON.stringify(Object.entries(flightCalcs).map(([k, v]) => [k, v.flightTimeMinutes])),
  ]);

  // ── Landing-country overflight exemption ────────────────────────────
  // Collect all countries where the aircraft lands (departs from or arrives at)
  // across the entire route. Overflight permits for these countries are waived.
  const landingCountriesLower = useMemo(() => {
    const countries = new Set<string>();
    legs.forEach(leg => {
      const c = leg.permitResult?.country || leg.chargesResult?.country || leg.pprResult?.country;
      if (c) countries.add(c.toLowerCase());
    });
    // Also include origin/destination from overflight results themselves
    Object.values(overflightResults).forEach(r => {
      if (r?.originCountry) countries.add(r.originCountry.toLowerCase());
      if (r?.destinationCountry) countries.add(r.destinationCountry.toLowerCase());
    });
    return countries;
  }, [legs, overflightResults]);

  // Post-process overflight results: exempt landing countries from permit requirements
  const processedOverflightResults = useMemo(() => {
    const processed: Record<number, OverflightResult | null> = {};
    for (const [key, result] of Object.entries(overflightResults)) {
      const idx = Number(key);
      if (!result || !result.countries) {
        processed[idx] = result;
        continue;
      }
      // Build set of landing countries for THIS sector too (origin + destination)
      const sectorLanding = new Set(landingCountriesLower);
      if (result.originCountry) sectorLanding.add(result.originCountry.toLowerCase());
      if (result.destinationCountry) sectorLanding.add(result.destinationCountry.toLowerCase());

      const updatedCountries = result.countries.map(c => {
        if (
          (c.overflightPermitRequired === 'yes' || c.overflightPermitRequired === 'conditional') &&
          sectorLanding.has(c.country.toLowerCase())
        ) {
          return {
            ...c,
            overflightPermitRequired: 'no' as const,
            notes: 'Not Required – Covered by Landing Permit',
          };
        }
        return c;
      });
      const totalPermitsNeeded = updatedCountries.filter(
        c => c.overflightPermitRequired === 'yes' || c.overflightPermitRequired === 'conditional'
      ).length;
      processed[idx] = { ...result, countries: updatedCountries, totalPermitsNeeded };
    }
    return processed;
  }, [overflightResults, landingCountriesLower]);

  // Compute trip totals
  const isFormReady = !!aircraftType && !!flightType;

  const totalCharges = legs.reduce((sum, l) => sum + (l.chargesResult?.totalEstimateUsd ?? 0), 0);
  const totalOverflightCharges = Object.values(processedOverflightResults).reduce(
    (sum, r) => sum + (r?.totalOverflightChargesUsd ?? 0), 0
  );
  const totalAegFees = legs.reduce((sum, leg) => {
    const overflightResult = processedOverflightResults[legs.indexOf(leg)] ?? null;
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
      <header className="border-b bg-white shadow-sm sticky top-0 z-40">
        <div className="container mx-auto flex items-center py-2 px-4 sm:px-6 gap-4">
          {/* Logo */}
          <a href="https://www.aegfuels.com" target="_blank" rel="noopener noreferrer" className="shrink-0 flex items-center">
            <img src={aegLogo} alt="AEG Fuels" className="h-[60px] sm:h-[90px] md:h-[120px] w-auto" />
          </a>

          {/* Divider */}
          <Separator orientation="vertical" className="h-8 bg-border shrink-0" />

          {/* Product title */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center justify-center h-7 w-7 rounded-md bg-primary/10">
              <Plane className="h-4 w-4 text-primary" />
            </div>
            <p className="text-sm sm:text-base font-semibold text-foreground leading-none">Trip Feasibility Check</p>
          </div>

          {/* Right side CTA */}
          <div className="ml-auto flex items-center gap-3">
            <a
              href="https://www.aegfuels.com/flightsupport"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
              onClick={(e) => { e.preventDefault(); setShowVideoModal(true); }}
            >
              <Globe className="h-3.5 w-3.5" />
              AEG Trip Planning
            </a>
            <a
              href="https://www.aegfuels.com/flightsupport"
              target="_blank"
              rel="noopener noreferrer"
              className="sm:hidden flex items-center justify-center h-8 w-8 rounded-md border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
              aria-label="AEG Trip Planning"
              onClick={(e) => { e.preventDefault(); setShowVideoModal(true); }}
            >
              <Globe className="h-4 w-4" />
            </a>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-3 sm:px-6 py-4 sm:py-8 pb-32 space-y-4 sm:space-y-6">
        {/* Shared Trip Config */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Trip Configuration</CardTitle>
            <p className="text-sm text-muted-foreground">
              Set aircraft and flight type, then add legs for each stop.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Aircraft Type <span className="text-destructive">*</span></Label>
                <AircraftTypeCombobox
                  value={aircraftType}
                  onChange={(v) => { setAircraftType(v); setCheckAllError(null); }}
                  hasError={!aircraftType && !!checkAllError}
                />
              </div>
              <div className="space-y-2">
                <Label>Flight Type <span className="text-destructive">*</span></Label>
                <Select value={flightType} onValueChange={(v) => { setFlightType(v); setCheckAllError(null); }}>
                  <SelectTrigger className={cn(!flightType && checkAllError ? "border-destructive ring-1 ring-destructive" : "")}><SelectValue placeholder="Select flight type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">Private (Non-Commercial)</SelectItem>
                    <SelectItem value="non-scheduled-commercial">Non-Scheduled Commercial</SelectItem>
                    <SelectItem value="commercial">Commercial (Scheduled)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                Aircraft Nationality
                <span className="text-xs text-muted-foreground font-normal">(country of registration — affects permit &amp; TCO requirements)</span>
              </Label>
              <NationalityCombobox
                value={aircraftNationality}
                onChange={setAircraftNationality}
                placeholder="Select country of registration…"
              />
            </div>
          </CardContent>
        </Card>

        {/* Everything below is locked until aircraft + flight type are chosen */}
        <div className={cn("space-y-6 transition-opacity duration-200", !isFormReady && "opacity-40 pointer-events-none select-none")}>
        {!isFormReady && (
          <p className="text-center text-sm text-muted-foreground font-medium py-2">
            Select an Aircraft Type and Flight Type above to begin.
          </p>
        )}

        {/* Trip Legs */}
        <div className="space-y-4">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.pdf,.doc,.docx,.csv,.xls,.xlsx,.md,.rtf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleDocumentUpload(f);
            }}
          />
          <div
            className={cn(
              "relative rounded-lg border-2 border-dashed transition-colors p-3",
              isDragOver ? "border-primary bg-primary/5" : "border-transparent"
            )}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current++; setIsDragOver(true); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current--; if (dragCounter.current === 0) setIsDragOver(false); }}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation();
              dragCounter.current = 0; setIsDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleDocumentUpload(f);
            }}
          >
            {isDragOver && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-primary/10 z-10 pointer-events-none">
                <p className="text-sm font-medium text-primary flex items-center gap-2"><Upload className="h-4 w-4" /> Drop schedule file here</p>
              </div>
            )}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">Trip Legs</h2>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Add multiple legs inline control */}
              <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Add</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  defaultValue={1}
                  id="add-legs-count"
                  className="w-10 text-xs text-center bg-transparent border-0 outline-none focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">leg(s)</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs px-2 gap-1"
                  onClick={() => {
                    const input = document.getElementById('add-legs-count') as HTMLInputElement;
                    const count = Math.min(20, Math.max(1, parseInt(input?.value || '1', 10) || 1));
                    setLegs(prev => [...prev, ...Array.from({ length: count }, () => createEmptyLeg())]);
                  }}
                >
                  <Plus className="h-3 w-3" />
                  Add
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadLoading}
                className="gap-2 text-xs"
              >
                {uploadLoading ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Parsing…</>
                ) : (
                  <><Upload className="h-3.5 w-3.5" /> Import Schedule</>
                )}
              </Button>
            </div>
          </div>
          </div>

          {/* Overflight auto-run toggle */}
          <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <Switch
              id="auto-overflight-toggle"
              checked={autoRunOverflights}
              onCheckedChange={(checked) => {
                setAutoRunOverflights(checked);
                if (!checked) {
                  setOverflightResults({});
                  setOverflightLoading({});
                }
              }}
            />
            <div className="flex flex-col">
              <Label htmlFor="auto-overflight-toggle" className="text-sm font-medium cursor-pointer">
                Add Overflight Analysis
              </Label>
              <p className="text-xs text-muted-foreground">
                {autoRunOverflights
                  ? 'Overflight permit & charge checks will run when you click Run Feasibility Check.'
                  : 'Off — overflight checks will not run with feasibility check.'}
              </p>
            </div>
            {autoRunOverflights && Object.values(overflightLoading).some(Boolean) && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-auto" />
            )}
          </div>

          {uploadError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {uploadError}
            </div>
          )}

          {/* Leg Navigation Bar */}
          {legs.length > 1 && (
            <div className="sticky top-[calc(var(--header-h,76px))] z-30 bg-background/95 backdrop-blur-sm border rounded-lg shadow-sm py-2 px-2 flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                disabled={currentLegIndex === 0}
                onClick={() => setCurrentLegIndex(prev => Math.max(0, prev - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex-1 overflow-x-auto scrollbar-hide">
                <div className="flex items-center gap-1">
                  {legs.map((leg, idx) => {
                    const label = leg.airportIcao || `Leg ${idx + 1}`;

                    const isCurrent = idx === currentLegIndex;
                    const hasFailed = leg.feasibilityResult?.feasible === false;
                    const hasPassed = leg.feasibilityResult?.feasible === true;

                    return (
                      <button
                        key={leg.id}
                        onClick={() => setCurrentLegIndex(idx)}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all",
                          isCurrent
                            ? hasFailed
                              ? "bg-destructive text-destructive-foreground shadow-sm"
                              : hasPassed
                                ? "bg-success text-success-foreground shadow-sm"
                                : "bg-primary text-primary-foreground shadow-sm"
                            : hasFailed
                              ? "bg-destructive/15 text-destructive border border-destructive/30"
                              : hasPassed
                                ? "bg-success/15 text-success border border-success/30"
                                : "bg-muted hover:bg-muted/80 text-muted-foreground",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                disabled={currentLegIndex >= legs.length - 1}
                onClick={() => setCurrentLegIndex(prev => Math.min(legs.length - 1, prev + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* All Legs (hidden when not current, so lookup refs stay registered) */}
          {legs.map((leg, idx) => {
            const isCurrent = idx === currentLegIndex;
            return (
            <div key={leg.id} id={`leg-${idx}`} className={isCurrent ? undefined : "hidden"}>
              <TripLegCard
                leg={leg}
                legIndex={idx}
                totalLegs={legs.length}
                aircraftType={aircraftType}
                flightType={flightType}
                aircraftNationality={aircraftNationality}
                overflightResult={processedOverflightResults[idx] ?? null}
                previousLegDepartureDate={idx > 0 ? legs[idx - 1].departureDate : undefined}
                nextLegIcao={idx < legs.length - 1 ? legs[idx + 1].airportIcao : undefined}
                prevLegIcao={idx > 0 ? legs[idx - 1].airportIcao : undefined}
                arrivalAutoCalculated={autoCalcLegs.has(idx)}
                expanded={isLegExpanded(idx)}
                onToggleExpanded={() => toggleLegExpanded(idx)}
                onUpdateLeg={updateLeg}
                onRemoveLeg={removeLeg}
                onRegisterLookup={registerLegLookup}
                onNavigateLeg={(toIndex) => setCurrentLegIndex(toIndex)}
                onRefreshLeg={(index) => {
                  feasibilityTriggered.current = true;
                  setTimeout(() => {
                    setLegs(prev => prev.map((l, i) =>
                      i === index
                        ? { ...l, feasibilityResult: evaluateLegFeasibility(l, aircraftType, i, prev.length, i > 0 ? prev[i - 1].airportIcao : undefined) }
                        : l
                    ));
                  }, 300);
                }}
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
                    {processedOverflightResults[idx] && !overflightLoading[idx] &&
                      leg.runwayResult?.latitude != null && leg.runwayResult?.longitude != null &&
                      legs[idx + 1]?.runwayResult?.latitude != null && legs[idx + 1]?.runwayResult?.longitude != null && (
                      <RouteMapPreview
                        origin={{ icao: leg.airportIcao, lat: leg.runwayResult.latitude, lon: leg.runwayResult.longitude }}
                        destination={{ icao: legs[idx + 1].airportIcao, lat: legs[idx + 1].runwayResult!.latitude!, lon: legs[idx + 1].runwayResult!.longitude! }}
                        overflightResult={processedOverflightResults[idx]!}
                      />
                    )}
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

                  {processedOverflightResults[idx] && !overflightLoading[idx] && isLegExpanded(idx) && (
                    <div className={cn("rounded-md border p-3 text-xs space-y-1.5",
                      processedOverflightResults[idx]!.success ? "border-primary/30 bg-primary/5" : "border-muted bg-muted/50"
                    )}>
                      {processedOverflightResults[idx]!.routeSummary && (
                        <p className="text-muted-foreground">{processedOverflightResults[idx]!.routeSummary}</p>
                      )}
                      {processedOverflightResults[idx]!.totalPermitsNeeded != null && (
                        <p className="font-medium">
                          {processedOverflightResults[idx]!.totalPermitsNeeded === 0
                            ? '✅ No permits required'
                            : `⚠️ ${processedOverflightResults[idx]!.totalPermitsNeeded} permit${processedOverflightResults[idx]!.totalPermitsNeeded! > 1 ? 's' : ''} required`}
                        </p>
                      )}
                      {processedOverflightResults[idx]!.totalOverflightChargesUsd != null && (
                        <p className="font-medium flex items-center gap-1">
                          <DollarSign className="h-3 w-3 text-primary" />
                          Navigation fees: ${processedOverflightResults[idx]!.totalOverflightChargesUsd!.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD
                        </p>
                      )}
                      {processedOverflightResults[idx]!.countries && (
                        <div className="space-y-1">
                          {processedOverflightResults[idx]!.countries!.map((c, ci) => (
                            <div key={ci} className={cn("rounded bg-background/50 px-2 py-1 space-y-0.5",
                              c.overflightPermitRequired === 'yes' ? "border-l-2 border-l-warning" : c.overflightPermitRequired === 'no' ? "border-l-2 border-l-success" : "border-l-2 border-l-muted-foreground"
                            )}>
                              <p className="font-medium">
                                {c.overflightPermitRequired === 'yes' ? '⚠️' : '✅'} {c.country}
                                <span className="font-normal text-muted-foreground ml-1">
                                  — {c.notes === 'Not Required – Covered by Landing Permit'
                                    ? 'Not Required – Covered by Landing Permit'
                                    : c.overflightPermitRequired === 'yes' ? 'Permit required' : c.overflightPermitRequired === 'no' ? 'No permit' : 'Conditional'}
                                </span>
                              </p>
                              {c.leadTimeDays != null && <p>Lead time: {c.leadTimeDays}d</p>}
                              {c.overflightChargeUsd != null && <p>Charge: ~${c.overflightChargeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD</p>}
                              {c.notes && <p className="text-muted-foreground italic">{c.notes}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                      {processedOverflightResults[idx]!.error && (
                        <p className="text-destructive">{processedOverflightResults[idx]!.error}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Add Leg button after each leg */}
              <div className="flex justify-center mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    insertLegAfter(idx);
                    setCurrentLegIndex(idx + 1);
                  }}
                  className="text-xs border-dashed"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Leg
                </Button>
              </div>
            </div>
            );
          })}
        </div>

        {/* Cabotage Analysis */}
        {(cabotageLoading || cabotageResult) && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">Cabotage Analysis</span>
                {cabotageLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>

              {cabotageLoading && (
                <div className="rounded-md border p-2 text-xs flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Analyzing route for cabotage restrictions…
                </div>
              )}

              {cabotageResult && !cabotageLoading && (
                <div className="space-y-2 text-xs">
                  {cabotageResult.error ? (
                    <p className="text-destructive">{cabotageResult.error}</p>
                  ) : (
                    <>
                      <div className={cn("rounded-md border p-3",
                        cabotageResult.overallRisk === 'none' ? "border-success/30 bg-success/5" :
                        cabotageResult.overallRisk === 'low' ? "border-warning/30 bg-warning/5" :
                        cabotageResult.overallRisk === 'medium' ? "border-warning/50 bg-warning/10" :
                        "border-destructive/40 bg-destructive/5"
                      )}>
                        <p className="font-medium mb-1">
                          {cabotageResult.overallRisk === 'none' ? '✅ No cabotage risk' :
                           cabotageResult.overallRisk === 'low' ? '⚠️ Low cabotage risk' :
                           cabotageResult.overallRisk === 'medium' ? '⚠️ Medium cabotage risk' :
                           '🚫 High cabotage risk'}
                        </p>
                        {cabotageResult.summary && (
                          <p className="text-muted-foreground">{cabotageResult.summary}</p>
                        )}
                      </div>

                      {cabotageResult.legAnalysis && cabotageResult.legAnalysis.length > 0 && (
                        <div className="space-y-1">
                          {cabotageResult.legAnalysis.map((la, i) => (
                            <div key={i} className={cn("rounded bg-background/50 px-2 py-1.5 space-y-0.5",
                              la.isCabotageRisk
                                ? "border-l-2 border-l-destructive"
                                : "border-l-2 border-l-success"
                            )}>
                              <p className="font-medium">
                                {la.isCabotageRisk ? '⚠️' : '✅'} {la.fromIcao} → {la.toIcao}
                                {la.fromCountry && la.toCountry && (
                                  <span className="font-normal text-muted-foreground ml-1">
                                    ({la.fromCountry} → {la.toCountry})
                                  </span>
                                )}
                              </p>
                              <p className="text-muted-foreground">{la.reason}</p>
                              {la.exemptions && <p className="text-muted-foreground italic">Exemptions: {la.exemptions}</p>}
                              {la.applicableLaw && <p className="text-muted-foreground italic">Law: {la.applicableLaw}</p>}
                            </div>
                          ))}
                        </div>
                      )}

                      {cabotageResult.recommendations && (
                        <p className="text-muted-foreground italic mt-1">{cabotageResult.recommendations}</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

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
                        <span>Navigation fees:</span>
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

        {/* Fuel Tankering Analysis */}
        {legs.length >= 2 && (
          <FuelTankeringPanel
            legs={legs}
            flightCalcs={flightCalcs}
            aircraftType={aircraftType}
            onUpdateLegFuelPrice={handleUpdateLegFuelPrice}
          />
        )}

        {/* Passenger Visa Requirements */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4" /> Passenger Visa Requirements
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
              Check Passenger Visa Requirements ({destinationIcaos.length} destination{destinationIcaos.length !== 1 ? 's' : ''})
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

        {/* Aircrew Visa Requirements */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Plane className="h-4 w-4" /> Aircrew Visa Requirements
            </CardTitle>
            {destinationIcaos.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Destinations detected: {destinationIcaos.join(', ')}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs">Aircrew Nationalities</Label>
              {aircrewNationalities.map((nat, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <Select
                    value={nat}
                    onValueChange={(v) => {
                      const updated = [...aircrewNationalities];
                      updated[idx] = v;
                      setAircrewNationalities(updated);
                      setAircrewVisaResults({});
                    }}
                  >
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select nationality" /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      <SelectItem value="United States of America">United States of America</SelectItem>
                      <Separator className="my-1" />
                      {COUNTRIES.filter(c => c !== "United States of America").map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {aircrewNationalities.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" className="shrink-0 h-9 w-9"
                      onClick={() => { setAircrewNationalities(aircrewNationalities.filter((_, i) => i !== idx)); setAircrewVisaResults({}); }}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setAircrewNationalities([...aircrewNationalities, ""])} className="text-xs">
                <Plus className="h-3 w-3 mr-1" /> Add Crew Member
              </Button>
            </div>

            <Button type="button" variant="secondary" onClick={handleAircrewVisaCheck}
              disabled={destinationIcaos.length === 0 || aircrewNationalities.filter(n => n).length === 0 || Object.values(aircrewVisaLoading).some(Boolean)}
              className="w-full">
              {Object.values(aircrewVisaLoading).some(Boolean) ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Plane className="h-4 w-4 mr-1.5" />}
              Check Aircrew Visa Requirements ({destinationIcaos.length} destination{destinationIcaos.length !== 1 ? 's' : ''})
            </Button>

            {/* Results per destination */}
            {destinationIcaos.map(icao => (
              <div key={icao}>
                {aircrewVisaLoading[icao] && (
                  <div className="rounded-md border p-3 text-sm flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking aircrew visa for {icao}…
                  </div>
                )}

                {aircrewVisaResults[icao] && !aircrewVisaLoading[icao] && (
                  <div className={cn("rounded-md border p-3 text-sm space-y-2", aircrewVisaResults[icao]!.success ? "border-primary/30 bg-primary/5" : "border-muted bg-muted/50")}>
                    <div className="flex items-center gap-1.5 font-medium">
                      <Plane className="h-3.5 w-3.5 text-primary" />
                      {icao} — {aircrewVisaResults[icao]!.destinationCountry || 'Unknown'}
                    </div>
                    {aircrewVisaResults[icao]!.results?.map((r, i) => (
                      <div key={i} className={cn("rounded bg-background/50 px-2 py-1.5 text-xs space-y-0.5",
                        r.visaRequired === 'yes' ? "border-l-2 border-l-destructive" : r.visaRequired === 'no' ? "border-l-2 border-l-success" : "border-l-2 border-l-warning"
                      )}>
                        <p className="font-medium">
                          {r.visaRequired === 'yes' ? '❌' : r.visaRequired === 'no' ? '✅' : '⚠️'} {r.nationality}
                          <span className="font-normal text-muted-foreground ml-1">
                            — {r.visaRequired === 'yes' ? 'Visa required' : r.visaRequired === 'no' ? 'Visa-free / Crew exemption' : 'Conditional'}
                          </span>
                        </p>
                        {r.visaType && <p><span className="font-medium">Visa type:</span> {r.visaType}</p>}
                        {r.visaOnArrival && <p className="text-success">✅ Visa on arrival</p>}
                        {r.eVisaAvailable && <p className="text-success">✅ e-Visa available</p>}
                        {r.maxStayDays != null && <p><span className="font-medium">Max stay:</span> {r.maxStayDays} days</p>}
                        {r.processingTimeDays != null && <p><span className="font-medium">Processing:</span> ~{r.processingTimeDays} days</p>}
                        {r.transitVisaRequired && <p className="text-warning">⚠️ Transit visa required</p>}
                        {r.conditions && <p><span className="font-medium">Conditions:</span> {r.conditions}</p>}
                        {r.notes && <p className="text-muted-foreground italic">{r.notes}</p>}
                      </div>
                    ))}
                    {aircrewVisaResults[icao]!.notes && (
                      <p className="text-xs text-muted-foreground italic">{aircrewVisaResults[icao]!.notes}</p>
                    )}
                    {aircrewVisaResults[icao]!.error && <p className="text-xs text-destructive">{aircrewVisaResults[icao]!.error}</p>}
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
        </div> {/* end locked wrapper */}
      </main>

      {/* Floating action toolbar */}
      {legs.some(l => l.airportIcao.length === 4) && (
        <div className="fixed bottom-6 right-6 z-50">
          <div className="flex flex-col gap-1 bg-background/95 backdrop-blur-sm border rounded-xl shadow-xl p-2 min-w-[160px]">
            <Button
              size="sm"
              className="justify-start gap-2 w-full"
              onClick={handleCheckAll}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Run Feasibility Check
            </Button>
            {checkAllError && (
              <p className="text-xs text-destructive leading-snug px-1">{checkAllError}</p>
            )}
            <Button
              variant="secondary"
              size="sm"
              className="justify-start gap-2 w-full"
              onClick={() => { handleCheckAll(); }}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh All
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
                      aircraftType, flightType, legs, overflightResults: processedOverflightResults,
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
                      aircraftType, flightType, legs, overflightResults: processedOverflightResults,
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
      <VideoModal
        open={showVideoModal}
        onClose={() => setShowVideoModal(false)}
        redirectUrl="https://www.aegfuels.com/flightsupport"
      />
    </div>
  );
}
