import { scrapeOfficialSources } from '../_shared/firecrawl-scrape.ts';
import {
  shouldAttemptSecondPass,
  resolveCiqAvailability,
  secondPassSearchQuery,
  type CiqPassResult,
} from './verification-logic.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface CiqExtraction {
  country: string;
  airportName?: string;
  ciqAvailable: 'yes' | 'no' | 'limited';
  isPortOfEntry?: boolean;
  operatingHours?: string;
  advanceNotice?: string;
  fees?: string;
  alternateAirports?: string;
  notes?: string;
  confidence: 'high' | 'medium' | 'low';
}

type ExtractionOutcome =
  | { ok: true; extraction: CiqExtraction; grounded: boolean }
  | { ok: false; errorResponse: Response };

/**
 * Runs one CIQ extraction pass: an OpenRouter/Gemini call, optionally
 * grounded by firecrawlContext. "grounded" reflects ONLY whether real,
 * non-empty scraped content was actually provided to the model for THIS
 * call — never inferred from the model's own self-reported confidence,
 * which is a separate, independent signal.
 */
async function runCiqExtraction(
  icao: string,
  firecrawlContext: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExtractionOutcome> {
  const icaoPrefix = icao.substring(0, 2);
  const prompt = `Given the ICAO airport code "${icao}" (prefix "${icaoPrefix}"), determine whether Customs, Immigration, and Quarantine (CIQ) services are available at this airport for general aviation and private jet operations.

${firecrawlContext ? `## Official eAIP / CAA scraped data (highest priority source):\n${firecrawlContext}\n\n---\n` : ''}
Consider:
- The country this ICAO prefix belongs to
- Whether this airport is an international airport or port of entry
- Whether CIQ/customs clearance is available for GA/private flights
- Whether CIQ is available 24/7 or only during specific hours
- Whether advance notice is required for CIQ services
- Any fees or special arrangements needed
- Alternative nearby airports with CIQ if this one doesn't have it

Provide your best assessment based on known aviation information about this airport.`;

  const aiResponse = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: 'You are an aviation operations expert specializing in international airport services. Determine CIQ (Customs, Immigration, Quarantine) availability at airports based on their ICAO code. Return structured data via the provided tool.',
        },
        { role: 'user', content: prompt },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'extract_ciq_info',
            description: 'Extract structured CIQ availability information for an airport.',
            parameters: {
              type: 'object',
              properties: {
                country: { type: 'string', description: 'Country name where the airport is located' },
                airportName: { type: 'string', description: 'Full name of the airport' },
                ciqAvailable: { type: 'string', enum: ['yes', 'no', 'limited'], description: 'Whether CIQ services are available' },
                isPortOfEntry: { type: 'boolean', description: 'Whether the airport is an official port of entry / international airport' },
                operatingHours: { type: 'string', description: 'CIQ operating hours if known (e.g. "24/7", "0800-1800 local", "By arrangement")' },
                advanceNotice: { type: 'string', description: 'Advance notice required for CIQ (e.g. "24 hours", "48 hours", "None")' },
                fees: { type: 'string', description: 'Any known overtime or special CIQ fees' },
                alternateAirports: { type: 'string', description: 'Nearby airports with CIQ if this airport has limited or no CIQ' },
                notes: { type: 'string', description: 'Additional important notes about CIQ at this airport' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Confidence level in the information provided' },
              },
              required: ['country', 'ciqAvailable', 'confidence'],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'extract_ciq_info' } },
    }),
  });

  if (!aiResponse.ok) {
    const status = aiResponse.status;
    if (status === 429) {
      return { ok: false, errorResponse: new Response(
        JSON.stringify({ success: false, error: 'Rate limit exceeded, please try again shortly' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      ) };
    }
    if (status === 402) {
      return { ok: false, errorResponse: new Response(
        JSON.stringify({ success: false, error: 'Usage limit reached. Please add credits to continue using AI lookups.' }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      ) };
    }
    console.error('AI gateway error:', status);
    return { ok: false, errorResponse: new Response(
      JSON.stringify({ success: false, error: 'AI lookup failed' }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    ) };
  }

  const aiData = await aiResponse.json();
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

  if (!toolCall?.function?.arguments) {
    return { ok: false, errorResponse: new Response(
      JSON.stringify({ success: false, error: 'Could not determine CIQ availability' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    ) };
  }

  const extraction = JSON.parse(toolCall.function.arguments) as CiqExtraction;
  return { ok: true, extraction, grounded: firecrawlContext.trim().length > 0 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { icao } = await req.json();

    if (!icao || typeof icao !== 'string' || !/^[A-Z]{4}$/.test(icao)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Valid 4-letter ICAO code required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'AI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Primary pass ──────────────────────────────────────────────────
    const { combinedContent: primaryContext } = await scrapeOfficialSources(icao, 'ciq');
    if (primaryContext) {
      console.log(`Firecrawl CIQ context (primary): ${primaryContext.length} chars`);
    }

    const primaryOutcome = await runCiqExtraction(icao, primaryContext, apiKey);
    if (!primaryOutcome.ok) {
      return primaryOutcome.errorResponse;
    }

    const primaryPass: CiqPassResult = {
      ciqAvailable: primaryOutcome.extraction.ciqAvailable,
      confidence: primaryOutcome.extraction.confidence,
      grounded: primaryOutcome.grounded,
    };

    // ── Optional second pass, only when the primary pass found nothing
    // to ground its answer in. Never triggered by low confidence alone —
    // see verification-logic.ts for why. ──────────────────────────────
    let secondPass: CiqPassResult | null = null;
    let secondExtraction: CiqExtraction | null = null;
    if (shouldAttemptSecondPass(primaryPass)) {
      console.log(`CIQ primary pass ungrounded for ${icao} — attempting second pass with a broader query`);
      const { combinedContent: secondContext } = await scrapeOfficialSources(
        icao,
        'ciq',
        { searchQuery: secondPassSearchQuery(icao), maxPages: 3 }
      );
      if (secondContext) {
        console.log(`Firecrawl CIQ context (second pass): ${secondContext.length} chars`);
      }
      const secondOutcome = await runCiqExtraction(icao, secondContext, apiKey);
      if (secondOutcome.ok) {
        secondExtraction = secondOutcome.extraction;
        secondPass = {
          ciqAvailable: secondOutcome.extraction.ciqAvailable,
          confidence: secondOutcome.extraction.confidence,
          grounded: secondOutcome.grounded,
        };
      } else {
        // Deliberately swallowed, not propagated as the overall response:
        // we still have a (ungrounded) primary answer, and
        // resolveCiqAvailability treats secondPass: null as "could not
        // attempt", collapsing safely to 'unknown' rather than failing
        // the whole request over a second-pass-only hiccup.
        console.warn(`CIQ second pass call failed for ${icao}; treating as ungrounded`);
      }
    }

    const resolved = resolveCiqAvailability(primaryPass, secondPass);

    // Use whichever pass's extracted descriptive fields (country, hours,
    // etc.) actually produced the grounded answer; fall back to the
    // primary extraction otherwise (including the both-ungrounded case,
    // where ciqAvailable is overridden to 'unknown' regardless).
    const sourceExtraction = (!primaryPass.grounded && secondExtraction)
      ? secondExtraction
      : primaryOutcome.extraction;

    return new Response(
      JSON.stringify({
        success: true,
        icao,
        country: sourceExtraction.country,
        airportName: sourceExtraction.airportName,
        ciqAvailable: resolved.ciqAvailable,
        isPortOfEntry: sourceExtraction.isPortOfEntry,
        operatingHours: sourceExtraction.operatingHours,
        advanceNotice: sourceExtraction.advanceNotice,
        fees: sourceExtraction.fees,
        alternateAirports: sourceExtraction.alternateAirports,
        notes: resolved.evidenceQuality === 'ungrounded'
          ? `Could not find grounded, official information about CIQ availability at ${icao} after two attempts.${sourceExtraction.notes ? ` ${sourceExtraction.notes}` : ''}`
          : sourceExtraction.notes,
        confidence: resolved.confidence,
        evidenceQuality: resolved.evidenceQuality,
        secondPassAttempted: resolved.secondPassAttempted,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in ciq-lookup:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
