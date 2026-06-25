// Custom YouTube transcript fetcher using the InnerTube API.
// Tries multiple client configurations so that if one is bot-checked or
// returns no captions, the next one is attempted automatically.

const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

interface InnerTubeClient {
  clientName: string;
  clientVersion: string;
  userAgent: string;
  extraContext?: Record<string, string>;
}

// Ordered from least-commonly-bot-checked to fallback.
// IOS is first because YouTube rarely challenges it with bot detection.
const INNERTUBE_CLIENTS: InnerTubeClient[] = [
  {
    clientName: "IOS",
    clientVersion: "20.10.4",
    userAgent:
      "com.google.ios.youtube/20.10.4 (iPhone14,5; U; CPU iOS 18_3_2 like Mac OS X)",
    extraContext: {
      deviceModel: "iPhone14,5",
      osVersion: "18.3.2.22D82",
      osName: "iPhone",
    },
  },
  {
    clientName: "TVHTML5",
    clientVersion: "7.20240201.00.00",
    userAgent:
      "Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1",
  },
  {
    clientName: "ANDROID",
    clientVersion: "20.10.38",
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14)",
  },
  {
    clientName: "WEB",
    clientVersion: "2.20240101.00.00",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
];

export class YouTubeTranscriptError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_CAPTIONS" | "VIDEO_UNAVAILABLE" | "NETWORK_ERROR"
  ) {
    super(message);
    this.name = "YouTubeTranscriptError";
  }
}

export async function fetchYouTubeTranscript(
  videoId: string,
  preferredLang?: string
): Promise<string> {
  const errors: string[] = [];

  for (const client of INNERTUBE_CLIENTS) {
    try {
      const text = await fetchWithClient(videoId, client, preferredLang);
      if (text) return text;
      // null means no captions with this client — try the next one
    } catch (err: any) {
      if (err instanceof YouTubeTranscriptError && err.code === "VIDEO_UNAVAILABLE") {
        throw err; // Genuinely private or deleted — no point retrying
      }
      errors.push(`${client.clientName}: ${err.message}`);
    }
  }

  throw new YouTubeTranscriptError(
    `No captions found after trying ${INNERTUBE_CLIENTS.length} clients. Details: ${errors.join(" | ")}`,
    "NO_CAPTIONS"
  );
}

async function fetchWithClient(
  videoId: string,
  client: InnerTubeClient,
  preferredLang?: string
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(INNERTUBE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": client.userAgent,
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: client.clientName,
            clientVersion: client.clientVersion,
            hl: "en",
            gl: "US",
            ...client.extraContext,
          },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });
  } catch (err: any) {
    throw new YouTubeTranscriptError(
      `Network error reaching YouTube: ${err.message}`,
      "NETWORK_ERROR"
    );
  }

  if (!response.ok) return null;

  let data: any;
  try {
    data = await response.json();
  } catch {
    return null;
  }

  const status: string | undefined = data?.playabilityStatus?.status;
  const reason: string = data?.playabilityStatus?.reason ?? "";

  if (status === "ERROR") {
    // Video deleted, taken down, or doesn't exist — no client will help
    throw new YouTubeTranscriptError(`Video unavailable: ${reason}`, "VIDEO_UNAVAILABLE");
  }

  if (status === "LOGIN_REQUIRED") {
    // A private video says "This video is private." — that is genuinely unavailable.
    // A bot-check says "Sign in to confirm you're not a bot" — try another client.
    if (reason.toLowerCase().includes("private")) {
      throw new YouTubeTranscriptError("This video is private.", "VIDEO_UNAVAILABLE");
    }
    // Bot check or age gate — return null to try the next client
    return null;
  }

  // UNPLAYABLE, CONTENT_CHECK_REQUIRED, etc. — try the next client
  if (status && status !== "OK") {
    return null;
  }

  const captionTracks: CaptionTrack[] =
    data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

  if (captionTracks.length === 0) return null;

  // Track selection: preferred lang → English manual → English auto → first available
  let track: CaptionTrack | undefined;
  if (preferredLang) {
    track = captionTracks.find((t) => t.languageCode === preferredLang);
    if (!track) return null;
  } else {
    track =
      captionTracks.find((t) => t.languageCode === "en" && !t.kind) ||
      captionTracks.find((t) => t.languageCode === "en") ||
      captionTracks.find((t) => t.languageCode?.startsWith("en")) ||
      captionTracks[0];
  }

  if (!track?.baseUrl) return null;

  // Guard against SSRF — transcript URLs must come from YouTube
  try {
    const url = new URL(track.baseUrl);
    if (!url.hostname.endsWith(".youtube.com")) return null;
  } catch {
    return null;
  }

  let transcriptResponse: Response;
  try {
    transcriptResponse = await fetch(track.baseUrl, {
      headers: {
        "User-Agent": client.userAgent,
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch {
    return null;
  }

  if (!transcriptResponse.ok) return null;

  const xml = await transcriptResponse.text();
  if (!xml) return null;

  return parseTranscriptXml(xml);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    );
}

function parseTranscriptXml(xml: string): string {
  const texts: string[] = [];

  // srv3 format: <p t="ms" d="ms">...<s>word</s>...</p>
  const pMatches = [
    ...xml.matchAll(/<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g),
  ];
  if (pMatches.length > 0) {
    for (const m of pMatches) {
      const inner = m[3];
      const sMatches = [...inner.matchAll(/<s[^>]*>([^<]*)<\/s>/g)];
      const raw =
        sMatches.length > 0
          ? sMatches.map((s) => s[1]).join("")
          : inner.replace(/<[^>]+>/g, "");
      const decoded = decodeHtmlEntities(raw.trim());
      if (decoded) texts.push(decoded);
    }
    return texts.join(" ").replace(/\s+/g, " ").trim();
  }

  // Classic format: <text start="s" dur="s">content</text>
  const textMatches = [...xml.matchAll(/<text[^>]*>([^<]*)<\/text>/g)];
  for (const m of textMatches) {
    const decoded = decodeHtmlEntities(m[1].trim());
    if (decoded) texts.push(decoded);
  }
  return texts.join(" ").replace(/\s+/g, " ").trim();
}
