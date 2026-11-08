import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, useAiStatus } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clearGeminiKey, clearGroqKey, DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL, setGeminiKey, setGeminiModel, setGroqKey, setGroqModel, setProvider, useGeminiStatus, type Provider } from "@/lib/ai/gemini-key";
import { testGeminiKey } from "@/lib/ai/gemini";
import { pageMeta } from "@/lib/meta";
import { LocalModelPanel } from "@/components/LocalModelPanel";

export const Route = createFileRoute("/setup")({
  head: () => pageMeta("AI connection", "Connect your own free Gemini API key to detect and translate comic text."),
  component: Setup,
});

function Setup() {
  const { data } = useAiStatus();
  const { provider } = useGeminiStatus();
  const isGroq = provider === "groq";
  const isLocal = provider === "local";
  const label = isGroq ? "Groq" : "Gemini";
  const defaultModel = isGroq ? DEFAULT_GROQ_MODEL : DEFAULT_GEMINI_MODEL;
  const saveKey = (v: string) => (isGroq ? setGroqKey(v) : setGeminiKey(v));
  const saveModel = (v: string) => (isGroq ? setGroqModel(v) : setGeminiModel(v));
  const [key, setKey] = useState("");
  const [model, setModel] = useState(data.model);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string }>();

  const save = () => {
    if (key.trim()) saveKey(key);
    saveModel(model || defaultModel);
    setKey("");
    setResult(undefined);
    toast.success("Saved in this browser");
  };
  const test = async () => {
    if (key.trim()) saveKey(key);
    saveModel(model || defaultModel);
    setKey("");
    setTesting(true);
    setResult(undefined);
    try {
      await testGeminiKey();
      setResult({ ok: true, message: "Connected. Your key works." });
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="AI connection" subtitle="KHMER COMIC AI" />
      <section className="border-y py-6">
        <div className="flex items-center gap-3">
          {data.configured ? <CheckCircle2 className="size-6 text-success" /> : <AlertTriangle className="size-6 text-warning" />}
          <h2 className="font-semibold">{isLocal ? (data.configured ? "Local Mode (on-device, no API key)" : "Local Mode needs a licence confirmation") : data.configured ? `${label} key saved in this browser` : `No ${label} key yet`}</h2>
        </div>
        <label className="mt-4 block text-sm">AI provider
          <select aria-label="AI provider" className="mt-2 w-full rounded-md border bg-background p-2.5 text-sm sm:w-64" value={provider} onChange={(e) => { setProvider(e.target.value as Provider); setResult(undefined); setKey(""); setModel(e.target.value === "groq" ? (localStorage.getItem("kca-groq-model") || DEFAULT_GROQ_MODEL) : e.target.value === "local" ? "" : (localStorage.getItem("kca-gemini-model") || DEFAULT_GEMINI_MODEL)); }}>
            <option value="gemini">Google Gemini</option>
            <option value="groq">Groq</option>
            <option value="local">Local (on-device, no API key)</option>
          </select>
        </label>
        {isLocal ? <LocalModelPanel /> : <>
        {isGroq && <p className="mt-3 rounded-md border border-warning/40 p-3 text-xs text-muted-foreground">Groq models are not specialised for comic OCR or Khmer. Text boxes may be placed less accurately and Khmer translations may be weaker than with Gemini. Groq's free tier also has a small per-minute token limit (8,000 tokens/min at the time of writing), so image pages may hit rate limits. Test on one page before a whole chapter.</p>}
        <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Open{" "}
            <a className="inline-flex items-center gap-1 text-cyan underline" href={isGroq ? "https://console.groq.com/keys" : "https://aistudio.google.com/apikey"} target="_blank" rel="noreferrer">
              {isGroq ? "Groq Console" : "Google AI Studio"} <ExternalLink className="size-3" />
            </a>{" "}
            and sign in.
          </li>
          <li>Create an API key (check the provider's page for current free-tier terms).</li>
          <li>Paste it below and press “Test connection”.</li>
        </ol>
        <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
          <label className="text-sm">
            {label} API key
            <Input aria-label={`${label} API key`} className="mt-2" type="password" autoComplete="off" spellCheck={false} placeholder={data.configured ? "•••••••• (saved) — paste a new key to replace" : isGroq ? "gsk_…" : "AIza…"} value={key} onChange={(e) => setKey(e.target.value)} />
          </label>
          <label className="text-sm">
            Model
            <Input aria-label={`${label} model`} className="mt-2" value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button disabled={testing || (!key.trim() && !data.configured)} onClick={test}>
            {testing && <Loader2 className="animate-spin" />}Test connection
          </Button>
          <Button variant="outline" disabled={testing} onClick={save}>Save</Button>
          {data.configured && (
            <Button variant="ghost" disabled={testing} onClick={() => { (isGroq ? clearGroqKey() : clearGeminiKey()); setResult(undefined); toast.success("Key removed from this browser"); }}>
              <Trash2 />Remove key
            </Button>
          )}
          <Button asChild variant="ghost"><Link to="/">Open translation studio</Link></Button>
        </div>
        {result && (
          <p role={result.ok ? "status" : "alert"} className={`mt-3 text-sm ${result.ok ? "text-success" : "text-destructive"}`}>
            {result.message}
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Default model: {defaultModel}. If the provider renames or retires a model, type another name here. Groq needs a model with image input for OCR.
        </p>
        </>}
      </section>
      <section className="border-b py-6">
        <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-5 text-cyan" />Free limits & privacy</h2>
        <div className="mt-4 space-y-3 text-sm text-muted-foreground">
          {isLocal ? <p>Local Mode runs the AI models inside this browser. Your pages and text are not sent to any AI service; only the model files are downloaded once (from Hugging Face) and cached on this device.</p> : <>
          <p>Your key stays in this browser and is sent only to Google. This site never sees it and never pays for your usage.</p>
          <p>Google’s free tier has per-minute and per-day limits, so a long chapter may pause or stop for the day. The app waits between requests and retries automatically; if the daily limit is reached, continue tomorrow.</p>
          <p>On the free tier, Google may use what you send (comic pages and extracted text) to improve its products. Do not upload material you are not allowed to share.</p>
          </>}
          <p>Projects and original images are saved only in this browser. Clearing browser data removes them, so use Project backup regularly.</p>
          <p>Text removal uses on-device surrounding-pixel filling, not AI artwork reconstruction. Detailed backgrounds may need manual correction.</p>
        </div>
      </section>
    </div>
  );
}
