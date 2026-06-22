/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Gemini before importing anything that uses it
vi.mock("../lib/gemini", () => ({
  geminiModel: {
    generateContent: vi.fn().mockResolvedValue({
      response: {
        text: () => "This is mocked extracted text from a fake PDF, long enough to pass the minimum length check for testing purposes.",
      },
    }),
  },
}));

// Mock OpenAI (both chat completions and TTS)
vi.mock("../lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "Mocked script: Now let's lock it in. Here are the key things to remember..." } }],
        }),
      },
    },
    audio: {
      speech: {
        create: vi.fn().mockResolvedValue({
          arrayBuffer: async () => new ArrayBuffer(100), // fake audio bytes
        }),
      },
    },
  },
}));

import { geminiModel } from "../lib/gemini";
import { openai } from "../lib/openai";

describe("AI pipeline mocking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts text using the mocked Gemini call without hitting the real API", async () => {
    const result = await geminiModel.generateContent([{ text: "fake input" }] as any);
    const text = result.response.text();

    expect(text).toContain("mocked extracted text");
    expect(geminiModel.generateContent).toHaveBeenCalledOnce();
  });

  it("generates a script using the mocked GPT-4o-mini call", async () => {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "test" }],
    } as any);

    const script = completion.choices[0].message.content;
    expect(script).toContain("Now let's lock it in");
    expect(openai.chat.completions.create).toHaveBeenCalledOnce();
  });

  it("generates audio using the mocked TTS call", async () => {
    const response = await openai.audio.speech.create({
      model: "tts-1",
      voice: "onyx",
      input: "test script",
    } as any);

    const buffer = await response.arrayBuffer();
    expect(buffer.byteLength).toBe(100);
    expect(openai.audio.speech.create).toHaveBeenCalledOnce();
  });
});