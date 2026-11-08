import { describe, expect, it } from "vitest";
import { needsReview, styleInstruction, STYLE_GUIDES } from "@/lib/translation-styles";
import { TRANSLATION_STYLES } from "@/lib/settings";

describe("translation styles", () => {
  it("offers exactly the five styles", () => {
    expect([...TRANSLATION_STYLES]).toEqual(["Natural", "Literal", "Professional", "Casual", "Novel"]);
    expect(Object.keys(STYLE_GUIDES).sort()).toEqual([...TRANSLATION_STYLES].sort());
  });
  it("sends the chosen style's rule", () => {
    expect(styleInstruction("Literal")).toMatch(/^Literal:/);
    expect(styleInstruction("unknown")).toMatch(/^Natural:/);
  });
  it("flags lines under 70% confidence or empty", () => {
    expect(needsReview({ translation: "សួស្តី", confidence: 0.69 })).toBe(true);
    expect(needsReview({ translation: "សួស្តី", confidence: 0.7 })).toBe(false);
    expect(needsReview({ translation: " " })).toBe(true);
  });
});
