import { describe, it, expect, vi } from "vitest";
import {
  runFocusedVerification,
  fetchEvidenceViaFirecrawl,
  fetchEvidenceViaZenRows,
  retrieveFullPageEvidence,
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
    expect(result).toEqual({ text: '', quality: 'none', statusCategory: 'unsafe_url' });
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
    expect(result).toEqual({ text: '', quality: 'none', statusCategory: 'not_configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("for a safe public URL, calls Firecrawl's scrape API itself — never fetches the target URL from this runtime", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.firecrawl.dev/v1/scrape');
      return jsonResponse(firecrawlBody('# Official page content about UK landing permits'));
    });
    const result = await fetchEvidenceViaFirecrawl(UK_URL, 'key', fetchImpl as unknown as typeof fetch);
    expect(result.quality).toBe('full_page');
    expect(result.statusCategory).toBe('success');
    expect(result.text).toContain('UK landing permits');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("degrades to unavailable (not an error) when Firecrawl itself returns a failure, and categorizes a 402 as payment_required", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 402));
    const result = await fetchEvidenceViaFirecrawl(UK_URL, 'key', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none', statusCategory: 'payment_required', httpStatus: 402 });
  });

  it("categorizes a generic server failure as http_error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500));
    const result = await fetchEvidenceViaFirecrawl(UK_URL, 'key', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none', statusCategory: 'http_error', httpStatus: 500 });
  });

  it("degrades gracefully when Firecrawl's response has no usable markdown", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: {} }));
    const result = await fetchEvidenceViaFirecrawl(UK_URL, 'key', fetchImpl as unknown as typeof fetch);
    expect(result.quality).toBe('none');
    expect(result.statusCategory).toBe('unusable_content');
  });

  it("degrades gracefully on a network-level throw (e.g. timeout), categorized as 'timeout'", async () => {
    const fetchImpl = vi.fn(async () => { throw new DOMException('The operation was aborted', 'AbortError'); });
    const result = await fetchEvidenceViaFirecrawl(UK_URL, 'key', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none', statusCategory: 'timeout' });
  });

  it("degrades gracefully on a generic network-level throw, categorized as 'network_error'", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNRESET'); });
    const result = await fetchEvidenceViaFirecrawl(UK_URL, 'key', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none', statusCategory: 'network_error' });
  });
});

describe("fetchEvidenceViaZenRows — never fetches an untrusted URL directly, ZenRows-specific request/response shape", () => {
  it("refuses an unsafe (private/metadata) URL without ever calling fetchImpl", async () => {
    const fetchImpl = vi.fn(() => { throw new Error('should never be called for an unsafe URL'); });
    const result = await fetchEvidenceViaZenRows('http://169.254.169.254/latest/meta-data/', 'zr-key', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none', statusCategory: 'unsafe_url' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never even attempts retrieval when no ZenRows key is configured", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchEvidenceViaZenRows(UK_URL, undefined, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none', statusCategory: 'not_configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls ZenRows' unified GET endpoint with apikey/url/response_type as QUERY PARAMETERS (not a Bearer header, not a POST body) — ZenRows is not assumed to be Firecrawl-compatible", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe('https://api.zenrows.com/v1/');
      expect(parsed.searchParams.get('apikey')).toBe('zr-key');
      expect(parsed.searchParams.get('url')).toBe(UK_URL);
      expect(parsed.searchParams.get('response_type')).toBe('markdown');
      // js_render / premium_proxy must never be set by default — they multiply credit cost.
      expect(parsed.searchParams.has('js_render')).toBe(false);
      expect(parsed.searchParams.has('premium_proxy')).toBe(false);
      expect(init?.method).toBe('GET');
      return { ok: true, status: 200, text: async () => '# UK CAA notice\n\nNo permit required for private flights.' } as Response;
    });
    const result = await fetchEvidenceViaZenRows(UK_URL, 'zr-key', fetchImpl as unknown as typeof fetch);
    expect(result.quality).toBe('full_page');
    expect(result.statusCategory).toBe('success');
    expect(result.text).toContain('No permit required');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats the raw response body as the markdown text directly (res.text()) — ZenRows does not wrap it in a {data: {markdown}} envelope like Firecrawl", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'Plain markdown body, not JSON.' } as Response));
    const result = await fetchEvidenceViaZenRows(UK_URL, 'zr-key', fetchImpl as unknown as typeof fetch);
    expect(result.text).toBe('Plain markdown body, not JSON.');
  });

  it("categorizes a 402 (ZenRows AUTH004 — credits exhausted) as payment_required", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 402, text: async () => '' } as Response));
    const result = await fetchEvidenceViaZenRows(UK_URL, 'zr-key', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none', statusCategory: 'payment_required', httpStatus: 402 });
  });

  it("categorizes a 504 (ZenRows CTX0002 — operation timeout) as timeout", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 504, text: async () => '' } as Response));
    const result = await fetchEvidenceViaZenRows(UK_URL, 'zr-key', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none', statusCategory: 'timeout', httpStatus: 504 });
  });

  it("degrades gracefully on malformed/incomplete (empty) content without throwing", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => '   ' } as Response));
    const result = await fetchEvidenceViaZenRows(UK_URL, 'zr-key', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none', statusCategory: 'unusable_content', httpStatus: 200 });
  });

  it("degrades gracefully on a client-side abort/timeout", async () => {
    const fetchImpl = vi.fn(async () => { throw new DOMException('The operation was aborted', 'AbortError'); });
    const result = await fetchEvidenceViaZenRows(UK_URL, 'zr-key', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none', statusCategory: 'timeout' });
  });

  it("never logs or embeds the API key anywhere except the ZenRows request URL itself (sanity check on our own test double, not production log output)", async () => {
    // This is a documentation-level reminder, not a new assertion: production
    // logging (see retrieveFullPageEvidence/logRetrievalAttempt) never logs
    // the constructed request URL, only the original citation `url`, precisely
    // because the ZenRows request URL embeds the API key as a query parameter.
    const fetchImpl = vi.fn(async (_url: string) => ({ ok: true, status: 200, text: async () => 'ok content here' } as Response));
    await fetchEvidenceViaZenRows(UK_URL, 'super-secret-zr-key', fetchImpl as unknown as typeof fetch);
    const calledUrl = fetchImpl.mock.calls[0][0];
    expect(calledUrl).toContain('super-secret-zr-key'); // confirms the key IS in the request URL (as ZenRows requires)
  });
});

describe("retrieveFullPageEvidence — Firecrawl-primary, ZenRows-fallback orchestration", () => {
  const KEYS = { firecrawlApiKey: 'fc-key', zenrowsApiKey: 'zr-key' };

  it("1. Firecrawl succeeds -> ZenRows is never called", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.firecrawl.dev/v1/scrape') return jsonResponse(firecrawlBody('Firecrawl content about UK permits.'));
      throw new Error(`unexpected fetch: ${url}`);
    });
    const result = await retrieveFullPageEvidence(UK_URL, KEYS, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: 'Firecrawl content about UK permits.', quality: 'full_page', provider: 'firecrawl', fallbackOccurred: false });
    const calledUrls = fetchImpl.mock.calls.map((c) => c[0] as string);
    expect(calledUrls.some((u) => u.startsWith('https://api.zenrows.com/'))).toBe(false);
  });

  it("2. Firecrawl returns 402 (credits exhausted) -> ZenRows is attempted for the SAME url and succeeds", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.firecrawl.dev/v1/scrape') return jsonResponse({}, false, 402);
      if (url.startsWith('https://api.zenrows.com/')) {
        expect(new URL(url).searchParams.get('url')).toBe(UK_URL); // same URL, never broadened
        return { ok: true, status: 200, text: async () => 'ZenRows content about UK permits.' } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const result = await retrieveFullPageEvidence(UK_URL, KEYS, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: 'ZenRows content about UK permits.', quality: 'full_page', provider: 'zenrows', fallbackOccurred: true });
  });

  it("3. Firecrawl times out -> ZenRows is attempted and succeeds", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.firecrawl.dev/v1/scrape') throw new DOMException('The operation was aborted', 'AbortError');
      if (url.startsWith('https://api.zenrows.com/')) return { ok: true, status: 200, text: async () => 'ZenRows content, Firecrawl had timed out.' } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    const result = await retrieveFullPageEvidence(UK_URL, KEYS, fetchImpl as unknown as typeof fetch);
    expect(result.provider).toBe('zenrows');
    expect(result.fallbackOccurred).toBe(true);
    expect(result.text).toBe('ZenRows content, Firecrawl had timed out.');
  });

  it("4. Firecrawl returns empty content -> ZenRows is attempted", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.firecrawl.dev/v1/scrape') return jsonResponse(firecrawlBody(''));
      if (url.startsWith('https://api.zenrows.com/')) return { ok: true, status: 200, text: async () => 'ZenRows filled in where Firecrawl was empty.' } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    const result = await retrieveFullPageEvidence(UK_URL, KEYS, fetchImpl as unknown as typeof fetch);
    expect(result.provider).toBe('zenrows');
    expect(result.text).toBe('ZenRows filled in where Firecrawl was empty.');
  });

  it("5. Both providers fail -> no text/provider is returned; the caller can never mistake this for verified evidence", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.firecrawl.dev/v1/scrape') return jsonResponse({}, false, 500);
      if (url.startsWith('https://api.zenrows.com/')) return { ok: false, status: 500, text: async () => '' } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    const result = await retrieveFullPageEvidence(UK_URL, KEYS, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none', provider: null, fallbackOccurred: true });
  });

  it("6. ZenRows returns malformed/incomplete (whitespace-only) content after Firecrawl also fails -> both fail, no text returned", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.firecrawl.dev/v1/scrape') return jsonResponse({}, false, 402);
      if (url.startsWith('https://api.zenrows.com/')) return { ok: true, status: 200, text: async () => '\n   \n' } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    const result = await retrieveFullPageEvidence(UK_URL, KEYS, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none', provider: null, fallbackOccurred: true });
  });

  it("7. Unsafe URL -> neither provider is called", async () => {
    const fetchImpl = vi.fn(() => { throw new Error('should never be called'); });
    const result = await retrieveFullPageEvidence('http://169.254.169.254/latest/meta-data/', KEYS, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none', provider: null, fallbackOccurred: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("11. Existing behavior is unchanged when ZenRows is not configured: Firecrawl failure yields no evidence, and ZenRows is never invoked even as a no-op", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.firecrawl.dev/v1/scrape') return jsonResponse({}, false, 402);
      throw new Error(`unexpected fetch: ${url}`);
    });
    const result = await retrieveFullPageEvidence(UK_URL, { firecrawlApiKey: 'fc-key', zenrowsApiKey: undefined }, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ text: '', quality: 'none', provider: null, fallbackOccurred: false });
    const calledUrls = fetchImpl.mock.calls.map((c) => c[0] as string);
    expect(calledUrls).toEqual(['https://api.firecrawl.dev/v1/scrape']); // exactly one call, ever
  });

  it("12. No duplicate retrievals or uncontrolled retries: Firecrawl is called exactly once and ZenRows at most once, even across a failing scenario", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.firecrawl.dev/v1/scrape') return jsonResponse({}, false, 500);
      if (url.startsWith('https://api.zenrows.com/')) return { ok: false, status: 500, text: async () => '' } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    await retrieveFullPageEvidence(UK_URL, KEYS, fetchImpl as unknown as typeof fetch);
    const firecrawlCalls = fetchImpl.mock.calls.filter((c) => (c[0] as string) === 'https://api.firecrawl.dev/v1/scrape');
    const zenrowsCalls = fetchImpl.mock.calls.filter((c) => (c[0] as string).startsWith('https://api.zenrows.com/'));
    expect(firecrawlCalls).toHaveLength(1);
    expect(zenrowsCalls).toHaveLength(1);
  });

  it("never lets a fallback attempt broaden retrieval to a different URL than the one approved by the caller", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        expect(JSON.parse(init!.body as string).url).toBe(UK_URL);
        return jsonResponse({}, false, 402);
      }
      if (url.startsWith('https://api.zenrows.com/')) {
        expect(new URL(url).searchParams.get('url')).toBe(UK_URL);
        return { ok: true, status: 200, text: async () => 'content' } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    await retrieveFullPageEvidence(UK_URL, KEYS, fetchImpl as unknown as typeof fetch);
  });
});

describe("runFocusedVerification — jurisdiction applicability (regression coverage for the EGLL/UAE defect)", () => {
  it("REGRESSION: EGLL/UK claim, only a UAE GCAA source available -> rejected as irrelevant. No Firecrawl call, no ZenRows call, and no classify call are made — the wrong-jurisdiction source never reaches evidence retrieval or classification at all, even when ZenRows IS configured", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        // Perplexity's own follow-up search also only turns up the UAE page.
        return jsonResponse(perplexityBody('UAE GCAA guidance on foreign aircraft.', [UAE_URL]));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification(
      { ...BASE_PARAMS, topCitation: UAE_URL, zenrowsApiKey: 'zr-key' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ classification: 'insufficient', evidenceQuality: 'none', sources: [], hadError: false });
    const calledUrls = fetchImpl.mock.calls.map((c) => c[0] as string);
    expect(calledUrls).not.toContain('https://api.firecrawl.dev/v1/scrape');
    expect(calledUrls.some((u) => u.startsWith('https://api.zenrows.com/'))).toBe(false);
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

  it("9. End-to-end ZenRows fallback: Firecrawl fails for the applicable UK source, ZenRows succeeds with full-page content, classifier says supports -> evidenceQuality 'full_page' (eligible for 'confirmed' only because a supporting classification was ALSO reached, not merely because a source was retrieved)", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('See UK CAA notice', [UK_URL]));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return jsonResponse({}, false, 402); // Firecrawl credits exhausted
      }
      if (url.startsWith('https://api.zenrows.com/')) {
        expect(new URL(url).searchParams.get('url')).toBe(UK_URL);
        return { ok: true, status: 200, text: async () => 'No landing permit is required for private non-commercial flights arriving in the UK.' } as Response;
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        return jsonResponse(classifyBody('supports'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification({ ...BASE_PARAMS, zenrowsApiKey: 'zr-key' }, fetchImpl as unknown as typeof fetch);
    expect(result.classification).toBe('supports');
    expect(result.evidenceQuality).toBe('full_page');
    expect(result.sources[0].url).toBe(UK_URL); // the regulatory source URL, never a provider URL
    expect(result.hadError).toBe(false);
  });

  it("ZenRows fallback with a genuinely contradicting result also reaches the classifier normally (fallback retrieval does not bias the outcome toward 'supports')", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('See UK CAA notice', [UK_URL]));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return jsonResponse({}, false, 402);
      }
      if (url.startsWith('https://api.zenrows.com/')) {
        return { ok: true, status: 200, text: async () => 'A landing permit IS required for all non-EU-registered private aircraft arriving in the UK.' } as Response;
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        return jsonResponse(classifyBody('contradicts'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification({ ...BASE_PARAMS, zenrowsApiKey: 'zr-key' }, fetchImpl as unknown as typeof fetch);
    expect(result.classification).toBe('contradicts');
    expect(result.evidenceQuality).toBe('full_page');
  });

  it("10. Firecrawl fails, ZenRows ALSO fails (or is not configured) for the applicable UK source -> falls back to the verify-call's OWN snippet (properly associated with that citation) -> classification proceeds with evidenceQuality 'search_snippet', never 'full_page', and therefore never eligible for 'confirmed'", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.perplexity.ai/chat/completions') {
        return jsonResponse(perplexityBody('UK CAA snippet: no permit required for private flights.', [UK_URL]));
      }
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return jsonResponse({}, false, 500);
      }
      if (url.startsWith('https://api.zenrows.com/')) {
        return { ok: false, status: 500, text: async () => '' } as Response;
      }
      if (url === 'https://ai.gateway.lovable.dev/v1/chat/completions') {
        return jsonResponse(classifyBody('supports'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runFocusedVerification({ ...BASE_PARAMS, zenrowsApiKey: 'zr-key' }, fetchImpl as unknown as typeof fetch);
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
