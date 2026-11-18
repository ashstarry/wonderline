import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const directory = new URL('../.sites-runtime/', import.meta.url);
await mkdir(directory, { recursive: true });
const microphoneFile = new URL('microphone-capture-test.mjs', directory);
const studioFile=new URL('microphone-studio-endpoint.mjs',directory);
const endpointFile=new URL('microphone-speech-endpoint.mjs',directory);
const realtimeFile=new URL('microphone-realtime.mjs',directory);
const audioFile = new URL('audio-capture-test.mjs', directory);
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
await writeFile(studioFile,compile(await readFile(new URL('../lib/studio-endpoint.ts',import.meta.url),'utf8')));
await writeFile(endpointFile,compile(await readFile(new URL('../lib/speech-endpoint.ts',import.meta.url),'utf8')).replace("'./studio-endpoint'","'./microphone-studio-endpoint.mjs'"));
await writeFile(microphoneFile, compile(await readFile(new URL('../lib/microphone.ts', import.meta.url), 'utf8')));
await writeFile(audioFile, compile((await readFile(new URL('../lib/audio.ts', import.meta.url), 'utf8')).replace("from './microphone'", "from './microphone-capture-test.mjs'").replace("from './realtime-audio'","from './microphone-realtime.mjs'")));
await writeFile(realtimeFile, compile((await readFile(new URL('../lib/realtime-audio.ts', import.meta.url),'utf8')).replace("from './speech-endpoint'", "from './microphone-speech-endpoint.mjs'")));
const { listMicrophones, resolveMicrophone } = await import(microphoneFile.href);
const { startStreamingRecording } = await import(audioFile.href);
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const originalWebSocket=globalThis.WebSocket;
after(async () => {
  await Promise.all([unlink(microphoneFile), unlink(audioFile), unlink(endpointFile), unlink(realtimeFile), unlink(studioFile)]);
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete globalThis.navigator;
  globalThis.window = originalWindow; globalThis.fetch = originalFetch; globalThis.WebSocket=originalWebSocket;
});

const microphone = (deviceId, label) => ({ kind: 'audioinput', deviceId, label, groupId: 'group-' + deviceId });
const mac = microphone('physical-mac', 'MacBook Pro麦克风');
const phone = microphone('physical-phone', '“Ashstarry”的麦克风');
let sockets=[],socketReady=true;
class Socket extends EventTarget {
 static OPEN=1; readyState=0;bufferedAmount=0;sent=[];
 constructor(url){super();this.url=url;sockets.push(this);queueMicrotask(()=>{if(socketReady)this.ready();});}
 ready(){if(this.readyState===3)return;this.readyState=1;this.message({type:"ready",sessionId:"test-session"});}
 message(value){this.dispatchEvent(new MessageEvent("message",{data:JSON.stringify(value)}));}
 send(data){this.sent.push(data);if(data==='{"type":"finish"}')queueMicrotask(()=>this.message({type:"update",update:{sessionId:"test-session",revision:1,mode:"qwen-realtime",partial:"",stableText:"",segments:[],done:true,elapsedMs:0}}));}
 close(){this.readyState=3;this.dispatchEvent(new Event("close"));}
}
let devices, captures, tracks, contexts, gumError, permissionGate, enumerateGate, resumeGate, wrongDevice, mediaDevices, systemDevice;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
class AudioNode { gain = { value: 1 }; connect() {} disconnect() {} }
class Context {
  sampleRate = 48000; destination = new AudioNode(); closes = 0;
  constructor() { contexts.push(this); }
  resume() { return resumeGate?.promise || Promise.resolve(); }
  close() { this.closes++; return Promise.resolve(); }
  createMediaStreamSource() { return new AudioNode(); }
  createGain() { return new AudioNode(); }
  createScriptProcessor() { this.processor = new AudioNode(); return this.processor; }
}
class Track extends EventTarget {
  stops = 0; readyState = 'live';
  constructor(device) { super(); this.device = device; this.label = device.label; }
  getSettings() { return { deviceId: this.device.deviceId }; }
  stop() { this.stops++; this.readyState = 'ended'; }
}
beforeEach(() => {
  devices = [microphone('default', '默认 - “Ashstarry”的麦克风'), phone, mac];
  systemDevice = phone;
  captures = []; tracks = []; contexts = [];
  gumError = permissionGate = enumerateGate = resumeGate = wrongDevice = undefined;
  mediaDevices = new EventTarget();
  mediaDevices.enumerateDevices = async () => { if (enumerateGate) await enumerateGate.promise; return devices; };
  mediaDevices.getSupportedConstraints = () => ({ deviceId: true });
  mediaDevices.getUserMedia = async constraints => {
    captures.push(constraints);
    const failure = typeof gumError === 'function' ? gumError(constraints) : gumError;
    if (failure) throw failure;
    if (permissionGate) await permissionGate.promise;
    const id = constraints.audio.deviceId?.exact;
    const chosen = wrongDevice || (!id || id === 'default' ? systemDevice : devices.find(device => device.deviceId === id));
    assert(chosen, 'capture must name an available physical device or follow the system');
    const track = new Track(chosen); tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices } });
  const winEvents=new EventTarget();
  globalThis.window = { AudioContext: Context,location:{origin:"https://studio.example"},addEventListener:winEvents.addEventListener.bind(winEvents),removeEventListener:winEvents.removeEventListener.bind(winEvents) };
  globalThis.WebSocket=Socket;sockets=[];socketReady=true;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ sessionId: request.sessionId, revision: request.seq, mode: 'rolling-window', partial: '', stableText: '', segments: [], done: request.action === 'flush', elapsedMs: 0 }) };
  };
});

const options = extra => ({ onUpdate() {}, ...extra });

test('enumeration never captures; a renamed phone is not guessed to be a computer', async () => {
  const list = await listMicrophones();
  assert.deepEqual(list.map(device => device.deviceId), ['physical-phone', 'physical-mac']);
  assert.equal(list[0].isComputer, false);
  assert.equal(list[1].isComputer, true);
  assert.equal(captures.length, 0);
  assert.equal(contexts.length, 0);
});

test('system default uses the default alias even when a built-in Mac is also available', async () => {
  let actual;
  const handle = await startStreamingRecording(options({ onMicrophone: device => { actual = device; } }));
  assert.deepEqual(captures[0].audio.deviceId, { exact: 'default' });
  assert.deepEqual(actual, { deviceId: 'physical-phone', label: '“Ashstarry”的麦克风' });
  await handle.stop();
  assert.equal(tracks[0].stops, 1);
  assert.equal(contexts[0].closes, 1);
});

test('first use without visible names or ids can request normal default capture', async () => {
  devices = [microphone('', '')];
  const handle = await startStreamingRecording(options());
  assert.equal(captures.length, 1);
  assert.equal('deviceId' in captures[0].audio, false);
  await handle.stop();
  assert.equal(contexts[0].closes, 1);
});

test('hidden names with an exposed default alias still allow first-use capture', async () => {
  devices = [microphone('default', ''), microphone('hidden', '')];
  const handle = await startStreamingRecording(options({ deviceId: 'system' }));
  assert.deepEqual(captures[0].audio.deviceId, { exact: 'default' });
  await handle.stop();
});

test('each new system recording follows the current input instead of pinning the first physical id', async () => {
  const reports = [];
  let handle = await startStreamingRecording(options({ onMicrophone: device => reports.push(device) }));
  await handle.stop();
  systemDevice = mac;
  handle = await startStreamingRecording(options({ onMicrophone: device => reports.push(device) }));
  assert.deepEqual(reports.map(device => device.deviceId), ['physical-phone', 'physical-mac']);
  assert.deepEqual(captures.map(capture => capture.audio.deviceId), [{ exact: 'default' }, { exact: 'default' }]);
  await handle.stop();
});

test('missing or failed enumeration does not prevent default-device permission requests', async () => {
  for (const enumerateDevices of [undefined, async () => { throw new Error('No device permission yet'); }]) {
    mediaDevices.enumerateDevices = enumerateDevices;
    const handle = await startStreamingRecording(options());
    assert.equal('deviceId' in captures.at(-1).audio, false);
    await handle.stop();
  }
});

test('the optional computer policy remains an explicit physical choice', async () => {
  const selected = await resolveMicrophone('computer');
  assert.equal(selected.deviceId, 'physical-mac');
  assert.equal(selected.isSystem, false);
  const handle = await startStreamingRecording(options({ deviceId: 'computer' }));
  assert.deepEqual(captures[0].audio.deviceId, { exact: 'physical-mac' });
  await handle.stop();
});

test('only an unknown renamed phone is present: computer strategy refuses capture', async () => {
  devices = [phone];
  await assert.rejects(startStreamingRecording(options({ deviceId: 'computer' })), /还没找到.*电脑/);
  assert.equal(captures.length, 0);
});

test('an explicit USB device is used; a disappeared selection never falls back to Mac or phone', async () => {
  devices.push(microphone('physical-usb', 'USB Audio Device'));
  const handle = await startStreamingRecording(options({ deviceId: 'physical-usb' }));
  assert.equal(captures[0].audio.deviceId.exact, 'physical-usb');
  handle.cancel(); await assert.rejects(handle.done, { name: 'AbortError' });
  devices = [phone, mac]; captures.length = 0;
  await assert.rejects(startStreamingRecording(options({ deviceId: 'physical-usb' })), /已不在设备列表/);
  assert.equal(captures.length, 0);
});

test('an exact constraint rejected by the browser is not retried with defaults', async () => {
  gumError = new DOMException('Device disappeared', 'OverconstrainedError');
  await assert.rejects(startStreamingRecording(options({ deviceId: 'physical-mac' })), /选定的麦克风不可用/);
  assert.equal(captures.length, 1);
  assert.equal(contexts[0].closes, 1);
});

test('a browser without deviceId support rejects only explicit selection before capture', async () => {
  mediaDevices.getSupportedConstraints = () => ({});
  await assert.rejects(startStreamingRecording(options({ deviceId: 'physical-mac' })), /不能锁定/);
  assert.equal(captures.length, 0);
  const handle = await startStreamingRecording(options());
  assert.equal('deviceId' in captures[0].audio, false);
  await handle.stop();
});

test('an unsupported default alias retries ordinary system capture without pinning a physical id', async () => {
  gumError = constraints => constraints.audio.deviceId ? new DOMException('Alias unsupported', 'OverconstrainedError') : undefined;
  const handle = await startStreamingRecording(options());
  assert.deepEqual(captures[0].audio.deviceId, { exact: 'default' });
  assert.equal('deviceId' in captures[1].audio, false);
  assert.equal(captures.length, 2);
  await handle.stop();
});

test('permission denial on the default alias is never retried', async () => {
  gumError = new DOMException('Denied', 'NotAllowedError');
  await assert.rejects(startStreamingRecording(options()), /麦克风还没有获得允许/);
  assert.equal(captures.length, 1);
  assert.equal(contexts[0].closes, 1);
});

test('cancellation prevents an unsupported default alias from starting fallback capture', async () => {
  const controller = new AbortController();
  gumError = () => { controller.abort(); return new DOMException('Alias unsupported', 'OverconstrainedError'); };
  await assert.rejects(startStreamingRecording(options({ signal: controller.signal })), { name: 'AbortError' });
  assert.equal(captures.length, 1);
  assert.equal(contexts[0].closes, 1);
});

test('cancelling during enumeration never opens a microphone', async () => {
  enumerateGate = deferred();
  const controller = new AbortController();
  const pending = startStreamingRecording(options({ signal: controller.signal }));
  controller.abort(); enumerateGate.resolve();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(captures.length, 0);
  assert.equal(contexts[0].closes, 1);
});

test('cancelling a pending permission request releases the late track without reporting it', async () => {
  permissionGate = deferred();
  const controller = new AbortController();
  let reports = 0;
  const pending = startStreamingRecording(options({ signal: controller.signal, onMicrophone() { reports++; } }));
  await tick(); controller.abort(); permissionGate.resolve();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(reports, 0);
  assert.equal(tracks[0].stops, 1);
  assert.equal(contexts[0].closes, 1);
});

test('cancelling while AudioContext resumes cannot revive audio capture', async () => {
  resumeGate = deferred();
  const controller = new AbortController();
  const pending = startStreamingRecording(options({ signal: controller.signal }));
  await tick(); controller.abort(); resumeGate.resolve();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(tracks[0].stops, 1);
  assert.equal(contexts[0].processor, undefined);
});

test('track ended stops recording and reports a device error, without automatic switching', async () => {
  const errors = [];
  const handle = await startStreamingRecording(options({ onError: error => errors.push(error) }));
  tracks[0].readyState = 'ended'; tracks[0].dispatchEvent(new Event('ended'));
  await assert.rejects(handle.done, /麦克风已断开/);
  assert.equal(errors.length, 1);
  assert.equal(captures.length, 1);
  assert.equal(contexts[0].closes, 1);
});

test('devicechange removes the selected physical input: stop, never silently switch', async () => {
  const handle = await startStreamingRecording(options({ deviceId: 'physical-mac' }));
  devices = [phone]; mediaDevices.dispatchEvent(new Event('devicechange'));
  await assert.rejects(handle.done, /麦克风已断开/);
  assert.equal(captures.length, 1);
  assert.equal(tracks[0].stops, 1);
});

test('system devicechange leaves routing to the browser and reports changed track identity', async () => {
  const reports = [];
  const handle = await startStreamingRecording(options({ onMicrophone: device => reports.push(device) }));
  devices = [mac];
  tracks[0].device = mac; tracks[0].label = mac.label;
  mediaDevices.dispatchEvent(new Event('devicechange'));
  await tick();
  assert.deepEqual(reports.map(device => device.deviceId), ['physical-phone', 'physical-mac']);
  assert.equal(tracks[0].stops, 0);
  assert.equal(captures.length, 1);
  tracks[0].dispatchEvent(new Event('unmute'));
  assert.equal(reports.length, 2, 'unchanged identity is not reported repeatedly');
  await handle.stop();
});

test('a wrong actual device is stopped before callback or audio processing', async () => {
  wrongDevice = phone;
  let reports = 0;
  await assert.rejects(startStreamingRecording(options({ deviceId: 'physical-mac', onMicrophone() { reports++; } })), /没有使用选定/);
  assert.equal(reports, 0);
  assert.equal(tracks[0].stops, 1);
  assert.equal(contexts[0].processor, undefined);
});

test('after stop, devicechange and ended cannot produce a second error or capture', async () => {
  const errors = [];
  const handle = await startStreamingRecording(options({ onError: error => errors.push(error) }));
  await handle.stop();
  devices = [phone]; mediaDevices.dispatchEvent(new Event('devicechange')); tracks[0].dispatchEvent(new Event('ended'));
  await tick();
  assert.equal(errors.length, 0);
  assert.equal(captures.length, 1);
  assert.equal(tracks[0].stops, 1);
});


test('cloud speech sends 200 ms PCM continuously without waiting for recognition; stop drains the tail', async () => {
 const handle=await startStreamingRecording(options());await tick();
 const input=Float32Array.from({length:60000},(_,i)=>((i%300)-150)/300);
 const feed=part=>contexts[0].processor.onaudioprocess({inputBuffer:{getChannelData:()=>part}});
 feed(input.subarray(0,9597));assert.equal(sockets[0].sent.length,0);
 feed(input.subarray(9597,9600));assert.equal(sockets[0].sent.length,1);
 feed(input.subarray(9600));await handle.stop();
 assert.equal(String(sockets[0].url),'wss://studio.example/api/speech/english');
 assert.equal(sockets[0].sent.at(-1),'{"type":"finish"}');
 const actual=Buffer.concat(sockets[0].sent.filter(x=>x instanceof ArrayBuffer).map(x=>Buffer.from(x)));
 assert.equal(actual.length,40000);
 for(let i=0;i<20000;i++){const v=Math.fround((input[i*3]+input[i*3+1]+input[i*3+2])/3);assert.equal(actual.readInt16LE(i*2),Math.round(v*(v<0?32768:32767)));}
 assert.equal(tracks[0].stops,1);assert.equal(sockets[0].readyState,3);
});
test('slow connection buffers the beginning and stopping before readiness still flushes it',async()=>{
 socketReady=false;const handle=await startStreamingRecording(options());
 contexts[0].processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(48000).fill(.2)}});
 assert.equal(sockets[0].sent.length,0);const stopped=handle.stop();sockets[0].ready();await stopped;
 assert.equal(sockets[0].sent.filter(x=>x instanceof ArrayBuffer).reduce((n,x)=>n+x.byteLength,0),32000);
 assert.equal(sockets[0].sent.at(-1),'{"type":"finish"}');
});
test('cloud errors stop capture and cannot revive a cancelled recording',async()=>{
 const errors=[];let updates=0;const handle=await startStreamingRecording(options({onError:e=>errors.push(e),onUpdate:()=>updates++}));
 sockets[0].message({type:'error',code:'configuration'});await assert.rejects(handle.done,/云端语音尚未开通/);
 assert.equal(tracks[0].stops,1);assert.equal(errors.length,1);
 sockets[0].ready();assert.equal(updates,0);assert.equal(sockets[0].readyState,3);
});
test('page exit closes the websocket and releases microphone without any local HTTP cleanup',async()=>{
 let hide;window.addEventListener=(name,callback)=>{if(name==='pagehide')hide=callback;};
 globalThis.fetch=()=>assert.fail('No HTTP localhost requests');
 const handle=await startStreamingRecording(options());hide();await assert.rejects(handle.done,{name:'AbortError'});
 assert.equal(sockets[0].readyState,3);assert.equal(tracks[0].stops,1);
});
