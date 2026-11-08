import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared";
import { FONTS, SOURCE_LANGS, TARGET_LANGS, TRANSLATION_STYLES, updateSettings, useSettings } from "@/lib/settings";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { pageMeta } from "@/lib/meta";

export const Route = createFileRoute("/settings")({
  head: () => pageMeta("Translation settings", "Set comic translation languages, Khmer typography, image format and appearance."),
  component: SettingsPage,
});

function SettingsPage() {
  const s = useSettings();
  const selectClass = "mt-2 w-full rounded-md border bg-background p-2.5 text-sm";
  return <div className="max-w-3xl"><PageHeader title="Settings" subtitle="Translation defaults" /><section className="border-y py-6"><h2 className="mb-5 font-semibold">Languages</h2><div className="grid gap-5 sm:grid-cols-2"><label className="text-sm">Source language<select className={selectClass} value={s.sourceLang} onChange={e => updateSettings({sourceLang:e.target.value})}>{SOURCE_LANGS.map(l => <option key={l}>{l}</option>)}</select></label><label className="text-sm">Target language<select className={selectClass} value={s.targetLang} onChange={e => updateSettings({targetLang:e.target.value})}>{TARGET_LANGS.map(l => <option key={l}>{l}</option>)}</select></label></div></section>
    <section className="border-b py-6"><h2 className="mb-5 font-semibold">Khmer typography</h2><div className="grid gap-5 sm:grid-cols-2"><label className="text-sm">Dialogue font<select className={selectClass} value={s.font} onChange={e => updateSettings({font:e.target.value})}>{FONTS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label><label className="text-sm">Sound effects font<select className={selectClass} value={s.sfxFont} onChange={e => updateSettings({sfxFont:e.target.value})}>{FONTS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label><label className="text-sm">Default size<Input className="mt-2" type="number" placeholder="Auto-fit" min={8} max={300} value={s.fontSize ?? ""} onChange={e => updateSettings({fontSize:e.target.value ? Math.max(8,Number(e.target.value)) : null})} /></label></div><p className="mt-5 border-l-2 border-cyan pl-4 font-khmer text-xl">សួស្តី! តោះយើងទៅជាមួយគ្នា។</p></section>
    <section className="border-b py-6"><h2 className="mb-4 font-semibold">Translation style</h2><select aria-label="Translation mode" className={selectClass} value={s.translationStyle} onChange={e => updateSettings({translationStyle:e.target.value as typeof s.translationStyle})}>{TRANSLATION_STYLES.map(style => <option key={style}>{style}</option>)}</select><label className="mt-4 block text-sm">Additional instructions<Textarea aria-label="Translation style" className="mt-2" value={s.style} onChange={e => updateSettings({style:e.target.value})} /></label></section>
    <section className="border-b py-6"><h2 className="mb-4 font-semibold">Translation speed</h2><select aria-label="Translation speed" className={selectClass} value={s.speed} onChange={e => updateSettings({speed:e.target.value as typeof s.speed})}><option value="fast">Fast (2 AI calls per page, no extra thinking)</option><option value="quality">Quality (extra proofreading pass, slower)</option></select><p className="mt-2 text-xs text-muted-foreground">Fast is best for free keys and long chapters. Quality takes noticeably longer but checks Khmer grammar and idioms more carefully.</p></section>
    <section className="border-b py-6"><h2 className="mb-5 font-semibold">Image export</h2><div className="grid gap-5 sm:grid-cols-2"><label className="text-sm">Format<select className={selectClass} value={s.format} onChange={e => updateSettings({format:e.target.value as typeof s.format})}><option value="png">PNG</option><option value="jpeg">JPG</option><option value="webp">WEBP</option></select></label><label className="text-sm">JPG / WEBP quality · {Math.round(s.quality*100)}%<input aria-label="Export quality" type="range" min={.5} max={1} step={.01} disabled={s.format === "png"} value={s.quality} onChange={e => updateSettings({quality:Number(e.target.value)})} className="mt-4 w-full accent-primary" /></label></div></section>
    <section className="flex items-center justify-between py-6"><h2 className="font-semibold">Light appearance</h2><Switch aria-label="Light appearance" checked={s.theme === "light"} onCheckedChange={v => updateSettings({theme:v ? "light" : "dark"})} /></section>
  </div>;
}
