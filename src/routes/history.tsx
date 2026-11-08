import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { FolderOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteProject, useProjects } from "@/lib/storage";
import { pageMeta } from "@/lib/meta";
import { toast } from "sonner";

export const Route = createFileRoute("/history")({
  head: () => pageMeta("Translation history", "Reopen, preview and manage comic translations saved on this device."),
  component: History,
});

function History() {
  const projects = useProjects(), [search,setSearch] = useState("");
  return <div><PageHeader title="Translation history" subtitle="Saved on this device" /><Input aria-label="Search projects" placeholder="Search projects…" className="mb-6 max-w-md" value={search} onChange={e => setSearch(e.target.value)} />
    {projects === null ? <p>Loading projects…</p> : projects.length === 0 ? <div className="border-t py-12 text-center"><FolderOpen className="mx-auto mb-4 size-10 text-muted-foreground" /><p className="mb-4 text-muted-foreground">No saved projects yet.</p><Button asChild><Link to="/">Upload comic pages</Link></Button></div> : <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{projects.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).map(p => <article key={p.id} className="overflow-hidden rounded-lg border bg-card"><img src={p.pages[0]?.thumb} alt={p.name} className="h-44 w-full object-cover object-top" /><div className="p-4"><h2 className="truncate font-semibold">{p.name}</h2><p className="mt-1 text-xs text-muted-foreground">{p.pages.filter(p => p.status === "done").length} / {p.pages.length} translated · {p.targetLang}</p><p className="mt-2 text-xs text-muted-foreground">{new Date(p.updatedAt).toLocaleDateString()}</p><div className="mt-4 flex justify-between"><Button asChild variant="outline"><Link to="/workspace/$projectId" params={{projectId:p.id}}><FolderOpen />Open project</Link></Button><Button variant="ghost" size="icon" aria-label={`Delete ${p.name}`} title="Delete project" onClick={async () => { if (window.confirm(`Delete “${p.name}” and its pages from this device?`)) { try { await deleteProject(p.id); } catch(e) { toast.error(String(e)); } } }}><Trash2 /></Button></div></div></article>)}</div>}
  </div>;
}
