import { getSettings } from "../settings";

export type AiErrorCode = "not_configured" | "credits" | "rate_limited" | "denied" | "invalid" | "upstream";

export class AiServiceError extends Error {
  constructor(public code: AiErrorCode, message: string) {
    super(message);
  }
}

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
// Schema dialect (OpenAPI subset). Gemini REST expects upper-case type names.
export type Schema = {
  type: "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN" | "ARRAY" | "OBJECT";
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: string[];
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const gapMs = () => (getSettings().speed === "quality" ? 3000 : 1000);
let nextSlot = 0;

/** Spaces out request starts but lets requests run concurrently (no waiting for the previous reply). */
export async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + gapMs();
  if (start > now) await sleep(start - now);
  return fn();
}
