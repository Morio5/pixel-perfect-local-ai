import JSZip from "jszip";
import { z } from "zod";
import type { Project } from "./types";

const rect = z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().positive(), h: z.number().positive() });
const region = rect.extend({ id: z.string(), kind: z.enum(["bubble", "thought", "caption", "sfx", "narration", "title", "sign"]), source: z.string(), translation: z.string(), vertical: z.boolean(), erase: z.boolean(), visible: z.boolean(), font: z.string(), fontSize: z.number().nullable(), bold: z.boolean(), align: z.enum(["left", "center", "right"]), lineHeight: z.number().positive(), color: z.string(), stroke: z.string() }).passthrough();
const metadata = z.object({ id: z.string(), name: z.string(), createdAt: z.number(), updatedAt: z.number(), sourceLang: z.string(), targetLang: z.string(), glossary: z.array(z.object({ source: z.string(), target: z.string() })), pages: z.array(z.object({ id: z.string(), name: z.string(), width: z.number().positive(), height: z.number().positive(), regions: z.array(region), manualErase: z.array(rect), status: z.enum(["queued", "detecting", "translating", "erasing", "rendering", "done", "error"]), originalType: z.enum(["image/jpeg", "image/png", "image/webp"]) }).passthrough()) }).passthrough();

export async function backupProject(project: Project) {
  const zip = new JSZip();
  const pages = [];
  for (const [i, page] of project.pages.entries()) {
    const { original, ...rest } = page;
    zip.file(`originals/${i}`, await original.arrayBuffer());
    pages.push({ ...rest, originalType: original.type });
  }
  zip.file("project.json", JSON.stringify({ ...project, version: 2, pages }));
  return zip.generateAsync({ type: "blob" });
}

/** Read a backup; caller must assign fresh IDs before saving an imported copy. */
export async function readBackup(bytes: ArrayBuffer): Promise<Project> {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const file = zip.file("project.json");
  if (!file) throw new Error("This ZIP is not a project backup.");
  const data = metadata.parse(JSON.parse(await file.async("string")));
  const pages = [];
  for (const [i, page] of data.pages.entries()) {
    const original = zip.file(`originals/${i}`);
    if (!original) throw new Error(`Missing original for ${page.name}. Nothing was imported.`);
    const bytes = await original.async("uint8array");
    pages.push({ ...page, original: new Blob([new Uint8Array(bytes).buffer], { type: page.originalType }) });
  }
  return { ...data, pages } as Project;
}