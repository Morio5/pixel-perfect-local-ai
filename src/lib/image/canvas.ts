import type { ComicPage, TextRegion } from "../types";

export async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // A decoded image stays drawable after its URL is revoked, so nothing leaks per call.
    return img;
  } catch {
    throw new Error("This image could not be read. It may be corrupt or in an unsupported format.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Splits long vertical pages into OCR-friendly chunks (≤ 2:1 tall) and downsizes them. */
export function sliceForOcr(img: HTMLImageElement) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const chunkH = Math.min(H, Math.round(W * 2));
  const chunks: { dataUrl: string; top: number; height: number }[] = [];
  for (let top = 0; top < H; top += chunkH) {
    const h = Math.min(chunkH, H - top);
    const scale = Math.min(1, 1600 / Math.max(W, h));
    const c = document.createElement("canvas");
    c.width = Math.round(W * scale);
    c.height = Math.round(h * scale);
    c.getContext("2d")!.drawImage(img, 0, top, W, h, 0, 0, c.width, c.height);
    chunks.push({ dataUrl: c.toDataURL("image/jpeg", 0.88), top, height: h });
  }
  return chunks;
}

export function makeThumb(img: HTMLImageElement) {
  const scale = 240 / img.naturalWidth;
  const c = document.createElement("canvas");
  c.width = 240;
  c.height = Math.min(Math.round(img.naturalHeight * scale), 480);
  c.getContext("2d")!.drawImage(img, 0, 0, 240, c.height / scale, 0, 0, 240, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

type Rect = { x: number; y: number; w: number; h: number };

/**
 * IMAGE INPAINTING SERVICE (on-device): removes text inside each rect by
 * onion-peel diffusion from surrounding pixels, then smooths the fill.
 */
export function inpaint(ctx: CanvasRenderingContext2D, rects: Rect[]) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  for (const r0 of rects) {
    const pad = 3;
    const rx = Math.max(0, Math.floor(r0.x - pad));
    const ry = Math.max(0, Math.floor(r0.y - pad));
    const rw = Math.min(W - rx, Math.ceil(r0.w + pad * 2));
    const rh = Math.min(H - ry, Math.ceil(r0.h + pad * 2));
    if (rw <= 2 || rh <= 2) continue;
    const m = 4;
    const cx = Math.max(0, rx - m);
    const cy = Math.max(0, ry - m);
    const cw = Math.min(W - cx, rw + m * 2);
    const ch = Math.min(H - cy, rh + m * 2);
    const img = ctx.getImageData(cx, cy, cw, ch);
    const known = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const gx = x + cx;
        const gy = y + cy;
        const inside = gx >= rx && gx < rx + rw && gy >= ry && gy < ry + rh;
        known[y * cw + x] = inside ? 0 : 1;
      }
    // If the rect touches an image border there may be no known pixels on that side — fine.
    fillMasked(img.data, known, cw, ch);
    // Soften diffusion streaks (manual blur: CanvasRenderingContext2D.filter is not available everywhere).
    blurRect(img.data, cw, ch, rx - cx, ry - cy, rx - cx + rw, ry - cy + rh);
    ctx.putImageData(img, cx, cy);
  }
}

const NEIGHBOURS: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/**
 * Onion-peel diffusion on a pixel buffer. `known[i] === 1` marks trusted pixels; every other pixel is
 * filled layer by layer with the average of its already-known neighbours. Work is proportional to the
 * filled area (the previous version rescanned the whole buffer once per layer).
 */
export function fillMasked(d: Uint8ClampedArray, known: Uint8Array, w: number, h: number) {
  const queued = new Uint8Array(w * h);
  let frontier: number[] = [];
  const hasKnownNeighbour = (x: number, y: number) => {
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && known[ny * w + nx] === 1) return true;
    }
    return false;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (known[i] !== 1 && hasKnownNeighbour(x, y)) { frontier.push(i); queued[i] = 1; }
    }
  while (frontier.length) {
    const colours = new Float64Array(frontier.length * 3);
    frontier.forEach((i, k) => {
      const x = i % w, y = (i - x) / w;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (known[j] !== 1) continue;
        r += d[j * 4]!; g += d[j * 4 + 1]!; b += d[j * 4 + 2]!; n++;
      }
      colours[k * 3] = r / n; colours[k * 3 + 1] = g / n; colours[k * 3 + 2] = b / n;
    });
    const next: number[] = [];
    frontier.forEach((i, k) => {
      d[i * 4] = colours[k * 3]!; d[i * 4 + 1] = colours[k * 3 + 1]!; d[i * 4 + 2] = colours[k * 3 + 2]!; d[i * 4 + 3] = 255;
      known[i] = 1;
    });
    for (const i of frontier) {
      const x = i % w, y = (i - x) / w;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (known[j] !== 1 && !queued[j]) { queued[j] = 1; next.push(j); }
      }
    }
    frontier = next;
  }
}

/** 3x3 box blur (RGB only) of the pixels in [x0,x1) x [y0,y1), reading neighbours from the whole buffer. */
export function blurRect(d: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, x1: number, y1: number, passes = 2) {
  for (let p = 0; p < passes; p++) {
    const src = d.slice();
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.min(w - 1, Math.max(0, x + dx)), ny = Math.min(h - 1, Math.max(0, y + dy));
            const j = (ny * w + nx) * 4;
            r += src[j]!; g += src[j + 1]!; b += src[j + 2]!; n++;
          }
        const i = (y * w + x) * 4;
        d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n;
      }
  }
}

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("km", { granularity: "word" }) : null;

function tokens(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return text.split(/(\s+)/);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const t of tokens(para)) {
      const test = line + t;
      if (ctx.measureText(test).width > maxW && line.trim()) {
        out.push(line.trim());
        line = t.trimStart();
      } else line = test;
    }
    out.push(line.trim());
  }
  return out;
}

export function fontString(r: TextRegion, size: number) {
  return `${r.bold || r.kind === "sfx" ? 700 : 500} ${size}px "${r.font}", "Noto Sans Khmer", sans-serif`;
}

/** Computes the auto-fit font size + wrapped lines for a region. */
export function layoutRegion(ctx: CanvasRenderingContext2D, r: TextRegion) {
  const padX = r.w * 0.04;
  const maxW = Math.max(10, r.w - padX * 2);
  const fit = (size: number) => {
    ctx.font = fontString(r, size);
    const lines = wrap(ctx, r.translation, maxW);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    return { lines, ok: lines.length * size * r.lineHeight <= r.h && widest <= maxW + 1 };
  };
  if (r.fontSize) return { size: r.fontSize, lines: fit(r.fontSize).lines, maxW };
  let lo = 8, hi = Math.max(10, Math.min(r.h, r.kind === "sfx" ? 220 : 64));
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fit(mid).ok) lo = mid;
    else hi = mid;
  }
  return { size: lo, lines: fit(lo).lines, maxW };
}

/** IMAGE RENDERING SERVICE: draws translated text into a context. */
export function drawText(ctx: CanvasRenderingContext2D, regions: TextRegion[]) {
  for (const r of regions) {
    if (!r.visible || !r.translation.trim()) continue;
    const { size, lines } = layoutRegion(ctx, r);
    ctx.save();
    ctx.font = fontString(r, size);
    if (r.rotation) { ctx.translate(r.x+r.w/2,r.y+r.h/2); ctx.rotate(r.rotation*Math.PI/180); ctx.translate(-r.x-r.w/2,-r.y-r.h/2); }
    if (r.shadow) { ctx.shadowColor=r.shadow; ctx.shadowBlur=3; ctx.shadowOffsetX=2; ctx.shadowOffsetY=2; }
    ctx.textBaseline = "middle";
    ctx.textAlign = r.align;
    const lh = size * r.lineHeight;
    const total = lines.length * lh;
    const x = r.align === "left" ? r.x + r.w * 0.04 : r.align === "right" ? r.x + r.w * 0.96 : r.x + r.w / 2;
    let y = r.y + (r.h - total) / 2 + lh / 2;
    for (const line of lines) {
      if (r.stroke !== "none") {
        ctx.lineJoin = "round";
        ctx.strokeStyle = r.stroke;
        ctx.lineWidth = r.strokeWidth ?? Math.max(2, size * (r.kind === "sfx" ? 0.18 : 0.12));
        ctx.strokeText(line, x, y);
      }
      ctx.fillStyle = r.color;
      ctx.fillText(line, x, y);
      y += lh;
    }
    ctx.restore();
  }
}

export async function ensureFonts(regions: TextRegion[]) {
  const fams = new Set(regions.map((r) => r.font));
  await Promise.all(
    [...fams].flatMap((f) => [document.fonts.load(`500 32px "${f}"`, "ក"), document.fonts.load(`700 32px "${f}"`, "ក")]),
  ).catch(() => {});
}

/** Builds the erased base (original minus text) on a full-resolution canvas. */
export async function buildErased(page: ComicPage, img?: HTMLImageElement) {
  const image = img ?? (await blobToImage(page.original));
  const c = document.createElement("canvas");
  c.width = page.width;
  c.height = page.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  inpaint(ctx, [...page.regions.filter((r) => r.erase), ...page.manualErase]);
  return c;
}

export async function renderFinal(page: ComicPage, erased?: HTMLCanvasElement) {
  const base = erased ?? (await buildErased(page));
  const c = document.createElement("canvas");
  c.width = page.width;
  c.height = page.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(base, 0, 0);
  await ensureFonts(page.regions);
  drawText(ctx, page.regions);
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement, format: "png" | "jpeg" | "webp", quality: number) {
  return new Promise<Blob>((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("Export failed"))), `image/${format}`, quality),
  );
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
