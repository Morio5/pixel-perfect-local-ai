import { describe, expect, it } from "vitest";
import { nms, parseDetections, readingOrder, toRegion } from "@/lib/ai/local-geometry";

describe("local geometry", () => {
  it("drops bubble outlines, low scores and tiny boxes, and suppresses overlaps", () => {
    const labels = [0, 1, 1, 2, 1];
    const boxes = [0, 0, 100, 100, 10, 10, 60, 60, 12, 12, 62, 62, 200, 200, 260, 260, 300, 300, 303, 303];
    const scores = [0.9, 0.9, 0.8, 0.7, 0.9];
    const out = parseDetections(labels, boxes, scores, 1000, 1000);
    expect(out).toHaveLength(2);
    expect(out[0]?.score).toBe(0.9);
  });
  it("handles bigint labels from int64 tensors", () => {
    const out = parseDetections([1n], [0, 0, 50, 50], [0.5], 100, 100);
    expect(out).toHaveLength(1);
  });
  it("orders manga right-to-left, top-to-bottom", () => {
    const items = [
      { id: "left", x: 100, y: 10, w: 50, h: 50 },
      { id: "right", x: 400, y: 20, w: 50, h: 50 },
      { id: "below", x: 300, y: 300, w: 50, h: 50 },
    ];
    expect(readingOrder(items).map((i) => i.id)).toEqual(["right", "left", "below"]);
  });
  it("normalises regions to 0-1000 and flags vertical text", () => {
    const r = toRegion({ x0: 100, y0: 0, x1: 150, y1: 200, score: 1, label: 1 }, "テスト", 1000, 2000, false);
    expect(r).toMatchObject({ x: 100, y: 0, w: 50, h: 100, vertical: true, kind: "bubble" });
  });
  it("nms keeps distinct boxes", () => {
    const b = (x0: number) => ({ x0, y0: 0, x1: x0 + 10, y1: 10, score: 1, label: 1 });
    expect(nms([b(0), b(100)])).toHaveLength(2);
  });
});
