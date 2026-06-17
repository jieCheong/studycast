import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

class FunctionError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.name = "FunctionError";
    this.status = status;
    this.code = code;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not configured");

    const { jobId, transcript, voiceId } = await req.json();
    if (!jobId || !transcript || !voiceId) throw new Error("Missing required fields");

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Split transcript into chunks of ~4500 chars to respect TTS limits
    const chunks: string[] = [];
    const maxChunkSize = 4500;
    let remaining = transcript;
    while (remaining.length > 0) {
      if (remaining.length <= maxChunkSize) {
        chunks.push(remaining);
        break;
      }
      // Find last sentence end within limit
      let splitAt = remaining.lastIndexOf(". ", maxChunkSize);
      if (splitAt === -1 || splitAt < maxChunkSize * 0.5) splitAt = maxChunkSize;
      else splitAt += 2; // Include the period and space
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
    }

    // Generate audio for each chunk
    const audioBuffers: Uint8Array[] = [];
    for (const chunk of chunks) {
      const ttsResponse = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: chunk,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.3,
            },
          }),
        }
      );

      if (!ttsResponse.ok) {
        const errText = await ttsResponse.text();
        console.error("ElevenLabs error:", ttsResponse.status, errText);

        let errorMessage = `ElevenLabs API error: ${ttsResponse.status}`;
        let errorCode: string | undefined;

        try {
          const parsed = JSON.parse(errText);
          const detail = parsed?.detail;
          errorCode = detail?.status;

          if (detail?.status === "quota_exceeded") {
            errorMessage = `${detail.message}. Add more ElevenLabs credits or generate a shorter audio clip.`;
          } else if (typeof detail?.message === "string" && detail.message.trim()) {
            errorMessage = detail.message;
          }
        } catch {
          if (errText.trim()) errorMessage = errText;
        }

        throw new FunctionError(errorMessage, ttsResponse.status, errorCode);
      }

      const buffer = new Uint8Array(await ttsResponse.arrayBuffer());
      audioBuffers.push(buffer);
    }

    // Concatenate audio buffers
    const totalLength = audioBuffers.reduce((sum, buf) => sum + buf.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of audioBuffers) {
      combined.set(buf, offset);
      offset += buf.length;
    }

    // Upload to storage
    const audioPath = `${jobId}.mp3`;
    const { error: storageError } = await adminClient.storage
      .from("audio-files")
      .upload(audioPath, combined, { contentType: "audio/mpeg", upsert: true });
    if (storageError) throw storageError;

    const { data: urlData } = adminClient.storage
      .from("audio-files")
      .getPublicUrl(audioPath);

    const audioUrl = urlData.publicUrl;

    // Estimate duration (~150 words/min, ~5 chars/word)
    const estimatedDuration = Math.round((transcript.length / 5 / 150) * 60);

    // Create output record
    await adminClient.from("outputs").insert({
      job_id: jobId,
      transcript,
      audio_url: audioUrl,
      duration_seconds: estimatedDuration,
    });

    // Update job status
    await adminClient
      .from("jobs")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("id", jobId);

    return new Response(
      JSON.stringify({ audioUrl, duration: estimatedDuration }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("generate-audio error:", error);

    // Mark job as failed
    try {
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { jobId } = await req.clone().json().catch(() => ({}));
      if (jobId) {
        await adminClient
          .from("jobs")
          .update({ status: "failed", error_message: error instanceof Error ? error.message : "Unknown error" })
          .eq("id", jobId);
      }
    } catch {}

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        code: error instanceof FunctionError ? error.code : undefined,
      }),
      {
        status: error instanceof FunctionError ? error.status : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
