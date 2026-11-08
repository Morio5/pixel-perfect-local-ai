/**
 * Minimal Groq client (OpenAI-compatible chat completions), used from the browser with the user's own key.
 * Docs: https://console.groq.com/docs/api-reference#chat
 */
import { getGroqKey, getGroqModel } from "./gemini-key";
import { AiServiceError, sleep, throttled, type Part, type Schema } from "./common";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MAX_RETRIES = 2;

/** Gemini-style schema (upper-case types) -> plain JSON Schema, shown to the model inside the prompt. */
function toJsonSchema(s: Schema): unknown {
  return {
    type: s.type.toLowerCase(),
    ...(s.properties ? { properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toJsonSchema(v)])) } : {}),
    ...(s.required ? { required: s.required } : {}),
    ...(s.items ? { items: toJsonSchema(s.items) } : {}),
    ...(s.enum ? { enum: s.enum } : {}),
  };
}

type GroqErrorBody = { error?: { message?: string; type?: string; code?: string } };

export function classifyGroq(status: number, body: GroqErrorBody, headers?: Headers): AiServiceError {
  const msg = body.error?.message || `Groq request failed (${status}).`;
  if (status === 429) {
    if (/per day|\bTPD\b|\bRPD\b/i.test(msg)) return new AiServiceError("credits", "Today's free Groq quota for this key is used up. Try again later, or pick a different model in AI connection.");
    return new AiServiceError("rate_limited", "Groq rate limit reached — wait a minute and retry.");
  }
  if (status === 401) return new AiServiceError("not_configured", "Your Groq API key was rejected. Check it in AI connection.");
  if (status === 403) return new AiServiceError("denied", `${msg} (the key may be restricted, or Groq may be unavailable in your region)`);
  if (status === 404 || /does not exist|decommission|deprecated/i.test(msg)) return new AiServiceError("invalid", `Groq model not available (it may have been retired). Change the model name in AI connection. ${msg}`);
  if (status === 413) return new AiServiceError("invalid", "The request was too large for Groq. Try a smaller image or shorter context.");
  if (status === 400) return new AiServiceError("invalid", msg);
  void headers;
  return new AiServiceError("upstream", msg);
}

export async function generateJsonGroq<T>(opts: { system: string; parts: Part[]; schema: Schema; signal?: AbortSignal }): Promise<T> {
  const key = getGroqKey();
  if (!key) throw new AiServiceError("not_configured", "Add your free Groq API key in AI connection to start translating.");
  const model = getGroqModel();
  const content = opts.parts.map((p) =>
    "text" in p ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } },
  );
  // Qwen3 models "think" by default (slow, and thinking tokens use up the per-minute token limit).
  let noReasoning = /qwen/i.test(model);
  const makeBody = () => JSON.stringify({
    model,
    temperature: 0.2,
    max_completion_tokens: 8000,
    ...(noReasoning ? { reasoning_effort: "none" } : {}),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${opts.system}\n\nRespond with ONE JSON object only (no markdown), matching exactly this JSON Schema:\n${JSON.stringify(toJsonSchema(opts.schema))}` },
      { role: "user", content },
    ],
  });
  let body = makeBody();

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await throttled(() =>
        fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body,
          ...(opts.signal ? { signal: opts.signal } : {}),
        }),
      );
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      throw new AiServiceError("upstream", "Could not reach Groq. Check your internet connection and try again.");
    }
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = undefined; }

    if (!res.ok) {
      // Retry once without reasoning_effort if the model rejects it.
      if (noReasoning && res.status === 400 && /reasoning/i.test(text)) {
        noReasoning = false;
        body = makeBody();
        continue;
      }
      const err = classifyGroq(res.status, (json ?? {}) as GroqErrorBody, res.headers);
      if (((res.status === 429 && err.code === "rate_limited") || res.status === 503) && attempt < MAX_RETRIES) {
        const retryAfter = parseFloat(res.headers.get("retry-after") ?? "");
        await sleep(Math.min(60_000, Math.max(3_000, Number.isFinite(retryAfter) ? retryAfter * 1000 + 500 : 10_000 * (attempt + 1))));
        continue;
      }
      throw err;
    }
    return parseGroqResponse<T>(json);
  }
}

export function parseGroqResponse<T>(json: unknown): T {
  const r = json as { choices?: { finish_reason?: string; message?: { content?: string } }[] };
  const choice = r?.choices?.[0];
  const out = choice?.message?.content ?? "";
  if (!out.trim()) throw new AiServiceError("upstream", `Groq returned no result${choice?.finish_reason ? ` (${choice.finish_reason})` : ""}. Please retry this page.`);
  if (choice?.finish_reason === "length") throw new AiServiceError("upstream", "Groq's answer was cut off. Retry this page.");
  try {
    return JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
  } catch {
    throw new AiServiceError("upstream", "Groq returned an unreadable result. Please retry this page.");
  }
}
