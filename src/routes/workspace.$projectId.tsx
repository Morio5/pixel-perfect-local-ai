import { createFileRoute } from "@tanstack/react-router";
import { ComicWorkspace } from "@/components/ComicWorkspace";
import { pageMeta } from "@/lib/meta";

export const Route = createFileRoute("/workspace/$projectId")({
  head: () => pageMeta("Translation workspace", "Edit Khmer comic dialogue, compare original artwork and export translated images."),
  component: Workspace,
});
function Workspace() {
  const { projectId } = Route.useParams();
  return <ComicWorkspace projectId={projectId} />;
}