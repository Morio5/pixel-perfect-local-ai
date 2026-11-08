import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setLocalAck, setLocalWebGpu, useLocalSettings } from "@/lib/ai/gemini-key";
import { checkLocalCompat, clearLocalCache, LOCAL_LICENSE_NOTICE, LOCAL_MODEL_LABELS, preloadLocalModels, useLocalState, type ModelState } from "@/lib/ai/local";
import type { LocalModelId } from "@/lib/ai/local-protocol";

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 100 * 1024 * 1024 ? 0 : 1)} MB`;
const IDS: LocalModelId[] = ["detector", "ocr", "translator"];

function Bar({ value }: { value: number }) {
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full bg-cyan transition-all" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} /></div>;
}

function Row({ id, s }: { id: LocalModelId; s: ModelState }) {
  const pct = s.total > 0 ? s.loaded / s.total : s.status === "ready" ? 1 : 0;
  return (
    <div className="text-sm">
      <div className="flex items-center justify-between gap-3">
        <span>{LOCAL_MODEL_LABELS[id]}</span>
        <span className="text-xs text-muted-foreground">
          {s.status === "idle" && "Not loaded"}
          {s.status === "loading" && (s.total > 0 ? `Downloading / loading… ${mb(s.loaded)} of ${mb(s.total)}` : "Loading…")}
          {s.status === "ready" && `Ready${s.device ? ` · ${s.device}` : ""}`}
          {s.status === "error" && "Failed"}
        </span>
      </div>
      <div className="mt-1"><Bar value={pct} /></div>
      {s.status === "error" && s.error && <p role="alert" className="mt-1 text-xs text-destructive">{s.error}</p>}
    </div>
  );
}

/** Setup-page controls for Local Mode: licence confirmation, compatibility, model download/load. */
export function LocalModelPanel() {
  const state = useLocalState();
  const { ack, webgpu } = useLocalSettings();
  const compat = useMemo(() => checkLocalCompat(), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();

  const load = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      await preloadLocalModels();
      setMessage({ ok: true, text: "All on-device models are loaded and cached in this browser." });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 space-y-5">
      <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
        <p className="font-medium">Licence notice</p>
        <p className="mt-1 text-xs text-muted-foreground">{LOCAL_LICENSE_NOTICE}</p>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" aria-label="Confirm non-commercial use" className="mt-1" checked={ack} onChange={(e) => setLocalAck(e.target.checked)} />
          <span>I confirm I use Local Mode only for personal, non-commercial purposes.</span>
        </label>
      </div>

      {!compat.ok && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{compat.reason}</p>}
      {compat.warnings.map((w) => <p key={w} className="flex gap-2 rounded-md border border-warning/40 p-3 text-xs text-muted-foreground"><AlertTriangle className="size-4 shrink-0 text-warning" />{w}</p>)}

      <div className="space-y-3">{IDS.map((id) => <Row key={id} id={id} s={state[id]} />)}</div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" aria-label="Use WebGPU" className="mt-1" checked={webgpu} disabled={!compat.webgpu} onChange={(e) => setLocalWebGpu(e.target.checked)} />
        <span>
          Use WebGPU for OCR when available <span className="text-xs text-muted-foreground">(experimental, larger download; the translator and detector always use WASM). {compat.webgpu ? "WebGPU was detected." : "WebGPU is not available in this browser, so WASM/CPU is used."}</span>
        </span>
      </label>

      <div className="flex flex-wrap gap-3">
        <Button disabled={busy || !compat.ok || !ack} onClick={load}>{busy && <Loader2 className="animate-spin" />}Download &amp; load models</Button>
        <Button variant="outline" disabled={busy} onClick={async () => { await clearLocalCache(); toast.success("Cached models deleted. Reload the page to free memory."); }}><Trash2 />Clear cached models</Button>
        <Button asChild variant="ghost"><Link to="/">Open translation studio</Link></Button>
      </div>
      {message && <p role={message.ok ? "status" : "alert"} className={`flex items-center gap-2 text-sm ${message.ok ? "text-success" : "text-destructive"}`}>{message.ok && <CheckCircle2 className="size-4" />}{message.text}</p>}
      <p className="text-xs text-muted-foreground">
        The first run downloads the models (the detector is about 11 MB; the OCR and translation models are much larger, so use Wi-Fi) and stores them in this browser, so later runs do not download again.
        Local Mode reads Japanese manga only. It translates line by line, so glossary, style and story-context settings do not apply, and quality is lower than Gemini.
      </p>
    </div>
  );
}

/** Shown at the top of the workspace in Local Mode: licence prompt, model download progress or errors. */
export function LocalProgressBanner() {
  const state = useLocalState();
  const { ack } = useLocalSettings();
  if (!ack) {
    return (
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
        <p>Local Mode needs a one-time licence confirmation. <Link to="/setup" className="text-cyan underline">Open AI connection</Link>.</p>
      </div>
    );
  }
  const loading = IDS.filter((id) => state[id].status === "loading");
  const failed = IDS.filter((id) => state[id].status === "error");
  if (!loading.length && !failed.length) return null;
  return (
    <div className="mb-6 space-y-3 rounded-xl border p-4 text-sm" role="status">
      {loading.map((id) => <Row key={id} id={id} s={state[id]} />)}
      {failed.map((id) => <Row key={id} id={id} s={state[id]} />)}
      {failed.length > 0 && <p className="text-xs text-muted-foreground">Check <Link to="/setup" className="text-cyan underline">AI connection</Link> to retry, or switch to Gemini/Groq.</p>}
    </div>
  );
}
