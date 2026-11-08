# KHMER COMIC AI

Static-friendly TanStack Start + React app that translates comics into Khmer.

- Everything is stored in the browser (IndexedDB). There is no backend, no accounts and no database.
- Local Mode (on-device Manga OCR + NLLB, non-commercial licence) lives in `src/lib/ai/local*.ts`; see LOCAL_MODE.md.
- AI runs in the browser through Google Gemini with each user's own API key (`src/lib/ai/gemini*.ts`, key kept in localStorage). Do not add a shared server-side AI key.
- Run `bun run test` before committing.
