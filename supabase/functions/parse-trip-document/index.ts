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

    const prompt = `You are an aviation trip itinerary parser. Extract the FULL trip schedule from the document below.

ICAO codes are always exactly 4 uppercase letters (e.g. KAUS, GMMX, HRYR, HTKJ, EGGW, KJFK, EGLL).

VERY COMMON DOCUMENT FORMAT — read line by line, ignoring blank lines:

  DATE_OF_DEPARTURE (e.g. 2/2/2026)
  ORIGIN_ICAO
  DEPARTURE_TIME
  ARRIVAL_TIME (may have "+1" meaning next calendar day)
  DESTINATION_ICAO
  DATE_OF_NEXT_DEPARTURE (e.g. 2/5/2026)
  ORIGIN_ICAO (same as previous destination)
  DEPARTURE_TIME
  ARRIVAL_TIME
  DESTINATION_ICAO
  ... and so on

EXAMPLE — this input:
  2/2/2026
  KAUS
  2100
  1233 (+1)
  GMMX
  2/5/2026
  GMMX
  700
  1400
  HRYR
  2/8/2026
  HRYR
  900
  1003
  HTKJ

Should produce legs: KAUS (departs 2026-02-02 21:00), GMMX (arrives 2026-02-03 12:33, departs 2026-02-05 07:00), HRYR (arrives 2026-02-05 14:00, departs 2026-02-08 09:00), HTKJ (arrives 2026-02-08 10:03)

TIME FORMAT RULES:
- Times have NO colon: 2100 = 21:00, 700 = 07:00, 1233 = 12:33, 1003 = 10:03
- Always output times in HH:MM 24-hour format
- "(+1)" after an arrival time means arrival is the NEXT calendar day — add 1 day to the departure date
- Dates like "2/5/2026" mean February 5, 2026 → ISO format 2026-02-05

PARSING RULES:
- Each unique airport stop = one leg entry
- The ICAO at the start of a block is the ORIGIN; the ICAO at the end is the DESTINATION
- The destination of one leg becomes the origin of the next (they share arrival/departure info)
- The VERY FIRST airport only has departureDate/departureTime (no arrival)
- The VERY LAST airport only has arrivalDate/arrivalTime (no departure)
- ALL intermediate airports have BOTH arrival AND departure info
- Extract ALL legs — do not stop after the first two
- Skip any token that is NOT a valid 4-letter ICAO code

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
    },
    {
      "icao": "HRYR",
      "arrivalDate": "2026-02-05",
      "arrivalTime": "14:00",
      "departureDate": "2026-02-08",
      "departureTime": "09:00"
    }
  ],
  "notes": "Brief description of what was parsed"
}

Use null for missing date/time fields (not empty string). Extract EVERY leg in the document.

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
