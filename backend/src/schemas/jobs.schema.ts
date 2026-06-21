import { z } from "zod";

export const createJobSchema = z.object({
  uploadId: z.string().uuid("Invalid upload ID"),
  mode: z.enum(["understanding", "memorization"], {
    message: "Mode must be 'understanding' or 'memorization'",
  }),
  language: z.string().min(1, "Language is required"),
  length: z.string().regex(/^\d+$/, "Length must be a number"),
  voice: z.string().optional(),
});

export const extractTextSchema = z.object({
  uploadId: z.string().uuid("Invalid upload ID"),
});

export const youtubeSchema = z.object({
  youtubeUrl: z.string().url("Please enter a valid URL"),
});