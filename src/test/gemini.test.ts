import { describe, expect, it } from "vitest";
import { classify, dataUrlToInline, parseResponse } from "@/lib/ai/gemini";
import { boxToRect } from "@/lib/ai/services.functions";

describe("Gemini BYOK helpers", () => {
  it("parses JSON answers, including fenced ones, and rejects truncated or blocked ones", () => {
    expect(parseResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '```json\n{"a":1}\n```' }] } }] })).toEqual({ a: 1 });
    expect(() => parseResponse({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"a":' }] } }] })).toThrow();
    expect(() => parseResponse({ promptFeedback: { blockReason: "SAFETY" } })).toThrow(/blocked/);
  });
  it("classifies Google errors", () => {
    expect(classify(429, { error: { message: "x", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProject" }] }] } }).code).toBe("credits");
    expect(classify(429, { error: { message: "x" } }).code).toBe("rate_limited");
    expect(classify(400, { error: { message: "API key not valid." } }).code).toBe("not_configured");
  });
  it("converts Gemini [ymin,xmin,ymax,xmax] boxes and rejects bad ones", () => {
    expect(boxToRect([100, 200, 300, 500])).toEqual({ x: 200, y: 100, w: 300, h: 200 });
    expect(boxToRect([10, 10, 10, 50])).toBeNull();
    expect(boxToRect([1, 2, 3])).toBeNull();
  });
  it("only accepts base64 image data URLs", () => {
    expect(dataUrlToInline("data:image/jpeg;base64,AAAA")).toEqual({ inlineData: { mimeType: "image/jpeg", data: "AAAA" } });
    expect(() => dataUrlToInline("data:text/html;base64,AAAA")).toThrow();
  });
});
