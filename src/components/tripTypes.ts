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

export interface RunwayInfo {
  id: string;
  lengthFt: number;
  widthFt: number;
  surface: string;
  lighted: boolean;
  ident: string;
}

export interface RunwayResult {
  success: boolean;
  found: boolean;
  icao: string;
  airportName: string | null;
  latitude: number | null;
  longitude: number | null;
  runways: RunwayInfo[];
  longestRunwayFt: number | null;
  message: string;
  error?: string;
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
  notes?: string;
  confidence?: 'high' | 'medium' | 'low';
  error?: string;
}

export interface CiqResult {
  success: boolean;
  icao: string;
  country?: string;
  airportName?: string;
  ciqAvailable?: 'yes' | 'no' | 'limited';
  isPortOfEntry?: boolean;
  operatingHours?: string;
  advanceNotice?: string;
  fees?: string;
  alternateAirports?: string;
  notes?: string;
  confidence?: 'high' | 'medium' | 'low';
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

export interface LegData {
  id: string;
  airportIcao: string;
  arrivalDate: Date | undefined;
  arrivalTime: string;
  departureDate: Date | undefined;
  departureTime: string;
  permitRequired: boolean;
  pprRequired: boolean;
  customsAvailable: boolean;
  runwayOverrideFt: string;
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
    arrivalDate: undefined,
    arrivalTime: "",
    departureDate: undefined,
    departureTime: "",
    permitRequired: false,
    pprRequired: false,
    customsAvailable: false,
    runwayOverrideFt: "",
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
