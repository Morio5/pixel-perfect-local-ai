import { createFileRoute } from "@tanstack/react-router";
import { ComicWorkspace } from "@/components/ComicWorkspace";
import { pageMeta } from "@/lib/meta";

export const Route = createFileRoute("/")({
  head: () => pageMeta("Comic translation studio", "Upload manhua, manga and manhwa, translate dialogue into Khmer, edit text and export comic pages."),
  component: () => <ComicWorkspace />,
});
