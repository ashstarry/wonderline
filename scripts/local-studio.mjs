#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MODEL = 'mlx-community/Qwen3-ASR-1.7B-8bit';
const STUDIO_URL = 'http://127.0.0.1:3000/signin-with-chatgpt?return_to=/';
const owned = new Set();
let closing = false;
let cleanupPromise;

async function portIsOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let finished = false;
    const end = value => { if (!finished) { finished = true; socket.destroy(); resolve(value); } };
    socket.setTimeout(1000);
    socket.once('connect', () => end(true));
    socket.once('error', () => end(false));
    socket.once('timeout', () => end(false));
  });
}

async function probe(kind) {
  const port = kind === 'asr' ? 8765 : 3000;
  const endpoint = kind === 'asr' ? '/health' : '/api/status';
  try {
    const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
      signal: AbortSignal.timeout(2000), redirect: 'error', cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const data = response.ok ? await response.json() : null;
    if (kind === 'asr' && data?.model === MODEL && data?.streaming?.mode !== 'rolling-window') {
      return { state: 'outdated', data };
    }
    const known = kind === 'asr'
      ? data?.model === MODEL && data?.offline === true && data?.streaming?.mode === 'rolling-window'
      : data?.app === 'softspoken' && data?.asr?.provider === 'local-qwen' && data?.asr?.model === MODEL;
    return { state: known ? 'known' : 'other', data };
  } catch {
    return { state: await portIsOpen(port) ? 'other' : 'free' };
  }
}

export async function stopOwnedProcessGroups(entries) {
  // Every PID in this set was spawned by this launcher with detached:true.
  // Negative PIDs target only those owned process groups, including their workers.
  const signal = (entry, name) => {
    if (!entry.pid) return;
    try { process.kill(-entry.pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const active = [...entries];
  for (const entry of active) { entry.stopping = true; signal(entry, 'SIGTERM'); }
  await delay(1200);
  // Do not send a later signal to a PID whose original child has already exited.
  for (const entry of active) {
    if (entry.child?.exitCode === null && entry.child?.signalCode === null) signal(entry, 'SIGKILL');
  }
}

function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  closing = true;
  cleanupPromise = stopOwnedProcessGroups(owned).catch(() => undefined);
  return cleanupPromise;
}

function startOwned(label, executable, args) {
  if (closing) throw new Error('启动已取消。');
  const child = spawn(executable, args, {
    cwd: ROOT,
    detached: true,
    // The framework reads .dev.vars itself. No configuration or child output is
    // read, copied, or printed by this launcher, so secrets stay out of Terminal.
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}` },
  });
  const entry = { child, pid: child.pid, label, exited: false, failed: false };
  owned.add(entry);
  child.once('error', () => { entry.failed = true; entry.exited = true; });
  child.once('exit', () => {
    entry.exited = true;
    if (!closing && entry.ready) {
      console.error(`${label}已经停止，正在关闭本窗口启动的其他服务。`);
      void cleanup().then(() => process.exit(1));
    }
  });
  return entry;
}

async function ensureService(kind) {
  const label = kind === 'asr' ? '本地语音模型' : '轻轻画网页';
  const port = kind === 'asr' ? 8765 : 3000;
  const initial = await probe(kind);
  if (initial.state === 'outdated') {
    throw new Error('找到旧版语音服务。请先关闭旧的语音窗口，再重新打开「启动轻轻画」。');
  }
  if (initial.state === 'other') {
    throw new Error(`端口 ${port} 正由其他程序使用。请关闭占用它的程序后再打开画室；启动器不会结束其他程序。`);
  }
  let entry;
  if (initial.state === 'free') {
    console.log(`正在准备${label}…`);
    entry = kind === 'asr'
      ? startOwned(label, '/bin/bash', ['local-asr/run.sh'])
      : startOwned(label, process.execPath, ['--import', './scripts/sites-env.mjs', 'scripts/run-framework.mjs', 'dev', '--hostname', '127.0.0.1', '--port', '3000']);
  } else {
    console.log(`${label}已在运行，正在连接。`);
  }
  const deadline = Date.now() + 120_000;
  while (!closing && Date.now() < deadline) {
    if (entry?.exited) throw new Error(`${label}没能启动。请检查本地环境是否完整，再重新打开画室。`);
    const result = await probe(kind);
    if (result.state === 'known') {
      if (kind === 'asr' && result.data.startupError) throw new Error('本地语音模型加载失败，请检查模型文件和运行环境。');
      if (kind !== 'asr' || result.data.ready === true) {
        if (entry) entry.ready = true;
        return { reused: !entry, data: result.data };
      }
    }
    await delay(500);
  }
  throw new Error(closing ? '启动已取消。' : `${label}准备时间较长。请稍后重新打开画室。`);
}

async function openBrowser() {
  await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/open', [STUDIO_URL], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('浏览器没有自动打开。')));
  });
}

async function main() {
  const unsupported = process.argv.slice(2).filter(arg => arg !== '--no-open');
  if (unsupported.length) throw new Error('启动参数不受支持。');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error('需要 Node.js 22.13 或更新版本，请使用随附的一键启动文件。');
  await access(path.join(ROOT, 'work/asr-venv/bin/python'));
  await access(path.join(ROOT, 'work/models/Qwen3-ASR-1.7B-8bit/model.safetensors'));
  await access(path.join(ROOT, 'node_modules/vinext/dist/cli.js'));

  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(name, () => {
      console.log('\n正在关闭本窗口启动的服务。已有的其他服务会继续运行。');
      void cleanup().then(() => process.exit(0));
    });
  }
  process.once('exit', () => {
    for (const entry of owned) {
      if (entry.pid && !entry.stopping && !entry.exited) try { process.kill(-entry.pid, 'SIGTERM'); } catch { /* Already stopped. */ }
    }
  });

  console.log('轻轻画 · 本地画室\n');
  await ensureService('asr');
  const website = await ensureService('site');
  console.log('\n画室准备好了：http://127.0.0.1:3000');
  console.log('声音由这台 Mac 上的 Qwen3-ASR 在本机识别。');
  if (website.data.configured) console.log('画面理解已连接 OpenRouter，可以把转写后的想象交给画笔。');
  else console.log('OpenRouter 尚未接通。现在可以尝试语音转写、切换画风和查看既有画面；示例按钮只填入文字，生成新画面需要先接通画笔。');
  if (!process.argv.includes('--no-open')) {
    try { await openBrowser(); } catch { console.log(`请在浏览器打开：${STUDIO_URL}`); }
  }
  if (owned.size) {
    console.log('请保留这个窗口。关闭窗口或按 Ctrl+C，会停止本窗口启动的服务。');
  } else {
    console.log('已连接现有服务。关闭这个窗口不会停止原先运行的画室。');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async error => {
    console.error(`\n${error.code === 'ENOENT' ? '没有找到完整的本地运行环境，请保留原来的项目文件夹。' : error.message}`);
    await cleanup();
    process.exitCode = 1;
  });
}
