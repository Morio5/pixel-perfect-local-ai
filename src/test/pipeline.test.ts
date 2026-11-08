import { beforeEach, describe, expect, it, vi } from "vitest";
import { processPage } from "@/lib/pipeline";
import { detectText, translateTexts } from "@/lib/ai/services.functions";
import type { Project } from "@/lib/types";
import { getSettings } from "@/lib/settings";

vi.mock("@/lib/ai/services.functions", () => ({ detectText: vi.fn(), translateTexts: vi.fn() }));
vi.mock("@/lib/image/canvas", () => ({ blobToImage: vi.fn(async () => ({})), sliceForOcr: vi.fn(() => [{dataUrl:"data:image/jpeg;base64,AA",top:0,height:1000}]), renderFinal: vi.fn(), canvasToBlob: vi.fn(), makeThumb: vi.fn() }));
vi.mock("@/lib/storage", () => ({saveProject:vi.fn(),uid:vi.fn(() => "region-1")}));
describe("Truthful translation status", () => {
  beforeEach(() => vi.clearAllMocks());
  it("does not mark a page translated when a region has no translation", async () => {
    const page = {id:"page",name:"page.png",original:new Blob(),width:1000,height:1000,regions:[],manualErase:[],status:"queued" as const};
    const project: Project = {id:"project",name:"Comic",createdAt:0,updatedAt:0,sourceLang:"Chinese (Simplified)",targetLang:"Khmer",glossary:[],pages:[page]};
    vi.mocked(detectText).mockResolvedValue({ok:true,data:[{text:"你好",kind:"bubble",vertical:false,x:10,y:10,w:100,h:100,textColor:"#111111",strokeColor:"none"}]});
    vi.mocked(translateTexts).mockResolvedValue({ok:true,data:{items:[],names:[]}});
    const status = vi.fn();
    await expect(processPage(project,page,getSettings(),status)).rejects.toThrow("Translation is incomplete");
    expect(status).not.toHaveBeenCalledWith("done");
    expect(page.status).toBe("queued");
  });
});