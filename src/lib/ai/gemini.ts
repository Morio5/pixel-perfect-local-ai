/**
 * Minimal Gemini REST client (no dependencies). Runs in the browser with the
 * user's own API key, so the site owner pays nothing and no AI endpoint is exposed.
 * Docs: https://ai.google.dev/api/generate-content
 */
import { getGeminiKey, getGeminiModel, getProvider } from "./gemini-key";
import { getSettings } from "../settings";
import { AiServiceError, sleep, throttled, type Part, type Schema } from "./common";
import { generateJsonGroq } from "./groq";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_RETRIES = 2;

export { AiServiceError } from "./common";
export type { AiErrorCode, Part, Schema } from "./common";

/** Flash models "think" by default, which adds many seconds. Translation/OCR don't need it. */
const supportsNoThinking = (model: string) => /flash/i.test(model) && !/pro/i.test(model);

type GeminiErrorBody = { error?: { code?: number; message?: string; status?: string; details?: unknown[] } };

function retryDelayMs(body: GeminiErrorBody, attempt: number) {
  const details = (body.error?.details ?? []) as { retryDelay?: string }[];
  const hinted = details.map((d) => d.retryDelay).find(Boolean);
  const seconds = hinted ? parseFloat(hinted) : NaN;
  const ms = Number.isFinite(seconds) ? seconds * 1000 + 500 : 15_000 * (attempt + 1);
  return Math.min(60_000, Math.max(3_000, ms));
}

export function classify(status: number, body: GeminiErrorBody): AiServiceError {
  const msg = body.error?.message || `Gemini request failed (${status}).`;
  const raw = JSON.stringify(body);
  if (status === 429) {
    if (/PerDay/i.test(raw)) return new AiServiceError("credits", "Today's free Gemini quota for this key is used up. Try again tomorrow, use another key, or pick a different model in AI connection.");
    return new AiServiceError("rate_limited", "Gemini rate limit reached — wait a minute and retry.");
  }
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(raw)) return new AiServiceError("not_configured", "Your Gemini API key is not valid. Check it in AI connection.");
  if (status === 400) return new AiServiceError("invalid", msg);
  if (status === 401) return new AiServiceError("not_configured", "Your Gemini API key was rejected. Check it in AI connection.");
  if (status === 403) return new AiServiceError("denied", `${msg} (the key may be restricted, or Gemini may be unavailable in your region)`);
  if (status === 404) return new AiServiceError("invalid", `Model not found. Change the model name in AI connection. ${msg}`);
  return new AiServiceError("upstream", msg);
}

/** Calls generateContent and returns the parsed JSON the model produced. */
export async function generateJson<T>(opts: { system: string; parts: Part[]; schema: Schema; signal?: AbortSignal }): Promise<T> {
  if (getProvider() === "local") throw new AiServiceError("invalid", "Local Mode does not use a cloud AI model for this step.");
  if (getProvider() === "groq") return generateJsonGroq<T>(opts);
  const key = getGeminiKey();
  if (!key) throw new AiServiceError("not_configured", "Add your free Gemini API key in AI connection to start translating.");
  const model = getGeminiModel();
  const makeBody = (noThinking: boolean) => JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: opts.parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: opts.schema,
      temperature: 0.2,
      ...(noThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  });
  let noThinking = getSettings().speed !== "quality" && supportsNoThinking(model);
  let body = makeBody(noThinking);

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await throttled(() =>
        fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body,
          ...(opts.signal ? { signal: opts.signal } : {}),
        }),
      );
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      throw new AiServiceError("upstream", "Could not reach Gemini. Check your internet connection and try again.");
    }
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = undefined; }

    if (!res.ok) {
      // Some models reject thinkingBudget: retry once without it.
      if (noThinking && res.status === 400 && /thinking/i.test(text)) {
        noThinking = false;
        body = makeBody(false);
        continue;
      }
      const err = classify(res.status, (json ?? {}) as GeminiErrorBody);
      const retryable = (res.status === 429 && err.code === "rate_limited") || res.status === 503;
      if (retryable && attempt < MAX_RETRIES) {
        await sleep(retryDelayMs((json ?? {}) as GeminiErrorBody, attempt));
        continue;
      }
      throw err;
    }
    return parseResponse<T>(json);
  }
}

export function parseResponse<T>(json: unknown): T {
  const r = json as {
    promptFeedback?: { blockReason?: string };
    candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  if (r?.promptFeedback?.blockReason) throw new AiServiceError("denied", `Gemini blocked this request (${r.promptFeedback.blockReason}).`);
  const cand = r?.candidates?.[0];
  const out = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  if (!out.trim()) throw new AiServiceError("upstream", `Gemini returned no result${cand?.finishReason ? ` (${cand.finishReason})` : ""}. Please retry this page.`);
  if (cand?.finishReason === "MAX_TOKENS") throw new AiServiceError("upstream", "Gemini's answer was cut off. Retry this page.");
  try {
    return JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
  } catch {
    throw new AiServiceError("upstream", "Gemini returned an unreadable result. Please retry this page.");
  }
}

/** Splits a data URL into what Gemini's inlineData expects. */
export function dataUrlToInline(dataUrl: string): Part {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new AiServiceError("invalid", "Unsupported image data.");
  return { inlineData: { mimeType: m[1]!, data: m[2]! } };
}

/** Tiny request used by the "Test key" button. */
export async function testGeminiKey() {
  await generateJson<{ ok: boolean }>({
    system: "Reply with JSON only.",
    parts: [{ text: 'Return {"ok": true}.' }],
    schema: { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } }, required: ["ok"] },
  });
}
