export class ModelStreamError extends Error {
  constructor(public kind: 'invalid' | 'incomplete' | 'length' | 'content' | 'upstream' | 'size', public statusCode?: number) { super(kind); }
}

/** Small SSE framer: comments, multiline data, LF/CRLF and split UTF-8 are safe. */
class EventFrames {
  private line = '';
  private data: string[] = [];
  private afterCR = false;
  push(text: string): string[] {
    const frames: string[] = [];
    const line = () => {
      if (!this.line) {
        if (this.data.length) frames.push(this.data.join('\n'));
        this.data = [];
      } else if (this.line === 'data' || this.line.startsWith('data:')) {
        this.data.push(this.line === 'data' ? '' : this.line.slice(5).replace(/^ /, ''));
      }
      this.line = '';
    };
    for (const character of text) {
      if (this.afterCR) { this.afterCR = false; if (character === '\n') continue; }
      if (character === '\r' || character === '\n') { line(); this.afterCR = character === '\r'; }
      else this.line += character;
    }
    return frames;
  }
  finish() { return this.push('\n\n'); }
}

export async function* readOpenRouterStream(
  body: ReadableStream<Uint8Array>,
  options: { signal?: AbortSignal; maxContentChars?: number; maxWireBytes?: number } = {},
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const frames = new EventFrames();
  let wireBytes = 0;
  let contentChars = 0;
  let finished = false;
  let doneMarker = false;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  const checkAbort = () => { if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  options.signal?.addEventListener('abort', abort, { once: true });
  function consume(frame: string): string | undefined {
    if (frame === '[DONE]') { doneMarker = true; return; }
    if (doneMarker) throw new ModelStreamError('invalid');
    let chunk: { error?: unknown; choices?: { index?: number; delta?: { content?: unknown }; finish_reason?: unknown }[] };
    try { chunk = JSON.parse(frame); } catch { throw new ModelStreamError('invalid'); }
    if (!chunk || typeof chunk !== 'object' || chunk.error) {
      const rawCode = chunk?.error && typeof chunk.error === 'object' && 'code' in chunk.error ? chunk.error.code : undefined;
      const code = typeof rawCode === 'number' || typeof rawCode === 'string' && /^\d{3}$/.test(rawCode) ? Number(rawCode) : NaN;
      throw new ModelStreamError('upstream', Number.isInteger(code) && code >= 400 && code <= 599 ? code : undefined);
    }
    if (!Array.isArray(chunk.choices)) throw new ModelStreamError('invalid');
    const choice = chunk.choices.find(value => value?.index === 0) ?? chunk.choices[0];
    if (!choice) return; // Some providers emit an empty usage-only choices array.
    const reason = choice.finish_reason;
    if (reason === 'length') throw new ModelStreamError('length');
    // A content-specific non-completion belongs to this utterance, not to the
    // account or connection; a new idea must not remain blocked behind it.
    if (reason === 'content_filter' || reason === 'refusal') throw new ModelStreamError('content');
    if (reason != null && reason !== 'stop') throw new ModelStreamError('upstream');
    const content = choice.delta?.content;
    if (content != null && typeof content !== 'string') throw new ModelStreamError('invalid');
    if (content) {
      if (finished) throw new ModelStreamError('invalid');
      contentChars += content.length;
      if (contentChars > (options.maxContentChars ?? 120_000)) throw new ModelStreamError('size');
    }
    if (reason === 'stop') finished = true; // The final usage frame may repeat stop.
    return content || undefined;
  }
  try {
    checkAbort();
    while (!doneMarker) {
      const { done, value } = await reader.read();
      checkAbort();
      if (done) {
        for (const frame of [...frames.push(decoder.decode()), ...frames.finish()]) {
          const delta = consume(frame);
          if (delta) yield delta;
        }
        break;
      }
      wireBytes += value.byteLength;
      if (wireBytes > (options.maxWireBytes ?? 2_000_000)) throw new ModelStreamError('size');
      for (const frame of frames.push(decoder.decode(value, { stream: true }))) {
        const delta = consume(frame);
        if (delta) yield delta;
      }
    }
    if (!doneMarker || !finished || !contentChars) throw new ModelStreamError('incomplete');
  } finally {
    options.signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
