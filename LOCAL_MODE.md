# Local Mode (on-device AI)

Local Mode translates Japanese manga **entirely in the browser**: no API key, no server calls, no quota.

```
Image → text/bubble detector → crop regions → Manga OCR → Japanese text → NLLB-200 (ja → km) → existing rendering pipeline
```

| Step | Model | Runs with | Licence |
|---|---|---|---|
| Text & bubble detection | `ogkalu/comic-text-and-bubble-detector` (file `detector-v4-s_int8.onnx`, int8; falls back to the byte-identical mirror `Sundowner123/comic-text-and-bubble-detector` → `detector.onnx`; size + SHA-256 checked; tensor names checked at load) | `onnxruntime-web` (WASM) | Apache-2.0 |
| Japanese OCR | `onnx-community/manga-ocr-base-ONNX` | Transformers.js, WebGPU (optional) → WASM fallback | Apache-2.0 |
| Translation | `Xenova/nllb-200-distilled-600M` (q8) | Transformers.js, WASM | **CC-BY-NC-4.0 (non-commercial only)** |

## Licence
NLLB-200 is CC-BY-NC-4.0. Local Mode asks the user to confirm personal, non-commercial use before it can be used
(`kca-local-nc-ack` in localStorage). Do not enable Local Mode in a commercial deployment. Gemini/Groq modes are unaffected.

## Files
- `src/lib/ai/local.worker.ts` – Web Worker: detector, OCR, translation, model download/caching, progress.
- `src/lib/ai/local.ts` – main-thread client, compatibility checks, progress store, worker error handling.
- `src/lib/ai/local-protocol.ts` – shared types, model IDs, licence text. `src/lib/ai/local-geometry.ts` – box parsing/NMS/reading order.
- `src/components/LocalModelPanel.tsx` – Setup panel and workspace progress banner.

## Limits
- Japanese source only (Chinese/Korean need a different OCR). Line-by-line translation: no glossary/style/context. Quality is below Gemini.
- Models are large; iPhone/iPad Safari may run out of memory. Models are cached in the Cache API; the app shell itself is not available offline (no service worker).
