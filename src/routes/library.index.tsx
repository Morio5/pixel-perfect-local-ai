import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BookOpen, FolderPlus, Library as LibraryIcon } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, ProgressBar } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chapterProgress, chaptersOf, newSeries, renumber, saveSeries, useLibrary } from "@/lib/library";
import { saveProject } from "@/lib/storage";
import { getSettings } from "@/lib/settings";
import { pageMeta } from "@/lib/meta";

export const Route = createFileRoute("/library/")({
  head: () => pageMeta("Comic library", "Organize comic translation projects, chapters and pages in one library."),
  component: LibraryPage,
});

type Sort = "updated" | "title" | "progress" | "created";

function LibraryPage() {
  const lib = useLibrary(), navigate = useNavigate();
  const [q, setQ] = useState(""), [sort, setSort] = useState<Sort>("updated");
  const cards = useMemo(() => {
    if (!lib) return [];
    return lib.series.map((s) => {
      const chs = chaptersOf(s.id, lib.chapters);
      const pages = chs.flatMap((c) => c.pages);
      const done = pages.filter((p) => p.status === "done").length;
      const last = Math.max(s.updatedAt, ...chs.map((c) => c.updatedAt));
      return { s, chs, done, total: pages.length, last, cover: s.cover ?? chs[0]?.pages[0]?.thumb };
    })
      .filter(({ s }) => [s.title, s.author, s.description, ...s.tags].join(" ").toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => sort === "title" ? a.s.title.localeCompare(b.s.title) : sort === "created" ? b.s.createdAt - a.s.createdAt : sort === "progress" ? b.done / (b.total || 1) - a.done / (a.total || 1) : b.last - a.last);
  }, [lib, q, sort]);
  const unsorted = lib?.chapters.filter((c) => !c.seriesId || !lib.series.some((s) => s.id === c.seriesId)) ?? [];

  const create = async () => {
    const st = getSettings();
    const s = newSeries({ sourceLang: st.sourceLang, targetLang: st.targetLang, translationStyle: st.translationStyle });
    await saveSeries(s);
    navigate({ to: "/library/$seriesId", params: { seriesId: s.id } });
  };
  const moveTo = async (chapterId: string, seriesId: string) => {
    if (!lib) return;
    const c = lib.chapters.find((c) => c.id === chapterId);
    if (!c) return;
    c.seriesId = seriesId;
    const list = [...chaptersOf(seriesId, lib.chapters).filter((x) => x.id !== c.id), c];
    renumber(list);
    for (const x of list) await saveProject(x);
    toast.success(`Moved “${c.name}”`);
  };

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="Library" subtitle="Projects & chapters">
        <Button onClick={create}><FolderPlus />New project</Button>
      </PageHeader>
      <div className="mb-6 flex flex-wrap gap-3">
        <Input aria-label="Search library" placeholder="Search title, author, tag…" className="max-w-sm" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Sort projects" className="rounded-md border bg-background px-3 text-sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="updated">Recently updated</option><option value="created">Newest</option><option value="title">Title A–Z</option><option value="progress">Most translated</option>
        </select>
      </div>
      {lib === null ? <p>Loading library…</p> : cards.length === 0 ? (
        <div className="border-y py-14 text-center">
          <LibraryIcon className="mx-auto mb-4 size-10 text-muted-foreground" />
          <p className="mb-4 text-muted-foreground">{q ? "No projects match your search." : "Create a project to organize your chapters."}</p>
          {!q && <Button onClick={create}><FolderPlus />New project</Button>}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {cards.map(({ s, chs, done, total, cover }) => (
            <Link key={s.id} to="/library/$seriesId" params={{ seriesId: s.id }} className="group overflow-hidden rounded-xl border bg-card transition hover:-translate-y-0.5 hover:border-primary">
              <div className="aspect-[2/3] overflow-hidden bg-muted">
                {cover ? <img src={cover} alt={s.title} className="size-full object-cover object-top transition group-hover:scale-105" /> : <div className="grid size-full place-items-center"><BookOpen className="size-10 text-muted-foreground" /></div>}
              </div>
              <div className="space-y-2 p-3">
                <h2 className="truncate font-semibold">{s.title}</h2>
                <p className="text-xs text-muted-foreground">{chs.length} chapter{chs.length === 1 ? "" : "s"} · {done}/{total} pages</p>
                <ProgressBar value={total ? Math.round((done / total) * 100) : 0} />
              </div>
            </Link>
          ))}
        </div>
      )}
      {unsorted.length > 0 && lib && (
        <section className="mt-10 border-t pt-6">
          <h2 className="mb-1 font-semibold">Unsorted chapters</h2>
          <p className="mb-4 text-sm text-muted-foreground">Chapters made before the library. Move them into a project — nothing is changed otherwise.</p>
          <div className="space-y-2">
            {unsorted.map((c) => { const pr = chapterProgress(c); return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 border-b pb-2">
                <img src={c.pages[0]?.thumb} alt="" className="h-12 w-9 rounded object-cover" />
                <Link to="/workspace/$projectId" params={{ projectId: c.id }} className="min-w-0 flex-1 truncate hover:text-primary">{c.name}</Link>
                <span className="text-xs text-muted-foreground">{pr.done}/{pr.total}</span>
                {lib.series.length > 0 && <select aria-label={`Move ${c.name} to project`} className="rounded-md border bg-background p-1.5 text-sm" value="" onChange={(e) => e.target.value && moveTo(c.id, e.target.value)}>
                  <option value="">Move to project…</option>{lib.series.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                </select>}
              </div>
            ); })}
          </div>
        </section>
      )}
    </div>
  );
}
