import { realtimeTransport as streamTransport } from './realtime-audio';
import { listMicrophones, resolveMicrophone, type ResolvedMicrophone } from './microphone';

/** Small, browser-only audio capture: mono PCM WAV at 16 kHz. */
const OUTPUT_SAMPLE_RATE = 16_000;
const MAX_SECONDS = 30;
const MAX_FILE_BYTES = 12 * 1024 * 1024;

export type VoiceRecording = {
  /** Stops the microphone and returns the recorded audio, without a data URL prefix. */
  stop(): Promise<string>;
  /** Discards the recording and immediately releases the microphone. */
  cancel(): void;
};

function createAudioContext(): AudioContext {
  const AudioContextConstructor = window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("这个浏览器暂时不能录音，可以试试文字输入。");
  }
  return new AudioContextConstructor();
}

async function openMicrophone(selected: ResolvedMicrophone, isCancelled = () => false): Promise<MediaStream> {
  const devices = navigator.mediaDevices;
  const supportsId = !devices.getSupportedConstraints || !!devices.getSupportedConstraints().deviceId;
  if (!selected.isSystem && !supportsId) {
    throw new Error('这个浏览器不能锁定指定的麦克风。请换用支持麦克风选择的浏览器。');
  }
  const exactId = supportsId ? selected.deviceId : '';
  const capture = (deviceId: string) => devices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    },
    video: false,
  });
  if (isCancelled()) throw cancelledError();
  try {
    return await capture(exactId);
  } catch (error) {
    // Some browsers expose the alias but cannot capture by it. Retry ordinary
    // default capture only for the system policy, never a selected physical ID.
    if (!selected.isSystem || !exactId || !(error instanceof Error) ||
        !['NotFoundError', 'OverconstrainedError'].includes(error.name)) throw error;
    if (isCancelled()) throw cancelledError();
    return capture('');
  }
}

function toMono16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === OUTPUT_SAMPLE_RATE) return input;
  const ratio = inputRate / OUTPUT_SAMPLE_RATE;
  const output = new Float32Array(Math.floor(input.length / ratio));
  if (ratio < 1) {
    for (let i = 0; i < output.length; i++) {
      const position = i * ratio;
      const left = Math.floor(position);
      const fraction = position - left;
      output[i] = input[left] * (1 - fraction) +
        input[Math.min(left + 1, input.length - 1)] * fraction;
    }
    return output;
  }
  // Average the actual overlap of each source sample with the output interval.
  for (let i = 0; i < output.length; i++) {
    const start = i * ratio;
    const end = Math.min((i + 1) * ratio, input.length);
    let sum = 0;
    for (let j = Math.floor(start); j < Math.ceil(end); j++) {
      const weight = Math.min(j + 1, end) - Math.max(j, start);
      if (weight > 0) sum += input[j] * weight;
    }
    output[i] = sum / (end - start);
  }
  return output;
}

function encodeWav(samples: Float32Array): string {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeText(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, OUTPUT_SAMPLE_RATE, true);
  view.setUint32(28, OUTPUT_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i] || 0));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  // Chunked conversion avoids argument and call stack limits for 30-second clips.
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(""));
}

export async function startRecording(onLevel?: (level: number) => void): Promise<VoiceRecording> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("这里暂时无法使用麦克风，请通过安全链接打开，或在设置里上传一段声音。");
  }
  // Create/resume during the user's gesture, before the permission prompt resolves.
  const context = createAudioContext();
  const resumed = context.resume().catch(() => undefined);
  let stream: MediaStream;
  try {
    const selected = await resolveMicrophone();
    stream = await openMicrophone(selected);
    await resumed;
  } catch (error) {
    await context.close().catch(() => undefined);
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      throw new Error("麦克风还没有获得允许。请在浏览器里允许麦克风，再点开始说话。");
    }
    if (error instanceof DOMException && error.name === "NotFoundError") {
      throw new Error("没有找到麦克风，可以先用文字输入。");
    }
    throw new Error("没能打开麦克风，请确认它没有被其他应用占用。");
  }

  let source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined;
  let silentOutput: GainNode | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  let stopped = false;
  let cancelled = false;
  let totalSamples = 0;
  let chunks: Float32Array[] = [];
  let result: Promise<string> | undefined;
  const sampleRate = context.sampleRate;
  const maximumSamples = Math.floor(sampleRate * MAX_SECONDS);
  const level = (value: number) => {
    try { onLevel?.(value); } catch { /* UI callbacks cannot interrupt microphone cleanup. */ }
  };

  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    stopped = true;
    if (timer) clearTimeout(timer);
    if (processor) processor.onaudioprocess = null;
    source?.disconnect();
    processor?.disconnect();
    silentOutput?.disconnect();
    stream.getTracks().forEach(track => track.stop());
    level(0);
    cleanupPromise = context.close().catch(() => undefined);
    return cleanupPromise;
  };

  try {
    source = context.createMediaStreamSource(stream);
    // ScriptProcessor keeps this small utility compatible with browsers that cannot
    // load a separately hosted AudioWorklet. No captured audio is played back.
    processor = context.createScriptProcessor(4096, 1, 1);
    silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    processor.onaudioprocess = event => {
      if (stopped) return;
      const input = event.inputBuffer.getChannelData(0);
      const remaining = maximumSamples - totalSamples;
      if (remaining <= 0) { void cleanup(); return; }
      const part = input.slice(0, Math.min(input.length, remaining));
      chunks.push(part);
      totalSamples += part.length;
      let squared = 0;
      for (let i = 0; i < part.length; i++) squared += part[i] * part[i];
      level(Math.min(1, Math.sqrt(squared / part.length) * 5));
      if (totalSamples >= maximumSamples) void cleanup();
    };
    source.connect(processor);
    processor.connect(silentOutput);
    silentOutput.connect(context.destination);
    // Release devices even if a tab timer or the calling component is interrupted.
    timer = setTimeout(() => { void cleanup(); }, MAX_SECONDS * 1000);
  } catch {
    await cleanup();
    throw new Error("录音没有准备好，请再试一次或用文字输入。");
  }

  return {
    stop() {
      if (result) return result;
      result = (async () => {
        await cleanup();
        if (cancelled) throw new Error("这次录音已取消。");
        if (totalSamples < sampleRate * 0.15) {
          throw new Error("这段声音有点短，再试着说一句吧。");
        }
        const input = new Float32Array(totalSamples);
        let offset = 0;
        for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
        chunks = [];
        return encodeWav(toMono16k(input, sampleRate));
      })();
      return result;
    },
    cancel() {
      cancelled = true;
      chunks = [];
      void cleanup();
    },
  };
}

/** Decode common browser-supported audio formats through the same 16 kHz WAV path. */
export async function audioFileToBase64(file: File): Promise<string> {
  if (!file.size || file.size > MAX_FILE_BYTES) {
    throw new Error("请选择一个不超过 12 MB 的声音文件。");
  }
  const context = createAudioContext();
  try {
    let audio: AudioBuffer;
    try {
      audio = await context.decodeAudioData(await file.arrayBuffer());
    } catch {
      throw new Error("这个声音文件暂时读不了，请试试 WAV、MP3 或 M4A。");
    }
    if (audio.duration > MAX_SECONDS + 0.01) {
      throw new Error("每次听 30 秒以内就好，请选一段短一点的声音。");
    }
    if (audio.duration < 0.15) throw new Error("这段声音有点短，请换一个文件。");
    const mono = new Float32Array(Math.min(audio.length, Math.floor(audio.sampleRate * MAX_SECONDS)));
    for (let channel = 0; channel < audio.numberOfChannels; channel++) {
      const data = audio.getChannelData(channel);
      for (let i = 0; i < mono.length; i++) mono[i] += data[i] / audio.numberOfChannels;
    }
    return encodeWav(toMono16k(mono, audio.sampleRate));
  } finally {
    await context.close().catch(() => undefined);
  }
}

export type StreamingUpdate = {
  sessionId: string;
  revision: number;
  /** Current uncommitted tail. Replace this on every update; do not append it. */
  partial: string;
  /** Cumulative committed transcript for this session. */
  stableText: string;
  /** Only newly committed segments. Consume each id once for painting. */
  segments: Array<{ id: string; text: string }>;
  done: boolean;
  mode: 'rolling-window' | 'qwen-realtime' | 'openrouter-rolling';
  elapsedMs: number;
  receivedSeconds?: number;
};

export type StreamingOptions = {
  /** Fixed for the duration of one recording; English remains the default. */
  language?: 'en' | 'zh';
  onUpdate(update: StreamingUpdate): void;
  onLevel?(level: number): void;
  onError?(error: Error): void;
  onBacklog?(catchingUp: boolean): void;
  onCaptureStopped?(): void;
  signal?: AbortSignal;
  endpoint?: string;
  /** 'system' (default) follows the browser's default input; physical IDs stay exact. */
  deviceId?: string;
  onMicrophone?(device: { deviceId: string; label: string }): void;
};

export type StreamingHandle = {
  /** Stop capture, drain contiguous audio, flush ASR, then resolve after final onUpdate. */
  stop(): Promise<StreamingUpdate>;
  /** Immediately discard pending audio/results. done rejects with AbortError. */
  cancel(): void;
  done: Promise<StreamingUpdate>;
};

const STREAM_CHUNK_SAMPLES = 3200; // 200 ms of mono audio.

function cancelledError(): Error {
  return new DOMException('这次录音已取消。', 'AbortError');
}

/** Keeps fractional source samples across callbacks, so chunks do not lose time. */
export class ContinuousResampler {
  private carry = new Float32Array(0);
  private offset = 0;
  private readonly inputRate: number;
  constructor(inputRate: number) { this.inputRate = inputRate; }
  push(input: Float32Array): Float32Array {
    const combined = new Float32Array(this.carry.length + input.length);
    combined.set(this.carry);
    combined.set(input, this.carry.length);
    const ratio = this.inputRate / OUTPUT_SAMPLE_RATE;
    const count = Math.max(0, Math.floor((combined.length - this.offset) / ratio));
    const output = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const start = this.offset + i * ratio;
      const end = start + ratio;
      let sum = 0;
      for (let index = Math.floor(start); index < Math.ceil(end); index++) {
        const weight = Math.min(index + 1, end) - Math.max(index, start);
        if (weight > 0 && index < combined.length) sum += combined[index] * weight;
      }
      output[i] = sum / ratio;
    }
    const consumed = this.offset + count * ratio;
    this.carry = combined.slice(Math.floor(consumed));
    this.offset = consumed - Math.floor(consumed);
    return output;
  }
}

export async function startStreamingRecording(options: StreamingOptions): Promise<StreamingHandle> {
  if (options.signal?.aborted) throw cancelledError();
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('这个浏览器暂时不能录音，可以在设置里上传一段声音。');
  const context = createAudioContext();
  const resumed = context.resume().catch(() => undefined);
  let media: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined;
  let gain: GainNode | undefined;
  let released = false;
  let safety: ReturnType<typeof setTimeout> | undefined;
  let removeDeviceListeners: (() => void) | undefined;
  const release = () => {
    if (released) return;
    released = true;
    if (safety) clearTimeout(safety);
    removeDeviceListeners?.();
    if (processor) processor.onaudioprocess = null;
    source?.disconnect(); processor?.disconnect(); gain?.disconnect();
    media?.getTracks().forEach(track => track.stop());
    void context.close().catch(() => undefined);
  };
  let transport: ReturnType<typeof streamTransport>;
  try { transport = streamTransport(options, release); }
  catch (error) { release(); throw error; }
  try {
    const selected = await resolveMicrophone(options.deviceId);
    if (released || transport.closed || options.signal?.aborted) throw cancelledError();
    media = await openMicrophone(selected, () => released || transport.closed || !!options.signal?.aborted);
    if (transport.closed || options.signal?.aborted) { media.getTracks().forEach(track => track.stop()); throw cancelledError(); }
    await resumed;
    if (released || transport.closed || options.signal?.aborted) throw cancelledError();
    const track = media.getAudioTracks()[0];
    if (!track || track.readyState === 'ended') throw new Error('当前麦克风已经断开，请确认设备后再开始。');
    const actualId = track.getSettings().deviceId;
    if (!selected.isSystem && actualId && actualId !== selected.deviceId) throw new Error('浏览器没有使用选定的麦克风，已停止收音。请重新选择设备。');
    let reportedId: string | undefined;
    let reportedLabel: string | undefined;
    const reportMicrophone = () => {
      if (released) return;
      const deviceId = track.getSettings().deviceId || selected.deviceId;
      const label = track.label || selected.label;
      if (reportedId === deviceId && reportedLabel === label) return;
      reportedId = deviceId; reportedLabel = label;
      try { options.onMicrophone?.({ deviceId, label }); } catch { /* Device display cannot interrupt capture cleanup. */ }
    };
    const disconnected = () => {
      if (!released) transport.fail(new Error(selected.isSystem
        ? '当前麦克风已断开，收音已停止。请确认系统输入设备后重新开始。'
        : '选定的麦克风已断开，收音已停止。请重新选择后继续，没有切换到其他设备。'));
    };
    let checkingDevices = false;
    const deviceChanged = async () => {
      if (released || checkingDevices) return;
      // A default track may migrate when the system input changes. Let the
      // browser own that behavior; do not bind it to its initial physical ID.
      if (selected.isSystem) { reportMicrophone(); return; }
      checkingDevices = true;
      try {
        const available = await listMicrophones();
        if (!released && !available.some(device => device.deviceId === selected.deviceId)) disconnected();
      } catch { /* Track's ended event still handles hardware removal. */ }
      finally { checkingDevices = false; }
    };
    track.addEventListener('ended', disconnected);
    track.addEventListener('unmute', reportMicrophone);
    navigator.mediaDevices.addEventListener?.('devicechange', deviceChanged);
    removeDeviceListeners = () => {
      track.removeEventListener('ended', disconnected);
      track.removeEventListener('unmute', reportMicrophone);
      navigator.mediaDevices.removeEventListener?.('devicechange', deviceChanged);
    };
    reportMicrophone();
    if (released || transport.closed || options.signal?.aborted) throw cancelledError();
    source = context.createMediaStreamSource(media);
    processor = context.createScriptProcessor(4096, 1, 1);
    gain = context.createGain(); gain.gain.value = 0;
    const resampler = new ContinuousResampler(context.sampleRate);
    processor.onaudioprocess = event => {
      if (released) return;
      if (selected.isSystem) reportMicrophone();
      if (released) return;
      const input = event.inputBuffer.getChannelData(0);
      let squared = 0;
      for (let i = 0; i < input.length; i++) squared += input[i] * input[i];
      try { options.onLevel?.(Math.min(1, Math.sqrt(squared / input.length) * 5)); } catch { /* Optional meter. */ }
      transport.feed(resampler.push(input));
    };
    source.connect(processor); processor.connect(gain); gain.connect(context.destination);
    safety = setTimeout(() => { void transport.handle.stop().catch(() => undefined); }, 300_000);
    return transport.handle;
  } catch (error) {
    const failure = error instanceof DOMException && error.name === 'NotAllowedError'
      ? new Error('麦克风还没有获得允许。请在浏览器里允许麦克风，再点开始说话。')
      : error instanceof Error && ['NotFoundError', 'OverconstrainedError'].includes(error.name)
        ? new Error(!options.deviceId || options.deviceId === 'system'
          ? '系统默认麦克风不可用，请确认系统输入设备后再试一次。'
          : '选定的麦克风不可用，已停止收音。请重新选择设备，没有切换到其他麦克风。')
      : error instanceof Error ? error : new Error('没能打开麦克风，请再试一次。');
    transport.fail(failure);
    release();
    throw failure;
  }
}

/** Replay an uploaded recording at real-time pace through the same stream endpoint. */
export async function startStreamingFile(file: File, options: StreamingOptions): Promise<StreamingHandle> {
  if (options.signal?.aborted) throw cancelledError();
  if (!file.size || file.size > 32 * 1024 * 1024) throw new Error('请选择不超过 32 MB 的声音文件。');
  const context = createAudioContext();
  let samples: Float32Array;
  try {
    const audio = await context.decodeAudioData(await file.arrayBuffer());
    if (audio.duration < 0.15 || audio.duration > 300 || audio.numberOfChannels > 2) throw new Error('请选择五分钟以内的单声道或双声道声音。');
    const mono = new Float32Array(audio.length);
    for (let channel = 0; channel < audio.numberOfChannels; channel++) {
      const data = audio.getChannelData(channel);
      for (let i = 0; i < mono.length; i++) mono[i] += data[i] / audio.numberOfChannels;
    }
    samples = toMono16k(mono, audio.sampleRate);
  } catch (error) {
    throw error instanceof Error && error.message.includes('五分钟') ? error : new Error('这个声音文件暂时读不了，请试试 WAV、MP3 或 M4A。');
  } finally { await context.close().catch(() => undefined); }
  if (options.signal?.aborted) throw cancelledError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let offset = 0;
  let released = false;
  let chunkStarted = performance.now();
  let scheduledLength = 0;
  const transport = streamTransport(options, () => { released = true; if (timer) clearTimeout(timer); samples = new Float32Array(0); });
  function next() {
    if (released || transport.closed) return;
    const length = Math.min(STREAM_CHUNK_SAMPLES, samples.length - offset);
    chunkStarted = performance.now();
    scheduledLength = length;
    timer = setTimeout(() => {
      if (released || transport.closed) return;
      const part = samples.subarray(offset, offset + length);
      offset += length;
      let squared = 0;
      for (const value of part) squared += value * value;
      try { options.onLevel?.(Math.min(1, Math.sqrt(squared / Math.max(1, part.length)) * 5)); } catch { /* Optional meter. */ }
      const ended = offset >= samples.length;
      transport.feed(part);
      if (ended) void transport.handle.stop().catch(() => undefined);
      else next();
    }, length / OUTPUT_SAMPLE_RATE * 1000);
  }
  next();
  return {
    ...transport.handle,
    stop() {
      if (!released && !transport.closed) {
        // Include the fraction of this chunk already replayed when Stop
        // is pressed, instead of dropping the last audible part of a word.
        const elapsed = Math.floor((performance.now() - chunkStarted) * OUTPUT_SAMPLE_RATE / 1000);
        const length = Math.min(scheduledLength, Math.max(0, elapsed));
        const part = samples.subarray(offset, offset + length);
        offset += length;
        scheduledLength = 0;
        transport.feed(part);
      }
      return transport.handle.stop();
    },
  };
}

export async function streamAudioFile(file: File, options: StreamingOptions): Promise<StreamingUpdate> {
  return (await startStreamingFile(file, options)).done;
}
