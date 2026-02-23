// ══════════════════════════════════════════════════════════════════════
// OVERFLIGHT ANALYSIS — Logic & Design Reference
// ══════════════════════════════════════════════════════════════════════
// This file documents how overflight countries and charges are
// calculated in the Trip Feasibility Check application.
// It is an export-only reference file (not imported at runtime).
// ══════════════════════════════════════════════════════════════════════

// ── 1. DATA TYPES ────────────────────────────────────────────────────

export interface OverflightCountry {
  country: string;
  overflightPermitRequired: 'yes' | 'no' | 'conditional';
  permitType?: string;
  leadTimeDays?: number;
  issuingAuthority?: string;
  conditions?: string;
  notes?: string;
  /** Estimated overflight / air-navigation charge in USD */
  overflightChargeUsd?: number;
  /** How the charge was calculated (weight factor, distance, unit rate, etc.) */
  chargeBasis?: string;
}

export interface OverflightResult {
  success: boolean;
  originIcao?: string;
  destinationIcao?: string;
  originAirport?: string;
  originCountry?: string;
  destinationAirport?: string;
  destinationCountry?: string;
  /** Human-readable summary of the great-circle route */
  routeSummary?: string;
  /** Ordered list of countries whose airspace is crossed */
  countries?: OverflightCountry[];
  /** Total permits needed (countries with 'yes' or 'conditional') */
  totalPermitsNeeded?: number;
  /** Longest lead time across all countries */
  maxLeadTimeDays?: number;
  /** Sum of all per-country overflightChargeUsd values */
  totalOverflightChargesUsd?: number;
  notes?: string;
  confidence?: 'high' | 'medium' | 'low';
  error?: string;
}

// ── 2. TRIGGER MECHANISM ─────────────────────────────────────────────
//
// Overflight analysis does NOT run automatically when ICAO codes are entered.
// It is controlled by two mechanisms:
//
// a) "Add Overflight Analysis" toggle (autoRunOverflights state)
//    - When ON, overflights are automatically included when the user
//      clicks "Run Feasibility Check".
//    - When OFF, overflight checks are skipped during bulk runs.
//
// b) Per-sector "Check" button
//    - Each pair of consecutive legs shows a "Check" button that
//      triggers an individual overflight lookup for that sector.
//
// Both call the same handler: handleOverflightBetweenLegs(fromIdx)
//

// ── 3. EDGE FUNCTION CALL ────────────────────────────────────────────
//
// Frontend invokes the Supabase Edge Function:
//
//   supabase.functions.invoke('overflight-permits', {
//     body: {
//       originIcao:      leg[fromIdx].airportIcao,   // e.g. "KJFK"
//       destinationIcao: leg[fromIdx+1].airportIcao,  // e.g. "EGLL"
//       flightType:      flightType,                  // "private" | "non-scheduled-commercial" | "commercial"
//       aircraftType:    aircraftType,                // e.g. "Bombardier Global 7500"
//     },
//   });
//
// The Edge Function does two things:
//
// STEP 1 — Perplexity grounding (optional, if PERPLEXITY_API_KEY is set)
//   • Sends a query to Perplexity sonar-pro asking about overflight
//     permit requirements and air navigation charges for the route.
//   • Domain filter restricts to official sources:
//     ead.eurocontrol.int, eurocontrol.int, icao.int, faa.gov,
//     caa.co.uk, easa.europa.eu, iata.org, gcaa.gov.ae, caac.gov.cn
//   • The response text is injected into the AI prompt as grounding context.
//
// STEP 2 — AI structured extraction (Gemini 2.5 Flash via Lovable AI Gateway)
//   • A detailed prompt asks the model to:
//     1. Determine the great-circle route between the two airports.
//     2. Identify ALL countries whose airspace is crossed or closely skirted.
//     3. For each country, determine:
//        - Whether a foreign-registered aircraft needs an overflight permit
//        - Whether the flight type affects the requirement
//        - Typical lead time for obtaining the permit
//        - The issuing authority
//        - Special conditions or exemptions (EU/EASA, bilateral agreements)
//        - Whether diplomatic clearance is needed
//        - Estimated overflight/air navigation charges in USD
//        - Basis for the charge calculation (weight factor, distance, unit rate)
//   • The model is forced to call the `extract_overflight_permits` tool,
//     returning structured JSON matching the OverflightResult schema above.
//   • If no aircraft type is specified, a mid-size business jet (~15,000 kg MTOW)
//     is assumed for charge calculations.
//   • Up to 2 retry attempts if the AI fails to return a tool call.

// ── 4. CHARGE CALCULATION LOGIC ──────────────────────────────────────
//
// Charges are estimated BY THE AI based on:
//   • MTOW of the aircraft (weight factor)
//   • Distance through each country's airspace (distance factor)
//   • Published Eurocontrol/IATA rates or national ANS fee schedules
//   • The charge basis is returned per-country (e.g. "Eurocontrol formula:
//     unit rate × distance factor × weight factor")
//
// The frontend sums per-country charges:
//   totalOverflightChargesUsd = sum of all country.overflightChargeUsd
//
// These are labelled "Navigation fees" in the UI to distinguish from
// administrative permit processing fees (which are separate AEG Set Up Fees).

// ── 5. AEG SET UP FEE INTEGRATION ───────────────────────────────────
//
// The "Overflight Permit" AEG service ($255/permit) auto-scales based on
// overflight results. The logic:
//
//   1. From the overflight result for the departing sector, filter countries
//      where overflightPermitRequired === 'yes' or 'conditional'.
//   2. EXCLUDE the origin and destination countries (they are landing
//      countries, not overflown).
//   3. Count remaining = overflightPermitsNeeded.
//   4. If overflightPermitsNeeded > 1, multiply the $255 unit cost:
//        effectiveCost = 255 × overflightPermitsNeeded
//   5. The UI shows "N permits required (Country1, Country2, ...)"
//      next to the overflight permit checkbox.
//
// If overflight analysis hasn't been run yet, the UI shows:
//   "Run overflight lookup to auto-calculate"

// ── 6. UI RENDERING ─────────────────────────────────────────────────
//
// Between each pair of consecutive legs, an overflight panel appears:
//
// ┌─────────────────────────────────────────────────┐
// │ Overflight: KJFK → EGLL            [Check]     │
// ├─────────────────────────────────────────────────┤
// │ Route summary text...                          │
// │ ⚠️ 2 permits required                          │
// │ 💲 Navigation fees: $1,234 USD                 │
// │                                                 │
// │ ┌ ✅ Canada — No permit ─────────────────────┐ │
// │ │ Charge: ~$180 USD                           │ │
// │ │ ICAO bilateral exemption for GA flights     │ │
// │ └────────────────────────────────────────────┘ │
// │ ┌ ⚠️ Iceland — Permit required ──────────────┐ │
// │ │ Lead time: 3d                               │ │
// │ │ Charge: ~$95 USD                            │ │
// │ └────────────────────────────────────────────┘ │
// │ ┌ ✅ United Kingdom — No permit ─────────────┐ │
// │ │ Charge: ~$420 USD                           │ │
// │ └────────────────────────────────────────────┘ │
// └─────────────────────────────────────────────────┘
//
// Color coding:
//   • Green left border (border-l-success): No permit required
//   • Yellow left border (border-l-warning): Permit required
//   • Gray left border (border-l-muted-foreground): Conditional
//
// The overflight country list is only shown when the leg is expanded
// (synchronized with the expanded/collapsed state of TripLegCard).

// ── 7. COST SUMMARY INTEGRATION ─────────────────────────────────────
//
// In the bottom cost summary card, overflight charges appear as a
// separate line item:
//
//   Airport charges:   $X,XXX
//   Navigation fees:   $X,XXX    ← sum of all overflight charges
//   AEG Set Up fees:   $X,XXX    ← includes scaled permit fees
//   ─────────────────────────
//   Total:             $XX,XXX

// ── 8. STATE MANAGEMENT ─────────────────────────────────────────────
//
// overflightResults: Record<number, OverflightResult | null>
//   Keyed by leg index (the departing leg of the pair).
//   e.g. overflightResults[0] = result for leg 0 → leg 1
//
// overflightLoading: Record<number, boolean>
//   Loading state per leg pair.
//
// When legs are removed, overflight results are re-indexed to maintain
// correct associations. When the form is reset, all results are cleared.
