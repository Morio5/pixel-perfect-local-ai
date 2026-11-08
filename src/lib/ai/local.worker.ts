/**
 * On-device AI worker for Local Mode. Runs entirely in the browser; nothing is sent to any API.
 *   image -> text/bubble detector (ONNX Runtime Web, WASM) -> crop -> Manga OCR (Transformers.js)
 *         -> NLLB-200 Japanese -> Khmer (Transformers.js)
 * Models are cached in the browser (Cache API) after the first download.
 * Licence note: NLLB-200 is CC-BY-NC-4.0 (non-commercial). See LOCAL_LICENSE_NOTICE.
 */
import { env, pipeline } from "@huggingface/transformers";
import * as ort from "onnxruntime-web";
import { parseDetections, readingOrder, toRegion } from "./local-geometry";
import { LOCAL_CACHE_NAME, LOCAL_MODELS, NLLB_LANG, type LocalModelId, type LocalRegion, type WorkerMessage, type WorkerRequest } from "./local-protocol";

const ctx = self as unknown as {
  postMessage: (m: WorkerMessage) => void;
  addEventListener: (type: "message", cb: (e: MessageEvent<WorkerRequest>) => void) => void;
};

env.allowLocalModels = false;
env.useBrowserCache = true;

// Transformers.js' pipeline() has a very large overloaded type; use a narrow structural type instead.
type AnyPipeline = (input: unknown, options?: Record<string, unknown>) => Promise<unknown>;
type PipelineFn = (task: string, model: string, options: Record<string, unknown>) => Promise<AnyPipeline>;
const makePipeline = pipeline as unknown as PipelineFn;

type FileState = { loaded: number; total: number };
const fileProgress: Record<LocalModelId, Map<string, FileState>> = { detector: new Map(), ocr: new Map(), translator: new Map() };
const deviceUsed: Partial<Record<LocalModelId, string>> = {};
let webgpuPref = false;

const post = (m: WorkerMessage) => ctx.postMessage(m);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function report(model: LocalModelId, status: "loading" | "ready" | "error", extra: { error?: string } = {}) {
  let loaded = 0;
  let total = 0;
  for (const f of fileProgress[model].values()) { loaded += f.loaded; total += f.total; }
  const device = deviceUsed[model];
  post({ type: "model", model, status, loaded, total, ...(device ? { device } : {}), ...extra });
}

const progressCb = (model: LocalModelId) => (e: unknown) => {
  const ev = e as { status?: string; file?: string; loaded?: number; total?: number };
  if (!ev.file) return;
  const files = fileProgress[model];
  if (ev.status === "initiate") files.set(ev.file, { loaded: 0, total: 0 });
  else if (ev.status === "progress") files.set(ev.file, { loaded: ev.loaded ?? 0, total: ev.total ?? 0 });
  else if (ev.status === "done") {
    const f = files.get(ev.file);
    const size = f ? f.total || f.loaded : 0;
    files.set(ev.file, { loaded: size, total: size });
  } else return;
  report(model, "loading");
};

const loaders: Partial<Record<LocalModelId, Promise<unknown>>> = {};
/** Loads a model once; a failed load is forgotten so the user can retry. */
function once<T>(id: LocalModelId, load: () => Promise<T>): Promise<T> {
  const existing = loaders[id];
  if (existing) return existing as Promise<T>;
  fileProgress[id].clear();
  report(id, "loading");
  const p = load().then(
    (v) => { report(id, "ready"); return v; },
    (e: unknown) => { delete loaders[id]; report(id, "error", { error: errText(e) }); throw e; },
  );
  loaders[id] = p;
  return p;
}

async function hasWebGPU() {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    return Boolean(gpu && (await gpu.requestAdapter()));
  } catch { return false; }
}

// ---- Detector (ONNX Runtime Web, WASM) ----
/** Downloads one URL and verifies size + SHA-256. Throws on any mismatch. */
async function downloadDetector(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const files = fileProgress.detector;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to fetch detector model (HTTP ${res.status}).`);
  const total = Number(res.headers.get("content-length")) || LOCAL_MODELS.detectorBytes;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    files.set("detector.onnx", { loaded, total });
    report("detector", "loading");
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  if (loaded !== LOCAL_MODELS.detectorBytes) throw new Error("The downloaded detector model has an unexpected size; refusing to load it.");
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    if (!hex.startsWith(LOCAL_MODELS.detectorShaPrefix) || !hex.endsWith(LOCAL_MODELS.detectorShaSuffix)) throw new Error("The downloaded detector model failed its integrity check; refusing to load it.");
  }
  return bytes;
}

async function fetchDetector(): Promise<Uint8Array<ArrayBuffer>> {
  // The cache key is the primary URL; the fallback mirror serves the same (hash-checked) bytes.
  const cacheKey = LOCAL_MODELS.detectorUrls[0];
  try {
    const cache = await caches.open(LOCAL_CACHE_NAME);
    const hit = await cache.match(cacheKey);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch { /* cache unavailable: download without caching */ }
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  let last: unknown;
  for (const url of LOCAL_MODELS.detectorUrls) {
    try {
      fileProgress.detector.clear();
      bytes = await downloadDetector(url);
      break;
    } catch (e) { last = e; }
  }
  if (!bytes) throw last instanceof Error ? last : new Error("Failed to fetch the detector model.");
  try {
    const cache = await caches.open(LOCAL_CACHE_NAME);
    await cache.put(cacheKey, new Response(bytes, { headers: { "content-type": "application/octet-stream" } }));
  } catch { /* storage full or unavailable: it will simply be downloaded again next time */ }
  return bytes;
}

const getDetector = () =>
  once("detector", async () => {
    const bytes = await fetchDetector();
    const version = ort.env.versions.web;
    if (version && !/dev/i.test(version)) ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`;
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
    deviceUsed.detector = "wasm";
    return session;
  });

// ---- OCR + translation (Transformers.js) ----
const getOcr = () =>
  once("ocr", async () => {
    // NOTE: the onnx/ file list of onnx-community/manga-ocr-base-ONNX could not be read when this was written, so the q8
    // ("_quantized") files are NOT confirmed to exist. A missing file makes Transformers.js throw, and the next entry is tried.
    const attempts: [string, string][] = webgpuPref && (await hasWebGPU())
      ? [["webgpu", "fp32"], ["wasm", "q8"], ["wasm", "fp32"]]
      : [["wasm", "q8"], ["wasm", "fp32"]];
    let last: unknown;
    for (const [device, dtype] of attempts) {
      try {
        fileProgress.ocr.clear();
        const p = await makePipeline("image-to-text", LOCAL_MODELS.ocr, { device, dtype, progress_callback: progressCb("ocr") });
        deviceUsed.ocr = `${device}/${dtype}`;
        return p;
      } catch (e) { last = e; }
    }
    throw last;
  });

const getTranslator = () =>
  once("translator", async () => {
    // The 600M model is only practical quantised (q8); WebGPU is not attempted for it.
    const p = await makePipeline("translation", LOCAL_MODELS.translator, { device: "wasm", dtype: "q8", progress_callback: progressCb("translator") });
    deviceUsed.translator = "wasm/q8";
    return p;
  });

// ---- Pipeline steps ----
async function detectAndRead(dataUrl: string): Promise<LocalRegion[]> {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  try {
    const session = await getDetector();
    const S = 640;
    const canvas = new OffscreenCanvas(S, S);
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) throw new Error("Canvas is not available in this browser worker.");
    g.drawImage(bmp, 0, 0, S, S);
    const { data } = g.getImageData(0, 0, S, S);
    const plane = S * S;
    const input = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      input[i] = (data[i * 4] ?? 0) / 255;
      input[plane + i] = (data[i * 4 + 1] ?? 0) / 255;
      input[2 * plane + i] = (data[i * 4 + 2] ?? 0) / 255;
    }
    // Tensor names are documented on the model mirror's card only; fail with a clear message if the graph differs.
    const need = { inputs: ["images", "orig_target_sizes"], outputs: ["labels", "boxes", "scores"] };
    const badIn = need.inputs.filter((n) => !session.inputNames.includes(n));
    const badOut = need.outputs.filter((n) => !session.outputNames.includes(n));
    if (badIn.length || badOut.length) {
      throw new Error(`Unexpected detector model signature. Expected inputs [${need.inputs.join(", ")}] and outputs [${need.outputs.join(", ")}], got inputs [${session.inputNames.join(", ")}] and outputs [${session.outputNames.join(", ")}].`);
    }
    const out = await session.run({
      images: new ort.Tensor("float32", input, [1, 3, S, S]),
      orig_target_sizes: new ort.Tensor("int64", BigInt64Array.from([BigInt(bmp.width), BigInt(bmp.height)]), [1, 2]),
    });
    const labels = out["labels"];
    const boxes = out["boxes"];
    const scores = out["scores"];
    if (!labels || !boxes || !scores) throw new Error("The detector returned an unexpected output format.");
    const found = parseDetections(labels.data as ArrayLike<number | bigint>, boxes.data as ArrayLike<number>, scores.data as ArrayLike<number>, bmp.width, bmp.height);
    if (!found.length) return [];

    const ocr = await getOcr();
    const regions: LocalRegion[] = [];
    for (const b of found) {
      const pad = 4;
      const x0 = Math.max(0, Math.floor(b.x0 - pad));
      const y0 = Math.max(0, Math.floor(b.y0 - pad));
      const w = Math.min(bmp.width - x0, Math.ceil(b.x1 - b.x0 + pad * 2));
      const h = Math.min(bmp.height - y0, Math.ceil(b.y1 - b.y0 + pad * 2));
      const crop = new OffscreenCanvas(w, h);
      const cg = crop.getContext("2d", { willReadFrequently: true });
      if (!cg) continue;
      cg.drawImage(bmp, x0, y0, w, h, 0, 0, w, h);
      // Average luminance of the crop decides white vs. dark text for the re-rendered translation.
      const px = cg.getImageData(0, 0, w, h).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.299 * (px[i] ?? 0) + 0.587 * (px[i + 1] ?? 0) + 0.114 * (px[i + 2] ?? 0);
      const dark = sum / (px.length / 4) < 100;
      const url = URL.createObjectURL(await crop.convertToBlob({ type: "image/png" }));
      let text = "";
      try {
        const res = (await ocr(url, { max_new_tokens: 100 })) as { generated_text?: string }[];
        // Manga OCR's tokenizer inserts spaces between Japanese characters.
        text = (res[0]?.generated_text ?? "").replace(/\s+/g, "");
      } finally { URL.revokeObjectURL(url); }
      if (text) regions.push(toRegion(b, text, bmp.width, bmp.height, dark));
    }
    return readingOrder(regions);
  } finally {
    bmp.close();
  }
}

async function translateAll(texts: string[], target: string): Promise<string[]> {
  const tgt = NLLB_LANG[target];
  if (!tgt) throw new Error(`Local Mode cannot translate into ${target}.`);
  const translate = await getTranslator();
  const out: string[] = [];
  for (const t of texts) {
    if (!t.trim()) { out.push(""); continue; }
    const res = (await translate(t, { src_lang: "jpn_Jpan", tgt_lang: tgt, max_new_tokens: 256 })) as { translation_text?: string }[];
    out.push((res[0]?.translation_text ?? "").trim());
  }
  return out;
}

ctx.addEventListener("message", (e) => {
  const req = e.data;
  webgpuPref = req.webgpu;
  void (async () => {
    try {
      let data: unknown;
      if (req.type === "preload") {
        await getDetector();
        await getOcr();
        await getTranslator();
        data = true;
      } else if (req.type === "detect") data = await detectAndRead(req.image);
      else data = await translateAll(req.texts, req.target);
      post({ type: "result", id: req.id, data });
    } catch (err) {
      post({ type: "error", id: req.id, code: "upstream", message: errText(err) });
    }
  })();
});
