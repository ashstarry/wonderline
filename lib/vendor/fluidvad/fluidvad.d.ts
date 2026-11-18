/* tslint:disable */
/* eslint-disable */

/**
 * Silero VAD: streaming events + offline segmentation. Model is embedded; no fetches.
 */
export class FluidVad {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Samples per frame (512 = 32 ms at 16 kHz).
     */
    static frameSize(): number;
    /**
     * Build the VAD (parses + optimizes the embedded model; do this once).
     * Throws if any option is out of range (NaN, negative durations,
     * thresholds outside [0, 1], negativeThreshold above threshold).
     */
    constructor(options?: VadOptions | null);
    /**
     * Push 16 kHz mono f32 samples of any length; returns boundary events for
     * every completed frame. Partial frames are buffered internally.
     */
    push(samples: Float32Array): VadEvent[];
    /**
     * Reset model + hysteresis state and drop buffered samples.
     */
    reset(): void;
    /**
     * Offline: segment a whole buffer into speech regions, using the same
     * configuration this instance was constructed with.
     */
    segment(samples: Float32Array): Segment[];
    /**
     * Whether the state machine is currently inside speech.
     */
    readonly isSpeaking: boolean;
    /**
     * Speech probability of the most recently processed frame.
     */
    readonly lastProbability: number;
}

/**
 * A detected speech region, seconds.
 */
export class Segment {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly endTime: number;
    readonly startTime: number;
}

/**
 * A speech boundary event.
 */
export class VadEvent {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `true` for SpeechStart, `false` for SpeechEnd.
     */
    readonly isStart: boolean;
    /**
     * Boundary position in samples (16 kHz, padding applied). f64 so long
     * sessions are exact in JS (u64 would surface as BigInt; usize is 32-bit
     * on wasm and wraps after ~74 hours of audio).
     */
    readonly sampleIndex: number;
    /**
     * Boundary position in seconds.
     */
    readonly timeSeconds: number;
}

/**
 * Configuration options; all fields optional on the JS side.
 */
export class VadOptions {
    free(): void;
    [Symbol.dispose](): void;
    constructor();
    set maxSpeechDuration(value: number);
    set minSilenceDuration(value: number);
    set minSpeechDuration(value: number);
    set negativeThreshold(value: number);
    set speechPadding(value: number);
    set threshold(value: number);
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_fluidvad_free: (a: number, b: number) => void;
    readonly __wbg_get_segment_endTime: (a: number) => number;
    readonly __wbg_get_segment_startTime: (a: number) => number;
    readonly __wbg_get_vadevent_isStart: (a: number) => number;
    readonly __wbg_segment_free: (a: number, b: number) => void;
    readonly __wbg_vadevent_free: (a: number, b: number) => void;
    readonly __wbg_vadoptions_free: (a: number, b: number) => void;
    readonly fluidvad_isSpeaking: (a: number) => number;
    readonly fluidvad_lastProbability: (a: number) => number;
    readonly fluidvad_new: (a: number) => [number, number, number];
    readonly fluidvad_push: (a: number, b: number, c: number) => [number, number, number, number];
    readonly fluidvad_reset: (a: number) => void;
    readonly fluidvad_segment: (a: number, b: number, c: number) => [number, number, number, number];
    readonly vadoptions_new: () => number;
    readonly vadoptions_set_maxSpeechDuration: (a: number, b: number) => void;
    readonly vadoptions_set_minSilenceDuration: (a: number, b: number) => void;
    readonly vadoptions_set_minSpeechDuration: (a: number, b: number) => void;
    readonly vadoptions_set_negativeThreshold: (a: number, b: number) => void;
    readonly vadoptions_set_speechPadding: (a: number, b: number) => void;
    readonly vadoptions_set_threshold: (a: number, b: number) => void;
    readonly fluidvad_frameSize: () => number;
    readonly __wbg_get_vadevent_sampleIndex: (a: number) => number;
    readonly __wbg_get_vadevent_timeSeconds: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
