import { useSyncExternalStore } from "react";

export const SOURCE_LANGS = ["Auto detect", "Chinese (Simplified)", "Chinese (Traditional)", "Japanese", "Korean", "English"];
export const TARGET_LANGS = ["Khmer", "English", "Thai", "Vietnamese"];
export const TRANSLATION_STYLES = ["Natural", "Literal", "Professional", "Casual", "Novel"] as const;
export const FONTS = [
  { id: "Kantumruy Pro", label: "Kantumruy Pro (modern)" },
  { id: "Noto Sans Khmer", label: "Noto Sans Khmer" },
  { id: "Battambang", label: "Battambang (classic)" },
  { id: "Koulen", label: "Koulen (bold SFX)" },
  { id: "Moul", label: "Moul (decorative)" },
  { id: "Bangers", label: "Bangers (Latin SFX)" },
];

export interface Settings {
  sourceLang: string;
  targetLang: string;
  font: string;
  sfxFont: string;
  fontSize: number | null;
  style: string;
  translationStyle: typeof TRANSLATION_STYLES[number];
  format: "png" | "jpeg" | "webp";
  quality: number;
  theme: "dark" | "light";
  /** "fast": 2 AI calls/page, no thinking. "quality": extra proofreading call + model thinking. */
  speed: "fast" | "quality";
}

const DEFAULTS: Settings = {
  sourceLang: "Auto detect",
  targetLang: "Khmer",
  font: "Kantumruy Pro",
  sfxFont: "Koulen",
  fontSize: null,
  style: "Natural, emotional, casual spoken dialogue",
  translationStyle: "Natural",
  format: "png",
  quality: 0.92,
  theme: "dark",
  speed: "fast",
};

const KEY = "kca-settings";
let cache: Settings | null = null;
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  if (!cache) {
    try {
      cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch {
      cache = DEFAULTS;
    }
  }
  return cache ?? DEFAULTS;
}

export function updateSettings(patch: Partial<Settings>) {
  cache = { ...getSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(cache));
  applyTheme(cache.theme);
  listeners.forEach((l) => l());
}

export function applyTheme(theme: Settings["theme"]) {
  document.documentElement.classList.toggle("light", theme === "light");
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSettings,
    () => DEFAULTS,
  );
}
