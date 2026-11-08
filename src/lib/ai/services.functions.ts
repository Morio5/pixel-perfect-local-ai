/**
 * Client-side AI services (Gemini, bring-your-own-key).
 * Same names and call shape as the former server functions: fn({ data }) → { ok, data } | { ok:false, code, error }.
 * Nothing here runs on the server, so there is no shared key to protect or to run out of credits.
 */
import { AiServiceError, dataUrlToInline, generateJson, type Schema } from "./gemini";
import { getLocalAck, getProvider } from "./gemini-key";
import { localDetect, localTranslate } from "./local";

function assertLocalReady() {
  if (!getLocalAck()) throw new AiServiceError("not_configured", "Confirm the non-commercial licence notice for Local Mode in AI connection first.");
}

type Fail = { ok: false; code: string; error: string };

async function guard<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | Fail> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    const e = err as { code?: string; message?: string; name?: string };
    if (e?.name === "AbortError") throw err;
    console.error("[ai-service]", e?.message);
    return { ok: false, code: e instanceof AiServiceError ? e.code : (e?.code ?? "upstream"), error: e?.message ?? "Unknown error" };
  }
}

const KINDS = ["bubble", "thought", "caption", "sfx", "narration", "title", "sign"] as const;
const str: Schema = { type: "STRING" };
const num: Schema = { type: "NUMBER" };
const clip = (s: string | undefined, n: number) => (s ?? "").slice(0, n);

export type OcrRegion = {
  text: string;
  kind: (typeof KINDS)[number];
  vertical: boolean;
  /** 0-1000 normalized box relative to the full image */
  x: number; y: number; w: number; h: number;
  textColor: string;
  strokeColor: string;
};

const ocrSchema: Schema = {
  type: "OBJECT",
  required: ["regions"],
  properties: {
    regions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["text", "kind", "vertical", "box_2d", "textColor", "strokeColor"],
        properties: {
          text: str,
          kind: { type: "STRING", enum: [...KINDS] },
          vertical: { type: "BOOLEAN" },
          // Gemini's native detection format: [ymin, xmin, ymax, xmax], 0-1000
          box_2d: { type: "ARRAY", items: { type: "INTEGER" } },
          textColor: str,
          strokeColor: str,
        },
      },
    },
  },
};

/** Converts Gemini's [ymin,xmin,ymax,xmax] into the app's x,y,w,h (0-1000). Returns null for unusable boxes. */
export function boxToRect(box: number[] | undefined) {
  if (!box || box.length !== 4 || box.some((n) => !Number.isFinite(n))) return null;
  const [y0, x0, y1, x1] = box as [number, number, number, number];
  const clamp = (n: number) => Math.max(0, Math.min(1000, n));
  const ymin = clamp(Math.min(y0, y1)), ymax = clamp(Math.max(y0, y1));
  const xmin = clamp(Math.min(x0, x1)), xmax = clamp(Math.max(x0, x1));
  if (xmax - xmin <= 0 || ymax - ymin <= 0) return null;
  return { x: xmin, y: ymin, w: xmax - xmin, h: ymax - ymin };
}

/** OCR SERVICE: detects every text region with normalized 0-1000 bounding boxes. */
export const detectText = (input: { data: { image: string; sourceLang: string } }) =>
  guard(async () => {
    const { image, sourceLang } = input.data;
    if (!image.startsWith("data:image/")) throw new AiServiceError("invalid", "Unsupported image data.");
    if (getProvider() === "local") {
      assertLocalReady();
      if (/chinese|korean|english/i.test(sourceLang)) throw new AiServiceError("invalid", "Local Mode currently reads Japanese manga only. Set the source language to Japanese (or Auto detect), or switch to Gemini/Groq.");
      return (await localDetect(image)).map((r): OcrRegion => ({ ...r }));
    }
    const res = await generateJson<{ regions: (Omit<OcrRegion, "x" | "y" | "w" | "h"> & { box_2d: number[] })[] }>({
      schema: ocrSchema,
      system: `You are a precise comic OCR engine. Find EVERY piece of text in the comic image: speech bubbles, thought bubbles, narration boxes, chapter titles, signs, and large decorative sound effects (SFX) drawn over the art. Expected source language: ${clip(sourceLang, 40)} (also accept Chinese Simplified/Traditional, Japanese, Korean, English).
Rules:
- One region per bubble / text block / SFX. Transcribe exactly in the original script; join vertical columns in reading order.
- box_2d is [ymin, xmin, ymax, xmax] as integers in a 0-1000 normalized space relative to the full image height and width. The box must tightly cover the glyphs (not the whole bubble).
- kind: bubble (spoken dialogue), thought (thought bubbles), caption (captions), sfx (sound effects / onomatopoeia), narration (narrator), title (chapter titles), sign (in-world text).
- vertical: true if glyphs are stacked top-to-bottom.
- textColor / strokeColor: dominant fill and outline hex colors of the glyphs, like #112233 (strokeColor "none" if no outline).
- Ignore watermarks, page numbers and scanlator credits. If no text, return an empty list.`,
      parts: [{ text: "Detect all text regions in this comic page." }, dataUrlToInline(image)],
    });
    const out: OcrRegion[] = [];
    for (const r of res.regions ?? []) {
      const rect = boxToRect(r.box_2d);
      if (!rect || !r.text?.trim()) continue;
      out.push({ text: r.text, kind: KINDS.includes(r.kind) ? r.kind : "bubble", vertical: Boolean(r.vertical), ...rect, textColor: r.textColor || "#111111", strokeColor: r.strokeColor || "none" });
    }
    return out;
  });

type TrItem = { id: string; translation: string; confidence?: number; note?: string };
const trSchema: Schema = {
  type: "OBJECT",
  required: ["items", "names"],
  properties: {
    items: { type: "ARRAY", items: { type: "OBJECT", required: ["id", "translation", "confidence", "note"], properties: { id: str, translation: str, confidence: num, note: str } } },
    names: { type: "ARRAY", items: { type: "OBJECT", required: ["source", "target"], properties: { source: str, target: str } } },
  },
};

/** TRANSLATION SERVICE: context-aware translation with a persistent character-name glossary. */
export const translateTexts = (input: {
  data: {
    items: { id: string; text: string; kind: string }[];
    targetLang: string;
    glossary: { source: string; target: string }[];
    style: string;
    context?: string | undefined;
    relationships?: string | undefined;
  };
}) =>
  guard(async () => {
    const data = input.data;
    if (data.items.length === 0) return { items: [] as TrItem[], names: [] as { source: string; target: string }[] };
    if (getProvider() === "local") {
      // Local NLLB translates line by line: no glossary, style or context prompts are possible.
      assertLocalReady();
      const out = await localTranslate(data.items.map((i) => clip(i.text, 1000)), data.targetLang);
      return { items: data.items.map((it, i): TrItem => ({ id: it.id, translation: out[i]?.trim() || it.text })), names: [] as { source: string; target: string }[] };
    }
    const glossary = data.glossary.slice(0, 300).map((g) => `${clip(g.source, 200)} => ${clip(g.target, 200)}`).join("\n") || "(empty)";
    return generateJson<{ items: TrItem[]; names: { source: string; target: string }[] }>({
      schema: trSchema,
      system: `You are an expert comic localizer translating manhua/manhwa/manga into natural, fluent ${data.targetLang}.
- Items are in reading order on one page; use surrounding lines as context for tone, who is speaking and emotion.
- Write natural spoken ${data.targetLang} dialogue, never stiff literal translations. Keep it concise so it fits bubbles.
- kind "sfx": translate into a short, punchy native ${data.targetLang} onomatopoeia/expression (1-3 words).
- Character and place names: ALWAYS reuse the glossary mapping when present. Report every proper name you translated in "names".
- Return one item per input id, same ids. Translation style (follow strictly): ${clip(data.style, 600) || "Natural"}.
- Preserve emotion, slang and idioms naturally without inventing plot. Preserve speaker relationships and consistent pronouns/honorifics. Proofread spelling and grammar before returning.
- For each item also return "confidence" (0-1 self-estimate; lower when the OCR text looks garbled, the speaker is ambiguous, or an idiom/pun may not carry over) and a short "note" about ambiguity (empty string when none).
Chapter context: ${clip(data.context, 12000) || "No preceding context"}
Character relationships: ${clip(data.relationships, 4000) || "Unspecified"}
Glossary:
${glossary}`,
      parts: [{ text: JSON.stringify(data.items.map((i) => ({ id: i.id, text: clip(i.text, 2000), kind: i.kind }))) }],
    });
  });

const reviewSchema: Schema = {
  type: "OBJECT",
  required: ["items"],
  properties: {
    items: { type: "ARRAY", items: { type: "OBJECT", required: ["id", "translation", "confidence", "note"], properties: { id: str, translation: str, confidence: num, note: str } } },
  },
};

export const proofreadTexts = (input: {
  data: { items: { id: string; source: string; translation: string }[]; targetLang: string; glossary?: { source: string; target: string }[] | undefined; style?: string | undefined };
}) =>
  guard(async () => {
    const data = input.data;
    return generateJson<{ items: { id: string; translation: string; confidence: number; note: string }[] }>({
      schema: reviewSchema,
      system: `Proofread comic translations in ${data.targetLang}. Return every input id with the corrected translation, a self-assessed confidence between 0 and 1 and a short note about ambiguity or corrections (empty when none). Confidence is an estimate, never a guarantee. Preserve names, intent, emotion and tone; do not invent missing context. Enforce these glossary names exactly: ${(data.glossary ?? []).slice(0, 300).map((g) => `${clip(g.source, 200)} => ${clip(g.target, 200)}`).join("; ") || "none"}. Keep this style: ${clip(data.style, 600) || "Natural"}. Lower confidence when the OCR source looks garbled, the speaker is ambiguous, or an idiom/pun may not carry over.`,
      parts: [{ text: JSON.stringify(data.items.map((i) => ({ id: i.id, source: clip(i.source, 2000), translation: clip(i.translation, 4000) }))) }],
    });
  });
