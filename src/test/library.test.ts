import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { chaptersOf, mergeGlossary, nextUnfinishedPage, recordMemory, reorderChapters } from "@/lib/library";
import { expandUploads } from "@/lib/uploads";
import type { ComicPage, Project } from "@/lib/types";

const ch = (id: string, n: number): Project => ({ id, name: id, createdAt: n, updatedAt: n, sourceLang: "", targetLang: "Khmer", glossary: [], pages: [], seriesId: "s", chapterNumber: n });
/** jsdom File lacks arrayBuffer(); browsers have it. */
const mkFile = (bytes: Uint8Array, name: string) => Object.assign(new File([new Uint8Array(bytes)], name), { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
const pg = (id: string, status: ComicPage["status"]) => ({ id, status }) as ComicPage;

describe("library", () => {
  it("orders chapters by number and moves one up with renumbering", () => {
    const list = chaptersOf("s", [ch("c", 3), ch("a", 1), ch("b", 2), { ...ch("x", 1), seriesId: "other" }]);
    expect(list.map((c) => c.id)).toEqual(["a", "b", "c"]);
    reorderChapters(list, 2, -1);
    expect(chaptersOf("s", list).map((c) => c.id)).toEqual(["a", "c", "b"]);
    expect(reorderChapters(list, 0, -1)).toEqual([]);
  });
  it("chapter glossary overrides shared names and drops blanks", () => {
    expect(mergeGlossary([{ source: "林", target: "លីន" }, { source: "王", target: "វ៉ាង" }], [{ source: "林", target: "លិន" }, { source: "", target: "x" }]))
      .toEqual([{ source: "林", target: "លិន" }, { source: "王", target: "វ៉ាង" }]);
  });
  it("keeps translation history when a line is re-translated", () => {
    let m = recordMemory([], [{ source: "你好", target: "សួស្តី" }], 1);
    m = recordMemory(m, [{ source: "你好", target: "ជំរាបសួរ" }], 2);
    expect(m).toEqual([{ source: "你好", target: "ជំរាបសួរ", updatedAt: 2, history: ["សួស្តី"] }]);
  });
  it("resumes from the first unfinished or failed page", () => {
    expect(nextUnfinishedPage([pg("1", "done"), pg("2", "error"), pg("3", "queued")])?.id).toBe("2");
    expect(nextUnfinishedPage([pg("1", "done")])).toBeUndefined();
  });
  it("sorts ZIP pages numerically and rejects ZIPs without images", async () => {
    const zip = new JSZip();
    for (const n of ["10.png", "2.png", "1.png", "notes.txt", "__MACOSX/1.png"]) zip.file(n, new Uint8Array([1, 2, 3]));
    const file = mkFile(await zip.generateAsync({ type: "uint8array" }), "ch1.zip");
    expect((await expandUploads([file])).map((f) => f.name)).toEqual(["1.png", "2.png", "10.png"]);
    const empty = new JSZip(); empty.file("a.txt", "x");
    await expect(expandUploads([mkFile(await empty.generateAsync({ type: "uint8array" }), "e.zip")])).rejects.toThrow(/No JPG/);
  });
  it("rejects a corrupt ZIP", async () => {
    await expect(expandUploads([mkFile(new Uint8Array([1, 2, 3]), "bad.zip")])).rejects.toThrow();
  });
});
