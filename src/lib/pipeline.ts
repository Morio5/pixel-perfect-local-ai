import JSZip from "jszip";
import { detectText, proofreadTexts, translateTexts } from "./ai/services.functions";
import { styleInstruction } from "./translation-styles";
import { getProvider } from "./ai/gemini-key";
import { commitPageToSeries, memoryContext, prepareChapter } from "./library";
import { blobToImage, canvasToBlob, makeThumb, renderFinal, sliceForOcr } from "./image/canvas";
import type { Settings } from "./settings";
import { saveProject, uid } from "./storage";
import type { ComicPage, PageStatus, Project, TextRegion } from "./types";

export class PipelineError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const hex = (c: string, fallback: string) => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback);

export async function createPage(file: File): Promise<ComicPage> {
  const img = await blobToImage(file);
  if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 40_000_000) throw new Error("Image dimensions are invalid or too large. Split long pages before uploading.");
  return {
    id: uid(),
    name: file.name,
    original: file,
    width: img.naturalWidth,
    height: img.naturalHeight,
    regions: [],
    manualErase: [],
    status: "queued",
    thumb: makeThumb(img),
  };
}

/** Full pipeline: DETECT → TRANSLATE → ERASE → RENDER. Throws on any failure (never fakes success). */
export async function processPage(
  project: Project,
  page: ComicPage,
  settings: Settings,
  onStatus: (s: PageStatus, info?: string) => void,
  detectOnly = false,
) {
  const series = await prepareChapter(project);
  const img = await blobToImage(page.original);
  onStatus("detecting");
  const chunks = sliceForOcr(img);
  const regions: TextRegion[] = [];
  if (page.ocrComplete) regions.push(...structuredClone(page.regions));
  const detected = page.ocrComplete ? [] : await Promise.all(chunks.map(async (c, i) => {
    if (chunks.length > 1) onStatus("detecting", `segment ${i + 1}/${chunks.length}`);
    const res = await detectText({ data: { image: c.dataUrl, sourceLang: project.sourceLang } });
    if (!res.ok) throw new PipelineError(res.code, res.error);
    return { c, data: res.data };
  }));
  for (const { c, data } of detected) {
    for (const r of data) {
      let x = (r.x / 1000) * page.width;
      let y = c.top + (r.y / 1000) * c.height;
      let w = (r.w / 1000) * page.width;
      let h = (r.h / 1000) * c.height;
      if (w < 4 || h < 4 || !r.text.trim()) continue;
      // Erase box (tight) is kept separately from the render box (expanded for Khmer).
      const erase = { x, y, w, h };
      if (r.vertical && h > w * 1.5) {
        const nw = Math.min(page.width, Math.max(w, h * 0.75));
        x = x + w / 2 - nw / 2;
        w = nw;
      }
      const px = w * 0.08, py = h * 0.08;
      x = Math.max(0, x - px); y = Math.max(0, y - py);
      w = Math.min(page.width - x, w + px * 2); h = Math.min(page.height - y, h + py * 2);
      const sfx = r.kind === "sfx";
      regions.push({
        id: uid(),
        kind: r.kind,
        source: r.text,
        translation: "",
        vertical: r.vertical,
        x, y, w, h,
        erase: true,
        visible: true,
        font: sfx ? settings.sfxFont : settings.font,
        fontSize: settings.fontSize && !sfx ? settings.fontSize : null,
        bold: sfx || r.kind === "title",
        align: "center",
        lineHeight: 1.35,
        color: hex(r.textColor, "#111111"),
        stroke: r.strokeColor === "none" ? (sfx ? "#ffffff" : "none") : hex(r.strokeColor, "none"),
        // stash erase rect
        ...{ _erase: erase },
      } as TextRegion);
    }
  }
  // Store erase rects as manual erase so the render box can be larger than the glyph box.
  if (!page.ocrComplete) page.manualErase = regions.map((r) => (r as unknown as { _erase: { x: number; y: number; w: number; h: number } })._erase);
  regions.forEach((r) => {
    delete (r as unknown as { _erase?: unknown })._erase;
    r.erase = false;
  });
  page.regions = regions;
  page.ocrComplete = true;
  page.status = "queued";
  await saveProject(project);
  if (detectOnly) { onStatus("queued", "OCR ready for correction"); return; }

  onStatus("translating", `${regions.length} text regions`);
  if (regions.length) {
    const tr = await translateTexts({
      data: {
        items: regions.map((r) => ({ id: r.id, text: r.source, kind: r.kind })),
        targetLang: project.targetLang,
        glossary: project.glossary,
        style: styleInstruction(series?.translationStyle ?? settings.translationStyle, settings.style),
        // Each part has its own budget so the total always stays under the 12,000-character limit.
        context: [
          (project.context ?? "").slice(0, 3000),
          memoryContext(series, 3000),
          project.pages.filter(p => p.status === "done" && p.id !== page.id).flatMap(p => p.regions.map(r => `${r.source} => ${r.translation}`)).join("\n").slice(-5000),
        ].filter(Boolean).join("\n"),
        relationships: project.relationships,
      },
    });
    if (!tr.ok) throw new PipelineError(tr.code, tr.error);
    const trItems = new Map(tr.data.items.map((i) => [i.id, i]));
    const map = new Map(tr.data.items.map((i) => [i.id, i.translation]));
    regions.forEach((r) => (r.translation = map.get(r.id) ?? ""));
    const missing = regions.filter((r) => !r.translation).length;
    if (missing > 0) throw new PipelineError("upstream", `Translation is incomplete: ${missing} text regions have no translation.`);
    for (const n of tr.data.names) {
      if (!project.glossary.some((g) => g.source === n.source)) project.glossary.push(n);
    }
    if (settings.speed === "quality" && getProvider() !== "local") {
      // QUALITY MODE: separate proofreading pass (slower, one extra AI call per page).
      onStatus("translating", "quality check");
      const qc = await proofreadTexts({ data: { items: regions.map((r) => ({ id: r.id, source: r.source, translation: r.translation })), targetLang: project.targetLang, glossary: project.glossary, style: styleInstruction(series?.translationStyle ?? settings.translationStyle) } });
      if (qc.ok) {
        for (const r of regions) {
          const item = qc.data.items.find((i) => i.id === r.id);
          if (item?.translation.trim()) Object.assign(r, { translation: item.translation, confidence: Math.max(0, Math.min(1, item.confidence)), reviewNote: item.note });
        }
      } else {
        regions.forEach((r) => { delete r.confidence; r.reviewNote = "Quality check failed: " + qc.error; });
      }
    } else if (getProvider() !== "local") {
      // FAST MODE: confidence and review notes come back in the same translation call.
      for (const r of regions) {
        const item = trItems.get(r.id);
        if (item?.confidence !== undefined) Object.assign(r, { confidence: Math.max(0, Math.min(1, item.confidence)), reviewNote: item.note ?? "" });
      }
    }
  }
  page.regions = regions;
  onStatus("erasing");
  onStatus("rendering");
  const final = await renderFinal(page);
  const t = document.createElement("canvas");
  t.width = 240;
  t.height = Math.min(480, Math.round((page.height * 240) / page.width));
  const thumbContext = t.getContext("2d");
  if (!thumbContext) throw new PipelineError("upstream", "Image preview could not be rendered.");
  thumbContext.drawImage(final, 0, 0, page.width, (t.height * page.width) / 240, 0, 0, 240, t.height);
  page.thumb = t.toDataURL("image/jpeg", 0.7);
  page.status = "done";
  delete page.error;
  await saveProject(project);
  await commitPageToSeries(project, page);
  onStatus("done");
}

export async function exportPage(page: ComicPage, settings: Settings) {
  const c = await renderFinal(page);
  return canvasToBlob(c, settings.format, settings.quality);
}

/** Exports pages in page order. With includeOriginals, untranslated pages are added as untouched originals. */
export async function exportZip(project: Project, settings: Settings, onProgress?: (n: number) => void, includeOriginals = false) {
  const zip = new JSZip();
  const pages = includeOriginals ? project.pages : project.pages.filter((p) => p.status === "done");
  if (!project.pages.some((p) => p.status === "done") && !includeOriginals) throw new Error("No successfully translated pages to export.");
  if (!pages.length) throw new Error("This chapter has no pages.");
  const ext = settings.format === "jpeg" ? "jpg" : settings.format;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (!page) continue;
    const n = String(project.pages.indexOf(page) + 1).padStart(3, "0");
    const base = page.name.replace(/\.[^.]+$/, "");
    if (page.status === "done") zip.file(`${n}_${base}.${ext}`, await exportPage(page, settings));
    else zip.file(`${n}_${base}_ORIGINAL.${page.original.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png"}`, page.original);
    onProgress?.(i + 1);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  if (!blob.size) throw new Error("Export failed: the ZIP file is empty.");
  return blob;
}

export function friendlyError(code: string, msg: string) {
  if (code === "not_configured") return msg || "Add your free AI API key in AI connection.";
  if (code === "credits") return msg;
  if (code === "rate_limited") return "Rate limited — wait a minute and retry.";
  return msg;
}
