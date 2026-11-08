import JSZip from "jszip";

const mime: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const MAX_BYTES = 100 * 1024 * 1024;
export async function expandUploads(files: File[]) {
  const result: File[] = [];
  let total = 0;
  for (const file of files) {
    if (file.size > MAX_BYTES) throw new Error("Upload is too large. Split the chapter into smaller files.");
    if (/\.(zip|cbz)$/i.test(file.name)) {
      let zip: JSZip;
      try { zip = await JSZip.loadAsync(new Uint8Array(await file.arrayBuffer())); } catch { throw new Error(`${file.name} is not a valid ZIP/CBZ file.`); }
      if (Object.keys(zip.files).length > 2000) throw new Error("ZIP contains too many files.");
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || entry.name.startsWith("__MACOSX/") || entry.name.split("/").at(-1)?.startsWith(".")) continue;
        const type = mime[entry.name.split(".").at(-1)?.toLowerCase() ?? ""];
        if (!type) continue;
        const declaredSize = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
        if (declaredSize && total + declaredSize > MAX_BYTES) throw new Error("Expanded ZIP is too large.");
        const bytes = await entry.async("uint8array");
        total += bytes.length;
        if (total > MAX_BYTES || result.length >= 200) throw new Error("Too many pages or expanded ZIP is too large.");
        result.push(new File([new Uint8Array(bytes).buffer], entry.name.split("/").at(-1) ?? entry.name, { type }));
      }
    } else {
      const type = mime[file.name.split(".").at(-1)?.toLowerCase() ?? ""];
      if (!type) throw new Error(`Unsupported file: ${file.name}`);
      total += file.size;
      if (total > MAX_BYTES || result.length >= 200) throw new Error("Upload is too large. Split the chapter.");
      result.push(file);
    }
  }
  if (!result.length) throw new Error("No JPG, PNG or WEBP pages found.");
  return result.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}