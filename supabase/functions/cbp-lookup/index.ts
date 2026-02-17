const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

    // Search CBP general aviation page filtered by ICAO code
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

    // Check if any results were found by looking for fact sheet links
    const hasFactSheet = html.includes(`(${icao})`) || html.includes(icao.toLowerCase());
    
    // Try to extract the detail page link
    const detailLinkMatch = html.match(/href="(\/document\/general-aviation\/[^"]*?)"/);
    const pdfLinkMatch = html.match(/href="(\/sites\/default\/files\/[^"]*?\.pdf)"/);

    // Try to extract airport name
    const nameMatch = html.match(new RegExp(`([^<>]+?)\\s*\\(${icao}\\)`, 'i'));
    const airportName = nameMatch ? nameMatch[1].trim() : null;

    // If we found a detail page, fetch it for more info
    let detailInfo: Record<string, string> = {};
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
          
          // Extract text content from the detail page body
          // Look for common patterns in CBP fact sheets
          const bodyMatch = detailHtml.match(/<div[^>]*class="[^"]*field--name-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
          const contentText = bodyMatch ? bodyMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
          
          if (contentText) {
            detailInfo.content = contentText.substring(0, 2000);
          }

          // Check for customs/CBP service hours patterns
          const hoursMatch = detailHtml.match(/hours?\s*(?:of\s*)?(?:operation|service)[^<]*?(\d{1,2}[:\d]*\s*(?:AM|PM|a\.m\.|p\.m\.)[^<]*)/i);
          if (hoursMatch) {
            detailInfo.serviceHours = hoursMatch[0].replace(/<[^>]+>/g, ' ').trim();
          }
        }
      } catch (e) {
        console.error('Error fetching detail page:', e);
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
      details: Object.keys(detailInfo).length > 0 ? detailInfo : null,
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
