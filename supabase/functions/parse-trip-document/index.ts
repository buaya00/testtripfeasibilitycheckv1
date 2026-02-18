import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileText = await file.text();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const prompt = `You are an aviation trip itinerary parser. Extract the trip schedule from the document below.

ICAO codes are always exactly 4 uppercase letters (e.g. KAUS, GMMX, HRYR, HTKJ, EGGW, KJFK, EGLL).

The document may use a columnar/tabular format like this:

  DATE
  ORIGIN_ICAO
  DEPARTURE_TIME
  ARRIVAL_TIME (may have "+1" meaning next day)
  DESTINATION_ICAO

Or any other schedule format. Parse intelligently.

TIME FORMAT RULES:
- Times may be written without colons: 2100 = 21:00, 700 = 07:00, 1233 = 12:33
- Always output times in HH:MM 24-hour format
- "(+1)" after an arrival time means the arrival is the next calendar day — adjust the arrivalDate accordingly
- If no explicit date is given for a leg, infer it from context

OUTPUT RULES:
- Each airport stop = one leg entry
- Include arrivalDate/arrivalTime if the aircraft arrives at that airport
- Include departureDate/departureTime if the aircraft departs from that airport
- The first stop typically only has departure info; the last stop typically only has arrival info
- Skip any stop where you cannot find a valid 4-letter ICAO code

Return ONLY a JSON object in this exact format, nothing else:
{
  "legs": [
    {
      "icao": "KAUS",
      "arrivalDate": null,
      "arrivalTime": null,
      "departureDate": "2026-02-02",
      "departureTime": "21:00"
    },
    {
      "icao": "GMMX",
      "arrivalDate": "2026-02-03",
      "arrivalTime": "12:33",
      "departureDate": "2026-02-05",
      "departureTime": "07:00"
    }
  ],
  "notes": "Brief description of what was parsed"
}

Use null for missing date/time fields (not empty string).

Document text:
${fileText.slice(0, 8000)}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`AI gateway error: ${errText}`);
    }

    const aiData = await aiRes.json();
    const rawText = aiData?.choices?.[0]?.message?.content ?? "{}";

    // Strip markdown code fences if present
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed: {
      legs: Array<{
        icao: string;
        arrivalDate?: string | null;
        arrivalTime?: string | null;
        departureDate?: string | null;
        departureTime?: string | null;
      }>;
      notes?: string;
    };

    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { legs: [] };
    }

    // Validate ICAO codes (exactly 4 uppercase letters)
    const validLegs = (parsed.legs || []).filter(
      (l) => l.icao && /^[A-Z]{4}$/.test(l.icao)
    );

    console.log(`Parsed ${validLegs.length} valid legs from document. Notes: ${parsed.notes}`);

    return new Response(
      JSON.stringify({ success: true, legs: validLegs, notes: parsed.notes }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("parse-trip-document error:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
