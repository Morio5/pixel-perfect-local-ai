import { createFileRoute } from "@tanstack/react-router";
import { ComicWorkspace } from "@/components/ComicWorkspace";
import { pageMeta } from "@/lib/meta";

export const Route = createFileRoute("/batch")({
  head: () => pageMeta("Batch translator", "Translate comic chapters sequentially and download finished pages as a ZIP archive."),
  component: () => <ComicWorkspace batch />,
});
