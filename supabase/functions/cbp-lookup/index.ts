const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface ParsedHours {
  open: string; // HH:MM in 24h format
  close: string;
  days: string; // e.g. "Mon-Fri", "Daily", "Mon-Sun"
  notes: string;
  raw: string;
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

    const searchUrl = `https://www.cbp.gov/newsroom/publications/general-aviation-airport-fact-sheets?field_airport_code_value=${icao}`;
    console.log('Fetching CBP page for:', icao, 'URL:', searchUrl);

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AirportOpsChecker/1.0)',
        'Accept': 'text/html',
      },
    });

    if (!response.ok) {
      console.error('CBP fetch failed:', response.status);
      return new Response(
        JSON.stringify({ success: false, error: `CBP site returned status ${response.status}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const html = await response.text();
    const hasFactSheet = html.includes(`(${icao})`) || html.includes(icao.toLowerCase());
    const detailLinkMatch = html.match(/href="(\/document\/general-aviation\/[^"]*?)"/);
    const pdfLinkMatch = html.match(/href="(\/sites\/default\/files\/[^"]*?\.pdf)"/);
    const nameMatch = html.match(new RegExp(`([^<>]+?)\\s*\\(${icao}\\)`, 'i'));
    const airportName = nameMatch ? nameMatch[1].trim() : null;

    let detailContent = '';
    if (detailLinkMatch) {
      try {
        const detailUrl = `https://www.cbp.gov${detailLinkMatch[1]}`;
        console.log('Fetching detail page:', detailUrl);
        const detailRes = await fetch(detailUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; AirportOpsChecker/1.0)',
            'Accept': 'text/html',
          },
        });
        if (detailRes.ok) {
          const detailHtml = await detailRes.text();
          const bodyMatch = detailHtml.match(/<div[^>]*class="[^"]*field--name-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
          detailContent = bodyMatch ? bodyMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
        }
      } catch (e) {
        console.error('Error fetching detail page:', e);
      }
    }

    // Use AI to extract structured hours from the fact sheet content
    let parsedHours: ParsedHours | null = null;
    if (detailContent && hasFactSheet) {
      try {
        const apiKey = Deno.env.get('LOVABLE_API_KEY');
        if (apiKey) {
          const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-3-flash-preview',
              messages: [
                {
                  role: 'system',
                  content: 'You extract CBP customs operating hours from airport fact sheet text. Return ONLY a JSON object with these fields: open (HH:MM 24h UTC), close (HH:MM 24h UTC), days (e.g. "Mon-Fri" or "Daily"), notes (any caveats like "by appointment only" or "advance notice required"), raw (the original hours text as found). If hours are in local time, note that in the notes field. If you cannot determine hours, return null.',
                },
                {
                  role: 'user',
                  content: `Extract CBP customs operating hours from this airport fact sheet content:\n\n${detailContent.substring(0, 3000)}`,
                },
              ],
              tools: [
                {
                  type: 'function',
                  function: {
                    name: 'extract_hours',
                    description: 'Extract structured CBP operating hours.',
                    parameters: {
                      type: 'object',
                      properties: {
                        open: { type: 'string', description: 'Opening time HH:MM 24h format' },
                        close: { type: 'string', description: 'Closing time HH:MM 24h format' },
                        days: { type: 'string', description: 'Days of operation e.g. Mon-Fri, Daily' },
                        notes: { type: 'string', description: 'Caveats or additional info about hours' },
                        raw: { type: 'string', description: 'Original hours text as found in source' },
                        found: { type: 'boolean', description: 'Whether hours were found in the text' },
                      },
                      required: ['found'],
                      additionalProperties: false,
                    },
                  },
                },
              ],
              tool_choice: { type: 'function', function: { name: 'extract_hours' } },
            }),
          });

          if (aiResponse.ok) {
            const aiData = await aiResponse.json();
            const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
            if (toolCall?.function?.arguments) {
              const extracted = JSON.parse(toolCall.function.arguments);
              if (extracted.found) {
                parsedHours = {
                  open: extracted.open || '',
                  close: extracted.close || '',
                  days: extracted.days || '',
                  notes: extracted.notes || '',
                  raw: extracted.raw || '',
                };
              }
            }
          } else {
            console.error('AI hours extraction failed:', aiResponse.status);
          }
        }
      } catch (e) {
        console.error('Error extracting hours with AI:', e);
      }
    }

    const result = {
      success: true,
      found: hasFactSheet,
      icao,
      airportName,
      customsAvailable: hasFactSheet,
      detailUrl: detailLinkMatch ? `https://www.cbp.gov${detailLinkMatch[1]}` : null,
      pdfUrl: pdfLinkMatch ? `https://www.cbp.gov${pdfLinkMatch[1]}` : null,
      operatingHours: parsedHours,
      message: hasFactSheet
        ? `CBP services available at ${airportName || icao}. See fact sheet for hours and requirements.`
        : `No CBP General Aviation fact sheet found for ${icao}. Customs may not be available.`,
    };

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in cbp-lookup:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
