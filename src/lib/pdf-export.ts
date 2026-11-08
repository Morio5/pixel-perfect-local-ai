import { jsPDF } from "jspdf";
import { renderFinal } from "./image/canvas";
import type { Project } from "./types";

export async function exportPdf(project: Project) {
  const pages = project.pages.filter(p => p.status === "done");
  if (!pages.length) throw new Error("No successfully translated pages to export.");
  const pdf = new jsPDF({ unit: "pt" });
  for (const [i, page] of pages.entries()) {
    // PDF pages cannot exceed 14,400 units, so very tall strips get a narrower page (same aspect ratio).
    const width = Math.min(595, (14000 * page.width) / page.height), height = (width * page.height) / page.width;
    if (i === 0) pdf.deletePage(1);
    pdf.addPage([width, height], height >= width ? "portrait" : "landscape");
    pdf.addImage((await renderFinal(page)).toDataURL("image/jpeg", .94), "JPEG", 0, 0, width, height);
  }
  return pdf.output("blob");
}