// Great circle distance and flight time calculations

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_NM = 3440.065; // Earth radius in nautical miles

/**
 * Haversine formula: great circle distance between two lat/lon points in nautical miles
 */
export function greatCircleDistanceNm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) *
    Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(a));
}

/**
 * Estimate block time in minutes given distance and cruise speed.
 * Adds overhead for taxi, climb, descent.
 */
export function estimateFlightTimeMinutes(
  distanceNm: number,
  cruiseSpeedKtas: number,
): number {
  if (cruiseSpeedKtas <= 0 || distanceNm <= 0) return 0;
  // Overhead: ~15 min for taxi/climb/descent on short flights, ~25 min for longer
  const overhead = distanceNm > 500 ? 25 : 15;
  const cruiseTimeMin = (distanceNm / cruiseSpeedKtas) * 60;
  return Math.round(cruiseTimeMin + overhead);
}

/**
 * Format minutes into "Xh Ym" string
 */
export function formatFlightTime(minutes: number): string {
  if (minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// ── Fuel burn estimation ─────────────────────────────────────
// Average fuel burn by aircraft class in US gallons/hour (conservative cruise estimate)
const FUEL_BURN_GPH_BY_CLASS: { pattern: RegExp; gph: number }[] = [
  // Very light jets / turboprops
  { pattern: /Cirrus|HondaJet|Phenom 100|Mustang|CJ3|CJ4|M2|PC-24|SyberJet|L-39|PC-21/i, gph: 80 },
  // Light jets
  { pattern: /Phenom 300|Learjet 40|Learjet 45|Learjet 70|Learjet 75|XLS|Citation X|Citation Sovereign|Praetor 500|Legacy 450|E170|E175|CRJ-700/i, gph: 170 },
  // Midsize jets
  { pattern: /Challenger 350|Challenger 3500|Learjet 60|Citation Longitude|Praetor 600|Legacy 500|G280|Falcon 2000|ATR/i, gph: 260 },
  // Super-mid / large cabin
  { pattern: /Challenger 60[045]|Challenger 650|Global 5000|Global 5500|G450|G400|G500|G550|G600|Falcon 7X|Falcon 8X|Falcon 900|Falcon 6X|Legacy 600|Legacy 650|Lineage|E190|E195|CRJ-900|CRJ-1000/i, gph: 400 },
  // Ultra-long range / VIP
  { pattern: /Global 6[05]00|Global 7500|Global 8000|G650|G700|G800|Falcon 10X/i, gph: 540 },
  // Narrowbody commercial
  { pattern: /A220|A319|A320|A321|737|Superjet|ARJ21|C919|MC-21|SpaceJet/i, gph: 800 },
  // Widebody commercial / military
  { pattern: /A330|A340|A350|A380|767|777|787|747|C-17|A400M|C-130|KC-390|C-2|Il-76|Y-20|A330 MRTT|KC-46|P-8|P-1/i, gph: 2400 },
];

/**
 * Estimate block fuel consumption in US gallons for a given aircraft and distance.
 * Uses class-based burn rates. Returns null if aircraft not recognised.
 */
export function estimateBlockFuelGallons(
  aircraftType: string,
  distanceNm: number,
  cruiseKtas: number,
): number | null {
  if (!aircraftType || distanceNm <= 0 || cruiseKtas <= 0) return null;
  const match = FUEL_BURN_GPH_BY_CLASS.find(c => c.pattern.test(aircraftType));
  if (!match) return null;
  const flightTimeHours = distanceNm / cruiseKtas + (distanceNm > 500 ? 25 : 15) / 60;
  return Math.round(match.gph * flightTimeHours);
}

/**
 * Calculate fuel tankering analysis between two stops.
 *
 * @param blockFuelGallons  Planned fuel burn for the leg
 * @param priceAtDep        Fuel price (USD/gal) at departure
 * @param priceAtDest       Fuel price (USD/gal) at destination
 * @param aircraftMtowKg    MTOW of aircraft in kg (used to estimate weight penalty)
 * @returns TankeringAnalysis or null if insufficient data
 */
export interface TankeringAnalysis {
  tankerGallons: number;
  weightPenaltyGallons: number;
  netFuelSavedGallons: number;
  netSavingUsd: number;
  recommendation: 'tanker' | 'buy_local' | 'neutral';
  spreadPerGallon: number;
  breakEvenSpreadUsd: number;
}

export function calculateTankering(
  blockFuelGallons: number,
  priceAtDep: number,
  priceAtDest: number,
  aircraftMtowKg: number,
): TankeringAnalysis {
  const spreadPerGallon = priceAtDest - priceAtDep;

  // Weight penalty: ~1% additional fuel burn per 1% of MTOW extra weight carried
  // Jet fuel = ~6.7 lb/gal; 1 lb = 0.4536 kg
  // Penalty factor: carrying full block fuel extra adds roughly 3-6% burn penalty
  // We use ~4% per full tank carried as a conservative industry rule of thumb
  const PENALTY_FACTOR = 0.04; // 4% extra burn per full block load tankered
  const weightPenaltyGallons = Math.round(blockFuelGallons * PENALTY_FACTOR);

  // Net gallons saved at destination = block fuel - penalty (we avoid buying blockFuel at dest)
  const netFuelSavedGallons = Math.max(0, blockFuelGallons - weightPenaltyGallons);

  // Cost: tankering costs (priceAtDep × block) vs buying at dest (priceAtDest × block)
  const costTankering = (blockFuelGallons + weightPenaltyGallons) * priceAtDep;
  const costBuyLocal = blockFuelGallons * priceAtDest;
  const netSavingUsd = Math.round(costBuyLocal - costTankering);

  // Break-even: what spread is needed to justify tankering?
  const breakEvenSpreadUsd = parseFloat((priceAtDep * PENALTY_FACTOR).toFixed(3));

  let recommendation: 'tanker' | 'buy_local' | 'neutral';
  if (spreadPerGallon <= 0) recommendation = 'buy_local'; // dest is cheaper
  else if (spreadPerGallon > breakEvenSpreadUsd && netSavingUsd > 50) recommendation = 'tanker';
  else if (Math.abs(netSavingUsd) < 50) recommendation = 'neutral';
  else recommendation = 'buy_local';

  return {
    tankerGallons: blockFuelGallons,
    weightPenaltyGallons,
    netFuelSavedGallons,
    netSavingUsd,
    recommendation,
    spreadPerGallon: parseFloat(spreadPerGallon.toFixed(3)),
    breakEvenSpreadUsd,
  };
}

export interface FlightLegCalculation {
  distanceNm: number;
  flightTimeMinutes: number;
  flightTimeFormatted: string;
  withinRange: boolean;
  rangeNm: number | null;
  cruiseSpeedKtas: number | null;
}

/**
 * Calculate flight parameters between two airports
 */
export function calculateFlightLeg(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  rangeNm: number | undefined,
  cruiseKtas: number | undefined,
): FlightLegCalculation {
  const distanceNm = Math.round(greatCircleDistanceNm(lat1, lon1, lat2, lon2));
  const flightTimeMinutes = cruiseKtas ? estimateFlightTimeMinutes(distanceNm, cruiseKtas) : 0;
  return {
    distanceNm,
    flightTimeMinutes,
    flightTimeFormatted: cruiseKtas ? formatFlightTime(flightTimeMinutes) : "—",
    withinRange: rangeNm != null ? distanceNm <= rangeNm : true,
    rangeNm: rangeNm ?? null,
    cruiseSpeedKtas: cruiseKtas ?? null,
  };
}
