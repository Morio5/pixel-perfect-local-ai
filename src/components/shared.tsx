import { Link } from "@tanstack/react-router";
import { AlertTriangle, ImagePlus, Loader2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useGeminiStatus } from "@/lib/ai/gemini-key";
import { LocalProgressBanner } from "@/components/LocalModelPanel";
import type { PageStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Whether this browser has a Gemini API key (bring-your-own-key). */
export function useAiStatus() {
  const { configured, model } = useGeminiStatus();
  return { data: { configured, model }, isFetching: false, error: null, refetch: () => {} };
}

export function SetupBanner() {
  const { data } = useAiStatus();
  const { provider } = useGeminiStatus();
  if (provider === "local") return <LocalProgressBanner />;
  if (!data || data.configured) return null;
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
      <div>
        <p className="font-semibold">Add your free AI API key (Gemini or Groq)</p>
        <p className="text-muted-foreground">
          Translation needs your own API key from Google AI Studio (Gemini) or Groq.{" "}
          <Link to="/setup" className="text-cyan underline">Set it up in 1 minute</Link>.
        </p>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

export function Dropzone({ onFiles, busy, compact }: { onFiles: (f: File[]) => void; busy?: boolean; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => ACCEPT.includes(f.type) || /\.(zip|cbz|jpg|jpeg|png|webp)$/i.test(f.name));
    if (files.length) onFiles(files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
  };
  return (
    <Button
      variant="ghost"
      type="button"
      disabled={busy}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files);
      }}
      className={cn(
        "group flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 text-center transition-all hover:border-primary hover:bg-primary/10",
        compact ? "h-auto whitespace-normal p-6" : "h-auto whitespace-normal p-10 md:p-14",
        over && "scale-[1.01] border-cyan bg-cyan/10",
      )}
    >
      <input ref={ref} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.zip,.cbz" className="hidden" onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
      <span className="grid size-14 place-items-center rounded-2xl bg-gradient-brand shadow-glow transition-transform group-hover:scale-110">
        {busy ? <Loader2 className="size-6 animate-spin text-primary-foreground" /> : <ImagePlus className="size-6 text-primary-foreground" />}
      </span>
      <span className="font-semibold">{busy ? "Preparing pages…" : "Drop comic pages or tap to upload"}</span>
      <span className="text-xs text-muted-foreground">JPG · PNG · WEBP · ZIP · CBZ</span>
    </Button>
  );
}

const LABEL: Record<PageStatus, string> = {
  queued: "Queued",
  detecting: "AI detecting text",
  translating: "Translating",
  erasing: "Erasing original text",
  rendering: "Inserting Khmer",
  done: "Translated",
  error: "Failed",
};
const ORDER: PageStatus[] = ["queued", "detecting", "translating", "erasing", "rendering", "done"];

export function statusProgress(s: PageStatus) {
  if (s === "error") return 100;
  return Math.round((ORDER.indexOf(s) / (ORDER.length - 1)) * 100);
}

export function StatusBadge({ status }: { status: PageStatus }) {
  const active = !["queued", "done", "error"].includes(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        status === "done" && "bg-success/15 text-success",
        status === "error" && "bg-destructive/15 text-destructive",
        status === "queued" && "bg-muted text-muted-foreground",
        active && "bg-primary/15 text-primary",
      )}
    >
      {active && <Loader2 className="size-3 animate-spin" />}
      {LABEL[status]}
    </span>
  );
}

export function ProgressBar({ value, error }: { value: number; error?: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full transition-all duration-500", error ? "bg-destructive" : "bg-gradient-brand")} style={{ width: `${value}%` }} />
    </div>
  );
}
