import { useSyncExternalStore } from "react";

/**
 * BYOK: every user brings their own free Google AI Studio key.
 * The key lives only in this browser (localStorage) and is sent only to Google.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
export const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b";
export type Provider = "gemini" | "groq" | "local";
const KEY = "kca-gemini-key";
const GROQ_KEY = "kca-groq-key";
const GROQ_MODEL = "kca-groq-model";
const PROVIDER = "kca-ai-provider";
const LOCAL_ACK = "kca-local-nc-ack";
const LOCAL_WEBGPU = "kca-local-webgpu";
const MODEL = "kca-gemini-model";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function read(name: string): string {
  if (typeof window === "undefined") return "";
  try { return window.localStorage.getItem(name) ?? ""; } catch { return ""; }
}
function write(name: string, value: string) {
  try {
    if (value) window.localStorage.setItem(name, value);
    else window.localStorage.removeItem(name);
  } catch { /* private mode / storage full: the key simply will not persist */ }
  emit();
}

export const getGeminiKey = () => read(KEY).trim();
export const setGeminiKey = (v: string) => write(KEY, v.trim());
export const clearGeminiKey = () => write(KEY, "");
export const getGeminiModel = () => read(MODEL).trim() || DEFAULT_GEMINI_MODEL;
export const setGeminiModel = (v: string) => write(MODEL, v.trim() === DEFAULT_GEMINI_MODEL ? "" : v.trim());

export const getProvider = (): Provider => {
  const v = read(PROVIDER);
  return v === "groq" || v === "local" ? v : "gemini";
};
export const setProvider = (v: Provider) => write(PROVIDER, v === "gemini" ? "" : v);
/** Local Mode needs no API key, but the user must confirm the non-commercial licence of the NLLB model. */
export const getLocalAck = () => read(LOCAL_ACK) === "1";
export const setLocalAck = (v: boolean) => write(LOCAL_ACK, v ? "1" : "");
export const getLocalWebGpu = () => read(LOCAL_WEBGPU) === "1";
export const setLocalWebGpu = (v: boolean) => write(LOCAL_WEBGPU, v ? "1" : "");
export const getGroqKey = () => read(GROQ_KEY).trim();
export const setGroqKey = (v: string) => write(GROQ_KEY, v.trim());
export const clearGroqKey = () => write(GROQ_KEY, "");
export const getGroqModel = () => read(GROQ_MODEL).trim() || DEFAULT_GROQ_MODEL;
export const setGroqModel = (v: string) => write(GROQ_MODEL, v.trim() === DEFAULT_GROQ_MODEL ? "" : v.trim());
export const getActiveModel = () => {
  const p = getProvider();
  return p === "local" ? "On-device (Manga OCR + NLLB-200)" : p === "groq" ? getGroqModel() : getGeminiModel();
};
/** "Configured" = ready to translate: an API key for cloud providers, the licence confirmation for Local Mode. */
export const hasActiveKey = () => {
  const p = getProvider();
  return p === "local" ? getLocalAck() : Boolean(p === "groq" ? getGroqKey() : getGeminiKey());
};

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

/** Reactive view of the key state. Never returns the key itself to components that only need a status. */
export function useGeminiStatus() {
  const provider = useSyncExternalStore(subscribe, getProvider, () => "gemini" as Provider);
  const configured = useSyncExternalStore(subscribe, hasActiveKey, () => false);
  const model = useSyncExternalStore(subscribe, getActiveModel, () => DEFAULT_GEMINI_MODEL);
  return { configured, model, provider };
}

/** Reactive Local Mode settings (licence confirmation, WebGPU preference). */
export function useLocalSettings() {
  const ack = useSyncExternalStore(subscribe, getLocalAck, () => false);
  const webgpu = useSyncExternalStore(subscribe, getLocalWebGpu, () => false);
  return { ack, webgpu };
}
