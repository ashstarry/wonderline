export const QWEN_REALTIME_MODEL = 'qwen3-asr-flash-realtime';
export const QWEN_SESSION = {
  input_audio_format: 'pcm', sample_rate: 16000, input_audio_transcription: {},
  turn_detection: { type: 'server_vad', threshold: 0.2, silence_duration_ms: 500 },
};
export type SpeechUpdate = {
  sessionId: string; revision: number; partial: string; stableText: string;
  segments: Array<{ id: string; text: string }>; done: boolean;
  mode: 'qwen-realtime' | 'openrouter-rolling'; elapsedMs: number; receivedSeconds: number;
};
/** Qwen sends a confirmed prefix + a provisional suffix, NOT a token delta. */
export class QwenTranscript {
  private items = new Map<string, { text: string; final: boolean }>();
  private revision = 0;
  constructor(private sessionId: string, private started = Date.now()) {}
  consume(event: Record<string, unknown>, bytes: number): SpeechUpdate | null {
    const type = event.type;
    if (!['conversation.item.input_audio_transcription.text', 'conversation.item.input_audio_transcription.completed', 'session.finished'].includes(String(type))) return null;
    const id = typeof event.item_id === 'string' ? event.item_id : '';
    const segments: SpeechUpdate['segments'] = [];
    const prior = this.items.get(id);
    if (id && !prior?.final) {
      const final = type === 'conversation.item.input_audio_transcription.completed';
      const text = final ? String(event.transcript ?? '') : String(event.text ?? '') + String(event.stash ?? '');
      this.items.set(id, { text: text.slice(0, 12000), final });
      if (final && text.trim()) segments.push({ id: `${this.sessionId}:${id}`, text: text.trim() });
    }
    const values = [...this.items.values()];
    return { sessionId: this.sessionId, revision: ++this.revision,
      partial: values.filter(x => !x.final).map(x => x.text).join(' '),
      stableText: values.filter(x => x.final).map(x => x.text).join(' '), segments,
      done: type === 'session.finished', mode: 'qwen-realtime', elapsedMs: Date.now() - this.started, receivedSeconds: bytes / 32000 };
  }
}
