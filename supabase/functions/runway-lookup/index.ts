const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface RunwayInfo {
  id: string;
  lengthFt: number;
  widthFt: number;
  surface: string;
  lighted: boolean;
  closed: boolean;
  ident: string;
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

    // Fetch from GitHub-based airports-db (free, no API key)
    const url = `https://raw.githubusercontent.com/epranka/airports-db/master/icao/${icao}.json`;
    console.log('Fetching runway data for:', icao);

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          success: true,
          found: false,
          icao,
          airportName: null,
          runways: [],
          longestRunwayFt: null,
          message: `No runway data found for ${icao}`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const runways: RunwayInfo[] = (data.runways || [])
      .map((rwy: Record<string, unknown>) => ({
        id: rwy.id || '',
        lengthFt: parseInt(String(rwy.length_ft || '0'), 10),
        widthFt: parseInt(String(rwy.width_ft || '0'), 10),
        surface: String(rwy.surface || 'Unknown'),
        lighted: rwy.lighted === '1' || rwy.lighted === 1 || rwy.lighted === true,
        closed: rwy.closed === '1' || rwy.closed === 1 || rwy.closed === true,
        ident: `${rwy.le_ident || ''}/${rwy.he_ident || ''}`,
      }))
      .filter((rwy: RunwayInfo) => !rwy.closed && rwy.lengthFt > 0);

    const longestRunwayFt = runways.length > 0
      ? Math.max(...runways.map((r: RunwayInfo) => r.lengthFt))
      : null;

    return new Response(
      JSON.stringify({
        success: true,
        found: runways.length > 0,
        icao,
        airportName: data.name || null,
        runways,
        longestRunwayFt,
        message: runways.length > 0
          ? `Found ${runways.length} active runway(s) at ${data.name || icao}. Longest: ${longestRunwayFt} ft`
          : `No active runways found for ${icao}`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in runway-lookup:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
