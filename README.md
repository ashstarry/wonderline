# Wonderline source — optional quick drawing

The public frontend defaults to Luna. Visitors may open “Draw sooner” and enable Mercury for faster drawing with potentially less detail and precision. The choice applies to the current browser tab and survives a refresh. Existing pictures, conversations and companions stay in place. Switching is disabled while recording, generating or drawing.

## Build

Use Node.js 22.13 or newer. Run `npm ci`, then `node scripts/export-pages.mjs`. Browser-only output is `work/github-pages/`, supporting both the custom-domain root and the legacy GitHub Pages path. CNAME remains wonderline.fun.

Drawing and speech use the hosted cloud service. Keys are server-only; this archive contains no credentials, host registration, database content, logs, recordings, user pictures or transcripts. Cloud hosting identity is intentionally excluded. The public website does not use a personal computer as a server.

The current public speech paths are /api/speech/english and /api/speech/chinese-clean. They add voice detection and conservative standalone hesitation cleanup without changing ASR models or adding LLM calls. Legacy endpoints remain available for cached clients. Public-origin speech content is not included in research logs; same-origin experimental diagnostics may log recognized words. Audio is not saved by this app. Provider policies are separate.

## Tests

`node --test tests/*.test.mjs` and `npx tsc --noEmit` run offline checks. Historical parity tests also require the source repository's referenced Git commits; a standalone archive does not include Git history. No paid provider calls are part of the offline suite.

Font licenses are in public/fonts. FluidVad and Silero licenses are included alongside the vendored server-only WASM. The browser bundle does not download that model.
