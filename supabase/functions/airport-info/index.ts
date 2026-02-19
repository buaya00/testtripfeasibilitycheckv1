const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
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

    const airportsRes = await fetch('https://davidmegginson.github.io/ourairports-data/airports.csv', {
      headers: { 'Accept': 'text/csv' },
    });

    if (!airportsRes.ok) {
      return new Response(
        JSON.stringify({ success: false, error: `Failed to fetch airport database (${airportsRes.status})` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const csv = await airportsRes.text();
    const lines = csv.split('\n');
    const header = parseCSVLine(lines[0]);

    const iIdent      = header.indexOf('ident');
    const iName       = header.indexOf('name');
    const iMunicipality = header.indexOf('municipality');
    const iCountry    = header.indexOf('iso_country');
    const iLat        = header.indexOf('latitude_deg');
    const iLon        = header.indexOf('longitude_deg');

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || !line.includes(icao)) continue;
      const fields = parseCSVLine(line);
      if (fields[iIdent] !== icao) continue;

      return new Response(
        JSON.stringify({
          success: true,
          icao,
          airportName: fields[iName] || null,
          municipality: fields[iMunicipality] || null,
          country: fields[iCountry] || null,
          latitude: parseFloat(fields[iLat]) || null,
          longitude: parseFloat(fields[iLon]) || null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, icao, airportName: null, municipality: null }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('airport-info error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
