import {build} from 'vite';
import {copyFile,writeFile,readdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),out=new URL('work/github-pages/',root);
await build({configFile:fileURLToPath(new URL('static-frontend/vite.config.mjs',root))});
for(const folder of ['fonts','demo-narration'])for(const name of await readdir(new URL(`public/${folder}/`,root))){
 await copyFile(new URL(`public/${folder}/${name}`,root),new URL(name,out));
}
for(const name of ['fluidvad-LICENSE.txt','silero-vad-LICENSE.txt']) await copyFile(new URL(`public/vendor/${name}`,root),new URL(name,out));
await copyFile(new URL('public/favicon.svg',root),new URL('favicon.svg',out));
await writeFile(new URL('.nojekyll',out),'');
await writeFile(new URL('CNAME',out),'wonderline.fun\n');
await writeFile(new URL('README.md',out),`# Wonderline · 一笔奇境

Keep talking while your imagination takes shape, stroke by stroke.

[Open the studio](https://wonderline.fun/) · [Cloud studio](https://softspoken-paper-garden.dongyuanshun.chatgpt.site/)

English is the default; choose 简体中文 in the language menu. Luna remains the default drawing model. Open “Draw sooner” to opt into Mercury: faster drawings may have less detail and precision. Switching keeps your current picture and words. Both languages support continuous speech while the picture is being drawn.

Keep and name companions, rename them in My companions, and bring the same friends into another picture. Save drawings and words to your picturebook, replay stories, explore inspiration on a blank page, and move, resize or rotate objects.

[Download the source code](./wonderline-source.zip) · [Release verification](./RELEASE.json)

The repository contains the browser-only GitHub Pages release and a sanitized source archive with application code, tests and build instructions. Speech recognition and drawing generation run in the cloud. No personal computer serves this website. API keys remain on the server and are absent from the frontend and source archive.

Drawings, words and companions are stored in each visitor's browser, separately for each website address. The two addresses do not share browser storage. No recordings, personal drawings, transcripts, environment files or runtime state are included in this repository.

The included LXGW Marker Gothic font is licensed under SIL Open Font License 1.1; see OFL-LXGWMarkerGothic.txt and AUTHORS-LXGWMarkerGothic.txt.
`);
for(const name of await readdir(out)){
 if(!/\.(?:js|html|css|md|txt)$/.test(name))continue;
 const text=await readFile(new URL(name,out),'utf8');
 if(/sk-or-v1-[a-zA-Z0-9]{20,}|sk-[a-zA-Z0-9]{30,}|\/Users\/ashstarry|BEGIN PRIVATE KEY|OPENROUTER_API_KEY|DASHSCOPE_API_KEY/.test(text))throw Error(`Release contains private data: ${name}`);
}
console.log('GitHub Pages browser-only release built and scanned.');
