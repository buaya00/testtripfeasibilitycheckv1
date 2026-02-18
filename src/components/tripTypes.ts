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
    arrivalDate: undefined,
    arrivalTime: "",
    departureDate: undefined,
    departureTime: "",
    permitRequired: false,
    pprRequired: false,
    customsAvailable: false,
    runwayOverrideFt: "",
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
