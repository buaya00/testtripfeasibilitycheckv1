import { describe, it, expect, vi } from "vitest";
import { runCiqExtraction, resolveIndustryCandidates } from "../../supabase/functions/ciq-lookup/extraction";

// Regression coverage for the defect found via live testing: a CIQ pass
// was marked "grounded" (and surfaced as "confirmed, high confidence,
// official government/CAA data") purely because Firecrawl returned some
// non-empty scraped text -- even when that text was genuinely about a
// different country. Observed case: a France/LFPB query was grounded by
// scraped content about US Customs and Border Protection, and the model's
// own narrative correctly said the source was "not relevant to LFPB" while
// the code still trusted it as grounded evidence. The fix requires the
// model to explicitly state relevance via a required sourceRelevant field,
// and never infers grounding from non-empty content alone.

function toolCallResponse(args: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(args) } }] } }],
    }),
  } as Response;
}

function errorResponse(status: number) {
  return { ok: false, status, json: async () => ({}) } as Response;
}

/** Explicit assertion function — sidesteps a control-flow-narrowing quirk observed with `if (!result.ok)` on this discriminated union in this TS config. */
function assertIsError(result: Awaited<ReturnType<typeof runCiqExtraction>>): asserts result is { ok: false; errorResponse: Response } {
  if (result.ok) {
    throw new Error('expected an error outcome (ok: false), got ok: true');
  }
}

const BASE_EXTRACTION = {
  country: 'France',
  airportName: 'Paris-Le Bourget Airport',
  ciqAvailable: 'yes' as const,
  confidence: 'high' as const,
};

describe("runCiqExtraction — grounding requires BOTH non-empty content AND explicit model-confirmed relevance", () => {
  it("REGRESSION: non-empty but genuinely irrelevant content (US CBP data for a France query), model correctly flags sourceRelevant: false -> grounded is false, even though real content was provided and the model gave a confident answer", async () => {
    const fetchImpl = vi.fn(async () => toolCallResponse({
      ...BASE_EXTRACTION,
      ciqAvailable: 'no',
      notes: 'The provided sources are for US Customs and Border Protection and are not relevant to LFPB.',
      sourceRelevant: false,
    }));

    const result = await runCiqExtraction('LFPB', 'US CBP general aviation clearance procedures for arriving international flights...', 'api-key', fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grounded).toBe(false);
      expect(result.extraction.sourceRelevant).toBe(false);
    }
  });

  it("REGRESSION 2: content genuinely about the correct airport, but never actually addresses CIQ/customs at all -> model correctly flags sourceRelevant: false -> grounded is false, even though the airport identity matches", async () => {
    const fetchImpl = vi.fn(async () => toolCallResponse({
      ...BASE_EXTRACTION,
      notes: 'The source describes LFPB as business-aviation-friendly with excellent runway infrastructure, but does not mention customs, immigration, or CIQ procedures at all.',
      sourceRelevant: false,
    }));

    const result = await runCiqExtraction('LFPB', 'LFPB is fully dedicated to general aviation and is one of the most business aviation-friendly airports in Europe in terms of operating flexibility and runway capacity.', 'api-key', fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grounded).toBe(false);
      expect(result.extraction.sourceRelevant).toBe(false);
    }
  });

  it("non-empty, genuinely relevant content, model confirms sourceRelevant: true -> grounded is true", async () => {
    const fetchImpl = vi.fn(async () => toolCallResponse({
      ...BASE_EXTRACTION,
      sourceRelevant: true,
    }));

    const result = await runCiqExtraction('LFPB', 'French DGAC guidance: LFPB is a designated port of entry with CIQ services available by arrangement...', 'api-key', fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grounded).toBe(true);
    }
  });

  it("empty context (no scraped content at all) -> grounded is always false, regardless of what the model reports for sourceRelevant", async () => {
    const fetchImpl = vi.fn(async () => toolCallResponse({
      ...BASE_EXTRACTION,
      sourceRelevant: true, // model should never do this for empty context, but the code must not trust it even if it does
    }));

    const result = await runCiqExtraction('LFPB', '', 'api-key', fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grounded).toBe(false); // defense in depth: empty content can never be grounded
    }
  });

  it("empty context, model correctly reports sourceRelevant: false -> grounded is false (the expected, well-behaved case)", async () => {
    const fetchImpl = vi.fn(async () => toolCallResponse({
      ...BASE_EXTRACTION,
      sourceRelevant: false,
    }));

    const result = await runCiqExtraction('LFPB', '', 'api-key', fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grounded).toBe(false);
    }
  });

  it("non-empty content but the model omits sourceRelevant entirely (malformed response) -> grounded defaults to false, never true by omission", async () => {
    const { sourceRelevant, ...withoutRelevance } = { ...BASE_EXTRACTION, sourceRelevant: true };
    const fetchImpl = vi.fn(async () => toolCallResponse(withoutRelevance));

    const result = await runCiqExtraction('LFPB', 'some real content here', 'api-key', fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grounded).toBe(false);
    }
  });

  it("the prompt sent to the model includes the explicit relevance-verification instruction whenever context is non-empty", async () => {
    let capturedBody: string | undefined;
    const fetchImpl = vi.fn(async (_url: string, options?: RequestInit) => {
      capturedBody = options?.body as string;
      return toolCallResponse({ ...BASE_EXTRACTION, sourceRelevant: true });
    });

    await runCiqExtraction('LFPB', 'some scraped content', 'api-key', fetchImpl as unknown as typeof fetch);
    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody!);
    const userMessage = parsed.messages.find((m: { role: string }) => m.role === 'user').content as string;
    expect(userMessage).toContain('CRITICAL');
    expect(userMessage.toLowerCase()).toContain('sourcerelevant');
    expect(userMessage.toLowerCase()).toContain('runways'); // the topical-relevance failure mode must be named explicitly, not just the wrong-country one
  });

  it("the tool schema requires sourceRelevant as a mandatory field, not optional", async () => {
    let capturedBody: string | undefined;
    const fetchImpl = vi.fn(async (_url: string, options?: RequestInit) => {
      capturedBody = options?.body as string;
      return toolCallResponse({ ...BASE_EXTRACTION, sourceRelevant: true });
    });

    await runCiqExtraction('LFPB', 'some content', 'api-key', fetchImpl as unknown as typeof fetch);
    const parsed = JSON.parse(capturedBody!);
    const required: string[] = parsed.tools[0].function.parameters.required;
    expect(required).toContain('sourceRelevant');
  });
});

describe("runCiqExtraction — error paths (unchanged behavior)", () => {
  it("propagates a 429 as a rate-limit error response", async () => {
    const fetchImpl = vi.fn(async () => errorResponse(429));
    const result = await runCiqExtraction('LFPB', '', 'api-key', fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    assertIsError(result);
    expect(result.errorResponse.status).toBe(429);
  });

  it("propagates a 402 as a usage-limit error response", async () => {
    const fetchImpl = vi.fn(async () => errorResponse(402));
    const result = await runCiqExtraction('LFPB', '', 'api-key', fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    assertIsError(result);
    expect(result.errorResponse.status).toBe(402);
  });

  it("propagates any other failure as a 502", async () => {
    const fetchImpl = vi.fn(async () => errorResponse(500));
    const result = await runCiqExtraction('LFPB', '', 'api-key', fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    assertIsError(result);
    expect(result.errorResponse.status).toBe(502);
  });

  it("returns a 500 when the model response has no tool call at all", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: {} }] }) } as Response));
    const result = await runCiqExtraction('LFPB', '', 'api-key', fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    assertIsError(result);
    expect(result.errorResponse.status).toBe(500);
  });
});

describe("resolveIndustryCandidates — tries every candidate in order, not just the first", () => {
  const GENERIC_UK_GUIDE = { content: 'Generic UK-wide customs and GAR filing procedures, never names a specific airport by ICAO code.', sourceUrl: 'https://www.universalweather.com/blog/united-kingdom-business-aviation-destination-guide/' };
  const SPECIFIC_EGGW_PAGE = { content: 'Customs Immigration Agriculture: Customs Available: Yes. This is the specific EGGW airport profile page.', sourceUrl: 'https://www.universalweather.com/airports/EGGW-LTN-LUTON-AIRPORT-LONDON-LUTON-ENGLAND-UNITED-KINGDOM/' };

  it("REGRESSION: a generic, non-airport-specific result ranked first is correctly rejected as ungrounded, and a more specific result ranked later IS tried and grounds the answer — this is the exact real bug (a real Universal Weather UK-wide guide ranked above the specific EGGW page, and only the first was ever tried before this fix)", async () => {
    const fetchImpl = vi.fn(async (_url: string, options?: RequestInit) => {
      const body = JSON.parse(options!.body as string);
      const userContent = body.messages.find((m: { role: string }) => m.role === 'user').content as string;
      const isGenericGuide = userContent.includes('Generic UK-wide');
      return {
        ok: true, status: 200,
        json: async () => ({
          choices: [{
            message: {
              tool_calls: [{
                function: {
                  arguments: JSON.stringify(
                    isGenericGuide
                      ? { country: 'United Kingdom', ciqAvailable: 'yes', confidence: 'medium', sourceRelevant: false, notes: 'Generic guide never names EGGW specifically.' }
                      : { country: 'United Kingdom', ciqAvailable: 'yes', confidence: 'high', sourceRelevant: true, notes: 'Customs Available: Yes, per the airport profile.' }
                  ),
                },
              }],
            },
          }],
        }),
      } as Response;
    });

    const resolution = await resolveIndustryCandidates('EGGW', [GENERIC_UK_GUIDE, SPECIFIC_EGGW_PAGE], 'api-key', fetchImpl as unknown as typeof fetch);
    expect(resolution.grounded).not.toBeNull();
    expect(resolution.grounded?.sourceUrl).toBe(SPECIFIC_EGGW_PAGE.sourceUrl);
    expect(resolution.grounded?.extraction.ciqAvailable).toBe('yes');
    // Both candidates were actually tried, in order -- not just the first.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops at the FIRST grounded candidate and never tries later ones", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ country: 'UK', ciqAvailable: 'yes', confidence: 'high', sourceRelevant: true }) } }] } }] }),
    } as Response));

    await resolveIndustryCandidates('EGGW', [GENERIC_UK_GUIDE, SPECIFIC_EGGW_PAGE], 'api-key', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("when NO candidate is ever grounded, returns grounded: null and keeps the LAST attempted extraction as a descriptive-only fallback", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ country: 'UK', ciqAvailable: 'no', confidence: 'low', sourceRelevant: false }) } }] } }] }),
    } as Response));

    const resolution = await resolveIndustryCandidates('EGGW', [GENERIC_UK_GUIDE, SPECIFIC_EGGW_PAGE], 'api-key', fetchImpl as unknown as typeof fetch);
    expect(resolution.grounded).toBeNull();
    expect(resolution.lastUngrounded).toBeDefined();
    expect(resolution.lastUngrounded?.ciqAvailable).toBe('no');
  });

  it("with an empty candidate list, returns grounded: null and lastUngrounded: undefined without calling fetch at all", async () => {
    const fetchImpl = vi.fn();
    const resolution = await resolveIndustryCandidates('EGGW', [], 'api-key', fetchImpl as unknown as typeof fetch);
    expect(resolution).toEqual({ grounded: null, lastUngrounded: undefined });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("when one candidate's extraction call fails outright, moves on to try the next candidate rather than aborting", async () => {
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return { ok: false, status: 500, json: async () => ({}) } as Response;
      return {
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ country: 'UK', ciqAvailable: 'yes', confidence: 'high', sourceRelevant: true }) } }] } }] }),
      } as Response;
    });

    const resolution = await resolveIndustryCandidates('EGGW', [GENERIC_UK_GUIDE, SPECIFIC_EGGW_PAGE], 'api-key', fetchImpl as unknown as typeof fetch);
    expect(resolution.grounded).not.toBeNull();
    expect(resolution.grounded?.sourceUrl).toBe(SPECIFIC_EGGW_PAGE.sourceUrl);
  });
});
