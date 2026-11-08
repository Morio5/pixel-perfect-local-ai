export function pageMeta(title: string, description: string) {
  return { meta: [
    { title: `${title} — KHMER COMIC AI` },
    { name: "description", content: description },
    { property: "og:title", content: `${title} — KHMER COMIC AI` },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] };
}