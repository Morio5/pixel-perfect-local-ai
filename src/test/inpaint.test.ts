import { describe, expect, it } from "vitest";
import { blurRect, fillMasked } from "@/lib/image/canvas";

describe("Text-removal fill", () => {
  it("fills the masked area from surrounding pixels and keeps known pixels untouched", () => {
    const w = 9, h = 9, d = new Uint8ClampedArray(w * h * 4);
    const known = new Uint8Array(w * h).fill(1);
    for (let i = 0; i < w * h; i++) { d[i * 4] = 200; d[i * 4 + 1] = 100; d[i * 4 + 2] = 50; d[i * 4 + 3] = 255; }
    for (let y = 3; y < 6; y++) for (let x = 3; x < 6; x++) { known[y * w + x] = 0; d[(y * w + x) * 4] = 0; }
    fillMasked(d, known, w, h);
    for (let i = 0; i < w * h; i++) { expect(d[i * 4]).toBe(200); expect(known[i]).toBe(1); }
  });
  it("blurs only inside the given rectangle", () => {
    const w = 10, h = 10, d = new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256));
    const before = d.slice();
    blurRect(d, w, h, 4, 4, 7, 7);
    expect(d[0]).toBe(before[0]);
    expect(d.slice((5 * w + 5) * 4, (5 * w + 5) * 4 + 3)).not.toEqual(before.slice((5 * w + 5) * 4, (5 * w + 5) * 4 + 3));
  });
});
