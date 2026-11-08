import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { backupProject, readBackup } from "@/lib/project-backup";
import { TRANSLATION_STYLES } from "@/lib/settings";
import type { Project } from "@/lib/types";
import { Blob as NodeBlob } from "node:buffer";

const readBlob = (blob: Blob) => new Promise<ArrayBuffer>((resolve,reject) => { const reader=new FileReader(); reader.onload=() => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error("Expected bytes")); reader.onerror=reject; reader.readAsArrayBuffer(blob); });

describe("V2 preservation", () => {
  it("preserves original bytes and legacy project IDs in a backup round trip", async () => {
    const original = new NodeBlob([new Uint8Array([1,2,3,4])], {type:"image/png"}) as unknown as Blob;
    const project: Project = {id:"existing",name:"Original project",createdAt:1,updatedAt:2,sourceLang:"Chinese (Simplified)",targetLang:"Khmer",glossary:[{source:"林",target:"លីន"}],pages:[{id:"original-page",name:"1.png",original,width:100,height:200,regions:[],manualErase:[],status:"queued"}]};
    const copy=await readBackup(await readBlob(await backupProject(project)));
    expect(copy.id).toBe("existing");
    expect(copy.pages[0]?.id).toBe("original-page");
    expect(copy.glossary).toEqual(project.glossary);
    const page=copy.pages[0];
    if (!page) throw new Error("Restored page missing");
    expect(Array.from(new Uint8Array(await readBlob(page.original)))).toEqual([1,2,3,4]);
    expect(project.pages[0]?.original).toBe(original);
  });
  it("rejects a backup without original files instead of creating incomplete pages", async () => {
    const zip=new JSZip();
    zip.file("project.json",JSON.stringify({id:"x",name:"x",createdAt:0,updatedAt:0,sourceLang:"English",targetLang:"Khmer",glossary:[],pages:[{id:"p",name:"p.png",width:10,height:10,regions:[],manualErase:[],status:"queued",originalType:"image/png"}]}));
    await expect(readBackup(await zip.generateAsync({type:"arraybuffer"}))).rejects.toThrow("Missing original");
  });
  it("supports exactly the five requested translation styles", () => {
    expect([...TRANSLATION_STYLES]).toEqual(["Natural","Literal","Professional","Casual","Novel"]);
  });
});