import { createClient } from 'jsr:@supabase/supabase-js@2';

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

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Server configuration missing' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Privileged, server-side-only client — never exposed to the frontend.
    // Reads these tables directly regardless of their SELECT RLS policies.
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: quotes, error: quotesError } = await supabase
      .from('ground_handling_quotes')
      .select('id, provider_id, aircraft_type, currency, grand_total, quote_date')
      .eq('icao', icao);

    if (quotesError) {
      console.error('ground-handling-quotes: quotes query error:', quotesError.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to load ground handling quotes' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!quotes || quotes.length === 0) {
      return new Response(
        JSON.stringify({ success: true, icao, quotes: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const providerIds = [...new Set(quotes.map((q) => q.provider_id).filter(Boolean))];
    const { data: providers } = providerIds.length > 0
      ? await supabase.from('ground_handling_providers').select('id, name').in('id', providerIds)
      : { data: [] as { id: string; name: string }[] };
    const providerMap = new Map((providers || []).map((p) => [p.id, p.name]));

    const quoteIds = quotes.map((q) => q.id);
    const { data: items } = await supabase
      .from('ground_handling_line_items')
      .select('quote_id, service_category, description, quantity, unit_price, vat_rate, subtotal, unit')
      .in('quote_id', quoteIds);

    const result = quotes.map((q) => ({
      id: q.id,
      provider_name: providerMap.get(q.provider_id) || 'Unknown',
      aircraft_type: q.aircraft_type,
      currency: q.currency,
      grand_total: q.grand_total,
      quote_date: q.quote_date,
      line_items: (items || []).filter((i) => i.quote_id === q.id),
    }));

    return new Response(
      JSON.stringify({ success: true, icao, quotes: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in ground-handling-quotes:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
