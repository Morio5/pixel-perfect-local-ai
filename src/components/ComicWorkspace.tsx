import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Download, FileImage, FolderOpen, Loader2, Play, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dropzone, PageHeader, ProgressBar, SetupBanner, StatusBadge, statusProgress, useAiStatus } from "@/components/shared";
import { ComicEditor } from "@/components/ComicEditor";
import { createPage, exportZip, friendlyError, processPage } from "@/lib/pipeline";
import { downloadBlob } from "@/lib/image/canvas";
import { SOURCE_LANGS, TARGET_LANGS, updateSettings, useSettings } from "@/lib/settings";
import { loadProject, saveProject, uid, useProjects } from "@/lib/storage";
import type { Project } from "@/lib/types";
import sample from "@/assets/comic-sample.jpg";
import { expandUploads } from "@/lib/uploads";
import { backupProject, readBackup } from "@/lib/project-backup";
import { exportPdf } from "@/lib/pdf-export";
import { nextUnfinishedPage, withChapterLock } from "@/lib/library";

export function ComicWorkspace({ batch = false, projectId }: { batch?: boolean; projectId?: string }) {
  const settings = useSettings(), projects = useProjects(), ai = useAiStatus();
  const [project, setProject] = useState<Project>();
  const [pageId, setPageId] = useState<string>();
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0), [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const stop = useRef(false);
  const restoreInput = useRef<HTMLInputElement>(null);
  const refresh = () => setProject(p => p ? { ...p, pages: [...p.pages] } : p);
  useEffect(() => {
    if (!projectId) return;
    loadProject(projectId).then(p => {
      if (!p) { setError("This project was not found on this device."); return; }
      p.pages.forEach(page => { if (!["done","error","queued"].includes(page.status)) { page.status = "error"; page.error = "Processing was interrupted. Start translation again."; } });
      setProject(p); setPageId((nextUnfinishedPage(p.pages) ?? p.pages[0])?.id);
    }).catch(e => setError(String(e)));
  }, [projectId]);
  const upload = async (files: File[]) => {
    if (busy || uploading) return;
    setUploading(true); setError(""); setUploadProgress(0);
    const p = project ?? { id:uid(), name:files[0]?.name.replace(/\.[^.]+$/, "") || "Untitled chapter", createdAt:Date.now(), updatedAt:Date.now(), sourceLang:settings.sourceLang,targetLang:settings.targetLang,glossary:[],pages:[] };
    try {
      files = await expandUploads(files);
      const prepared = [];
      for (let i=0;i<files.length;i++) {
        const file = files[i]; if (!file) continue;
        prepared.push(await createPage(file)); setUploadProgress(Math.round((i+1)/files.length*100));
      }
      p.pages.push(...prepared);
      await saveProject(p); setProject({...p}); setPageId(p.pages.at(-files.length)?.id);
    } catch(e) { setError(`Upload failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setUploading(false); }
  };
  const run = async (detectOnly = false) => {
    if (!project || busy) return;
    setBusy(true); setError(""); stop.current = false;
    try {
      const outcome = await withChapterLock(project.id, async () => {
      for (const page of project.pages.filter(p => p.status !== "done")) {
        if (stop.current) break;
        setPageId(page.id);
        try {
          await processPage(project,page,settings,(status, info) => { page.status = status; setMessage(info ?? ""); refresh(); }, detectOnly);
        } catch(e) {
          const err = e as { code?:string; message?:string };
          page.status = "error"; page.error = friendlyError(err.code ?? "upstream",err.message ?? "Translation failed");
          setError(page.error); await saveProject(project); refresh();
          // Never continue a batch after a blocked AI call or retry automatically.
          break;
        }
      }
      });
      if (outcome === "locked") { setError("This chapter is already being translated in another tab."); return; }
      await saveProject(project);
    } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); setMessage(""); refresh(); }
  };
  const zip = async () => { if (!project) return; try { downloadBlob(await exportZip(project,settings),`${project.name}.zip`); } catch(e) { toast.error(String(e)); } };
  const page = project?.pages.find(p => p.id === pageId);
  const translated = projects?.reduce((n,p) => n+p.pages.filter(p => p.status === "done").length,0) ?? 0;
  return <div className="mx-auto max-w-[1500px]">
    <SetupBanner />
    {project?.seriesId && <Link to="/library/$seriesId" params={{seriesId:project.seriesId}} className="mb-3 inline-block text-sm text-muted-foreground hover:text-foreground">← Back to project chapters</Link>}
    <input ref={restoreInput} type="file" accept=".zip" aria-label="Restore project backup" className="hidden" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; try { if (file.size > 100 * 1024 * 1024) throw new Error("Backup is too large."); const copy = await readBackup(await file.arrayBuffer()); copy.id=uid(); copy.name += " (restored copy)"; copy.pages.forEach(p => { p.id=uid(); }); await saveProject(copy); setProject(copy); setPageId(copy.pages[0]?.id); toast.success("Backup restored as a new copy"); } catch(err) { toast.error(String(err)); } }} />
    <div className="mb-3 flex flex-wrap gap-2"><Button variant="outline" disabled={busy || uploading} onClick={() => restoreInput.current?.click()}><FolderOpen />Restore backup</Button>{project && <><Button variant="outline" disabled={busy} onClick={async () => { try { downloadBlob(await backupProject(project), `${project.name}-backup.zip`); } catch(e) { toast.error(String(e)); } }}><Download />Project backup</Button><Button variant="outline" disabled={busy || !project.pages.some(p => p.status === "done")} onClick={async () => { try { downloadBlob(await exportPdf(project), `${project.name}.pdf`); } catch(e) { toast.error(String(e)); } }}><Download />PDF</Button></>}</div>
    <PageHeader title={batch ? "Batch translator" : "KHMER COMIC AI"} subtitle={batch ? "Chapter queue" : "Comic translation studio"}>
      <span className="flex items-center gap-2 text-xs text-muted-foreground"><span className={`size-2 rounded-full ${ai.data?.configured ? "bg-success" : "bg-warning"}`} />{ai.data?.configured ? "AI connected" : "AI key needed"}</span>
    </PageHeader>
    {!project && <div className="mb-6 grid grid-cols-3 gap-4 border-y py-4">{[["Projects",projects?.length ?? 0],["Translated pages",translated],["Output language",settings.targetLang]].map(([label,value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>)}</div>}
    {project && <div className="mb-4 flex flex-wrap items-center gap-3"><Input aria-label="Project name" className="max-w-xs" disabled={busy} value={project.name} onChange={e => { project.name = e.target.value; refresh(); }} onBlur={() => { saveProject(project).catch(e => toast.error(String(e))); }} /><Button variant="ghost" disabled={busy} onClick={() => { setProject(undefined); setPageId(undefined); setError(""); }}><FolderOpen />New project</Button><span className="text-xs text-muted-foreground">{project.pages.filter(p => p.status === "done").length} / {project.pages.length} translated</span></div>}
    <div className={!project ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px]" : ""}>
      <div>
        <Dropzone onFiles={upload} busy={uploading || busy} compact={Boolean(project)} />
        {uploading && <div className="mt-3"><ProgressBar value={uploadProgress} /><p className="mt-2 text-xs">Preparing pages · {uploadProgress}%</p></div>}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-36 flex-1 text-xs text-muted-foreground">Source language<select aria-label="Source language" disabled={busy} value={project?.sourceLang ?? settings.sourceLang} onChange={e => { if (project) { project.sourceLang=e.target.value; refresh(); } else updateSettings({sourceLang:e.target.value}); }} className="mt-1 w-full rounded-md border bg-background p-2 text-sm text-foreground">{SOURCE_LANGS.map(l => <option key={l}>{l}</option>)}</select></label>
          <label className="min-w-32 flex-1 text-xs text-muted-foreground">Translate into<select aria-label="Target language" disabled={busy} value={project?.targetLang ?? settings.targetLang} onChange={e => { if(project) { project.targetLang=e.target.value; refresh(); } else updateSettings({targetLang:e.target.value}); }} className="mt-1 w-full rounded-md border bg-background p-2 text-sm text-foreground">{TARGET_LANGS.map(l => <option key={l}>{l}</option>)}</select></label>
          <Button variant="outline" disabled={!project?.pages.some(p => !p.ocrComplete) || busy || uploading || !ai.data?.configured} onClick={() => run(true)}>Detect text</Button>
          <Button size="lg" disabled={!project?.pages.some(p => p.status !== "done") || busy || uploading || !ai.data?.configured} onClick={() => run()}>{busy ? <Loader2 className="animate-spin" /> : <Play />}{busy ? "Translating…" : "Translate pages"}</Button>
          {busy && <Button variant="outline" onClick={() => { stop.current=true; setMessage("Stopping after this page…"); }}><Square />Stop queue</Button>}
          {project?.pages.some(p => p.status === "done") && <Button variant="outline" disabled={busy} onClick={zip}><Download />ZIP</Button>}
        </div>
      </div>
      {!project && <div className="hidden lg:block"><img src={sample} alt="Sample Chinese manhua page" width={768} height={1024} className="max-h-60 w-full rounded-lg object-cover object-top" /><Button variant="outline" className="mt-3 w-full" disabled={uploading} onClick={async () => { try { const blob = await fetch(sample).then(r => r.blob()); await upload([new File([blob],"sample-manhua.jpg",{type:"image/jpeg"})]); } catch(e) { toast.error(String(e)); } }}><FileImage />Use sample page</Button></div>}
    </div>
    {error && <div role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
    {message && <p role="status" className="mt-3 text-sm text-cyan">{message}</p>}
    {project && <div className="mt-5 flex gap-3 overflow-x-auto pb-2">{project.pages.map(p => <div key={p.id} className="relative w-36 shrink-0 rounded-lg border bg-card p-2"><Button variant="ghost" className="h-auto w-full flex-col p-0" aria-label={`Open ${p.name}`} disabled={busy} onClick={() => setPageId(p.id)}><img src={p.thumb} alt={p.name} className="h-24 w-full rounded object-cover object-top" /><span className="w-full truncate text-xs">{p.name}</span><StatusBadge status={p.status} /></Button><div className="mt-2"><ProgressBar value={statusProgress(p.status)} error={p.status === "error"} /></div><Button variant="ghost" size="icon" className="absolute right-2 top-2 bg-background/90" aria-label={`Remove ${p.name}`} disabled={busy} onClick={async () => { project.pages=project.pages.filter(x => x.id!==p.id); if(pageId===p.id) setPageId(project.pages[0]?.id); await saveProject(project); refresh(); }}><Trash2 /></Button></div>)}</div>}
    {project && <details className="mt-5 border-y py-4"><summary className="cursor-pointer font-semibold">Chapter context & shared glossary</summary><div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-sm">Story context<textarea aria-label="Story context" className="mt-2 min-h-24 w-full rounded-md border bg-background p-3" value={project.context ?? ""} onChange={e => { project.context=e.target.value; refresh(); }} onBlur={() => saveProject(project)} /></label><label className="text-sm">Character relationships<textarea aria-label="Character relationships" className="mt-2 min-h-24 w-full rounded-md border bg-background p-3" value={project.relationships ?? ""} onChange={e => { project.relationships=e.target.value; refresh(); }} onBlur={() => saveProject(project)} /></label></div>{project.glossary.map((g,i) => <div key={i} className="mt-2 flex gap-2"><Input aria-label={`Original name ${i+1}`} value={g.source} onChange={e => { g.source=e.target.value; refresh(); }} onBlur={() => saveProject(project)} /><Input aria-label={`Translated name ${i+1}`} value={g.target} onChange={e => { g.target=e.target.value; refresh(); }} onBlur={() => saveProject(project)} /></div>)}<Button variant="outline" className="mt-3" disabled={busy} onClick={() => { project.glossary.push({source:"",target:""}); refresh(); }}>Add glossary entry</Button></details>}
    {page && project && <div className="mt-4 flex flex-wrap gap-2"><label className="flex items-center gap-2 text-sm">Chapter<Input aria-label="Page chapter" value={page.chapter ?? ""} onChange={e => { page.chapter=e.target.value; refresh(); }} onBlur={() => saveProject(project)} /></label><Button variant="outline" disabled={busy || project.pages.indexOf(page) === 0} onClick={async () => { const i=project.pages.indexOf(page); project.pages.splice(i,1); project.pages.splice(i-1,0,page); await saveProject(project); refresh(); }}>Move earlier</Button><Button variant="outline" disabled={busy || project.pages.indexOf(page) === project.pages.length-1} onClick={async () => { const i=project.pages.indexOf(page); project.pages.splice(i,1); project.pages.splice(i+1,0,page); await saveProject(project); refresh(); }}>Move later</Button><span className="self-center text-sm text-muted-foreground">Page {project.pages.indexOf(page)+1}</span></div>}
    {page && project && <ComicEditor key={page.id} page={page} project={project} settings={settings} busy={busy} onSave={() => saveProject(project)} />}
    {!project && <section className="mt-8 border-t pt-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Recent projects</h2><Button asChild variant="ghost" size="sm"><Link to="/history">View history</Link></Button></div>{projects?.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{projects.slice(0,6).map(p => <Button key={p.id} variant="outline" className="h-20 justify-start overflow-hidden" onClick={() => { setProject(p); setPageId(p.pages[0]?.id); }}><img src={p.pages[0]?.thumb} alt="" className="h-14 w-10 rounded object-cover" /><span className="min-w-0 text-left"><span className="block truncate">{p.name}</span><span className="text-xs text-muted-foreground">{p.pages.length} pages · {p.targetLang}</span></span></Button>)}</div> : <p className="text-sm text-muted-foreground">No translations yet.</p>}</section>}
  </div>;
}