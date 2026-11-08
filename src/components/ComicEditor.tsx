import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Bold, Download, Eraser, Plus, Redo2, RotateCcw, Save, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buildErased, downloadBlob, renderFinal } from "@/lib/image/canvas";
import { exportPage } from "@/lib/pipeline";
import { FONTS, type Settings } from "@/lib/settings";
import { uid } from "@/lib/storage";
import type { ComicPage, Project, TextRegion } from "@/lib/types";
import { proofreadTexts, translateTexts } from "@/lib/ai/services.functions";
import { needsReview, styleInstruction } from "@/lib/translation-styles";

type Snapshot = Pick<ComicPage, "regions" | "manualErase">;
export function ComicEditor({ page, project, settings, onSave, busy }: { page: ComicPage; project: Project; settings: Settings; onSave: () => Promise<void>; busy: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const erased = useRef<HTMLCanvasElement | undefined>(undefined);
  const erasedKey = useRef("");
  const [original, setOriginal] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, select] = useState<string>();
  const [zoom, setZoom] = useState(100);
  const [compare, setCompare] = useState(false);
  const [eraseMode, setEraseMode] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const clipboard = useRef<TextRegion | undefined>(undefined);
  const undo = useRef<Snapshot[]>([]), redo = useRef<Snapshot[]>([]);
  const drag = useRef<{ x: number; y: number; region?: TextRegion; resize: boolean } | undefined>(undefined);
  const region = page.regions.find(r => r.id === selected);
  useEffect(() => {
    const url = URL.createObjectURL(page.original); setOriginal(url); erased.current = undefined;
    undo.current = []; redo.current = []; select(undefined); setZoom(100);
    return () => URL.revokeObjectURL(url);
  }, [page.id, page.original]);
  useEffect(() => {
    let active = true;
    setRendering(true);
    (async () => {
      const key = JSON.stringify([page.id, page.manualErase, page.regions.filter(r => r.erase).map(r => [r.x,r.y,r.w,r.h])]);
      if (erasedKey.current !== key) { erased.current = undefined; erasedKey.current = key; }
      const base = erased.current ?? await buildErased(page);
      if (!active) return;
      erased.current = base;
      const final = await renderFinal(page, base);
      if (active && canvas.current) {
        canvas.current.width = page.width; canvas.current.height = page.height;
        canvas.current.getContext("2d")?.drawImage(final, 0, 0);
      }
    })().catch(e => toast.error(String(e))).finally(() => { if (active) setRendering(false); });
    return () => { active = false; };
  }, [page, page.status, page.regions, page.manualErase, revision]);
  const snapshot = () => structuredClone({ regions: page.regions, manualErase: page.manualErase });
  const checkpoint = () => { undo.current.push(snapshot()); if (undo.current.length > 40) undo.current.shift(); redo.current = []; };
  const changed = (invalidate = false) => { if (invalidate) erased.current = undefined; setRevision(n => n + 1); };
  const patch = (values: Partial<TextRegion>) => { if (!region) return; checkpoint(); Object.assign(region, values); changed("erase" in values); };
  const history = (back: boolean) => {
    const from = back ? undo : redo, to = back ? redo : undo;
    const state = from.current.pop(); if (!state) return;
    to.current.push(snapshot()); Object.assign(page, state); changed(true);
  };
  const retranslate = async () => {
    if (!region || aiBusy) return;
    setAiBusy(true);
    try {
      const result = await translateTexts({ data: { items:[{id:region.id,text:region.source,kind:region.kind}], targetLang:project.targetLang, glossary:project.glossary, style:styleInstruction(settings.translationStyle, settings.style), context:project.context, relationships:project.relationships } });
      if (!result.ok) throw new Error(result.error);
      const item=result.data.items.find(i => i.id===region.id);
      if (!item?.translation) throw new Error("Translation is incomplete.");
      patch({translation:item.translation}); await onSave();
    } catch(e) { toast.error(String(e)); } finally { setAiBusy(false); }
  };
  const qualityCheck = async () => {
    if (aiBusy || !page.regions.length) return;
    setAiBusy(true);
    try {
      const result=await proofreadTexts({ data:{ items:page.regions.map(r => ({id:r.id,source:r.source,translation:r.translation})), targetLang:project.targetLang, glossary:project.glossary, style:styleInstruction(settings.translationStyle) } });
      if (!result.ok) throw new Error(result.error);
      if (page.regions.some(r => !result.data.items.some(i => i.id===r.id && i.translation.trim()))) throw new Error("Quality check returned an incomplete result.");
      checkpoint();
      for (const r of page.regions) { const item=result.data.items.find(i => i.id===r.id); if (item) Object.assign(r,{translation:item.translation,confidence:Math.max(0,Math.min(1,item.confidence)),reviewNote:item.note}); }
      changed(); await onSave(); toast.success("Quality review saved");
    } catch(e) { toast.error(String(e)); } finally { setAiBusy(false); }
  };
  const point = (e: React.PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width * page.width, y: (e.clientY - rect.top) / rect.height * page.height };
  };
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    if (busy) return;
    const p = point(e);
    if (eraseMode) { checkpoint(); drag.current = { ...p, resize: false }; e.currentTarget.setPointerCapture(e.pointerId); return; }
    const hit = [...page.regions].reverse().find(r => p.x >= r.x && p.x <= r.x+r.w && p.y >= r.y && p.y <= r.y+r.h);
    select(hit?.id);
    if (hit) { checkpoint(); drag.current = { ...p, region: { ...hit }, resize: p.x > hit.x+hit.w-20 && p.y > hit.y+hit.h-20 }; e.currentTarget.setPointerCapture(e.pointerId); }
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d?.region) return;
    const p = point(e), r = page.regions.find(r => r.id === d.region?.id); if (!r) return;
    if (d.resize) { r.w = Math.max(20, Math.min(page.width-r.x, d.region.w+p.x-d.x)); r.h = Math.max(20, Math.min(page.height-r.y, d.region.h+p.y-d.y)); }
    else { r.x = Math.max(0, Math.min(page.width-r.w, d.region.x+p.x-d.x)); r.y = Math.max(0, Math.min(page.height-r.h, d.region.y+p.y-d.y)); }
    changed();
  };
  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d && eraseMode) {
      const p = point(e); page.manualErase.push({ x: Math.min(d.x,p.x), y: Math.min(d.y,p.y), w: Math.max(8,Math.abs(p.x-d.x)), h: Math.max(8,Math.abs(p.y-d.y)) }); changed(true);
    }
    drag.current = undefined;
  };
  const save = async () => { try { await onSave(); toast.success("Edits saved on this device"); } catch (e) { toast.error(String(e)); } };
  const download = async () => { try { downloadBlob(await exportPage(page,settings), `${page.name.replace(/\.[^.]+$/,"")}-${settings.targetLang}.${settings.format === "jpeg" ? "jpg" : settings.format}`); } catch(e) { toast.error(String(e)); } };
  return <section className="mt-6 border-t pt-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h2 className="truncate font-semibold">{page.name}</h2><p className="text-xs text-muted-foreground">{page.width} × {page.height} · {page.regions.length} text regions{rendering ? " · Rendering…" : ""}</p></div>
      <div className="flex flex-wrap gap-1">
        <Button variant="outline" disabled={busy || aiBusy || !page.regions.some(r => r.translation)} onClick={qualityCheck}>{aiBusy ? "Checking…" : "Quality check"}</Button>
        <Button variant={compare ? "secondary" : "ghost"} size="icon" title="Compare original" aria-label="Compare original" onClick={() => setCompare(!compare)}><ArrowLeftRight /></Button>
        <Button variant="ghost" size="icon" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom(Math.max(25,zoom-25))}><ZoomOut /></Button><span className="self-center text-xs">{zoom}%</span>
        <Button variant="ghost" size="icon" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom(Math.min(300,zoom+25))}><ZoomIn /></Button>
        <Button variant="ghost" size="icon" title="Undo" aria-label="Undo" disabled={!undo.current.length || busy} onClick={() => history(true)}><Undo2 /></Button>
        <Button variant="ghost" size="icon" title="Redo" aria-label="Redo" disabled={!redo.current.length || busy} onClick={() => history(false)}><Redo2 /></Button>
        <Button variant="outline" disabled={busy} onClick={save}><Save />Save</Button>
        <Button disabled={busy || rendering || page.status !== "done"} onClick={download}><Download />Download</Button>
      </div>
    </div>
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="checker max-h-[75vh] min-h-80 overflow-auto rounded-lg border p-3">
        <div className={compare ? "grid grid-cols-2 gap-3" : ""} style={{ width: `${zoom}%`, minWidth: "100%" }}>
          {compare && <div><p className="mb-2 text-xs text-muted-foreground">Original</p><img src={original} alt="Original comic page" className="w-full" /></div>}
          <div><p className="mb-2 text-xs text-muted-foreground">{page.status === "done" ? "Translated" : "Preview"}</p>
            <div className="relative touch-none" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={() => { drag.current = undefined; }}>
              <canvas ref={canvas} className="block w-full" aria-label="Translated comic page" />
              {page.regions.map(r => <div key={r.id} className={`pointer-events-none absolute border ${selected === r.id ? "border-cyan bg-cyan/10" : "border-primary/40"}`} style={{ left:`${r.x/page.width*100}%`, top:`${r.y/page.height*100}%`, width:`${r.w/page.width*100}%`, height:`${r.h/page.height*100}%` }}>{selected === r.id && <span className="absolute bottom-0 right-0 size-2 bg-cyan" />}</div>)}
            </div>
          </div>
        </div>
      </div>
      <aside className="min-w-0 space-y-4">
        <div className="flex justify-between"><h3 className="font-semibold">Text layers</h3><Button size="icon" variant="ghost" aria-label="Add text" title="Add text" disabled={busy} onClick={() => { checkpoint(); const r: TextRegion = { id: uid(), kind:"bubble", source:"", translation:"អត្ថបទថ្មី", vertical:false, x:page.width*.3,y:page.height*.15,w:page.width*.4,h:page.width*.2, erase:false,visible:true,font:settings.font,fontSize:null,bold:false,align:"center",lineHeight:1.35,color:"#111111",stroke:"none" }; page.regions.push(r); select(r.id); changed(); }}><Plus /></Button></div>
        <div className="max-h-36 space-y-1 overflow-auto">{page.regions.map((r,i) => <Button key={r.id} variant={r.id === selected ? "secondary" : "ghost"} className="w-full justify-start overflow-hidden" onClick={() => select(r.id)}><span className="text-muted-foreground">{i+1}</span><span className="truncate">{r.translation || r.source}</span>{needsReview(r) && <span className="ml-auto shrink-0 rounded bg-destructive/15 px-1.5 text-xs text-destructive">Review</span>}</Button>)}</div>
        {page.regions.some(needsReview) && <p className="text-xs text-destructive">{page.regions.filter(needsReview).length} line(s) need review — low AI confidence or empty.</p>}
        {region && <fieldset disabled={busy} className="space-y-3">
          <label className="block text-xs text-muted-foreground">Original<Textarea aria-label="OCR source text" className="mt-1" value={region.source} onChange={e => patch({source:e.target.value})} /></label>
          <Button variant="outline" className="w-full" disabled={aiBusy || !region.source.trim()} onClick={retranslate}>Re-translate selected text</Button>
          {region.confidence !== undefined && <p className="text-xs text-muted-foreground">AI confidence estimate: {Math.round(region.confidence*100)}%{region.reviewNote && ` · ${region.reviewNote}`}</p>}
          <label className="block text-xs text-muted-foreground">Text type<select aria-label="Text type" className="mt-1 w-full rounded-md border bg-background p-2" value={region.kind} onChange={e => patch({kind:e.target.value as TextRegion["kind"]})}>{["bubble","thought","caption","narration","sfx","title","sign"].map(k => <option key={k}>{k}</option>)}</select></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={region.vertical} onChange={e => patch({vertical:e.target.checked})} />Vertical source text</label>
          <label className="block text-xs text-muted-foreground">Translation<Textarea aria-label="Translation text" className="mt-1 font-khmer" value={region.translation} onChange={e => patch({translation:e.target.value, confidence:1, reviewNote:"Edited by you"})} /></label>
          <label className="block text-xs text-muted-foreground">Font<select className="mt-1 w-full rounded-md border bg-background p-2 text-sm text-foreground" value={region.font} onChange={e => patch({font:e.target.value})}>{FONTS.map(f => <option key={f.id}>{f.id}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2"><label className="text-xs text-muted-foreground">Font size<Input aria-label="Font size" type="number" min={8} max={300} placeholder="Auto" value={region.fontSize ?? ""} onChange={e => patch({fontSize:e.target.value ? Math.max(8,Number(e.target.value)) : null})} /></label><label className="text-xs text-muted-foreground">Line spacing<Input type="number" min={1} max={3} step={.05} value={region.lineHeight} onChange={e => patch({lineHeight:Math.max(1,Number(e.target.value))})} /></label></div>
          <div className="flex gap-2"><Button variant={region.bold ? "secondary" : "outline"} size="icon" aria-label="Bold" title="Bold" onClick={() => patch({bold:!region.bold})}><Bold /></Button><input aria-label="Text color" type="color" value={region.color} onChange={e => patch({color:e.target.value})} className="h-9 w-10 rounded border bg-background" /><select aria-label="Text alignment" className="min-w-0 flex-1 rounded border bg-background px-2 text-sm" value={region.align} onChange={e => patch({align:e.target.value as TextRegion["align"]})}><option>left</option><option>center</option><option>right</option></select></div>
          <label className="block text-xs text-muted-foreground">Rotation<Input aria-label="Text rotation" type="number" min={-180} max={180} value={region.rotation ?? 0} onChange={e => patch({rotation:Math.max(-180,Math.min(180,Number(e.target.value)))})} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={region.stroke !== "none"} onChange={e => patch({stroke:e.target.checked ? "#ffffff" : "none"})} />Outline{region.stroke !== "none" && <input aria-label="Outline color" type="color" value={region.stroke} onChange={e => patch({stroke:e.target.value})} />}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(region.shadow)} onChange={e => patch({shadow:e.target.checked ? "#000000" : ""})} />Shadow</label>
          <div className="flex gap-2"><Button variant="outline" onClick={() => { clipboard.current=structuredClone(region); }}>Copy</Button><Button variant="outline" disabled={!clipboard.current} onClick={() => { if (!clipboard.current) return; checkpoint(); const copy={...structuredClone(clipboard.current),id:uid(),x:Math.min(page.width-clipboard.current.w,clipboard.current.x+15),y:Math.min(page.height-clipboard.current.h,clipboard.current.y+15)}; page.regions.push(copy); select(copy.id); changed(); }}>Paste</Button></div>
          <Button variant="outline" className="w-full" onClick={() => { checkpoint(); region.visible = false; region.erase = false; page.manualErase = page.manualErase.filter(r => !(r.x < region.x+region.w && r.x+r.w > region.x && r.y < region.y+region.h && r.y+r.h > region.y)); changed(true); }}><RotateCcw />Restore original region</Button>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={region.visible} onChange={e => patch({visible:e.target.checked})} />Show translation</label>
        </fieldset>}
        <Button disabled={busy} className="w-full" variant={eraseMode ? "secondary" : "outline"} onClick={() => setEraseMode(!eraseMode)}><Eraser />{eraseMode ? "Erase selected area" : "Manual erase"}</Button>
      </aside>
    </div>
  </section>;
}