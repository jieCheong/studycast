import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      // /embed/<id> or /shorts/<id>
      const m = u.pathname.match(/\/(embed|shorts|v)\/([A-Za-z0-9_-]{6,})/);
      if (m) return m[2];
    }
  } catch {
    // not a URL — maybe a raw id
  }
  if (/^[A-Za-z0-9_-]{6,}$/.test(url)) return url;
  return null;
}

async function tryFetchTranscript(videoId: string): Promise<string> {
  const endpoints = [
    `https://www.youtube-transcript-api.com/api/transcript?video_id=${videoId}&lang=en`,
    `https://yt-transcript-api.vercel.app/api?videoId=${videoId}`,
  ];

  let lastErr = "";
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!res.ok) {
        lastErr = `${url} -> ${res.status}`;
        continue;
      }
      const data = await res.json();
      const text = parseTranscript(data);
      if (text && text.trim().length > 20) return text;
      lastErr = `${url} -> empty transcript`;
    } catch (e) {
      lastErr = `${url} -> ${e instanceof Error ? e.message : "error"}`;
    }
  }
  throw new Error(`Could not fetch YouTube transcript. ${lastErr}`);
}

function parseTranscript(data: any): string {
  // Possible shapes: { transcript: [{ text, ... }] } or array directly, or { data: [...] }
  const arr =
    Array.isArray(data) ? data :
    Array.isArray(data?.transcript) ? data.transcript :
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.segments) ? data.segments :
    null;

  if (arr) {
    return arr.map((s: any) => (typeof s === "string" ? s : s?.text ?? "")).join(" ").replace(/\s+/g, " ").trim();
  }
  if (typeof data?.transcript === "string") return data.transcript;
  if (typeof data?.text === "string") return data.text;
  return "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { youtubeUrl } = await req.json();
    if (!youtubeUrl) throw new Error("Missing youtubeUrl");

    const videoId = extractVideoId(String(youtubeUrl).trim());
    if (!videoId) throw new Error("Could not parse a YouTube video ID from that URL.");

    console.log("Fetching transcript for", videoId);
    let text = await tryFetchTranscript(videoId);

    // Cap at 50k chars to match PDF flow
    text = text.slice(0, 50000);

    return new Response(
      JSON.stringify({ text, videoId, length: text.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("fetch-youtube error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});