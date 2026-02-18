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

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

    const prompt = `You are an aviation trip scheduler parser. Extract the trip itinerary from the following document text.

For each stop/leg in the schedule, extract ONLY:
1. Airport ICAO code (4 uppercase letters, e.g. KJFK, EGLL, YSSY) - required
2. Arrival date (ISO format YYYY-MM-DD) - if provided
3. Arrival time UTC (HH:MM 24h format) - if provided
4. Departure date (ISO format YYYY-MM-DD) - if provided
5. Departure time UTC (HH:MM 24h format) - if provided

Rules:
- Each unique stop is a "leg" in the array
- If times are in local time, try to convert to UTC if timezone is mentioned; otherwise keep as-is
- Round times to nearest :00 or :30 (e.g. 14:23 → 14:00 or 14:30)
- If an ICAO code is not clearly identifiable, skip that stop
- Return ONLY valid ICAO codes (4 uppercase letters)
- Do NOT include airport names, only ICAO codes

Return ONLY a JSON object in this exact format, nothing else:
{
  "legs": [
    {
      "icao": "KJFK",
      "arrivalDate": "2024-03-15",
      "arrivalTime": "14:00",
      "departureDate": "2024-03-16",
      "departureTime": "09:30"
    }
  ],
  "notes": "Any relevant extraction notes"
}

Document text:
${fileText.slice(0, 8000)}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Gemini API error: ${errText}`);
    }

    const geminiData = await geminiRes.json();
    const rawText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

    let parsed: { legs: Array<{
      icao: string;
      arrivalDate?: string;
      arrivalTime?: string;
      departureDate?: string;
      departureTime?: string;
    }>; notes?: string };

    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { legs: [] };
    }

    // Validate ICAO codes
    const validLegs = (parsed.legs || []).filter(
      (l) => l.icao && /^[A-Z]{4}$/.test(l.icao)
    );

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
