import { createStore, del, entries, get, set } from "idb-keyval";
import { useEffect, useState } from "react";
import { deleteProject, listProjects, saveProject, subscribeProjects, uid } from "./storage";
import type { ComicPage, MemoryEntry, Project, Series } from "./types";

/** LIBRARY SERVICE — library projects (series) on-device; chapters stay in the existing project store. */
const store = typeof indexedDB !== "undefined" ? createStore("khmer-comic-ai-library", "series") : undefined;
const listeners = new Set<() => void>();
export const notifyLibrary = () => listeners.forEach((l) => l());

export async function saveSeries(s: Series) {
  s.updatedAt = Date.now();
  await set(s.id, s, store);
  notifyLibrary();
}
export const loadSeries = (id: string) => get<Series>(id, store);
export async function listSeries(): Promise<Series[]> {
  return (await entries<string, Series>(store)).map(([, s]) => s);
}

export function newSeries(patch: Partial<Series> = {}): Series {
  const now = Date.now();
  return { id: uid(), title: "Untitled project", description: "", author: "", status: "ongoing", tags: [], sourceLang: "Auto detect", targetLang: "Khmer", translationStyle: "Natural", glossary: [], memory: [], createdAt: now, updatedAt: now, ...patch };
}

// ---------- pure helpers (tested) ----------

export function chaptersOf(seriesId: string, chapters: Project[]) {
  return chapters.filter((c) => c.seriesId === seriesId).sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0) || a.createdAt - b.createdAt);
}

/** Moves a chapter up/down and renumbers 1..n. Returns the chapters whose number changed. */
export function reorderChapters(ordered: Project[], index: number, delta: -1 | 1) {
  const list = [...ordered];
  const target = index + delta;
  if (target < 0 || target >= list.length) return [];
  const [item] = list.splice(index, 1);
  if (item) list.splice(target, 0, item);
  return renumber(list);
}
export function renumber(list: Project[]) {
  const changed: Project[] = [];
  list.forEach((c, i) => { if (c.chapterNumber !== i + 1) { c.chapterNumber = i + 1; changed.push(c); } });
  return changed;
}

/** Merge glossaries; entries in `override` win for the same source term. Blank rows are dropped. */
export function mergeGlossary(base: Series["glossary"], override: Series["glossary"]) {
  const map = new Map<string, string>();
  for (const g of [...base, ...override]) if (g.source.trim() && g.target.trim()) map.set(g.source.trim(), g.target.trim());
  return [...map].map(([source, target]) => ({ source, target }));
}

/** Upserts translated lines into memory, keeping up to 5 previous translations per line. */
export function recordMemory(memory: MemoryEntry[], pairs: { source: string; target: string }[], now = Date.now()) {
  const bySource = new Map(memory.map((m) => [m.source, m]));
  for (const { source, target } of pairs) {
    const s = source.trim(), t = target.trim();
    if (!s || !t) continue;
    const prev = bySource.get(s);
    if (!prev) bySource.set(s, { source: s, target: t, updatedAt: now, history: [] });
    else if (prev.target !== t) bySource.set(s, { source: s, target: t, updatedAt: now, history: [prev.target, ...prev.history].slice(0, 5) });
  }
  return [...bySource.values()].slice(-5000);
}

/** First page that still needs work: failed or unfinished pages, in page order. */
export function nextUnfinishedPage(pages: ComicPage[]) {
  return pages.find((p) => p.status !== "done");
}

export function chapterProgress(c: Project) {
  const done = c.pages.filter((p) => p.status === "done").length;
  const failed = c.pages.filter((p) => p.status === "error").length;
  return { done, failed, total: c.pages.length, pct: c.pages.length ? Math.round((done / c.pages.length) * 100) : 0 };
}

// ---------- storage operations ----------

/** Deletes the library project and (only if asked) its chapters. Otherwise chapters become unsorted. */
export async function deleteSeries(id: string, withChapters: boolean) {
  for (const c of (await listProjects()).filter((c) => c.seriesId === id)) {
    if (withChapters) await deleteProject(c.id);
    else { delete c.seriesId; delete c.chapterNumber; await saveProject(c); }
  }
  await del(id, store);
  notifyLibrary();
}

/** Copies a project with all chapters under fresh IDs. Original images are shared read-only blobs. */
export async function duplicateSeries(id: string) {
  const s = await loadSeries(id);
  if (!s) throw new Error("Project not found.");
  const copy: Series = { ...structuredClone(s), id: uid(), title: `${s.title} (copy)`, createdAt: Date.now() };
  for (const c of chaptersOf(id, await listProjects())) {
    const cc: Project = { ...c, id: uid(), seriesId: copy.id, createdAt: Date.now(), pages: c.pages.map((p) => ({ ...structuredClone({ ...p, original: undefined }), original: p.original, id: uid() })) };
    await saveProject(cc);
  }
  await saveSeries(copy);
  return copy;
}

/** Pulls the shared glossary & memory into a chapter before translating. */
export async function prepareChapter(project: Project) {
  if (!project.seriesId) return undefined;
  const s = await loadSeries(project.seriesId);
  if (!s) return undefined;
  project.glossary = mergeGlossary(s.glossary, project.glossary);
  return s;
}

/** Saves a finished page's translations and names back to the library project. */
export async function commitPageToSeries(project: Project, page: ComicPage) {
  if (!project.seriesId) return;
  const s = await loadSeries(project.seriesId);
  if (!s) return;
  s.glossary = mergeGlossary(s.glossary, project.glossary);
  s.memory = recordMemory(s.memory, page.regions.map((r) => ({ source: r.source, target: r.translation })));
  await saveSeries(s);
}

export function memoryContext(s: Series | undefined, limit = 4000) {
  if (!s?.memory.length) return "";
  return "Translation memory (reuse for repeated lines):\n" + s.memory.slice(-200).map((m) => `${m.source} => ${m.target}`).join("\n").slice(-limit);
}

export function useLibrary() {
  const [data, setData] = useState<{ series: Series[]; chapters: Project[] } | null>(null);
  useEffect(() => {
    const load = () => Promise.all([listSeries(), listProjects()]).then(([series, chapters]) => setData({ series, chapters })).catch(() => setData({ series: [], chapters: [] }));
    load();
    listeners.add(load);
    // chapter saves notify the project store; re-read when the tab regains focus (other tabs) too
    const stopProjects = subscribeProjects(load);
    window.addEventListener("focus", load);
    return () => { listeners.delete(load); stopProjects(); window.removeEventListener("focus", load); };
  }, []);
  return data;
}

/** Cover thumbnail as a data URL (max 480px wide). */
export async function makeCover(file: Blob) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("Cover image could not be read.")); i.src = url; });
    const w = Math.min(480, img.naturalWidth), h = Math.round((img.naturalHeight * w) / img.naturalWidth);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d")?.drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.85);
  } finally { URL.revokeObjectURL(url); }
}

/** Single-flight lock per chapter across tabs, so a chapter is never processed twice at once. */
export async function withChapterLock<T>(id: string, fn: () => Promise<T>): Promise<T | "locked"> {
  if (typeof navigator === "undefined" || !navigator.locks) return fn();
  return navigator.locks.request(`kca-chapter-${id}`, { ifAvailable: true }, async (lock) => (lock ? fn() : "locked"));
}
