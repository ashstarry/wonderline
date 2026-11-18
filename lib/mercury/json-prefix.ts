// Isolated copy of the release JSON-prefix parser. Luna keeps its original parser unchanged.
type ObjectFrame = { kind: 'object'; value: Record<string, unknown>; state: 'key-or-end' | 'key' | 'colon' | 'value' | 'comma-or-end'; key?: string; keys: Set<string> };
type ArrayFrame = { kind: 'array'; value: unknown[]; state: 'value-or-end' | 'value' | 'comma-or-end' };
type Frame = ObjectFrame | ArrayFrame;

/** Parses a JSON prefix without inventing missing values or closing delimiters. */
export class JsonPrefix {
  value: unknown;
  revision = 0;
  private stack: Frame[] = [];
  private complete = new WeakSet<object>();
  private started = false;
  private ended = false;
  private size = 0;
  private token = '';
  private tokenKind: 'string' | 'primitive' | null = null;
  private stringKey = false;
  private escaped = false;
  isComplete(value: unknown): boolean { return !!value && typeof value === 'object' && this.complete.has(value); }
  private fail(): never { throw new Error('Invalid or incomplete model JSON'); }
  private accept(value: unknown) {
    const frame = this.stack.at(-1);
    if (!frame) {
      if (this.started) this.fail();
      this.started = true; this.value = value;
      return;
    }
    if (frame.kind === 'object') {
      if (frame.state !== 'value' || frame.key === undefined) this.fail();
      frame.value[frame.key] = value;
      frame.state = 'comma-or-end';
      if (this.stack.length === 1 && (value === null || typeof value !== 'object')) this.revision++;
    } else {
      if (frame.state !== 'value' && frame.state !== 'value-or-end') this.fail();
      frame.value.push(value); frame.state = 'comma-or-end';
    }
  }
  private primitive() {
    let value: unknown;
    try { value = JSON.parse(this.token); } catch { this.fail(); }
    if (value !== null && typeof value !== 'number' && typeof value !== 'boolean') this.fail();
    this.accept(value);
    this.token = ''; this.tokenKind = null;
    if (!this.stack.length) this.ended = true;
  }
  push(text: string) {
    this.size += text.length;
    if (this.size > 120_000) this.fail();
    for (const character of text) {
      if (this.tokenKind === 'string') {
        this.token += character;
        if (this.escaped) { this.escaped = false; continue; }
        if (character === '\\') { this.escaped = true; continue; }
        if (character !== '"') continue;
        let value: string;
        try { value = JSON.parse(this.token); } catch { this.fail(); }
        this.token = ''; this.tokenKind = null;
        if (this.stringKey) {
          const frame = this.stack.at(-1);
          if (!frame || frame.kind !== 'object' || frame.keys.has(value)) this.fail();
          frame.keys.add(value); frame.key = value; frame.state = 'colon';
        } else { this.accept(value); if (!this.stack.length) this.ended = true; }
        continue;
      }
      if (this.tokenKind === 'primitive') {
        if (!/[ \t\r\n,\]}]/.test(character)) { this.token += character; continue; }
        this.primitive();
      }
      if (/[ \t\r\n]/.test(character)) continue;
      if (this.ended) this.fail();
      const frame = this.stack.at(-1);
      if (frame?.kind === 'object' && (frame.state === 'key' || frame.state === 'key-or-end')) {
        if (character === '}' && frame.state === 'key-or-end') { this.close(frame); continue; }
        if (character !== '"') this.fail();
        this.tokenKind = 'string'; this.token = '"'; this.stringKey = true; continue;
      }
      if (frame?.kind === 'object' && frame.state === 'colon') {
        if (character !== ':') this.fail();
        frame.state = 'value'; continue;
      }
      if (frame?.state === 'comma-or-end') {
        if (character === ',') { frame.state = frame.kind === 'object' ? 'key' : 'value'; continue; }
        if (character === (frame.kind === 'object' ? '}' : ']')) { this.close(frame); continue; }
        this.fail();
      }
      if (frame?.kind === 'array' && frame.state === 'value-or-end' && character === ']') { this.close(frame); continue; }
      if (character === '{' || character === '[') {
        if (this.stack.length >= 24) this.fail();
        const next: Frame = character === '{'
          ? { kind: 'object', value: Object.create(null), state: 'key-or-end', keys: new Set() }
          : { kind: 'array', value: [], state: 'value-or-end' };
        this.accept(next.value); this.stack.push(next); continue;
      }
      if (character === '"') { this.tokenKind = 'string'; this.token = '"'; this.stringKey = false; continue; }
      if (/[-0-9tfn]/.test(character)) { this.tokenKind = 'primitive'; this.token = character; continue; }
      this.fail();
    }
  }
  private close(frame: Frame) {
    this.complete.add(frame.value); this.stack.pop(); this.revision++;
    if (!this.stack.length) this.ended = true;
  }
  finish() {
    if (this.tokenKind === 'primitive') this.primitive();
    if (!this.ended || this.stack.length || this.tokenKind) this.fail();
    return this.value;
  }
}

