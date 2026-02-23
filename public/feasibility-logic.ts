// ══════════════════════════════════════════════════════════════════════
// FEASIBILITY CHECK — Logic & Design Reference
// ══════════════════════════════════════════════════════════════════════
// This file documents the complete feasibility check architecture,
// including per-leg lookups, evaluation logic, and orchestration.
// It is an export-only reference file (not imported at runtime).
// ══════════════════════════════════════════════════════════════════════

// ── 1. ARCHITECTURE OVERVIEW ─────────────────────────────────────────
//
// The feasibility check is a multi-step evaluation of each trip leg:
//
//  ┌──────────────────┐
//  │ Trip Configuration│  ← Aircraft Type, Flight Type, Aircraft Nationality
//  └────────┬─────────┘
//           │
//  ┌────────▼─────────┐
//  │   Per-Leg Data    │  ← ICAO, dates/times (UTC), runway override, fuel price
//  └────────┬─────────┘
//           │  "Run Feasibility Check" button
//           │
//  ┌────────▼─────────────────────────────────────────────────┐
//  │  7 Parallel Edge Function Lookups per leg:               │
//  │  1. CBP Lookup (US airports) OR CIQ Lookup (non-US)     │
//  │  2. Runway Lookup                                        │
//  │  3. Permit Lookup (landing permits, TCO)                 │
//  │  4. Charges Lookup (landing/parking fees)                │
//  │  5. PPR Lookup (Prior Permission Required + slots)       │
//  │  6. Airport Hours & NOTAM Lookup                         │
//  │  7. Airport Info (auto-fetches city/timezone on ICAO)    │
//  └────────┬─────────────────────────────────────────────────┘
//           │
//  ┌────────▼─────────────────────────────────────────────────┐
//  │  evaluateLegFeasibility()                                │
//  │  → Collects issues[] and notes[] from all lookup results │
//  │  → Returns { feasible: boolean, issues, notes }          │
//  └──────────────────────────────────────────────────────────┘
//
// NOTHING runs automatically on ICAO entry (except airport-info for
// city name and timezone). All operational lookups require the user
// to click "Run Feasibility Check".

// ── 2. EDGE FUNCTIONS CALLED ─────────────────────────────────────────
//
// All edge functions use the same pattern:
//   supabase.functions.invoke('<function-name>', { body: { ... } })
//
// ┌──────────────────────┬─────────────────────────────────────────────┐
// │ Function             │ Parameters                                 │
// ├──────────────────────┼─────────────────────────────────────────────┤
// │ airport-info         │ { icao }                                   │
// │                      │ → Returns municipality, utcOffsetHours     │
// │                      │ → Auto-fires when 4-char ICAO entered     │
// ├──────────────────────┼─────────────────────────────────────────────┤
// │ cbp-lookup           │ { icao }                                   │
// │                      │ → US airports only (K*, PA*, PH*, PG*, TJ*)│
// │                      │ → Returns customs availability, hours      │
// ├──────────────────────┼─────────────────────────────────────────────┤
// │ ciq-lookup           │ { icao }                                   │
// │                      │ → Non-US airports                          │
// │                      │ → Returns CIQ availability, port of entry  │
// ├──────────────────────┼─────────────────────────────────────────────┤
// │ runway-lookup        │ { icao }                                   │
// │                      │ → Returns runways[], longestRunwayFt,      │
// │                      │   latitude, longitude (used for GC calc)   │
// ├──────────────────────┼─────────────────────────────────────────────┤
// │ permit-lookup        │ { icao, flightType?, aircraftNationality? }│
// │                      │ → Returns permitRequired, leadTimeDays,    │
// │                      │   TCO info, charter permits, bilateral     │
// │                      │ → 'conditional' → only PPR/slot needed     │
// │                      │ → Part 91 'private' → conditional→'no'     │
// ├──────────────────────┼─────────────────────────────────────────────┤
// │ charges-lookup       │ { icao, aircraftType?, arrivalDate?,       │
// │                      │   arrivalTime?, departureDate?,            │
// │                      │   departureTime? }                         │
// │                      │ → Returns landing/parking/pax fees in USD  │
// ├──────────────────────┼─────────────────────────────────────────────┤
// │ ppr-lookup           │ { icao, flightType?, aircraftType? }       │
// │                      │ → Returns PPR requirement, slot required,  │
// │                      │   advance notice period, contact details   │
// ├──────────────────────┼─────────────────────────────────────────────┤
// │ airport-hours-notam  │ { icao, arrivalDate?, arrivalTime?,        │
// │                      │   departureDate?, departureTime?,          │
// │                      │   aircraftType?, flightType? }             │
// │                      │ → Returns operating hours, curfew,         │
// │                      │   active NOTAMs, fire category, de-icing   │
// └──────────────────────┴─────────────────────────────────────────────┘
//
// All AI-powered lookups use Perplexity sonar-pro for grounding
// (domain-filtered to official sources like AIPs, CAAs), then
// Gemini 2.5 Flash for structured extraction via tool calls.

// ── 3. LOOKUP ORCHESTRATION ──────────────────────────────────────────
//
// handleCheckAll() in FeasibilityForm.tsx:
//
//   1. Validates that Aircraft Type and Flight Type are selected
//   2. Sets feasibilityTriggered flag to true
//   3. Calls handleLookupAll() on each leg via registered refs
//   4. Each leg's handleLookupAll() fires 6-7 lookups IN PARALLEL:
//      - US airport? → CBP lookup (skip CIQ)
//      - Non-US?     → CIQ lookup (skip CBP)
//      - Always:     → Runway, Permit, Charges, PPR, Airport Hours
//   5. Runs initial evaluateLegFeasibility() with current data
//   6. If autoRunOverflights is ON → also fires overflight checks
//   7. If multi-leg → fires cabotage check after 2s delay
//
// As each lookup completes, it updates leg state via onUpdateLeg().
// A useEffect watches lookupSnapshot and re-evaluates feasibility
// whenever any lookup result changes.

// ── 4. FEASIBILITY EVALUATION LOGIC ─────────────────────────────────
//
// evaluateLegFeasibility(leg, aircraftType, legIndex, totalLegs)
// → Returns { feasible: boolean, issues: string[], notes: string[] }
//
// "issues" = problems that make the leg NOT feasible
// "notes"  = informational items (warnings, guidance)
//
// CHECKS PERFORMED (in order):
//
// A. BASIC VALIDATION
//    - Aircraft type must be specified
//    - ICAO code must be exactly 4 letters
//    - Arrival date/time required (except first leg of multi-leg)
//    - Departure date/time required (except last leg of multi-leg)
//    - Departure date must not be before arrival date
//
// B. PERMIT & PPR FLAGS
//    - If permitRequired → note: "Landing permit must be obtained"
//    - If pprRequired → note: "Prior Permission Required"
//    - If slotRequired → note: "Slot coordination required"
//
// C. CUSTOMS AVAILABILITY
//    - Only checked if a lookup has completed (CBP or CIQ)
//    - If customs not available → ISSUE (not feasible)
//
// D. PERMIT LEAD TIME
//    - Compares days until arrival vs. permitResult.leadTimeDays
//    - US airports: insufficient lead time → NOTE (guidance only)
//    - Non-US airports: insufficient lead time → ISSUE (not feasible)
//    - Message includes issuing authority name
//
// E. PPR LEAD TIME
//    - Parses advanceNoticePeriod as integer days
//    - If insufficient → ISSUE (not feasible)
//
// F. CBP OPERATING HOURS (US airports)
//    - Checks arrival/departure time against CBP open/close
//    - Outside hours → ISSUE
//    - Includes CBP notes if present
//
// G. RUNWAY LENGTH
//    - Uses runwayOverrideFt if set, otherwise longestRunwayFt
//    - Compared against AIRCRAFT_RUNWAY_REQ[aircraftType]
//    - Too short → ISSUE with specific measurements
//    - Adequate → NOTE with margin calculation
//    - Unknown → NOTE to verify manually
//
// H. AIRPORT OPERATING HOURS
//    - arrivalOutsideHours → ISSUE
//    - departureOutsideHours → ISSUE
//    - arrivalDuringCurfew → ISSUE (with curfew times)
//    - departureDuringCurfew → ISSUE (with curfew times)
//    - NOTAMs with affectsOperations=true:
//      - type='closure' → ISSUE
//      - other types → NOTE
//    - Seasonal restrictions → NOTE
//    - 24-hour operation → NOTE
//    - Standard hours → NOTE with times
//
// I. MULTI-LEG AWARENESS
//    - First leg: skip arrival-based checks (arrival fields hidden)
//    - Last leg: skip departure-based checks (departure fields hidden)
//    - Single leg: check both arrival and departure

// ── 5. TIME HANDLING ─────────────────────────────────────────────────
//
// All times are stored internally as UTC (HH:MM string).
// Each leg has a utcOffsetHours field (populated from airport-info).
//
// Display/entry can toggle between UTC and Local:
//   - utcToLocal(utcTime, offsetHours) → local display
//   - localToUtc(localTime, offsetHours) → stored UTC value
//
// Time range checks (CBP hours, airport hours) operate on UTC values.
// isTimeInRange(time, open, close) handles overnight ranges.

// ── 6. FLIGHT CALCULATIONS ──────────────────────────────────────────
//
// Between consecutive legs, the system calculates:
//   - Great-circle distance (Haversine formula, nautical miles)
//   - Estimated block time (cruise time + taxi/climb/descent overhead)
//   - Range check (distance vs. aircraft max range from AIRCRAFT_RANGE_NM)
//
// Source: src/lib/flightCalculations.ts
//
// greatCircleDistanceNm(lat1, lon1, lat2, lon2) → nm
// estimateFlightTimeMinutes(distanceNm, cruiseSpeedKtas) → minutes
//   Overhead: +15 min (<500 nm) or +25 min (>500 nm)
//
// Lat/lon coordinates come from runway-lookup results.
// Aircraft range/speed from src/data/aircraftPerformance.ts.

// ── 7. FUEL BURN & TANKERING ────────────────────────────────────────
//
// estimateBlockFuelGallons(aircraftType, distanceNm, cruiseKtas)
//   Uses class-based burn rates (GPH by regex pattern match):
//   - VLJ/turboprop: ~80 GPH
//   - Light jet: ~170 GPH
//   - Midsize: ~260 GPH
//   - Super-mid/large: ~400 GPH
//   - Ultra-long range: ~540 GPH
//   - Narrowbody: ~800 GPH
//   - Widebody: ~2400 GPH
//
// calculateTankering(blockFuel, priceAtDep, priceAtDest, mtowKg)
//   Compares cost of carrying extra fuel vs buying locally.
//   Weight penalty: 4% extra burn per full block load tankered.
//   Returns recommendation: 'tanker' | 'buy_local' | 'neutral'
//   Break-even spread = departurePrice × 0.04

// ── 8. ADDITIONAL ROUTE-LEVEL CHECKS ────────────────────────────────
//
// These run alongside or after per-leg checks:
//
// a) OVERFLIGHT ANALYSIS (see public/overflight-logic.ts)
//    - Toggle-controlled: autoRunOverflights state
//    - Checks overflight permits and navigation charges
//
// b) VISA CHECKS (passenger + aircrew)
//    - supabase.functions.invoke('visa-check', { body: {
//        nationalities: [...], destinationIcao, isAircrew? } })
//    - Runs for all unique destination ICAOs in parallel
//    - Passenger and aircrew nationalities tracked separately
//
// c) PET REQUIREMENTS
//    - supabase.functions.invoke('pet-requirements', { body: {
//        petTypes: [...], destinationIcao, originIcao? } })
//    - Checks vaccination, quarantine, import permits per country
//
// d) CABOTAGE CHECK (see knowledge://memory/features/cabotage-analysis)
//    - supabase.functions.invoke('cabotage-check', { body: {
//        legs: [{ icao, country? }],
//        aircraftNationality?, flightType?, aircraftType? } })
//    - Auto-runs for multi-leg trips after 2s delay
//    - Evaluates domestic transport risks per leg pair

// ── 9. COST SUMMARY ─────────────────────────────────────────────────
//
// Bottom of FeasibilityForm shows totals:
//
//   Airport charges:   sum of all legs chargesResult.totalEstimateUsd
//   Navigation fees:   sum of all overflightResults.totalOverflightChargesUsd
//   AEG Set Up fees:   sum of selected predefined + ad-hoc services per leg
//                      (overflight permit auto-scales by permits needed)
//   ───────────────
//   Total:             sum of above
//
// Also shows:
//   Total distance (nm), total flight time, range warnings,
//   overall feasibility status (all legs must pass + no range issues)

// ── 10. STATE MANAGEMENT ────────────────────────────────────────────
//
// FeasibilityForm.tsx state:
//
//   aircraftType: string              — selected aircraft
//   flightType: string                — "private" | "non-scheduled-commercial" | "commercial"
//   aircraftNationality: string       — country of registration
//   legs: LegData[]                   — array of trip legs (each has all lookup results)
//   autoRunOverflights: boolean       — toggle for overflight analysis
//   currentLegIndex: number           — which leg is currently displayed
//   expandedLegs: Record<number, boolean>
//   overflightResults: Record<number, OverflightResult | null>
//   overflightLoading: Record<number, boolean>
//   visaNationalities: string[]       — passenger nationalities to check
//   visaResults: Record<string, VisaCheckResult | null>  — keyed by ICAO
//   aircrewNationalities: string[]
//   aircrewVisaResults: Record<string, VisaCheckResult | null>
//   petTypes: string[]                — e.g. ["dog", "cat"]
//   petResults: Record<string, PetCheckResult | null>
//   cabotageResult: CabotageResult | null
//   flightCalcs: Record<number, FlightLegCalculation>  — computed between legs
//
// TripLegCard.tsx manages per-lookup loading states internally.
// It registers its handleLookupAll via onRegisterLookup so the parent
// can trigger all lookups from the "Run Feasibility Check" button.

// ── 11. US vs NON-US AIRPORT DETECTION ──────────────────────────────
//
// isUsAirport(icao): K*, PA* (Alaska), PH* (Hawaii), PG* (Guam), TJ* (Puerto Rico)
//   → US airports get CBP lookup instead of CIQ lookup
//   → Permit lead time issues are downgraded to notes (guidance only)
//
// isUkOrEuAirport(icao): checks against UK_EU_PREFIXES array
//   → Used for TCO authorization checks (TCO only applies to UK/EU destinations)
//
// UK/EU ICAO prefixes:
//   UK: EG  |  Belgium: EB  |  Germany: ED, ET  |  Estonia: EE
//   Finland: EF  |  Netherlands: EH  |  Ireland: EI  |  Denmark: EK
//   Luxembourg: EL  |  Poland: EP  |  Sweden: ES  |  Latvia: EV
//   Lithuania: EY  |  Bulgaria: LB  |  Cyprus: LC  |  Croatia: LD
//   Spain: LE  |  France: LF  |  Greece: LG  |  Hungary: LH
//   Italy: LI  |  Slovenia: LJ  |  Czech Republic: LK  |  Austria: LO
//   Portugal: LP  |  Romania: LR  |  Slovakia: LZ  |  Gibraltar: LX

// ── 12. DOCUMENT IMPORT ─────────────────────────────────────────────
//
// Users can upload trip schedules (txt, pdf, csv, etc.) via:
//   supabase.functions.invoke('parse-trip-document', { body: FormData })
//
// Returns parsed legs with ICAO codes, dates, and times.
// Legs are created from the parsed data, replacing existing legs.

// ── 13. PRINTABLE REPORT ────────────────────────────────────────────
//
// generatePrintableHtml() creates a full HTML report with:
//   - Trip configuration summary
//   - Per-leg feasibility results (issues + notes)
//   - Overflight analysis per sector
//   - Visa and pet requirements
//   - Cabotage analysis
//   - Cost summary
//   - AEG branding with logo (converted to data URL for offline use)
