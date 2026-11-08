export type RegionKind = "bubble" | "thought" | "caption" | "sfx" | "narration" | "title" | "sign";

export interface TextRegion {
  id: string;
  kind: RegionKind;
  source: string;
  translation: string;
  vertical: boolean;
  /** pixel coords in original image space */
  x: number;
  y: number;
  w: number;
  h: number;
  erase: boolean;
  visible: boolean;
  font: string;
  fontSize: number | null; // null = auto-fit
  bold: boolean;
  align: "left" | "center" | "right";
  lineHeight: number;
  color: string;
  stroke: string; // "none" or hex
  rotation?: number;
  strokeWidth?: number;
  shadow?: string;
  confidence?: number;
  reviewNote?: string;
}

export type PageStatus = "queued" | "detecting" | "translating" | "erasing" | "rendering" | "done" | "error";

export interface ComicPage {
  id: string;
  name: string;
  original: Blob;
  width: number;
  height: number;
  regions: TextRegion[];
  /** manual erase strokes (pixel rects) */
  manualErase: { x: number; y: number; w: number; h: number }[];
  status: PageStatus;
  error?: string;
  thumb?: string;
  ocrComplete?: boolean;
  chapter?: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  sourceLang: string;
  targetLang: string;
  glossary: { source: string; target: string }[];
  pages: ComicPage[];
  context?: string;
  relationships?: string;
  /** library project this chapter belongs to */
  seriesId?: string;
  chapterNumber?: number;
}

export interface MemoryEntry {
  source: string;
  target: string;
  updatedAt: number;
  /** previous translations, newest first */
  history: string[];
}

/** A library project (Komga "series") that groups chapters. Chapters are stored Projects. */
export interface Series {
  id: string;
  title: string;
  description: string;
  author: string;
  status: "ongoing" | "completed" | "hiatus";
  tags: string[];
  cover?: string;
  sourceLang: string;
  targetLang: string;
  translationStyle: string;
  glossary: { source: string; target: string }[];
  memory: MemoryEntry[];
  createdAt: number;
  updatedAt: number;
}
