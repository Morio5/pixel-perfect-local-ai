import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Copy, Download, FileText, ImagePlus, Loader2, Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dropzone, PageHeader, ProgressBar, StatusBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { chapterProgress, chaptersOf, deleteSeries, duplicateSeries, makeCover, mergeGlossary, nextUnfinishedPage, reorderChapters, saveSeries, useLibrary } from "@/lib/library";
import { createPage, exportZip } from "@/lib/pipeline";
import { exportPdf } from "@/lib/pdf-export";
import { downloadBlob } from "@/lib/image/canvas";
import { expandUploads } from "@/lib/uploads";
import { deleteProject, saveProject, uid } from "@/lib/storage";
import { SOURCE_LANGS, TARGET_LANGS, TRANSLATION_STYLES, useSettings } from "@/lib/settings";
import { pageMeta } from "@/lib/meta";
import type { Project, Series } from "@/lib/types";

export const Route = createFileRoute("/library/$seriesId")({
  head: () => pageMeta("Comic project", "Chapters, pages, shared glossary and translation memory for a comic project."),
  component: SeriesPage,
});

const field = "mt-1 w-full rounded-md border bg-background p-2 text-sm text-foreground";

function SeriesPage() {
  const { seriesId } = Route.useParams();
  const lib = useLibrary(), navigate = useNavigate(), settings = useSettings();
  const [chapterId, setChapterId] = useState<string>();
  const [editing, setEditing] = useState(false), [importing, setImporting] = useState(""), [exporting, setExporting] = useState("");
  const [draft, setDraft] = useState<Series>();
  const coverInput = useRef<HTMLInputElement>(null);
  const series = lib?.series.find((s) => s.id === seriesId);
  const chapters = useMemo(() => (lib ? chaptersOf(seriesId, lib.chapters) : []), [lib, seriesId]);
  const chapter = chapters.find((c) => c.id === chapterId) ?? chapters[0];

  if (!lib) return <p>Loading project…</p>;
  if (!series) return <div className="py-12 text-center"><p className="mb-4">This project was not found on this device.</p><Button asChild><Link to="/library">Back to library</Link></Button></div>;

  const save = async (patch: Partial<Series>) => { try { await saveSeries({ ...series, ...patch }); } catch (e) { toast.error(String(e)); } };

  const importChapter = async (files: File[]) => {
    if (importing) return;
    setImporting("Reading files…");
    try {
      const pages = await expandUploads(files);
      const zipName = files.length === 1 && /\.zip$/i.test(files[0]?.name ?? "") ? files[0]?.name.replace(/\.zip$/i, "") : undefined;
      const c: Project = { id: uid(), name: zipName ?? `Chapter ${chapters.length + 1}`, createdAt: Date.now(), updatedAt: Date.now(), sourceLang: series.sourceLang, targetLang: series.targetLang, glossary: [], pages: [], seriesId, chapterNumber: chapters.length + 1 };
      for (let i = 0; i < pages.length; i++) {
        const f = pages[i]; if (!f) continue;
        setImporting(`Preparing page ${i + 1}/${pages.length}`);
        c.pages.push(await createPage(f));
      }
      await saveProject(c);
      setChapterId(c.id);
      toast.success(`Imported ${c.pages.length} pages into “${c.name}”`);
    } catch (e) { toast.error(`Import failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setImporting(""); }
  };
  const move = async (i: number, d: -1 | 1) => { for (const c of reorderChapters(chapters, i, d)) await saveProject(c); };
  const rename = async (c: Project) => { const name = window.prompt("Chapter name", c.name)?.trim(); if (name) { c.name = name; await saveProject(c); } };
  const removeChapter = async (c: Project) => {
    if (!window.confirm(`Delete “${c.name}” and its ${c.pages.length} pages from this device?`)) return;
    await deleteProject(c.id);
    const rest = chapters.filter((x) => x.id !== c.id);
    rest.forEach((x, i) => (x.chapterNumber = i + 1));
    for (const x of rest) await saveProject(x);
  };
  const doExport = async (c: Project, kind: "zip" | "zip-all" | "pdf") => {
    setExporting(kind);
    try {
      const pr = chapterProgress(c);
      if (kind === "pdf") downloadBlob(await exportPdf(c), `${c.name}.pdf`);
      else downloadBlob(await exportZip(c, settings, undefined, kind === "zip-all"), `${c.name}${kind === "zip-all" ? "-complete" : ""}.zip`);
      if (kind !== "zip-all" && pr.done < pr.total) toast.warning(`${pr.total - pr.done} untranslated page(s) were left out.`);
    } catch (e) { toast.error(`Export failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setExporting(""); }
  };

  const all = chapters.flatMap((c) => c.pages), doneAll = all.filter((p) => p.status === "done").length;
  const resumeChapter = chapters.find((c) => nextUnfinishedPage(c.pages));
  const d = draft ?? series;

  return (
    <div className="mx-auto max-w-[1500px]">
      <Link to="/library" className="text-sm text-muted-foreground hover:text-foreground">← Library</Link>
      <div className="mb-6 mt-3 flex flex-col gap-6 md:flex-row">
        <button type="button" aria-label="Change cover" className="group relative aspect-[2/3] w-36 shrink-0 overflow-hidden rounded-xl border bg-muted" onClick={() => coverInput.current?.click()}>
          {series.cover ?? chapters[0]?.pages[0]?.thumb ? <img src={series.cover ?? chapters[0]?.pages[0]?.thumb} alt={`${series.title} cover`} className="size-full object-cover object-top" /> : <BookOpen className="m-auto size-10 text-muted-foreground" />}
          <span className="absolute inset-x-0 bottom-0 bg-background/80 py-1 text-xs opacity-0 transition group-hover:opacity-100">Change cover</span>
        </button>
        <input ref={coverInput} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; try { await save({ cover: await makeCover(f) }); } catch (err) { toast.error(String(err)); } }} />
        <div className="min-w-0 flex-1">
          {!editing ? <>
            <PageHeader title={series.title} subtitle={[series.author, series.status, ...series.tags].filter(Boolean).join(" · ") || "Project"} />
            {series.description && <p className="-mt-2 mb-3 max-w-2xl text-sm text-muted-foreground">{series.description}</p>}
            <p className="text-sm">{chapters.length} chapters · {doneAll}/{all.length} pages translated · {series.sourceLang} → {series.targetLang} · {series.translationStyle}</p>
            <div className="mt-2 max-w-md"><ProgressBar value={all.length ? Math.round((doneAll / all.length) * 100) : 0} /></div>
            <div className="mt-4 flex flex-wrap gap-2">
              {resumeChapter && <Button asChild><Link to="/workspace/$projectId" params={{ projectId: resumeChapter.id }}><Play />Continue {resumeChapter.name}</Link></Button>}
              <Button variant="outline" onClick={() => { setDraft(structuredClone(series)); setEditing(true); }}><Pencil />Edit details</Button>
              <Button variant="outline" onClick={async () => { try { const c = await duplicateSeries(series.id); toast.success("Project duplicated"); navigate({ to: "/library/$seriesId", params: { seriesId: c.id } }); } catch (e) { toast.error(String(e)); } }}><Copy />Duplicate</Button>
              <Button variant="ghost" onClick={async () => {
                if (!window.confirm(`Delete project “${series.title}”?`)) return;
                const withChapters = chapters.length > 0 && window.confirm(`Also delete its ${chapters.length} chapter(s) and pages? Press Cancel to keep them as unsorted chapters.`);
                await deleteSeries(series.id, withChapters); navigate({ to: "/library" });
              }}><Trash2 />Delete</Button>
            </div>
          </> : <form className="grid max-w-3xl gap-3 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); if (!d.title.trim()) { toast.error("Title is required"); return; } await save({ ...d, title: d.title.trim().slice(0, 200), glossary: mergeGlossary([], d.glossary) }); setEditing(false); setDraft(undefined); }}>
            <label className="text-xs text-muted-foreground sm:col-span-2">Title<Input className="mt-1" maxLength={200} value={d.title} onChange={(e) => setDraft({ ...d, title: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground sm:col-span-2">Description<Textarea className="mt-1" maxLength={4000} value={d.description} onChange={(e) => setDraft({ ...d, description: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">Author<Input className="mt-1" maxLength={200} value={d.author} onChange={(e) => setDraft({ ...d, author: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">Status<select className={field} value={d.status} onChange={(e) => setDraft({ ...d, status: e.target.value as Series["status"] })}><option value="ongoing">Ongoing</option><option value="completed">Completed</option><option value="hiatus">Hiatus</option></select></label>
            <label className="text-xs text-muted-foreground sm:col-span-2">Tags (comma separated)<Input className="mt-1" value={d.tags.join(", ")} onChange={(e) => setDraft({ ...d, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20) })} /></label>
            <label className="text-xs text-muted-foreground">Source language<select className={field} value={d.sourceLang} onChange={(e) => setDraft({ ...d, sourceLang: e.target.value })}>{SOURCE_LANGS.map((l) => <option key={l}>{l}</option>)}</select></label>
            <label className="text-xs text-muted-foreground">Translate into<select className={field} value={d.targetLang} onChange={(e) => setDraft({ ...d, targetLang: e.target.value })}>{TARGET_LANGS.map((l) => <option key={l}>{l}</option>)}</select></label>
            <label className="text-xs text-muted-foreground">Translation style (remembered for all chapters)<select className={field} value={d.translationStyle} onChange={(e) => setDraft({ ...d, translationStyle: e.target.value })}>{TRANSLATION_STYLES.map((l) => <option key={l}>{l}</option>)}</select></label>
            <div className="flex items-end gap-2"><Button type="submit">Save</Button><Button type="button" variant="ghost" onClick={() => { setEditing(false); setDraft(undefined); }}>Cancel</Button></div>
          </form>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <h2 className="font-semibold">Chapters</h2>
          <div className="space-y-1">
            {chapters.length === 0 && <p className="text-sm text-muted-foreground">No chapters yet. Import images or a ZIP below.</p>}
            {chapters.map((c, i) => { const pr = chapterProgress(c); return (
              <div key={c.id} className={`rounded-lg border p-2 ${c.id === chapter?.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"}`}>
                <button type="button" className="w-full text-left" onClick={() => setChapterId(c.id)}>
                  <span className="mr-2 text-xs text-muted-foreground">#{c.chapterNumber ?? i + 1}</span><span className="text-sm font-medium">{c.name}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{pr.done}/{pr.total} pages{pr.failed ? ` · ${pr.failed} failed` : ""}</span>
                  <span className="mt-1 block"><ProgressBar value={pr.pct} error={pr.failed > 0} /></span>
                </button>
                {c.id === chapter?.id && <div className="mt-2 flex gap-1">
                  <Button size="icon" variant="ghost" aria-label="Move chapter up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                  <Button size="icon" variant="ghost" aria-label="Move chapter down" disabled={i === chapters.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                  <Button size="icon" variant="ghost" aria-label="Rename chapter" onClick={() => rename(c)}><Pencil /></Button>
                  <Button size="icon" variant="ghost" aria-label="Delete chapter" onClick={() => removeChapter(c)}><Trash2 /></Button>
                </div>}
              </div>
            ); })}
          </div>
          <Dropzone onFiles={importChapter} busy={Boolean(importing)} compact />
          {importing && <p className="text-xs text-muted-foreground">{importing}</p>}
          <details className="border-t pt-3">
            <summary className="cursor-pointer text-sm font-semibold">Shared glossary ({series.glossary.length})</summary>
            <p className="my-2 text-xs text-muted-foreground">Names used in every chapter. New names found while translating are added automatically.</p>
            {series.glossary.map((g, i) => <div key={`${g.source}-${i}`} className="mb-1 flex gap-1">
              <Input aria-label={`Original name ${i + 1}`} defaultValue={g.source} onBlur={(e) => { const gl = [...series.glossary]; gl[i] = { ...g, source: e.target.value }; save({ glossary: gl.filter((x) => x.source.trim()) }); }} />
              <Input aria-label={`Translated name ${i + 1}`} className="font-khmer" defaultValue={g.target} onBlur={(e) => { const gl = [...series.glossary]; gl[i] = { ...g, target: e.target.value }; save({ glossary: gl }); }} />
              <Button size="icon" variant="ghost" aria-label="Remove name" onClick={() => save({ glossary: series.glossary.filter((_, j) => j !== i) })}><Trash2 /></Button>
            </div>)}
            <form className="mt-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const s = String(f.get("s") ?? "").trim(), t = String(f.get("t") ?? "").trim(); if (s && t) { save({ glossary: mergeGlossary(series.glossary, [{ source: s, target: t }]) }); e.currentTarget.reset(); } }}>
              <Input name="s" placeholder="Original" aria-label="New original name" /><Input name="t" placeholder="Khmer" aria-label="New translated name" className="font-khmer" /><Button type="submit" variant="outline">Add</Button>
            </form>
          </details>
          <details className="border-t pt-3">
            <summary className="cursor-pointer text-sm font-semibold">Translation memory ({series.memory.length})</summary>
            <div className="mt-2 max-h-72 space-y-2 overflow-auto">
              {series.memory.length === 0 && <p className="text-xs text-muted-foreground">Translated lines are saved here automatically.</p>}
              {[...series.memory].reverse().slice(0, 300).map((m) => <div key={m.source} className="border-b pb-1 text-xs">
                <p className="text-muted-foreground">{m.source}</p><p className="font-khmer">{m.target}</p>
                {m.history.length > 0 && <p className="text-muted-foreground">Earlier: {m.history.join(" · ")}</p>}
              </div>)}
            </div>
          </details>
        </aside>

        <section className="min-w-0">
          {!chapter ? <div className="grid place-items-center rounded-xl border border-dashed py-20 text-muted-foreground"><ImagePlus className="mb-3 size-8" />Import a chapter to see its pages.</div> : <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-lg font-semibold">#{chapter.chapterNumber} {chapter.name}</h2>
              <Button asChild><Link to="/workspace/$projectId" params={{ projectId: chapter.id }}><Play />{nextUnfinishedPage(chapter.pages) ? (chapterProgress(chapter).done ? "Resume" : "Translate") : "Open"}</Link></Button>
              <Button variant="outline" disabled={Boolean(exporting) || !chapterProgress(chapter).done} onClick={() => doExport(chapter, "zip")}>{exporting === "zip" ? <Loader2 className="animate-spin" /> : <Download />}Translated ZIP</Button>
              <Button variant="outline" disabled={Boolean(exporting) || !chapter.pages.length} onClick={() => doExport(chapter, "zip-all")}>{exporting === "zip-all" ? <Loader2 className="animate-spin" /> : <Download />}Complete ZIP</Button>
              <Button variant="outline" disabled={Boolean(exporting) || !chapterProgress(chapter).done} onClick={() => doExport(chapter, "pdf")}>{exporting === "pdf" ? <Loader2 className="animate-spin" /> : <FileText />}PDF</Button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">Complete ZIP includes every page in order; untranslated pages are added as untouched originals.</p>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-7">
              {chapter.pages.map((p, i) => <Link key={p.id} to="/workspace/$projectId" params={{ projectId: chapter.id }} className="group overflow-hidden rounded-lg border bg-card hover:border-primary">
                <div className="aspect-[2/3] bg-muted"><img src={p.thumb} alt={`Page ${i + 1}`} className="size-full object-cover object-top" loading="lazy" /></div>
                <div className="space-y-1 p-1.5"><p className="truncate text-xs"><span className="text-muted-foreground">{i + 1}.</span> {p.name}</p><StatusBadge status={p.status} /></div>
              </Link>)}
            </div>
          </>}
        </section>
      </div>
    </div>
  );
}
