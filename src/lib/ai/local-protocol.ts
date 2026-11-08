/** Shared types/constants between the main thread (local.ts) and the Web Worker (local.worker.ts). */

export type LocalModelId = "detector" | "ocr" | "translator";

/** A detected + OCR'd text region. Box is 0-1000 normalised relative to the image that was sent. */
export type LocalRegion = {
  text: string;
  kind: "bubble" | "caption";
  vertical: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  textColor: string;
  strokeColor: string;
};

export type WorkerRequest =
  | { id: number; type: "preload"; webgpu: boolean }
  | { id: number; type: "detect"; image: string; webgpu: boolean }
  | { id: number; type: "translate"; texts: string[]; target: string; webgpu: boolean };

export type WorkerMessage =
  | { type: "model"; model: LocalModelId; status: "loading" | "ready" | "error"; loaded: number; total: number; device?: string; error?: string }
  | { type: "result"; id: number; data: unknown }
  | { type: "error"; id: number; code: "invalid" | "upstream"; message: string };

/**
 * Models used by Local Mode.
 * - Detector: ogkalu/comic-text-and-bubble-detector, file `detector-v4-s_int8.onnx` (Apache-2.0, ~11.1 MB).
 *   The same bytes are mirrored as `detector.onnx` at Sundowner123/comic-text-and-bubble-detector (used only as a fallback URL).
 *   SHA-256 5fe9e4f5…931ea79 is shown on both Hub file pages; 11,120,765 bytes comes from the mirror's model card.
 *   Tensor names (images, orig_target_sizes -> labels, boxes, scores) are documented only on the mirror card, so the worker
 *   re-checks them against the loaded ONNX session before running.
 * - OCR: onnx-community/manga-ocr-base-ONNX (Apache-2.0).
 * - Translation: Xenova/nllb-200-distilled-600M (CC-BY-NC-4.0, NON-COMMERCIAL use only).
 */
export const LOCAL_MODELS = {
  /** Tried in order; the first one that downloads and passes the size + SHA-256 check wins. */
  detectorUrls: [
    "https://huggingface.co/ogkalu/comic-text-and-bubble-detector/resolve/main/detector-v4-s_int8.onnx",
    "https://huggingface.co/Sundowner123/comic-text-and-bubble-detector/resolve/main/detector.onnx",
  ],
  detectorBytes: 11_120_765,
  detectorShaPrefix: "5fe9e4f5",
  detectorShaSuffix: "931ea79",
  ocr: "onnx-community/manga-ocr-base-ONNX",
  translator: "Xenova/nllb-200-distilled-600M",
} as const;

export const LOCAL_CACHE_NAME = "kca-local-models-v1";

/** App target language -> FLORES-200 code used by NLLB. */
export const NLLB_LANG: Record<string, string> = {
  Khmer: "khm_Khmr",
  English: "eng_Latn",
  Thai: "tha_Thai",
  Vietnamese: "vie_Latn",
};

export const LOCAL_LICENSE_NOTICE =
  "Local Mode uses facebook/NLLB-200 (distilled 600M) for translation, which is licensed CC-BY-NC-4.0: personal, non-commercial use only. " +
  "Do not use Local Mode in a commercial product or service. The detector (ogkalu/comic-text-and-bubble-detector) and Manga OCR (kha-white/manga-ocr-base) are Apache-2.0.";
