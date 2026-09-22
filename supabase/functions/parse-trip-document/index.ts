
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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const isPdf = file.name?.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
    const fileBytes = new Uint8Array(await file.arrayBuffer());

    // Determine if we have usable text or need vision/OCR
    let fileText = "";
    let useVision = false;

    if (isPdf) {
      // Try extracting text from the raw bytes (works for text-based PDFs)
      const rawText = new TextDecoder("utf-8", { fatal: false }).decode(fileBytes);

      // Count alphabetic characters in extracted text to gauge quality
      const letterCount = (rawText.match(/[A-Za-z]/g) || []).length;
      const icaoMatches = rawText.match(/\b[A-Z]{4}\b/g) || [];

      console.log(`PDF raw text stats: ${letterCount} letters, ${icaoMatches.length} potential ICAO codes, text length: ${rawText.length}`);

      // PDF binary will have lots of bytes but few meaningful words
      // If we find ICAO-like codes in raw text, it might still work, but PDFs
      // encode text in streams that file.text() can't decode properly.
      // Always use vision for PDFs since raw byte decoding is unreliable.
      useVision = true;
      console.log("PDF detected — using vision model for extraction");
    } else {
      // Plain text, CSV, etc. — direct text extraction works fine
      fileText = new TextDecoder("utf-8", { fatal: false }).decode(fileBytes);
      const letterCount = (fileText.match(/[A-Za-z]/g) || []).length;
      console.log(`Text file: ${letterCount} letters, length: ${fileText.length}`);

      if (letterCount < 50) {
        console.log("Text file has very little text — falling back to vision");
        useVision = true;
      }
    }

    const prompt = `You are an aviation trip itinerary parser. Extract the FULL trip schedule from the document.

ICAO codes are always exactly 4 uppercase letters (e.g. KAUS, GMMX, HRYR, HTKJ, EGGW, KJFK, EGLL, KHND, KGRB, LIPH, LMML, LFMD, EDDB, LEMG, TJIG).

The document may be a Jeppesen trip sheet, flight plan, or similar aviation document. Look for:
- Tables with columns like "City / Airport / Country", "ICAO", "IATA", "Date/Time UTC"
- ETA and ETD lines with dates and times
- Flight leg information spread across multiple pages

PARSING RULES:
- Each page typically represents one leg/stop of the trip
- Look for ICAO codes in table cells, headers, or any structured data
- Extract arrival (ETA) and departure (ETD) dates and times in UTC
- Times may be in formats like "Thu 12-Mar-2026 0429Z" or "0429Z" or "04:29"
- Convert all dates to ISO format YYYY-MM-DD
- Convert all times to HH:MM 24-hour format
- The VERY FIRST airport only has departureDate/departureTime (no arrival)
- The VERY LAST airport only has arrivalDate/arrivalTime (no departure)
- ALL intermediate airports have BOTH arrival AND departure info
- Extract ALL legs — do not stop early
- Skip any token that is NOT a valid 4-letter ICAO code

Return ONLY a JSON object in this exact format, nothing else:
{
  "legs": [
    {
      "icao": "KHND",
      "arrivalDate": null,
      "arrivalTime": null,
      "departureDate": "2026-03-12",
      "departureTime": "01:30"
    },
    {
      "icao": "KGRB",
      "arrivalDate": "2026-03-12",
      "arrivalTime": "04:29",
      "departureDate": "2026-03-12",
      "departureTime": "05:00"
    }
  ],
  "notes": "Brief description of what was parsed"
}

Use null for missing date/time fields (not empty string). Extract EVERY leg in the document.`;

    let aiRes: Response;

    if (useVision) {
      // Send PDF as base64 to Gemini vision — it can read PDFs directly
      const base64Data = btoa(String.fromCharCode(...fileBytes));
      const mimeType = isPdf ? "application/pdf" : (file.type || "image/png");

      console.log(`Sending ${mimeType} to vision model (${fileBytes.length} bytes, base64: ${base64Data.length} chars)`);

      aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${base64Data}`,
                  },
                },
              ],
            },
          ],
          temperature: 0.1,
        }),
      });
    } else {
      // Text-based file — send as text content
      console.log(`Sending text content to model (${fileText.length} chars)`);

      aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "user",
              content: prompt + "\n\nDocument text:\n" + fileText.slice(0, 8000),
            },
          ],
          temperature: 0.1,
        }),
      });
    }

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error(`AI gateway error: ${errText}`);
      throw new Error(`AI gateway error: ${errText}`);
    }

    const aiData = await aiRes.json();
    const rawText = aiData?.choices?.[0]?.message?.content ?? "{}";

    console.log(`AI raw response (first 500 chars): ${rawText.slice(0, 500)}`);

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
      console.error(`Failed to parse AI response as JSON: ${cleaned.slice(0, 300)}`);
      parsed = { legs: [] };
    }

    // Validate ICAO codes (exactly 4 uppercase letters)
    const validLegs = (parsed.legs || []).filter(
      (l) => l.icao && /^[A-Z]{4}$/.test(l.icao)
    );

    console.log(`Parsed ${validLegs.length} valid legs from document. Vision used: ${useVision}. Notes: ${parsed.notes}`);

    if (validLegs.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          legs: [],
          notes: "No ICAO codes detected. Please verify the document formatting and ensure ICAO codes are present.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
