# KHMER COMIC AI

Translate manhua, manhwa and manga into Khmer: upload pages, detect text (OCR), translate, remove the original text, render Khmer text, edit, and export.

## How it works

- Everything is stored in your browser (IndexedDB). There is no backend, database or account.
- AI runs in the browser through Google Gemini with **your own free API key**. Create one at https://aistudio.google.com/apikey and paste it on the **Setup** page (`/setup`). The key stays in your browser and is sent only to Google. Free-tier limits are set by Google.
- Use **Project backup** regularly: clearing browser data removes your projects.

## Run locally

```
bun install
bun run dev
bun run test
bun run build
```
