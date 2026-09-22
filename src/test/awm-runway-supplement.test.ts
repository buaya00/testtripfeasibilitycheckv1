import { describe, it, expect } from "vitest";
import {
  findAwmRunwaySupplement,
  findAwmAirportNotes,
  AWM_RUNWAY_SUPPLEMENT,
} from "../../supabase/functions/_shared/awm-runway-supplement";

// These tests exercise the curated, static AWM declared-distances/PCN
// supplement used by runway-lookup. They intentionally do NOT test for
// coverage of any airport not already in AWM_RUNWAY_SUPPLEMENT — this
// dataset is a small, hand-picked, dated snapshot, not a general source,
// and the tests should fail loudly if that assumption is ever violated by
// an unreviewed addition.

describe("findAwmRunwaySupplement — exact and single-end matching", () => {
  it("matches an exact combined ident", () => {
    const result = findAwmRunwaySupplement('LFPG', '08L/26R');
    expect(result?.pcn).toBe('100/R/B/W/T');
    expect(result?.declaredDistances?.['26R']?.ldaFt).toBe(11864);
  });

  it("is case-insensitive on both ICAO and ident", () => {
    expect(findAwmRunwaySupplement('lfpg', '08l/26r')?.pcn).toBe('100/R/B/W/T');
  });

  it("matches a single-ended AWM entry (EDDF '18') against a combined OurAirports ident", () => {
    const result = findAwmRunwaySupplement('EDDF', '18/36');
    expect(result?.ident).toBe('18');
    expect(result?.declaredDistances?.['18']?.toraFt).toBe(13025);
  });

  it("surfaces the EDDF '18' data-quality flag — this must never be silently dropped", () => {
    const result = findAwmRunwaySupplement('EDDF', '18/36');
    expect(result?.dataQualityFlag).toBeTruthy();
    expect(result?.dataQualityFlag).toMatch(/13,123 ft/);
  });

  it("returns undefined for an airport with no verified AWM entry — never a fallback guess", () => {
    expect(findAwmRunwaySupplement('EGLL', '09L/27R')).toBeUndefined();
    expect(findAwmRunwaySupplement('KENYA', '01/19')).toBeUndefined();
  });

  it("returns undefined for a runway ident that doesn't exist at a covered airport", () => {
    expect(findAwmRunwaySupplement('LFPG', '99/17')).toBeUndefined();
  });

  it("returns PCR (not PCN) where the source used PCR — never fabricates a PCN when only PCR was published", () => {
    const result = findAwmRunwaySupplement('KTEB', '01/19');
    expect(result?.pcr).toBe('459/F/D/X/T, SW 50, DW 100');
    expect(result?.pcn).toBeUndefined();
  });

  it("carries runway-specific notes verbatim (KJFK EMAS note)", () => {
    const result = findAwmRunwaySupplement('KJFK', '04R/22L');
    expect(result?.notes).toContain('EMAS departure end Rwy 04R.');
  });
});

describe("findAwmAirportNotes — airport-level operational notes", () => {
  it("returns OMDB's slot-coordination note with source dating", () => {
    const result = findAwmAirportNotes('OMDB');
    expect(result?.sourceRevision).toBe('31 JUL 2026');
    expect(result?.assessedAt).toBe('2026-08-19');
    expect(result?.notes.some(n => n.includes('slot-coordinated'))).toBe(true);
  });

  it("returns undefined for an airport with no airport-level notes (KVIS)", () => {
    expect(findAwmAirportNotes('KVIS')).toBeUndefined();
  });

  it("returns undefined for an airport with no AWM entry at all", () => {
    expect(findAwmAirportNotes('EGLL')).toBeUndefined();
  });
});

describe("AWM_RUNWAY_SUPPLEMENT — dataset shape sanity", () => {
  it("covers exactly the 8 hand-verified airports — a change here should be a deliberate, reviewed addition", () => {
    expect(Object.keys(AWM_RUNWAY_SUPPLEMENT).sort()).toEqual(
      ['EDDF', 'KJFK', 'KTEB', 'KVIS', 'LFPB', 'LFPG', 'LSGG', 'OMDB'].sort()
    );
  });

  it("every entry has a non-empty sourceRevision and assessedAt — never an undated snapshot", () => {
    for (const airport of Object.values(AWM_RUNWAY_SUPPLEMENT)) {
      expect(airport.sourceRevision).toBeTruthy();
      expect(airport.assessedAt).toBeTruthy();
      expect(airport.runways.length).toBeGreaterThan(0);
    }
  });
});
