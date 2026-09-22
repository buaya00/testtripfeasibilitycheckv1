// Curated, hand-extracted supplement to the live OurAirports runway-lookup
// data source, drawn from Jeppesen's AWM Airport Directory (accessed via the
// Airflow Intelligence aviation-context-graph). Deliberately Deno-free (zero
// Deno-specific imports/globals), matching the pattern in
// permit-lookup/verification-logic.ts, so this same module is importable by
// the Deno Edge Function at runtime and by the Vite/vitest test suite.
//
// WHY THIS EXISTS AS A STATIC FILE, NOT A LIVE QUERY:
// Airflow Intelligence is reachable to Claude via MCP tools in a chat
// session — it is NOT a public HTTP/REST API this Edge Function can call at
// runtime (no evidence of an API-key-based endpoint, unlike Perplexity or
// Firecrawl). So this is a one-time, dated extraction for a specific,
// hand-picked set of airports, not a general or live-updating source.
//
// WHY THIS SUPPLEMENTS RATHER THAN REPLACES OurAirports:
// OurAirports (davidmegginson.github.io/ourairports-data) is free, worldwide,
// and updated daily — it already covers runway length/width/surface/lighting
// far more completely than this curated set ever will (a 2-airport spot
// check found OurAirports and AWM agree on length in 4 of 5 shared runways,
// with a genuine ~240 ft discrepancy on the 5th — see PR discussion). AWM's
// real, non-redundant value is data OurAirports doesn't carry at all:
// declared distances (TORA/TODA/ASDA/LDA) and PCN/PCR pavement strength
// codes. This module supplies ONLY that supplemental data, keyed by ICAO,
// and only for airports explicitly verified present in the graph — it must
// never be treated as a general fallback for airports not listed here.
//
// COVERAGE IS EXTREMELY PARTIAL AND MUST NOT BE ASSUMED: the AWM source
// itself is unevenly populated — a spot check found ~2,200 US, ~350 French,
// and ~430 German airports present, but essentially none in the UK (a
// single remote Falklands airfield was the only "EG"-prefixed entry found).
// The 8 airports below are a hand-picked, verified-present starter set for
// major/business-aviation-relevant fields — nothing more.
//
// STALENESS: every entry is a snapshot as of a specific Jeppesen source
// revision date (sourceRevision) and graph assessment date (assessedAt).
// It is NOT current operational data. Always label it as such to the user
// and never let it override a live source that also has data for the same
// runway.
//
// KNOWN SOURCE DATA-QUALITY ISSUE (preserved faithfully, not "corrected"):
// EDDF's runway "18" entry gives a length of 13,123 ft — identical to
// EDDF's 07C/25C entry, and inconsistent with the real-world known length
// of Frankfurt's northwest runway (~9,186 ft / 2,800 m). This looks like a
// copy artifact in the source text itself. We preserve it as published
// (never silently "fix" a source), but flag it so nothing downstream
// treats it as trustworthy without cross-checking.

/** Declared distances for one runway end, in feet, as published. Any field may be absent if the source didn't state it for that end. */
export interface AwmDeclaredDistances {
  toraFt?: number;
  todaFt?: number;
  asdaFt?: number;
  ldaFt?: number;
}

export interface AwmRunwaySupplement {
  /** Combined runway ident exactly as AWM published it, e.g. "08L/26R", or a single end like "18" for a one-direction-only entry. */
  ident: string;
  /** Raw Jeppesen PCN string, e.g. "100/R/B/W/T". Omitted when the source used PCR instead. */
  pcn?: string;
  /** Raw Jeppesen PCR string (some US/UAE entries report PCR instead of, or alongside, PCN). */
  pcr?: string;
  /** Declared distances keyed by exact runway end as published (e.g. "12L"), only for ends the source actually stated. */
  declaredDistances?: Record<string, AwmDeclaredDistances>;
  /** Free-text operational notes tied to this specific runway, taken verbatim/near-verbatim from the source (PPR, EMAS, circuit direction, etc.). */
  notes?: string[];
  /** Set true when a value above is internally inconsistent with other data in the same source entry — see EDDF "18" above. Never hide this from the UI. */
  dataQualityFlag?: string;
}

export interface AwmAirportSupplement {
  icao: string;
  /** Jeppesen source revision date as published, e.g. "31 JUL 2026". */
  sourceRevision: string;
  /** Date the Airflow Intelligence graph assessed/ingested this edition, e.g. "2026-08-19". */
  assessedAt: string;
  runways: AwmRunwaySupplement[];
  /** Airport-level operational notes not tied to one runway (e.g. slot coordination, PPR for all non-scheduled traffic). */
  airportNotes?: string[];
}

export const AWM_RUNWAY_SUPPLEMENT: Readonly<Record<string, AwmAirportSupplement>> = {
  KVIS: {
    icao: 'KVIS',
    sourceRevision: '17 JUL 2026',
    assessedAt: '2026-08-19',
    runways: [
      {
        ident: '12/30',
        declaredDistances: {
          '12': { toraFt: 6560, todaFt: 7560, asdaFt: 6560, ldaFt: 5635 },
          '30': { toraFt: 5635, todaFt: 6635, asdaFt: 5635, ldaFt: 5635 },
        },
        notes: ['Pilot Controlled Lighting.'],
      },
    ],
  },
  LFPG: {
    icao: 'LFPG',
    sourceRevision: '31 JUL 2026',
    assessedAt: '2026-08-19',
    runways: [
      {
        ident: '08L/26R',
        pcn: '100/R/B/W/T',
        declaredDistances: {
          '08L': { todaFt: 13786 },
          '26R': { todaFt: 13786, ldaFt: 11864 },
        },
      },
      {
        ident: '08R/26L',
        pcn: '100/R/B/W/T',
        declaredDistances: {
          '08R': { todaFt: 9055 },
          '26L': { todaFt: 9055 },
        },
      },
      {
        ident: '09L/27R',
        pcn: '100/F/B/W/T',
        declaredDistances: {
          '09L': { todaFt: 9055 },
          '27R': { todaFt: 9055 },
        },
      },
      {
        ident: '09R/27L',
        pcn: '100/R/B/W/T',
        declaredDistances: {
          '09R': { todaFt: 13977 },
          '27L': { todaFt: 13977, ldaFt: 11811 },
        },
      },
    ],
    airportNotes: [
      'PPR (30 min prior notice) for long-range flights using extended TORA on 08L/26R and 09R/27L; standard TORA applies to other flights.',
      'PPR for commercial scheduled/non-scheduled/charter aircraft and 24hr PPR for business/private aircraft, with mandatory assistance by approved based handling companies.',
    ],
  },
  LFPB: {
    icao: 'LFPB',
    sourceRevision: '31 JUL 2026',
    assessedAt: '2026-08-19',
    runways: [
      {
        ident: '03/21',
        pcn: '47/F/C/W/T',
        declaredDistances: {
          '03': { asdaFt: 8740, ldaFt: 6988 },
          '21': { toraFt: 6988, todaFt: 7185, asdaFt: 6988, ldaFt: 6988 },
        },
      },
      {
        ident: '07/25',
        pcn: '58/R/C/W/U',
        declaredDistances: {
          '07': { toraFt: 9518, todaFt: 10010, asdaFt: 9518, ldaFt: 8537 },
          '25': { toraFt: 9639, todaFt: 10010, asdaFt: 9639, ldaFt: 6722 },
        },
      },
      {
        ident: '09/27',
        pcn: '47/F/C/W/T',
        declaredDistances: {
          '09': { todaFt: 6277, asdaFt: 6329 },
          '27': { ldaFt: 5922 },
        },
        notes: ['Rwy 09 Landing not allowed.', 'Rwy 27 Takeoff not allowed.'],
      },
    ],
  },
  EDDF: {
    icao: 'EDDF',
    sourceRevision: '31 JUL 2026',
    assessedAt: '2026-08-19',
    runways: [
      { ident: '07C/25C', pcn: '74/F/A/W/T' },
      {
        ident: '07L/25R',
        pcn: '74/R/A/W/T',
        notes: [
          'Rwy 07L Takeoff not allowed.',
          'Rwy 25R Takeoff not allowed.',
          'Porous friction course (antiskid surface); expect different friction at transition to taxiways P4, P6, P8, P10, P14, P16, P20 and P24.',
        ],
      },
      { ident: '07R/25L', pcn: '74/F/A/W/T' },
      {
        ident: '18',
        pcn: '74/R/A/W/T',
        declaredDistances: {
          '18': { toraFt: 13025, todaFt: 13025, asdaFt: 13025 },
        },
        notes: [
          'Rwy 18 Landing not allowed (takeoff only).',
          "From threshold, 4675' length by 148' width: PCN 74/F/A/W/T (asphalt).",
        ],
        dataQualityFlag: "Published length (13,123 ft) is identical to EDDF's 07C/25C entry and does not match the real-world known length of this runway (~9,186 ft / 2,800 m) — likely a copy artifact in the source. Preserved as published; do not treat as reliable without cross-checking a live source.",
      },
    ],
  },
  LSGG: {
    icao: 'LSGG',
    sourceRevision: '31 JUL 2026',
    assessedAt: '2026-08-19',
    runways: [
      {
        ident: '04/22',
        pcn: '81/R/B/W/T',
        pcr: '1100/R/B/W/T',
        declaredDistances: {
          '04': { todaFt: 12992, ldaFt: 11713 },
          '22': { todaFt: 12992 },
        },
      },
    ],
    airportNotes: ['PPR for non-scheduled and non-commercial traffic.'],
  },
  KTEB: {
    icao: 'KTEB',
    sourceRevision: '17 JUL 2026',
    assessedAt: '2026-08-19',
    runways: [
      {
        ident: '01/19',
        pcr: '459/F/D/X/T, SW 50, DW 100',
        declaredDistances: {
          '01': { asdaFt: 6929, ldaFt: 6159 },
          '19': { ldaFt: 6230 },
        },
        notes: ['Rwy 19 departure end EMAS.'],
      },
      {
        ident: '06/24',
        pcr: '343/F/D/X/T, SW 50, DW 100',
        notes: ['Rwy 06 departure end EMAS.', 'Rwy 24 departure end EMAS.'],
      },
    ],
    airportNotes: [
      'Aircraft capable of operating above 100,000 lb must submit certification to the airport manager verifying operating weight is below 100,000 lb before use.',
      'Stage 1 aircraft not permitted to operate at Teterboro.',
      'Aircraft/helicopter noise abatement rules in effect; Rwy 24 is noise-critical (max 80 dB 0300-1200Z, 90 dB other hours). Contact airport Operations Noise Abatement Office before arrival.',
    ],
  },
  KJFK: {
    icao: 'KJFK',
    sourceRevision: '17 JUL 2026',
    assessedAt: '2026-08-19',
    runways: [
      {
        ident: '04L/22R',
        pcr: '1260/R/B/W/T, DDT 1100, DT 550, DW 210',
        declaredDistances: {
          '04L': { toraFt: 11351, todaFt: 11351, asdaFt: 11470, ldaFt: 11010 },
          '22R': { asdaFt: 11219, ldaFt: 7795 },
        },
      },
      {
        ident: '04R/22L',
        pcr: '1260/F/B/X/T, DDT 1100, DW 210, DT 550',
        notes: [
          'EMAS departure end Rwy 04R.',
          "Non-standard EMAS 405' x 226' at departure end of Rwy 22L.",
        ],
      },
      {
        ident: '13L/31R',
        pcr: '1260/R/B/W/T, DDT 1100, DT 550, DW 210',
        declaredDistances: {
          '13L': { ldaFt: 9093 },
          '31R': { asdaFt: 9513, ldaFt: 8486 },
        },
        notes: ['Right-hand circuit.'],
      },
      {
        ident: '13R/31L',
        pcr: '1260/R/B/W/T, DDT 1100, DT 550, DW 210',
        declaredDistances: {
          '13R': { ldaFt: 12467 },
          '31L': { ldaFt: 11247 },
        },
        notes: ['Right-hand circuit.', 'Caution: can be confused with Rwy 13L.'],
      },
    ],
  },
  OMDB: {
    icao: 'OMDB',
    sourceRevision: '31 JUL 2026',
    assessedAt: '2026-08-19',
    runways: [
      {
        ident: '12L/30R',
        pcn: '95/F/A/W/T',
        pcr: '850/F/A/W/T',
        declaredDistances: {
          '12L': { toraFt: 13287, todaFt: 13484, asdaFt: 13700, ldaFt: 11811 },
          '30R': { toraFt: 14108, todaFt: 14304, asdaFt: 14308, ldaFt: 13124 },
        },
      },
      {
        ident: '12R/30L',
        pcn: '109/F/A/W/T',
        pcr: '850/F/A/W/T',
        declaredDistances: {
          '12R': { toraFt: 14157, todaFt: 14354, asdaFt: 14777, ldaFt: 11811 },
          '30L': { todaFt: 14787, asdaFt: 15361, ldaFt: 14157 },
        },
      },
    ],
    airportNotes: [
      'OMDB is an IATA Level 3 slot-coordinated airport: an allocated slot from Airport Coordination Limited (ACL) and landing permission from the DCAA are both required before operating. Schedules must be submitted to ACL in IATA SSIM format.',
    ],
  },
};

/**
 * Looks up the AWM supplement for one runway at one airport. Matching is
 * exact against the published combined ident (e.g. "08L/26R"); for a
 * single-ended AWM entry (e.g. EDDF's "18"), it also matches an OurAirports
 * runway whose le_ident or he_ident equals that single end. Returns
 * undefined when there is no verified AWM data for this exact ICAO/runway —
 * callers must never fall back to a different runway or airport.
 */
export function findAwmRunwaySupplement(
  icao: string,
  combinedIdent: string
): AwmRunwaySupplement | undefined {
  const airport = AWM_RUNWAY_SUPPLEMENT[icao.toUpperCase()];
  if (!airport) return undefined;
  const normalized = combinedIdent.toUpperCase();
  const ends = normalized.split('/').map((e) => e.trim()).filter(Boolean);
  return airport.runways.find((rwy) => {
    if (rwy.ident.toUpperCase() === normalized) return true;
    // Single-ended AWM entry (e.g. "18") matching one end of a combined ident (e.g. "18/36")
    return ends.includes(rwy.ident.toUpperCase());
  });
}

/** Airport-level AWM notes (slot coordination, blanket PPR, etc.), or undefined if this ICAO has no verified AWM entry. */
export function findAwmAirportNotes(icao: string): { sourceRevision: string; assessedAt: string; notes: string[] } | undefined {
  const airport = AWM_RUNWAY_SUPPLEMENT[icao.toUpperCase()];
  if (!airport || !airport.airportNotes || airport.airportNotes.length === 0) return undefined;
  return { sourceRevision: airport.sourceRevision, assessedAt: airport.assessedAt, notes: airport.airportNotes };
}
