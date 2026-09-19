import { describe, it, expect, vi } from "vitest";
import {
  runFocusedVerification,
  fetchEvidenceViaFirecrawl,
} from "../../supabase/functions/permit-lookup/verification-runtime";

// jsdom (vitest's default test environment) does not implement
// AbortSignal.timeout, unlike Node and Deno (where this code actually runs).
// Without this, every fetchImpl call below would throw before the mock is
// even invoked, since the production code builds `{ signal: AbortSignal.timeout(...) }`
// inline in the fetch options object. This shim only affects this test
// process — it never touches the production module.
if (typeof AbortSignal.timeout !== "function") {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = () => new AbortController().signal;
}

// Mocked integration tests for the actual production orchestration code
// (imported directly, not reimplemented) — covers the retrieval + fallback +
// classification flow end-to-end with a fake `fetch` injected via the
// `fetchImpl` parameter. No live/paid API calls are made and no real network
// access occurs.
//
// The primary scenario mirrors the live-test regression exactly: EGLL (UK),
// private/non-commercial, US-registered Global 6000, permitRequired "no".
// The bug was a UAE GCAA page being accepted as evidence for this UK claim.
// A second, unrelated destination (USA/FAA) is included per the requirement
// that the fix not be airport- or country-specific.

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function perplexityBody(content: string, citations: string[]) {
  return { choices: [{ message: { content } }], citations };
}

function firecrawlBody(markdown: string) {
  return { data: { markdown } };
}

function classifyBody(classification: string) {
  return {
    choices: [{
      message: {
        tool_calls: [{ function: { arguments: JSON.stringify({ classification }) } }],
      },
    }],
  };
}

const UK_URL = 'https://www.caa.co.uk/notice';
const UAE_URL = 'https://www.gcaa.gov.ae/eaip/some-page';
const USA_URL = 'https://www.faa.gov/notice';

const BASE_PARAMS = {
  icao: 'EGLL',
  flightTypeLabel: 'Private / general aviation',
  aircraftNationality: 'United States',
  resolvedAirportName: 'London Heathrow Airport',
  permitRequired: 'no' as const,
  country: 'United Kingdom',
  perplexityApiKey: 'pplx-key',
  lovableApiKey: 'lovable-key',
  firecrawlApiKey: 'firecrawl-key',
  topCitation: undefined as string | undefined,
};

describe("fetchEvidenceViaFirecrawl — never fetches an untrusted URL directly", () => {
  it("refuses an unsafe (private/metadata) URL without ever calling fetchImpl — the SSRF gate runs before any network call", async () => {
    const fetchImpl = vi.fn(() => { throw new Error('should never be called for an unsafe URL'); });
    const result = await fetchEvidenceViaFirecrawl('http://169.254.169.254/latest/meta-data/', 'key', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a non-http(s) scheme without calling fetchImpl", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchEvidenceViaFirecrawl('javascript:alert(1)', 'key', fetchImpl as unknown as typeof fetch);
    expect(result.quality).toBe('none');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never even attempts retrieval when no Firecrawl key is configured", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchEvidenceViaFirecrawl('https://www.faa.gov/x', undefined, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("for a safe public URL, calls Firecrawl's scrape API itself — never fetches the target URL from this runtime", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.firecrawl.dev/v1/scrape');
      return jsonResponse(firecrawlBody('# Official page content about UK landing permits'));
    });
    const result = await fetchEvidenceViaFirecrawl(UK_URL, 'key', fetchImpl as unknown as typeof fetch);
    expect(result.quality).toBe('full_page');
    expect(result.text).toContain('UK landing permits');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("degrades to unavailable (not an error) when Firecrawl itself returns a failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500));
    const result = await fetchEvidenceViaFirecrawl(UK_URL, 'key', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none' });
  });

  it("degrades gracefully when Firecrawl's response has no usable markdown", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: {} }));
    const result = await fetchEvidenceViaFirecrawl(UK_URL, 'key', fetchImpl as unknown as typeof fetch);
    expect(result.quality).toBe('none');
  });

  it("degrades gracefully on a network-level throw (e.g. timeout)", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('timeout'); });
    const result = await fetchEvidenceViaFirecrawl(UK_URL, 'key', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none' });
  });
});

describe("runFocusedVerification — jurisdiction applicability (regression coverage for the EGLL/UAE defect)", () => {
  it("REGRESSION: EGLL/UK claim, only a UAE GCAA source available -> rejected as irrelevant. No Firecrawl call and no classify call are made — the wrong-jurisdiction source never reaches evidence retrieval or classification at all", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        // Perplexity's own follow-up search also only turns up the UAE page.
        return jsonResponse(perplexityBody('UAE GCAA guidance on foreign aircraft.', [UAE_URL]));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification({ ...BASE_PARAMS, topCitation: UAE_URL }, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ classification: 'insufficient', evidenceQuality: 'none', sources: [], hadError: false });
    const calledUrls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(calledUrls).not.toContain('https://api.firecrawl.dev/v1/scrape');
    expect(calledUrls).not.toContain('https://ai.gateway.lovable.dev/v1/chat/completions');
  });

  it("REGRESSION: even if the classifier WOULD have said 'contradicts' for the UAE source, it is never given the chance to — the jurisdiction gate runs first, so a wrong-jurisdiction source can never produce 'conflicting'", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('UAE GCAA guidance.', [UAE_URL]));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        // If this were ever called, it would hand back UAE content...
        return jsonResponse(firecrawlBody('UAE GCAA landing permit rules for foreign aircraft.'));
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        // ...and if the classifier were ever called with it, it might wrongly say "contradicts" —
        // exactly the reported bug. This must never be reached.
        return jsonResponse(classifyBody('contradicts'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification({ ...BASE_PARAMS, topCitation: UAE_URL }, fetchImpl as unknown as typeof fetch);
    expect(result.classification).not.toBe('contradicts');
    expect(result.classification).toBe('insufficient');
    expect(result.hadError).toBe(false);
    const calledUrls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(calledUrls).not.toContain('https://api.firecrawl.dev/v1/scrape');
    expect(calledUrls).not.toContain('https://ai.gateway.lovable.dev/v1/chat/completions');
  });

  it("An applicable UK CAA source is accepted, retrieved via Firecrawl, and classified normally -> eligible for 'confirmed' (via evidenceQuality: 'full_page')", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('See UK CAA notice', [UK_URL]));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return jsonResponse(firecrawlBody('No landing permit is required for private non-commercial flights arriving in the UK.'));
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        return jsonResponse(classifyBody('supports'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(BASE_PARAMS, fetchImpl as unknown as typeof fetch);
    expect(result.hadError).toBe(false);
    expect(result.classification).toBe('supports');
    expect(result.evidenceQuality).toBe('full_page');
    expect(result.sources).toEqual([
      { url: UK_URL, supports: 'supports', retrievedAt: expect.any(String), evidenceQuality: 'full_page' },
    ]);
  });

  it("An applicable UK CAA source that genuinely contradicts the claim -> 'contradicts' with full_page evidence (eligible for 'conflicting')", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('See UK CAA notice', [UK_URL]));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return jsonResponse(firecrawlBody('A landing permit IS required for all non-EU-registered private aircraft arriving in the UK.'));
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        return jsonResponse(classifyBody('contradicts'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(BASE_PARAMS, fetchImpl as unknown as typeof fetch);
    expect(result.classification).toBe('contradicts');
    expect(result.evidenceQuality).toBe('full_page');
    expect(result.hadError).toBe(false);
  });

  it("Firecrawl fails for the applicable UK source -> falls back to the verify-call's OWN snippet (properly associated with that citation) -> classification proceeds with evidenceQuality 'search_snippet', never 'full_page'", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('UK CAA snippet: no permit required for private flights.', [UK_URL]));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return jsonResponse({}, false, 500);
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        return jsonResponse(classifyBody('supports'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(BASE_PARAMS, fetchImpl as unknown as typeof fetch);
    expect(result.classification).toBe('supports');
    expect(result.evidenceQuality).toBe('search_snippet'); // caller must map this to 'provisional', never 'confirmed'
    expect(result.sources[0].evidenceQuality).toBe('search_snippet');
  });

  it("No applicable source anywhere (only a UAE citation on offer, and the caller-supplied topCitation is also UAE) -> insufficient/none, no warning-worthy error, no paid calls beyond the initial Perplexity check", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('', [UAE_URL]));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification({ ...BASE_PARAMS, topCitation: UAE_URL }, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ classification: 'insufficient', evidenceQuality: 'none', sources: [], hadError: false });
  });

  it("The initial (caller-supplied) topCitation is re-validated for jurisdiction even if the caller already filtered it — a UAE topCitation is never trusted just because it was passed in", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('', [])); // follow-up search finds nothing at all
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification({ ...BASE_PARAMS, topCitation: UAE_URL }, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ classification: 'insufficient', evidenceQuality: 'none', sources: [], hadError: false });
    const calledUrls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(calledUrls).not.toContain('https://api.firecrawl.dev/v1/scrape');
  });

  it("A mix of citations in the follow-up response (UAE first, UK second) -> the applicable UK one is selected, not simply the first one returned — citation ORDER must not decide applicability", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('Mixed results.', [UAE_URL, UK_URL]));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        expect(url).toBe('https://api.firecrawl.dev/v1/scrape');
        return jsonResponse(firecrawlBody('UK guidance content.'));
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        return jsonResponse(classifyBody('supports'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(BASE_PARAMS, fetchImpl as unknown as typeof fetch);
    expect(result.classification).toBe('supports');
    expect(result.sources[0].url).toBe(UK_URL);
  });

  it("NON-UK destination (USA/FAA): an applicable FAA source is accepted and classified normally — proves the fix is not UK/EGLL-specific", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('FAA guidance.', [USA_URL]));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return jsonResponse(firecrawlBody('No landing permit is required for private non-commercial flights arriving in the US.'));
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        return jsonResponse(classifyBody('supports'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(
      { ...BASE_PARAMS, icao: 'KJFK', resolvedAirportName: 'John F. Kennedy International Airport', country: 'United States' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.classification).toBe('supports');
    expect(result.evidenceQuality).toBe('full_page');
  });

  it("NON-UK destination (USA): a UK or UAE citation is rejected for a US claim just as readily as a UAE citation was rejected for the UK claim — this is a general jurisdiction rule, not a UK-specific carve-out", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('', [UK_URL, UAE_URL]));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(
      { ...BASE_PARAMS, icao: 'KJFK', country: 'United States', topCitation: UK_URL },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ classification: 'insufficient', evidenceQuality: 'none', sources: [], hadError: false });
  });

  it("UNMAPPED destination (no entry in the static jurisdiction map, and no acronym-based fallback): rejected regardless of which citation is offered, and no source can be established — an unmapped country never fabricates applicability, it fails safe to inconclusive", async () => {
    const KENYA_PARAMS = {
      ...BASE_PARAMS,
      icao: 'HKJK',
      country: 'Kenya',
    };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('', [UK_URL, USA_URL, UAE_URL]));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(KENYA_PARAMS, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ classification: 'insufficient', evidenceQuality: 'none', sources: [], hadError: false });
    const calledUrls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(calledUrls).not.toContain('https://api.firecrawl.dev/v1/scrape');
    expect(calledUrls).not.toContain('https://ai.gateway.lovable.dev/v1/chat/completions');
  });

  it("An applicable authority domain is NOT sufficient on its own: a UK CAA page that actually discusses an unrelated subject is still classified insufficient by the (mocked) classifier — jurisdiction match only gets evidence to classification, it does not shortcut past it", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('UK CAA guidance found.', [UK_URL]));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        // Genuinely from the UK's own authority, but about an unrelated topic (noise, not landing permits).
        return jsonResponse(firecrawlBody('UK CAA guidance on airport noise abatement procedures and night flight restrictions.'));
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        // Reflects what the classifier's existing prompt instruction ("must
        // specifically address... otherwise insufficient") should produce
        // for genuinely off-topic content.
        return jsonResponse(classifyBody('insufficient'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(BASE_PARAMS, fetchImpl as unknown as typeof fetch);
    expect(result.classification).toBe('insufficient');
    expect(result.evidenceQuality).toBe('full_page'); // content WAS retrieved — it just didn't address the claim
    expect(result.hadError).toBe(false);
  });
});

describe("runFocusedVerification — no evidence / error paths (unchanged safe-warning behavior)", () => {
  it("no citation and no snippet content -> classified insufficient WITHOUT ever calling the classifier (no evidence to classify)", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('', []));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(BASE_PARAMS, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ classification: 'insufficient', evidenceQuality: 'none', sources: [], hadError: false });
    const calledUrls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(calledUrls).not.toContain('https://ai.gateway.lovable.dev/v1/chat/completions');
    expect(calledUrls).not.toContain('https://api.firecrawl.dev/v1/scrape');
  });

  it("classifier API call fails (non-200) -> hadError true, classification null", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('some content', [UK_URL]));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return jsonResponse(firecrawlBody('some UK page content about EGLL permits'));
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        return jsonResponse({}, false, 502);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(BASE_PARAMS, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ classification: null, evidenceQuality: 'full_page', sources: [], hadError: true });
  });

  it("classifier returns a response with no tool call at all (malformed AI response) -> hadError true", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('some content', [UK_URL]));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return jsonResponse(firecrawlBody('some page content'));
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        return jsonResponse({ choices: [{ message: {} }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(BASE_PARAMS, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ classification: null, evidenceQuality: 'full_page', sources: [], hadError: true });
  });

  it("classifier tool call arguments are malformed JSON -> hadError true, does not throw", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('some content', [UK_URL]));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return jsonResponse(firecrawlBody('some page content'));
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        return jsonResponse({ choices: [{ message: { tool_calls: [{ function: { arguments: '{not valid json' } }] } }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(BASE_PARAMS, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ classification: null, evidenceQuality: 'full_page', sources: [], hadError: true });
  });

  it("classifier returns a classification value outside the allowed enum -> hadError true, never trusted verbatim", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('some content', [UK_URL]));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return jsonResponse(firecrawlBody('some page content'));
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        return jsonResponse(classifyBody('maybe'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(BASE_PARAMS, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ classification: null, evidenceQuality: 'full_page', sources: [], hadError: true });
  });

  it("a network-level throw/timeout anywhere in the flow is caught -> hadError true, never propagates", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('AbortError: timeout'); });
    const result = await runFocusedVerification(BASE_PARAMS, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ classification: null, evidenceQuality: 'none', sources: [], hadError: true });
  });

  it("an unsafe topCitation (private/metadata address) is never fetched directly, and never sent to Firecrawl either", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('', []));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(
      { ...BASE_PARAMS, topCitation: 'http://169.254.169.254/latest/meta-data/' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ classification: 'insufficient', evidenceQuality: 'none', sources: [], hadError: false });
    const calledUrls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(calledUrls).not.toContain('https://api.firecrawl.dev/v1/scrape');
    expect(calledUrls).not.toContain('https://ai.gateway.lovable.dev/v1/chat/completions');
  });

  it("no Perplexity key configured: skips the Perplexity call entirely and still works off the provided (jurisdiction-applicable) topCitation via Firecrawl", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return jsonResponse(firecrawlBody('Landing permits required at EGLL for all foreign aircraft.'));
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        return jsonResponse(classifyBody('supports'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(
      { ...BASE_PARAMS, perplexityApiKey: undefined, topCitation: UK_URL },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.classification).toBe('supports');
    expect(result.evidenceQuality).toBe('full_page');
    const calledUrls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(calledUrls).not.toContain('https://api.perplexity.ai/chat/completions');
  });
});
