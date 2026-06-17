import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { uploadId, filePath } = await req.json();
    if (!uploadId || !filePath) throw new Error("Missing uploadId or filePath");

    // Download the PDF
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("pdf-uploads")
      .download(filePath);
    if (downloadError) throw downloadError;

    const arrayBuffer = await fileData.arrayBuffer();
    const pdfBase64 = base64Encode(new Uint8Array(arrayBuffer));

    console.log(`PDF downloaded, size: ${arrayBuffer.byteLength} bytes`);

    // Determine MIME type from file extension (PDF, PPTX, DOCX, etc.)
    const lowerPath = filePath.toLowerCase();
    let mimeType = "application/pdf";
    if (lowerPath.endsWith(".pptx")) mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    else if (lowerPath.endsWith(".ppt")) mimeType = "application/vnd.ms-powerpoint";
    else if (lowerPath.endsWith(".docx")) mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    else if (lowerPath.endsWith(".doc")) mimeType = "application/msword";

    // Use Gemini to extract text from the document
    const geminiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract ALL text content from this document (PDF, PowerPoint, or Word file). Return ONLY the extracted text preserving structure. Do not add commentary."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${pdfBase64}`
                }
              }
            ]
          }
        ],
        max_tokens: 16000,
        temperature: 0,
      }),
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error("Gemini API error:", geminiResponse.status, errText);
      throw new Error(`AI text extraction failed: ${geminiResponse.status}`);
    }

    const geminiData = await geminiResponse.json();
    let extractedText = geminiData.choices?.[0]?.message?.content || "";

    if (extractedText.length < 50) {
      throw new Error(
        "Could not extract enough readable text from this PDF. " +
        "Please try uploading a different PDF file."
      );
    }

    // Cap at 50k chars
    extractedText = extractedText.slice(0, 50000);
    console.log(`Extracted ${extractedText.length} chars from PDF via AI`);

    // Update the upload record
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    await adminClient
      .from("uploads")
      .update({ extracted_text: extractedText })
      .eq("id", uploadId);

    return new Response(
      JSON.stringify({ text: extractedText, length: extractedText.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("process-pdf error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
