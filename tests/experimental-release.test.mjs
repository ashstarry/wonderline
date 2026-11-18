import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = new URL('../.sites-runtime/', import.meta.url);
await mkdir(directory, { recursive: true });
const files = ['pages', 'cloud', 'health'].map(name => new URL(`experimental-release-${name}.mjs`, directory));
after(() => Promise.all(files.map(file => unlink(file).catch(() => {}))));
const exports = [
  "export * from './lib/ui-language';",
  "export * from './lib/studio-endpoint';",
  "export * from './lib/speech-endpoint';",
  "export * from './lib/asr-connection';",
  "export * from './lib/realtime-audio';",
  "export * from './lib/studio-origin';",
  "export {LanguageProvider} from './components/LanguageProvider';",
  "export {default as Home} from './app/page';",
].join('\n');
const built = await Promise.all([true, false].map(pages => build({
  stdin: { contents: exports, resolveDir: root }, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic',
  define: { __WONDERLINE_PAGES__: String(pages) }, loader: { '.css': 'empty' }, write: false,
})));
await Promise.all(built.map((result, i) => writeFile(files[i], result.outputFiles[0].text)));
const [pages, cloud] = await Promise.all(files.slice(0, 2).map(file => import(file.href)));
const healthBuilt = await build({
  stdin: { contents: "export { GET } from './app/api/speech/health-chinese/route';", resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'isolated-test-cloud-env', setup(builder) {
    builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'test-env', namespace: 'test-cloud' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-cloud' }, () => ({ contents: 'export const env=globalThis.__wonderlineReleaseTestEnv;' }));
  } }],
});
await writeFile(files[2], healthBuilt.outputFiles[0].text);
const health = await import(files[2].href);

function browser(origin, action) {
  const previous = globalThis.window;
  const fake = new EventTarget(); fake.location = { origin };
  globalThis.window = fake;
  try { return action(); } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
}
async function browserAsync(origin, action) {
  const previous = globalThis.window;
  const fake = new EventTarget(); fake.location = { origin };
  globalThis.window = fake;
  try { return await action(); } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
}

test('Pages offers English and Chinese, with English as default', () => {
  assert.equal(pages.isPagesBuild(), true); assert.equal(pages.CHINESE_UI_ENABLED, true);
  for (const language of [null, undefined, 'en', 'fr']) assert.equal(pages.readLanguage(language), 'en');
  assert.equal(pages.readLanguage('zh'), 'zh');
});

test('cloud studio enables exactly English and Chinese with English as default', () => {
  assert.equal(cloud.isPagesBuild(), false); assert.equal(cloud.CHINESE_UI_ENABLED, true);
  assert.equal(cloud.readLanguage('zh'), 'zh'); assert.equal(cloud.readLanguage('en'), 'en');
  for (const language of [null, undefined, 'fr', 'ZH', '']) assert.equal(cloud.readLanguage(language), 'en');
});

test('Site defaults to Mercury, explicit Luna remains available, Pages never activates Mercury', () => {
  const previous=globalThis.window;
  try {
    for(const search of ['', '?draw-lab=other', '?draw-lab=mercury3', '?draw-lab=luna']) {
      globalThis.window={location:{origin:'https://softspoken-paper-garden.neonolm3.chatgpt.site',search}};
      assert.equal(cloud.drawingExperimentEnabled(),search!=='?draw-lab=luna');
      assert.equal(pages.drawingExperimentEnabled(),false);
      assert.equal(cloud.drawingPaperStorageKey('paper'),search!=='?draw-lab=luna'?'paper-lab-mercury3':'paper');
      assert.equal(pages.drawingPaperStorageKey('paper'),'paper');
    }
  } finally {if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});

test('public Pages exposes the complete bilingual studio without changing API hosting', () => {
  for (const [language, companions, collection] of [['en', 'My companions', 'Picturebook'], ['zh', '我的伙伴', '画册']]) {
    const html = renderToStaticMarkup(createElement(pages.LanguageProvider, { initialLanguage: language }, createElement(pages.Home)));
    assert.ok(html.includes(companions)); assert.ok(html.includes(collection));
    assert.match(html, /studio-language-select|paper-inspiration/);
    assert.match(html, /voice-controls/); assert.match(html, /studio-library-nav/);
  }
});

test('cloud homepage keeps collections and hidden paper inspiration without a global keep-character action', () => {
  for (const [language, label, inspiration] of [['en', 'My companions', 'A little inspiration'], ['zh', '我的伙伴', '一点小灵感']]) {
    const html = renderToStaticMarkup(createElement(cloud.LanguageProvider, { initialLanguage: language }, createElement(cloud.Home)));
    assert.ok(html.includes(label)); assert.match(html, /<select class="studio-language-select"/);
    assert.match(html, /studio-library-nav/);
    assert.doesNotMatch(html, /studio-creation-actions|Keep a character|留下角色|voice-studio-footer|studio-door--companions|story-doors|Need an idea|Leave some space|找点灵感|收起灵感/);
    const paper = html.match(/<section id="paper-inspiration"[^>]*>/)?.[0];
    assert.ok(paper);
    assert.ok(paper.includes(`aria-label="${inspiration}"`));
    assert.match(paper, /aria-hidden="true"/);
    assert.match(paper, /inert=""/);
    assert.ok(paper.includes(`data-language="${language}"`));
    assert.doesNotMatch(paper, /is-visible/);
    assert.match(html, /voice-controls/); assert.match(html, /picture-book/); assert.match(html, /paper-inspiration/);
  }
});

test('both releases start in object selection', () => {
  for (const [api, language, chosen, unchosen] of [
    [cloud, 'en', 'Objects', 'Draw by hand'],
    [cloud, 'zh', '操控物件', '自己画'],
    [pages, 'en', 'Objects', 'Draw by hand'],
  ]) {
    const html = renderToStaticMarkup(createElement(api.LanguageProvider, { initialLanguage: language }, createElement(api.Home)));
    const button = label => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0];
    assert.match(button(chosen), /aria-pressed="true"/);
    assert.match(button(unchosen), /aria-pressed="false"/);
    // The heart belongs to a selected character, never to the default page or a background.
    assert.doesNotMatch(html, /data-keep-companion=|companion-name-dialog|companion-picker-target/);
  }
});

test('contextual companion saving is enabled in both builds and opens the selected object directly', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /canKeepCompanion=\{isCompanionCandidate\}/);
  assert.match(page, /onKeepCompanion=\{beginCompanionPick\}/);
  assert.match(page, /<CompanionCanvasPicker\s+selectionFirst\s/);
  assert.match(page, /<CompanionCanvasPicker[^>]*initialObjectId=\{pickInitialId\}/);
  assert.match(page, /setPickInitialId\(objectId\)/);
  assert.doesNotMatch(page, /<StudioCreationActions\b/);
});

test('Pages uses the promoted clean speech endpoints without changing health checks', () => {
  browser('https://ashstarry.github.io', () => {
    assert.equal(pages.speechEndpoint('health', undefined, 'en'), `${pages.CLOUD_STUDIO_ORIGIN}/api/speech/health`);
    assert.equal(pages.speechEndpoint('realtime', undefined, 'en'), `${pages.CLOUD_STUDIO_ORIGIN}/api/speech/english`);
    assert.equal(pages.speechEndpoint('health', undefined, 'zh'), `${pages.CLOUD_STUDIO_ORIGIN}/api/speech/health-chinese`);
    assert.equal(pages.speechEndpoint('realtime', undefined, 'zh'), `${pages.CLOUD_STUDIO_ORIGIN}/api/speech/chinese-clean`);
    assert.throws(() => pages.speechEndpoint('realtime', `${pages.CLOUD_STUDIO_ORIGIN}/api/speech/chinese`, 'en'));
    assert.throws(() => pages.speechEndpoint('realtime', `${pages.CLOUD_STUDIO_ORIGIN}/api/speech/realtime`, 'zh'));
  });
});

test('cloud languages retain their existing speech addresses', () => {
  browser(cloud.CLOUD_STUDIO_ORIGIN, () => {
    assert.equal(cloud.speechEndpoint('health', undefined, 'zh'), `${cloud.CLOUD_STUDIO_ORIGIN}/api/speech/health-chinese`);
    assert.equal(cloud.speechEndpoint('realtime', undefined, 'zh'), `${cloud.CLOUD_STUDIO_ORIGIN}/api/speech/chinese`);
    assert.equal(cloud.speechEndpoint('health', undefined, 'en'), `${cloud.CLOUD_STUDIO_ORIGIN}/api/speech/health`);
    assert.equal(cloud.speechEndpoint('realtime', undefined, 'en'), `${cloud.CLOUD_STUDIO_ORIGIN}/api/speech/english`);
    for (const unsafe of ['http://localhost:8000/api/speech/chinese', 'https://elsewhere.example/api/speech/chinese', '/api/speech/chinese?key=browser-secret', '/api/speech/chinese#anything', '/api/speech/realtime']) {
      assert.throws(() => cloud.speechEndpoint('realtime', unsafe, 'zh'));
    }
  });
});

test('language-specific health checks use only configuration fetches and reject the wrong provider response', async () => {
  await browserAsync(cloud.CLOUD_STUDIO_ORIGIN, async () => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url, init }); return Response.json({ ready: true, startupError: false, model: 'fish-audio/transcribe-1', language: 'zh', offline: false, streaming: { mode: 'openrouter-rolling' } }); };
    const result = await cloud.checkAsrConnection({ language: 'zh', fetchImpl });
    assert.equal(result.ready, true); assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${cloud.CLOUD_STUDIO_ORIGIN}/api/speech/health-chinese`);
    assert.equal(calls[0].init.method, 'GET'); assert.equal(calls[0].init.body, undefined);
    assert.equal((await cloud.checkAsrConnection({ language: 'en', fetchImpl })).state, 'outdated');
    assert.equal((await cloud.checkAsrConnection({ language: 'zh', fetchImpl: async () => Response.json({ ready: true, startupError: false, model: 'microsoft/mai-transcribe-2', offline: false, streaming: { mode: 'openrouter-rolling' } }) })).state, 'outdated');
  });
});

test('the live transport opens one fixed websocket for each release/language and cancellation releases it', () => {
  const previous = globalThis.WebSocket;
  const sockets = [];
  class FakeSocket extends EventTarget {
    static OPEN = 1;
    constructor(url) { super(); this.url = String(url); this.readyState = 0; this.bufferedAmount = 0; this.wasClosed = false; sockets.push(this); }
    close() { this.wasClosed = true; } send() { throw new Error('No audio should be sent by an idle test'); }
  }
  globalThis.WebSocket = FakeSocket;
  try {
    for (const [api, origin, language, expected] of [
      [pages, 'https://ashstarry.github.io', 'en', '/api/speech/english'],
      [pages, 'https://ashstarry.github.io', 'zh', '/api/speech/chinese-clean'],
      [cloud, cloud.CLOUD_STUDIO_ORIGIN, 'en', '/api/speech/english'],
      [cloud, cloud.CLOUD_STUDIO_ORIGIN, 'zh', '/api/speech/chinese'],
    ]) browser(origin, () => {
      let stopped = 0;
      const transport = api.realtimeTransport({ language, onUpdate() {}, onError() {} }, () => stopped++);
      const socket = sockets.at(-1);
      assert.equal(socket.url, `${cloud.CLOUD_STUDIO_ORIGIN.replace('https:', 'wss:')}${expected}`);
      transport.handle.cancel(); assert.equal(socket.wasClosed, true); assert.equal(stopped, 1);
    });
    assert.equal(sockets.length, 4);
  } finally { globalThis.WebSocket = previous; }
});

test('Chinese routes join only the exact public Pages CORS allow-list', () => {
  for (const path of ['/api/speech/chinese', '/api/speech/health-chinese']) {
    const request = new Request(`${cloud.CLOUD_STUDIO_ORIGIN}${path}`, { method: 'OPTIONS', headers: { Origin: 'https://ashstarry.github.io', 'Access-Control-Request-Method': 'GET' } });
    assert.equal(cloud.pagesPreflight(request, true).status, 204);
    assert.equal(cloud.pagesPreflight(request, false).status, 403);
  }
  const existing = new Request(`${cloud.CLOUD_STUDIO_ORIGIN}/api/speech/health`, { method: 'OPTIONS', headers: { Origin: 'https://ashstarry.github.io', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(cloud.pagesPreflight(existing, true).status, 204);
});

test('Chinese health rejects cross-site callers before reading any credentials or billing data', async () => {
  for (const headers of [{ Origin: 'https://ashstarry.github.io.evil.example' }, { Origin: 'https://unexpected.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await health.GET(new Request(`${cloud.CLOUD_STUDIO_ORIGIN}/api/speech/health-chinese`, { headers }))).status, 403);
  }
});

test('Chinese health is fixed-language and credential-free for both published frontends', async () => {
  let queries = 0;
  const previous = globalThis.__wonderlineReleaseTestEnv;
  globalThis.__wonderlineReleaseTestEnv = { PUBLIC_ACCESS_ENABLED:'true', OPENROUTER_API_KEY: 'test-key-never-returned', CLOUD_ASR_ENABLED: 'true', DB: { prepare() { queries++; return { bind() { return this; }, async first() { return { used: 0 }; } }; } } };
  try {
    for (const origin of [cloud.CLOUD_STUDIO_ORIGIN, 'https://ashstarry.github.io']) {
    const response = await health.GET(new Request(`${cloud.CLOUD_STUDIO_ORIGIN}/api/speech/health-chinese`, { headers: { Origin: origin } }));
    const value = await response.json();
    assert.equal(response.status, 200); assert.equal(value.ready, true); assert.equal(value.language, 'zh');
    assert.equal(value.model, 'fish-audio/transcribe-1'); assert.equal(value.transport, 'cloud'); assert.equal(value.offline, false);
    assert.doesNotMatch(JSON.stringify(value), /test-key-never-returned|api_key|Authorization|localhost/);
    }
    assert.equal(queries, 2);
    globalThis.__wonderlineReleaseTestEnv.PUBLIC_ACCESS_ENABLED='false';
    assert.equal((await health.GET(new Request(`${cloud.CLOUD_STUDIO_ORIGIN}/api/speech/health-chinese`, {headers:{Origin:'https://ashstarry.github.io'}}))).status,403);
    assert.equal(queries,2);
  } finally { if (previous === undefined) delete globalThis.__wonderlineReleaseTestEnv; else globalThis.__wonderlineReleaseTestEnv = previous; }
});

test('collection dialogs guard shortcuts while paper inspiration leaves speech available', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /shortcutEnabled=\{[^}]*!pictureBookOpen[^}]*!companionsOpen/);
  assert.match(page, /shortcutUndo\.current=.*!pictureBookOpen.*!companionsOpen/);
  assert.match(page, /<ObjectTransformLayer[^>]*enabled=\{[^}]*!pictureBookOpen[^}]*!companionsOpen/);
  assert.doesNotMatch(page, /sparksOpen|setSparksOpen|showInspiration|onIdeas=|ideasVisible=/);
  assert.match(page, /inspirationOnset\.current\.observe\(level,performance\.now\(\)\)/);
});
