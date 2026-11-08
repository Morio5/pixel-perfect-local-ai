import type { LocalRegion } from "./local-protocol";

/** Pure geometry helpers for the on-device detector (kept separate so they can be unit-tested). */
export type Box = { x0: number; y0: number; x1: number; y1: number; score: number; label: number };

export function iou(a: Box, b: Box) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  const union = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return union > 0 ? inter / union : 0;
}

/** Greedy non-maximum suppression; keeps the highest-scoring box of overlapping ones. */
export function nms(boxes: Box[], threshold = 0.5): Box[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept: Box[] = [];
  for (const b of sorted) if (kept.every((k) => iou(k, b) < threshold)) kept.push(b);
  return kept;
}

/**
 * Converts the detector's raw output into boxes.
 * labels: 0 = bubble outline (ignored), 1 = text_bubble, 2 = text_free. boxes are xyxy in page pixels.
 */
export function parseDetections(labels: ArrayLike<number | bigint>, boxes: ArrayLike<number>, scores: ArrayLike<number>, width: number, height: number, minScore = 0.3): Box[] {
  const out: Box[] = [];
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
  for (let i = 0; i < scores.length; i++) {
    const score = Number(scores[i]);
    const label = Number(labels[i]);
    if (!Number.isFinite(score) || score < minScore || (label !== 1 && label !== 2)) continue;
    const x0 = clamp(Number(boxes[i * 4]), width);
    const y0 = clamp(Number(boxes[i * 4 + 1]), height);
    const x1 = clamp(Number(boxes[i * 4 + 2]), width);
    const y1 = clamp(Number(boxes[i * 4 + 3]), height);
    if (![x0, y0, x1, y1].every(Number.isFinite) || x1 - x0 < 8 || y1 - y0 < 8) continue;
    out.push({ x0, y0, x1, y1, score, label });
  }
  return nms(out);
}

/** Manga reading order: rows from top to bottom, right to left inside a row. */
export function readingOrder<T extends { x: number; y: number; w: number; h: number }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows: { items: T[]; minBottom: number }[] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    const cy = it.y + it.h / 2;
    if (row && cy < row.minBottom) {
      row.items.push(it);
      row.minBottom = Math.min(row.minBottom, it.y + it.h);
    } else rows.push({ items: [it], minBottom: it.y + it.h });
  }
  return rows.flatMap((r) => r.items.sort((a, b) => b.x + b.w - (a.x + a.w)));
}

export function toRegion(b: Box, text: string, width: number, height: number, dark: boolean): LocalRegion {
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  return {
    text,
    kind: b.label === 1 ? "bubble" : "caption",
    vertical: h > w * 1.5,
    x: (b.x0 / width) * 1000,
    y: (b.y0 / height) * 1000,
    w: (w / width) * 1000,
    h: (h / height) * 1000,
    textColor: dark ? "#ffffff" : "#111111",
    strokeColor: dark ? "#000000" : "none",
  };
}
