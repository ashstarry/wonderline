/* @ts-self-types="./fluidvad.d.ts" */

/**
 * Silero VAD: streaming events + offline segmentation. Model is embedded; no fetches.
 */
export class FluidVad {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FluidVadFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_fluidvad_free(ptr, 0);
    }
    /**
     * Samples per frame (512 = 32 ms at 16 kHz).
     * @returns {number}
     */
    static frameSize() {
        const ret = wasm.fluidvad_frameSize();
        return ret >>> 0;
    }
    /**
     * Whether the state machine is currently inside speech.
     * @returns {boolean}
     */
    get isSpeaking() {
        const ret = wasm.fluidvad_isSpeaking(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Speech probability of the most recently processed frame.
     * @returns {number}
     */
    get lastProbability() {
        const ret = wasm.fluidvad_lastProbability(this.__wbg_ptr);
        return ret;
    }
    /**
     * Build the VAD (parses + optimizes the embedded model; do this once).
     * Throws if any option is out of range (NaN, negative durations,
     * thresholds outside [0, 1], negativeThreshold above threshold).
     * @param {VadOptions | null} [options]
     */
    constructor(options) {
        let ptr0 = 0;
        if (!isLikeNone(options)) {
            _assertClass(options, VadOptions);
            ptr0 = options.__destroy_into_raw();
        }
        const ret = wasm.fluidvad_new(ptr0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        FluidVadFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Push 16 kHz mono f32 samples of any length; returns boundary events for
     * every completed frame. Partial frames are buffered internally.
     * @param {Float32Array} samples
     * @returns {VadEvent[]}
     */
    push(samples) {
        const ptr0 = passArrayF32ToWasm0(samples, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.fluidvad_push(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Reset model + hysteresis state and drop buffered samples.
     */
    reset() {
        wasm.fluidvad_reset(this.__wbg_ptr);
    }
    /**
     * Offline: segment a whole buffer into speech regions, using the same
     * configuration this instance was constructed with.
     * @param {Float32Array} samples
     * @returns {Segment[]}
     */
    segment(samples) {
        const ptr0 = passArrayF32ToWasm0(samples, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.fluidvad_segment(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
}
if (Symbol.dispose) FluidVad.prototype[Symbol.dispose] = FluidVad.prototype.free;

/**
 * A detected speech region, seconds.
 */
export class Segment {
    static __wrap(ptr) {
        const obj = Object.create(Segment.prototype);
        obj.__wbg_ptr = ptr;
        SegmentFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SegmentFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_segment_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get endTime() {
        const ret = wasm.__wbg_get_segment_endTime(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get startTime() {
        const ret = wasm.__wbg_get_segment_startTime(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) Segment.prototype[Symbol.dispose] = Segment.prototype.free;

/**
 * A speech boundary event.
 */
export class VadEvent {
    static __wrap(ptr) {
        const obj = Object.create(VadEvent.prototype);
        obj.__wbg_ptr = ptr;
        VadEventFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        VadEventFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_vadevent_free(ptr, 0);
    }
    /**
     * `true` for SpeechStart, `false` for SpeechEnd.
     * @returns {boolean}
     */
    get isStart() {
        const ret = wasm.__wbg_get_vadevent_isStart(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Boundary position in samples (16 kHz, padding applied). f64 so long
     * sessions are exact in JS (u64 would surface as BigInt; usize is 32-bit
     * on wasm and wraps after ~74 hours of audio).
     * @returns {number}
     */
    get sampleIndex() {
        const ret = wasm.__wbg_get_vadevent_sampleIndex(this.__wbg_ptr);
        return ret;
    }
    /**
     * Boundary position in seconds.
     * @returns {number}
     */
    get timeSeconds() {
        const ret = wasm.__wbg_get_vadevent_timeSeconds(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) VadEvent.prototype[Symbol.dispose] = VadEvent.prototype.free;

/**
 * Configuration options; all fields optional on the JS side.
 */
export class VadOptions {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        VadOptionsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_vadoptions_free(ptr, 0);
    }
    constructor() {
        const ret = wasm.vadoptions_new();
        this.__wbg_ptr = ret;
        VadOptionsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} v
     */
    set maxSpeechDuration(v) {
        wasm.vadoptions_set_maxSpeechDuration(this.__wbg_ptr, v);
    }
    /**
     * @param {number} v
     */
    set minSilenceDuration(v) {
        wasm.vadoptions_set_minSilenceDuration(this.__wbg_ptr, v);
    }
    /**
     * @param {number} v
     */
    set minSpeechDuration(v) {
        wasm.vadoptions_set_minSpeechDuration(this.__wbg_ptr, v);
    }
    /**
     * @param {number} v
     */
    set negativeThreshold(v) {
        wasm.vadoptions_set_negativeThreshold(this.__wbg_ptr, v);
    }
    /**
     * @param {number} v
     */
    set speechPadding(v) {
        wasm.vadoptions_set_speechPadding(this.__wbg_ptr, v);
    }
    /**
     * @param {number} v
     */
    set threshold(v) {
        wasm.vadoptions_set_threshold(this.__wbg_ptr, v);
    }
}
if (Symbol.dispose) VadOptions.prototype[Symbol.dispose] = VadOptions.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_92b29b0548f8b746: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_segment_new: function(arg0) {
            const ret = Segment.__wrap(arg0);
            return ret;
        },
        __wbg_vadevent_new: function(arg0) {
            const ret = VadEvent.__wrap(arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./fluidvad_bg.js": import0,
    };
}

const FluidVadFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_fluidvad_free(ptr, 1));
const SegmentFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_segment_free(ptr, 1));
const VadEventFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_vadevent_free(ptr, 1));
const VadOptionsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_vadoptions_free(ptr, 1));

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('fluidvad_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
