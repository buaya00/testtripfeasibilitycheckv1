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

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
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

    // Fetch from OurAirports runways.csv (free, updated daily, no API key)
    const url = 'https://davidmegginson.github.io/ourairports-data/runways.csv';
    console.log('Fetching runway data for:', icao);

    const response = await fetch(url, {
      headers: { 'Accept': 'text/csv' },
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          found: false,
          icao,
          airportName: null,
          runways: [],
          longestRunwayFt: null,
          message: `Failed to fetch runway database (status ${response.status})`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const csv = await response.text();
    const lines = csv.split('\n');
    const header = parseCSVLine(lines[0]);

    // Find column indices
    const col = (name: string) => header.indexOf(name);
    const iIdent = col('airport_ident');
    const iLength = col('length_ft');
    const iWidth = col('width_ft');
    const iSurface = col('surface');
    const iLighted = col('lighted');
    const iClosed = col('closed');
    const iLeIdent = col('le_ident');
    const iHeIdent = col('he_ident');
    const iId = col('id');

    const runways: RunwayInfo[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const fields = parseCSVLine(line);
      if (fields[iIdent] !== icao) continue;

      const closed = fields[iClosed] === '1';
      const lengthFt = parseInt(fields[iLength] || '0', 10);
      if (closed || lengthFt <= 0) continue;

      runways.push({
        id: fields[iId] || '',
        lengthFt,
        widthFt: parseInt(fields[iWidth] || '0', 10),
        surface: fields[iSurface] || 'Unknown',
        lighted: fields[iLighted] === '1',
        closed: false,
        ident: `${fields[iLeIdent] || ''}/${fields[iHeIdent] || ''}`,
      });
    }

    const longestRunwayFt = runways.length > 0
      ? Math.max(...runways.map(r => r.lengthFt))
      : null;

    // Also fetch airport name and coordinates from airports.csv
    let airportName: string | null = null;
    let latitude: number | null = null;
    let longitude: number | null = null;
    try {
      const airportsRes = await fetch('https://davidmegginson.github.io/ourairports-data/airports.csv');
      if (airportsRes.ok) {
        const airportsCsv = await airportsRes.text();
        const airportLines = airportsCsv.split('\n');
        const airportHeader = parseCSVLine(airportLines[0]);
        const iAIdent = airportHeader.indexOf('ident');
        const iAName = airportHeader.indexOf('name');
        const iALat = airportHeader.indexOf('latitude_deg');
        const iALon = airportHeader.indexOf('longitude_deg');
        for (let i = 1; i < airportLines.length; i++) {
          const line = airportLines[i].trim();
          if (!line) continue;
          if (!line.includes(icao)) continue; // quick pre-filter
          const fields = parseCSVLine(line);
          if (fields[iAIdent] === icao) {
            airportName = fields[iAName] || null;
            const lat = parseFloat(fields[iALat]);
            const lon = parseFloat(fields[iALon]);
            if (!isNaN(lat)) latitude = lat;
            if (!isNaN(lon)) longitude = lon;
            break;
          }
        }
      }
    } catch (e) {
      console.error('Error fetching airport name:', e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        found: runways.length > 0,
        icao,
        airportName,
        latitude,
        longitude,
        runways,
        longestRunwayFt,
        message: runways.length > 0
          ? `Found ${runways.length} active runway(s) at ${airportName || icao}. Longest: ${longestRunwayFt?.toLocaleString()} ft`
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
