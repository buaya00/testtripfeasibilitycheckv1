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

const BASE_PARAMS = {
  icao: 'VHHH',
  flightTypeLabel: 'Private / general aviation',
  resolvedAirportName: 'Hong Kong International Airport',
  permitRequired: 'yes' as const,
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
      return jsonResponse(firecrawlBody('# Official page content about Hong Kong landing permits'));
    });
    const result = await fetchEvidenceViaFirecrawl('https://www.cad.gov.hk/page', 'key', fetchImpl as unknown as typeof fetch);
    expect(result.quality).toBe('full_page');
    expect(result.text).toContain('Hong Kong landing permits');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("degrades to unavailable (not an error) when Firecrawl itself returns a failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500));
    const result = await fetchEvidenceViaFirecrawl('https://www.faa.gov/x', 'key', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none' });
  });

  it("degrades gracefully when Firecrawl's response has no usable markdown", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: {} }));
    const result = await fetchEvidenceViaFirecrawl('https://www.faa.gov/x', 'key', fetchImpl as unknown as typeof fetch);
    expect(result.quality).toBe('none');
  });

  it("degrades gracefully on a network-level throw (e.g. timeout)", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('timeout'); });
    const result = await fetchEvidenceViaFirecrawl('https://www.faa.gov/x', 'key', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none' });
  });
});

describe("runFocusedVerification — end-to-end mocked flow", () => {
  it("full_page evidence via Firecrawl -> classifier says supports -> confirmed classification with a source recorded", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('See official notice', ['https://www.cad.gov.hk/notice']));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return jsonResponse(firecrawlBody('Landing permits are required for all foreign aircraft at VHHH.'));
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        return jsonResponse(classifyBody('supports'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(BASE_PARAMS, fetchImpl as unknown as typeof fetch);
    expect(result.hadError).toBe(false);
    expect(result.classification).toBe('supports');
    // full_page evidence quality is what allows the caller to map this to 'confirmed'.
    expect(result.evidenceQuality).toBe('full_page');
    expect(result.sources).toEqual([
      { url: 'https://www.cad.gov.hk/notice', supports: 'supports', retrievedAt: expect.any(String), evidenceQuality: 'full_page' },
    ]);
  });

  it("Firecrawl fails -> falls back to the Perplexity search snippet -> classification still proceeds, but evidenceQuality is 'search_snippet' (never conflated with full_page)", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('Snippet: permits are required.', ['https://www.faa.gov/notice']));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return jsonResponse({}, false, 500);
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        return jsonResponse(classifyBody('insufficient'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(BASE_PARAMS, fetchImpl as unknown as typeof fetch);
    expect(result.hadError).toBe(false);
    expect(result.classification).toBe('insufficient');
    expect(result.evidenceQuality).toBe('search_snippet');
  });

  it("Firecrawl fails and the snippet is classified as SUPPORTS -> evidenceQuality 'search_snippet' is still reported honestly — the caller (resolveVerificationStatus) is responsible for mapping this to 'provisional', never 'confirmed'", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('Snippet: permits are required for all foreign aircraft at VHHH.', ['https://www.faa.gov/notice']));
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
    expect(result.evidenceQuality).toBe('search_snippet');
    expect(result.sources[0].evidenceQuality).toBe('search_snippet');
  });

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
        return jsonResponse(perplexityBody('some content', ['https://www.faa.gov/x']));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return jsonResponse(firecrawlBody('some page content about VHHH permits'));
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
        return jsonResponse(perplexityBody('some content', ['https://www.faa.gov/x']));
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
        return jsonResponse(perplexityBody('some content', ['https://www.faa.gov/x']));
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
        return jsonResponse(perplexityBody('some content', ['https://www.faa.gov/x']));
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
        // Perplexity returns no citations of its own — only the (unsafe) topCitation passed in is available.
        return jsonResponse(perplexityBody('', []));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(
      { ...BASE_PARAMS, topCitation: 'http://169.254.169.254/latest/meta-data/' },
      fetchImpl as unknown as typeof fetch,
    );
    // No full-page evidence (Firecrawl never invoked for an unsafe URL) and no snippet -> insufficient, no classify call.
    expect(result).toEqual({ classification: 'insufficient', evidenceQuality: 'none', sources: [], hadError: false });
    const calledUrls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(calledUrls).not.toContain('https://api.firecrawl.dev/v1/scrape');
    expect(calledUrls).not.toContain('https://ai.gateway.lovable.dev/v1/chat/completions');
  });

  it("no Perplexity key configured: skips the Perplexity call entirely and still works off the provided topCitation via Firecrawl", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return jsonResponse(firecrawlBody('Landing permits required at VHHH for all foreign aircraft.'));
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        return jsonResponse(classifyBody('supports'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(
      { ...BASE_PARAMS, perplexityApiKey: undefined, topCitation: 'https://www.cad.gov.hk/notice' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.classification).toBe('supports');
    expect(result.evidenceQuality).toBe('full_page');
    const calledUrls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(calledUrls).not.toContain('https://api.perplexity.ai/chat/completions');
  });
});
