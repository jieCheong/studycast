import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

    const { jobId, extractedText, mode, language, length } = await req.json();
    if (!jobId || !extractedText) throw new Error("Missing required fields");

    const wordTarget = length * 150; // ~150 words per minute of speech

    const modeInstructions = mode === "memorization"
      ? `Focus on memorization. Structure the script in THREE distinct parts so key terms are repeated across intro, body, and outro (like song lyrics):

Part 1 — Introduction (~15% of total words): Briefly preview ALL the key terms, names, dates, formulas, and concepts that will be covered. Frame it as a "coming up" teaser, e.g. "In this session we'll cover X, Y, and Z..." Just name them — do not explain yet.

Part 2 — Full Explanation (~65% of total words): Explain each concept naturally and conversationally with examples. When you introduce each key term, say the term clearly and then define it.

Part 3 — Rapid Recall Recap (~20% of total words): Return to every key term, definition, and formula and state it again clearly and concisely — like a flashcard read aloud. Start this section with the exact phrase: "Now let's lock it in. Here are the key things to remember..." Then go through each item in the format "Term — definition." Keep it tight and rhythmic for retention.`
      : `Focus on understanding: explain relationships and meaning, add transitions between ideas, clarify why points matter, use examples where helpful. Make it conversational and explanatory.`;

    const languageInstruction = language !== "English"
      ? `Generate the entire script in ${language}. Translate all content.`
      : `Generate the script in English.`;

    const systemPrompt = `You are an expert educational audio content creator. Your job is to transform study materials into clear, engaging audio scripts that sound like a well-produced educational podcast.

Rules:
- Stay grounded in the source material. Do not invent facts.
- Create smooth, listenable content — NOT a bullet-point reading.
- Add natural transitions between topics.
- Target approximately ${wordTarget} words (~${length} minutes of audio).
- ${modeInstructions}
- ${languageInstruction}
- Do NOT include stage directions, speaker labels, or sound effects.
- Write in a warm, knowledgeable tone as if explaining to a friend.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Here is the study material to convert into an audio script:\n\n${extractedText}` },
        ],
        max_tokens: 4096,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI error:", response.status, errText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const transcript = data.choices[0]?.message?.content;
    if (!transcript) throw new Error("No transcript generated");

    // Update job status
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    await adminClient
      .from("jobs")
      .update({ status: "processing" })
      .eq("id", jobId);

    return new Response(
      JSON.stringify({ transcript }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("generate-script error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
