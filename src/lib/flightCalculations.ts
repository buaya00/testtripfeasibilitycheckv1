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
