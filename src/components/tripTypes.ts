// ── Shared types for multi-leg trip ──────────────────────

export interface OperatingHours {
  open: string;
  close: string;
  days: string;
  notes: string;
  raw: string;
}

export interface CbpResult {
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

export interface AwmDeclaredDistances {
  toraFt?: number;
  todaFt?: number;
  asdaFt?: number;
  ldaFt?: number;
}

export interface AwmRunwaySupplement {
  ident: string;
  pcn?: string;
  pcr?: string;
  declaredDistances?: Record<string, AwmDeclaredDistances>;
  notes?: string[];
  dataQualityFlag?: string;
  sourceRevision: string;
  assessedAt: string;
}

export interface RunwayInfo {
  id: string;
  lengthFt: number;
  widthFt: number;
  surface: string;
  lighted: boolean;
  ident: string;
  /** Curated, dated Jeppesen AWM supplement — present only for a small hand-verified set of airports. See supabase/functions/_shared/awm-runway-supplement.ts. */
  awm?: AwmRunwaySupplement;
}

export interface RunwayResult {
  success: boolean;
  found: boolean;
  icao: string;
  airportName: string | null;
  municipality: string | null;
  latitude: number | null;
  longitude: number | null;
  runways: RunwayInfo[];
  longestRunwayFt: number | null;
  message: string;
  /** Airport-level AWM notes (slot coordination, blanket PPR) — only for the same curated airport set. */
  awmAirportNotes?: { sourceRevision: string; assessedAt: string; notes: string[] } | null;
  error?: string;
}

export type PermitVerificationStatus = 'not_triggered' | 'confirmed' | 'provisional' | 'inconclusive' | 'conflicting' | 'unavailable';

export interface PermitVerificationSource {
  url: string;
  supports: 'supports' | 'contradicts' | 'insufficient';
  retrievedAt: string;
  /** 'full_page' = actual source content was retrieved and examined; 'search_snippet' = only a search engine's own summary text, not the source itself. */
  evidenceQuality?: 'full_page' | 'search_snippet' | 'none';
  /** 'government' = the destination's own official CAA/AIP authority. 'industry' = a curated business-aviation trip-support publisher, used only when no government evidence resolved the claim. Always shown to the user — these carry different weight. */
  sourceType?: 'government' | 'industry';
}

export interface PermitVerification {
  status: PermitVerificationStatus;
  reason: string;
  checkedAt?: string;
  sources?: PermitVerificationSource[];
}

export interface PermitResult {
  success: boolean;
  icao: string;
  country?: string;
  permitRequired?: 'yes' | 'no' | 'conditional';
  permitType?: string;
  leadTimeDays?: number;
  issuingAuthority?: string;
  conditions?: string;
  overflightPermit?: 'yes' | 'no' | 'conditional';
  // TCO (Third Country Operator) authorization
  tcoRequired?: 'yes' | 'no' | 'conditional' | 'not_applicable';
  tcoAuthority?: string;
  tcoLeadTimeDays?: number;
  tcoNotes?: string;
  // Bilateral/multilateral air service agreements
  bilateralAgreement?: string;
  bilateralImpact?: string;
  // Charter / non-scheduled commercial specific permits
  charterPermitRequired?: 'yes' | 'no' | 'conditional' | 'not_applicable';
  charterPermitAuthority?: string;
  charterLeadTimeDays?: number;
  charterPermitNotes?: string;
  // Regulatory warnings
  regulatoryWarnings?: string[];
  notes?: string;
  confidence?: 'high' | 'medium' | 'low';
  // Perplexity grounding
  citations?: string[];
  groundedByPerplexity?: boolean;
  // Selective follow-up verification (additive — existing consumers unaffected)
  verification?: PermitVerification;
  error?: string;
}

export interface CiqResult {
  success: boolean;
  icao: string;
  country?: string;
  airportName?: string;
  ciqAvailable?: 'yes' | 'no' | 'limited' | 'unknown';
  isPortOfEntry?: boolean;
  operatingHours?: string;
  advanceNotice?: string;
  fees?: string;
  alternateAirports?: string;
  notes?: string;
  confidence?: 'high' | 'medium' | 'low' | null;
  /** 'ungrounded' means neither the primary nor a second verification pass found real official-source content — ciqAvailable will be 'unknown' in that case, not a guessed yes/no/limited. */
  evidenceQuality?: 'grounded' | 'ungrounded';
  /** True when the primary pass was ungrounded and a second, differently-worded verification pass was attempted. */
  secondPassAttempted?: boolean;
  /** True when both generic passes were ungrounded and a third pass, scoped to curated industry trip-support sources, was attempted. */
  industryPassAttempted?: boolean;
  /** 'government' = a national/official source found via the generic search. 'industry' = a curated business-aviation trip-support publisher, used only when the generic passes found nothing. Always shown to the user — these carry different weight. Undefined when evidenceQuality is 'ungrounded'. */
  sourceType?: 'government' | 'industry';
  error?: string;
}

export interface ChargesResult {
  success: boolean;
  icao: string;
  aircraftType?: string | null;
  country?: string;
  airportName?: string;
  currency?: string;
  mtowKg?: number;
  landingFeeLocal?: number;
  landingFeeUsd?: number;
  parkingPerDayLocal?: number;
  parkingPerDayUsd?: number;
  parkingDays?: number;
  totalParkingUsd?: number;
  passengerFeeUsd?: number;
  surcharges?: string;
  nightSurchargeApplies?: boolean;
  totalEstimateUsd?: number;
  notes?: string;
  confidence?: 'high' | 'medium' | 'low';
  error?: string;
}

export interface PprResult {
  success: boolean;
  icao: string;
  country?: string;
  airportName?: string;
  pprRequired?: 'yes' | 'no' | 'conditional';
  advanceNoticePeriod?: string;
  contactMethod?: string;
  contactDetails?: string;
  slotRequired?: boolean;
  operatingRestrictions?: string;
  conditions?: string;
  handlingAgentRequired?: boolean;
  notes?: string;
  confidence?: 'high' | 'medium' | 'low';
  error?: string;
}

export interface NotamItem {
  id?: string;
  type: 'closure' | 'restriction' | 'runway_closure' | 'equipment' | 'hazard' | 'info';
  summary: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  affectsOperations: boolean;
}

export interface AirportHoursResult {
  success: boolean;
  icao: string;
  airportName?: string | null;
  country?: string | null;
  is24Hours?: boolean;
  operatingHoursOpen?: string | null;
  operatingHoursClose?: string | null;
  operatingDays?: string;
  curfewStart?: string | null;
  curfewEnd?: string | null;
  curfewNotes?: string | null;
  activeNotams?: NotamItem[];
  arrivalOutsideHours?: boolean;
  departureOutsideHours?: boolean;
  arrivalDuringCurfew?: boolean;
  departureDuringCurfew?: boolean;
  seasonalRestrictions?: string | null;
  deicingAvailable?: 'yes' | 'no' | 'limited' | 'unknown';
  deicingProvider?: string | null;
  deicingNotes?: string | null;
  fireCategory?: number | null;
  fireCategoryUpgradable?: boolean | null;
  fireCategoryNotes?: string | null;
  notes?: string | null;
  hasLiveNotamData?: boolean;
  confidence?: 'high' | 'medium' | 'low';
  error?: string;
}

export interface FeasibilityResult {
  feasible: boolean;
  issues: string[];
  notes: string[];
}

export interface OverflightCountry {
  country: string;
  overflightPermitRequired: 'yes' | 'no' | 'conditional';
  permitType?: string;
  leadTimeDays?: number;
  issuingAuthority?: string;
  conditions?: string;
  notes?: string;
  overflightChargeUsd?: number;
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
  routeSummary?: string;
  countries?: OverflightCountry[];
  totalPermitsNeeded?: number;
  maxLeadTimeDays?: number;
  totalOverflightChargesUsd?: number;
  notes?: string;
  confidence?: 'high' | 'medium' | 'low';
  error?: string;
}

export interface VisaPassengerResult {
  nationality: string;
  visaRequired: 'yes' | 'no' | 'conditional';
  visaType?: string;
  visaOnArrival?: boolean;
  eVisaAvailable?: boolean;
  processingTimeDays?: number;
  maxStayDays?: number;
  transitVisaRequired?: boolean;
  conditions?: string;
  notes?: string;
}

export interface VisaCheckResult {
  success: boolean;
  destinationCountry?: string;
  results?: VisaPassengerResult[];
  notes?: string;
  confidence?: 'high' | 'medium' | 'low';
  error?: string;
}

export interface PetRequirementResult {
  petType: string;
  importAllowed: 'yes' | 'no' | 'conditional';
  healthCertificate?: string;
  vaccinations?: string;
  microchipRequired?: boolean;
  quarantine?: string;
  quarantineDays?: number;
  bloodTests?: string;
  importPermit?: string;
  leadTimeDays?: number;
  breedRestrictions?: string;
  documentsRequired?: string;
  advanceNotification?: string;
  privateAviationNotes?: string;
  estimatedFeesUsd?: number;
  preparationTimeline?: string;
  notes?: string;
}

export interface PetCheckResult {
  success: boolean;
  destinationCountry?: string;
  destinationIcao?: string;
  results?: PetRequirementResult[];
  generalNotes?: string;
  confidence?: 'high' | 'medium' | 'low';
  error?: string;
}

// ── Cabotage Analysis ────────────────────────────────────
export interface CabotageLegAnalysis {
  fromIcao: string;
  toIcao: string;
  fromCountry?: string;
  toCountry?: string;
  isCabotageRisk: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  reason: string;
  exemptions?: string;
  applicableLaw?: string;
}

export interface CabotageResult {
  success: boolean;
  overallRisk?: 'none' | 'low' | 'medium' | 'high';
  legAnalysis?: CabotageLegAnalysis[];
  summary?: string;
  recommendations?: string;
  confidence?: 'high' | 'medium' | 'low';
  error?: string;
}

// ── AEG Set Up Fees ──────────────────────────────────────
export interface AegPredefinedService {
  id: string;
  name: string;
  costUsd: number;
  selected: boolean;
}

export interface AegAdHocService {
  id: string;
  name: string;
  costUsd: number | string;
  notes: string;
}

export const AEG_PREDEFINED_SERVICES: Omit<AegPredefinedService, 'selected'>[] = [
  { id: 'flight-planning',           name: 'Flight Planning',            costUsd: 135 },
  { id: 'handling-setup',            name: 'Handling Set Up',            costUsd: 170 },
  { id: 'overflight-permit',         name: 'Overflight Permit',          costUsd: 255 },
  { id: 'landing-permit',            name: 'Landing Permit',             costUsd: 255 },
  { id: 'ppr',                       name: 'PPR',                        costUsd: 190 },
  { id: 'slot-coordination',         name: 'Slot Coordination',          costUsd: 90  },
  { id: 'ground-transport',          name: 'Ground Transport',           costUsd: 70  },
  { id: 'hotel-reservation',         name: 'Hotel Reservation',          costUsd: 85  },
  { id: 'catering',                  name: 'Catering',                   costUsd: 90  },
  { id: 'us-customs-notification',   name: 'US Customs Notification',    costUsd: 70  },
  { id: 'inbound-apis',              name: 'Inbound APIS',               costUsd: 125 },
  { id: 'outbound-apis',             name: 'Outbound APIS',              costUsd: 125 },
];

export function createDefaultAegServices(): AegPredefinedService[] {
  return AEG_PREDEFINED_SERVICES.map(s => ({ ...s, selected: false }));
}

// ── Fuel Tankering ───────────────────────────────────────
export interface FuelLegPrice {
  icao: string;
  /** Price per US gallon in USD (manual entry, placeholder for AEG Fuels API) */
  pricePerGallonUsd: number | null;
  /** Fuel uplifted at this stop in US gallons */
  upliftGallons: number | null;
  /** Note / source for this price */
  priceNote: string;
}

export interface TankeringLeg {
  fromIcao: string;
  toIcao: string;
  /** Great-circle distance in nm */
  distanceNm: number;
  /** Estimated block fuel for the leg in US gallons */
  blockFuelGallons: number;
  /** Price at departure in USD/gal */
  priceAtDepartureUsd: number | null;
  /** Price at destination in USD/gal */
  priceAtDestinationUsd: number | null;
  /** Tankering analysis */
  analysis: TankeringAnalysis | null;
}

export interface TankeringAnalysis {
  /** Extra fuel to tanker in US gallons */
  tankerGallons: number;
  /** Fuel burn penalty for carrying extra weight (gal) */
  weightPenaltyGallons: number;
  /** Net fuel saved at destination (gal) */
  netFuelSavedGallons: number;
  /** Net cost saving in USD (positive = save money by tankering) */
  netSavingUsd: number;
  /** Recommendation */
  recommendation: 'tanker' | 'buy_local' | 'neutral';
  /** Price spread per gallon */
  spreadPerGallon: number;
  /** Break-even price spread (below this, not worth tankering) */
  breakEvenSpreadUsd: number;
}

export interface LegData {
  id: string;
  airportIcao: string;
  /** City/municipality from fast airport-info lookup — populated as soon as 4-char ICAO is entered */
  airportCity: string | null;
  arrivalDate: Date | undefined;
  /** Stored as UTC HH:MM */
  arrivalTime: string;
  /** True when the user has manually edited arrival date or time (prevents auto-calc overwrite) */
  arrivalManuallyEdited: boolean;
  departureDate: Date | undefined;
  /** Stored as UTC HH:MM */
  departureTime: string;
  /** UTC offset for local time display/entry, e.g. -5 for EST, +5.5 for IST */
  utcOffsetHours: number;
  permitRequired: boolean;
  pprRequired: boolean;
  customsAvailable: boolean;
  slotRequired: boolean;
  runwayOverrideFt: string;
  // Fuel price at this stop (for tankering analysis)
  fuelPriceUsd: number | null;
  fuelPriceNote: string;
  // AEG Set Up Fees
  aegServices: AegPredefinedService[];
  aegAdHocServices: AegAdHocService[];
  // Lookup results per leg
  cbpResult: CbpResult | null;
  runwayResult: RunwayResult | null;
  permitResult: PermitResult | null;
  ciqResult: CiqResult | null;
  chargesResult: ChargesResult | null;
  pprResult: PprResult | null;
  airportHoursResult: AirportHoursResult | null;
  feasibilityResult: FeasibilityResult | null;
}

export function createEmptyLeg(): LegData {
  return {
    id: crypto.randomUUID(),
    airportIcao: "",
    airportCity: null,
    arrivalDate: undefined,
    arrivalTime: "",
    arrivalManuallyEdited: false,
    departureDate: undefined,
    departureTime: "",
    utcOffsetHours: 0,
    permitRequired: false,
    pprRequired: false,
    customsAvailable: false,
    slotRequired: false,
    runwayOverrideFt: "",
    fuelPriceUsd: null,
    fuelPriceNote: "",
    aegServices: createDefaultAegServices(),
    aegAdHocServices: [],
    cbpResult: null,
    runwayResult: null,
    permitResult: null,
    ciqResult: null,
    chargesResult: null,
    pprResult: null,
    airportHoursResult: null,
    feasibilityResult: null,
  };
}
