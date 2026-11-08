import type { TRANSLATION_STYLES } from "./settings";

export type TranslationStyle = (typeof TRANSLATION_STYLES)[number];

/** Concrete writing rules sent to the translator for each style. */
export const STYLE_GUIDES: Record<TranslationStyle, string> = {
  Natural: "Natural: fluent everyday spoken language that sounds like native speech; adapt idioms to native equivalents.",
  Literal: "Literal: stay as close to the original wording and sentence order as grammar allows; keep idioms literal and do not add or drop meaning.",
  Professional: "Professional: polished, grammatically formal wording with respectful pronouns; avoid slang.",
  Casual: "Casual: relaxed, youthful dialogue with contractions and natural slang where the original is informal.",
  Novel: "Novel: rich literary phrasing like a published novel; vivid but still concise enough for bubbles.",
};

export function styleInstruction(style: string | undefined, extra?: string) {
  const guide = STYLE_GUIDES[(style ?? "Natural") as TranslationStyle] ?? STYLE_GUIDES.Natural;
  return extra?.trim() ? `${guide} Extra instructions: ${extra.trim()}` : guide;
}

/** Below this AI confidence estimate a line is flagged for human review. */
export const REVIEW_THRESHOLD = 0.7;

export function needsReview(r: { confidence?: number; translation: string }) {
  return !r.translation.trim() || (r.confidence !== undefined && r.confidence < REVIEW_THRESHOLD);
}
