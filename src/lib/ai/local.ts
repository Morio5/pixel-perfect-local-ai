/**
 * Local (on-device) AI client: talks to local.worker.ts. No API key, no server.
 * Everything heavy runs in a Web Worker so the UI never freezes.
 */
import { useSyncExternalStore } from "react";
import { AiServiceError } from "./common";
import { getLocalWebGpu } from "./gemini-key";
import { LOCAL_CACHE_NAME, type LocalModelId, type LocalRegion, type WorkerMessage, type WorkerRequest } from "./local-protocol";

export type { LocalRegion } from "./local-protocol";
export { LOCAL_LICENSE_NOTICE } from "./local-protocol";

export type ModelState = { status: "idle" | "loading" | "ready" | "error"; loaded: number; total: number; device?: string; error?: string };
export type LocalState = Record<LocalModelId, ModelState>;

export const LOCAL_MODEL_LABELS: Record<LocalModelId, string> = {
  detector: "Text & bubble detector",
  ocr: "Manga OCR (Japanese)",
  translator: "NLLB-200 translator (Japanese → Khmer)",
};

const idle = (): ModelState => ({ status: "idle", loaded: 0, total: 0 });
let state: LocalState = { detector: idle(), ocr: idle(), translator: idle() };
const listeners = new Set<() => void>();
let lastEmit = 0;
function setModel(model: LocalModelId, next: ModelState, force = false) {
  state = { ...state, [model]: next };
  const now = Date.now();
  if (force || now - lastEmit > 120) {
    lastEmit = now;
    listeners.forEach((l) => l());
  }
}
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const getState = () => state;
export const useLocalState = () => useSyncExternalStore(subscribe, getState, getState);

// ---- compatibility ----
export type Compat = { ok: boolean; reason?: string; warnings: string[]; webgpu: boolean };

export function checkLocalCompat(): Compat {
  const warnings: string[] = [];
  if (typeof window === "undefined") return { ok: false, reason: "Local Mode only runs in the browser.", warnings, webgpu: false };
  const missing: string[] = [];
  if (typeof Worker === "undefined") missing.push("Web Workers");
  if (typeof WebAssembly === "undefined") missing.push("WebAssembly");
  if (typeof OffscreenCanvas === "undefined") missing.push("OffscreenCanvas");
  if (typeof createImageBitmap === "undefined") missing.push("createImageBitmap");
  if (missing.length) {
    return { ok: false, reason: `This browser does not support ${missing.join(", ")}, which Local Mode needs. Use a recent desktop Chrome/Edge/Firefox (or Safari 16.4+), or switch to Gemini/Groq.`, warnings, webgpu: false };
  }
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) warnings.push("iPhone/iPad Safari limits how much memory a page can use. The translation model is large and may fail to load or reload the page. A desktop browser is recommended; otherwise use Gemini/Groq.");
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  if (typeof mem === "number" && mem < 4) warnings.push(`This device reports about ${mem} GB of memory. Loading the models may fail; close other tabs first.`);
  return { ok: true, warnings, webgpu: "gpu" in navigator };
}

// ---- worker plumbing ----
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function toServiceError(message: string): AiServiceError {
  if (/memory|allocation|bad_alloc|RangeError|Aborted\(/i.test(message)) {
    return new AiServiceError("upstream", "This device ran out of memory while running the on-device AI models. Close other tabs, try a desktop browser, or switch to Gemini/Groq in AI connection.");
  }
  if (/failed to fetch|networkerror|load failed|download|HTTP \d{3}/i.test(message)) {
    return new AiServiceError("upstream", `Could not download the on-device models. Check your connection and try again (models are cached after the first successful download). ${message}`);
  }
  return new AiServiceError("upstream", `On-device AI error: ${message}`);
}

function resetWorker(reason: string) {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(toServiceError(reason));
  pending.clear();
  for (const id of ["detector", "ocr", "translator"] as const) {
    if (state[id].status === "loading") setModel(id, { ...state[id], status: "error", error: reason }, true);
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  const compat = checkLocalCompat();
  if (!compat.ok) throw new AiServiceError("invalid", compat.reason ?? "Local Mode is not supported on this device.");
  let w: Worker;
  try {
    w = new Worker(new URL("./local.worker.ts", import.meta.url), { type: "module" });
  } catch (e) {
    throw new AiServiceError("invalid", `Could not start the on-device AI worker: ${e instanceof Error ? e.message : String(e)}`);
  }
  w.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const m = e.data;
    if (m.type === "model") {
      setModel(m.model, { status: m.status, loaded: m.loaded, total: m.total, ...(m.device ? { device: m.device } : {}), ...(m.error ? { error: m.error } : {}) }, m.status !== "loading");
    } else {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.type === "result") p.resolve(m.data);
      else p.reject(toServiceError(m.message));
    }
  };
  w.onerror = (e) => resetWorker(e.message || "The on-device AI worker stopped unexpectedly (likely out of memory).");
  w.onmessageerror = () => resetWorker("The on-device AI worker sent an unreadable message.");
  worker = w;
  return w;
}

function call<T>(req: DistributiveOmit<WorkerRequest, "id" | "webgpu">): Promise<T> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ ...req, id, webgpu: getLocalWebGpu() } as WorkerRequest);
  });
}

// ---- public API ----
/** Downloads (or loads from cache) all three models. Safe to call repeatedly. */
export async function preloadLocalModels(): Promise<void> {
  try { await navigator.storage?.persist?.(); } catch { /* optional: ask the browser not to evict cached models */ }
  await call<boolean>({ type: "preload" });
}

export const localDetect = (image: string) => call<LocalRegion[]>({ type: "detect", image });
export const localTranslate = (texts: string[], target: string) => call<string[]>({ type: "translate", texts, target });

/** Deletes cached model files and resets the worker (a reload is needed to free memory completely). */
export async function clearLocalCache() {
  resetWorker("Cache cleared");
  state = { detector: idle(), ocr: idle(), translator: idle() };
  listeners.forEach((l) => l());
  if (typeof caches === "undefined") return;
  for (const name of [LOCAL_CACHE_NAME, "transformers-cache"]) {
    try { await caches.delete(name); } catch { /* ignore */ }
  }
}
