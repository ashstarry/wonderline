import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({
  entryPoints: [new URL('../lib/chinese-voice-activity.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { chineseVoiceStats } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const RATE = 16000;
const silence = seconds => new Int16Array(Math.round(seconds * RATE));
const tone = (seconds, amplitude = .03, frequency = 300, dc = 0) => Int16Array.from(
  { length: Math.round(seconds * RATE) }, (_, i) => Math.round(32768 * (dc + amplitude * Math.sin(2 * Math.PI * frequency * i / RATE))),
);
const join = (...chunks) => {
  const pcm = new Int16Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0; for (const chunk of chunks) { pcm.set(chunk, offset); offset += chunk.length; }
  return pcm;
};

for (const seconds of [0, .01, .2, .6, 12]) {
  test(`digital silence ${seconds}s cannot qualify as speech or create a pause boundary`, () => {
    assert.deepEqual(chineseVoiceStats(silence(seconds)), { voiced: false, silence: seconds });
  });
}
for (const offset of [115, 131, 1800, -1800, 32767, -32768]) {
  test(`constant DC ${offset} cannot qualify as speech`, () => {
    assert.deepEqual(chineseVoiceStats(new Int16Array(RATE).fill(offset)), { voiced: false, silence: 1 });
  });
}
for (const positions of [[100], [310, 330], [1200, 2480], [100, 740, 1380]]) {
  test(`isolated clicks at samples ${positions.join(',')} cannot qualify as speech`, () => {
    const pcm = silence(1); for (const index of positions) pcm[index] = 30000;
    assert.equal(chineseVoiceStats(pcm).voiced, false);
    assert.equal(chineseVoiceStats(pcm).firstPauseEnd, undefined);
  });
}
for (const seconds of [.02, .04]) {
  test(`${seconds}s acoustic bump is too brief to qualify`, () => {
    assert.equal(chineseVoiceStats(join(tone(seconds, .1, 100), silence(.8))).voiced, false);
  });
}
for (const frequency of [220, 300, 450, 800]) {
  test(`quiet harmonic voice at ${frequency}Hz retains the existing energy threshold`, () => {
    const stats = chineseVoiceStats(tone(.2, .0052, frequency));
    assert.equal(stats.voiced, true); assert.equal(stats.silence, 0);
  });
}
test('a quiet utterance with a DC offset is still admitted', () => {
  assert.equal(chineseVoiceStats(tone(.2, .0052, 300, .1)).voiced, true);
});
test('a 60ms short word qualifies immediately, without an additional calibration period', () => {
  const short = tone(.06, .0052);
  assert.equal(chineseVoiceStats(short.subarray(0, 320)).voiced, false);
  assert.equal(chineseVoiceStats(short.subarray(0, 640)).voiced, false);
  assert.equal(chineseVoiceStats(short).voiced, true);
  assert.equal(chineseVoiceStats(join(silence(.2), short)).voiced, true);
});
test('60ms short word followed by quiet produces the exact completed pause cutoff', () => {
  assert.deepEqual(chineseVoiceStats(join(tone(.06), silence(.5))), {
    voiced: true, silence: .5, firstPauseEnd: .56 * RATE,
  });
});
test('trailing quiet below500ms does not create an internal boundary', () => {
  assert.deepEqual(chineseVoiceStats(join(tone(.2), silence(.48))), { voiced: true, silence: .48 });
});
test('the first internal pause remains available when a second utterance already follows it', () => {
  assert.deepEqual(chineseVoiceStats(join(tone(.2), silence(.5), tone(.2))), {
    voiced: true, silence: 0, firstPauseEnd: .7 * RATE,
  });
});
test('multiple pauses return the earliest cut, not the final utterance boundary', () => {
  assert.deepEqual(chineseVoiceStats(join(tone(.2), silence(.5), tone(.2), silence(.8))), {
    voiced: true, silence: .8, firstPauseEnd: .7 * RATE,
  });
});
test('initial silence never becomes a cut before the first word', () => {
  assert.deepEqual(chineseVoiceStats(join(silence(.8), tone(.2), silence(.5))), {
    voiced: true, silence: .5, firstPauseEnd: 1.5 * RATE,
  });
});
test('a new voice onset near500ms is not cut before its third active frame', () => {
  const prefix = join(tone(.2), silence(.48));
  for (const seconds of [.02, .04, .06, .2]) {
    const stats = chineseVoiceStats(join(prefix, tone(seconds)));
    assert.equal(stats.voiced, true); assert.equal(stats.silence, 0);
    assert.equal(stats.firstPauseEnd, undefined);
  }
});
test('single transients after valid speech conservatively postpone the quiet boundary', () => {
  const click = silence(.02); click[100] = 30000;
  const stats = chineseVoiceStats(join(tone(.2), silence(.4), click, silence(.5)));
  assert.equal(stats.firstPauseEnd, Math.round(1.12 * RATE));
  assert.equal(stats.silence, .5);
});
test('frames below the original energy threshold stay unvoiced', () => {
  assert.equal(chineseVoiceStats(tone(.4, .003)).voiced, false);
});
test('continuous low-frequency sound is not advertised as filtered without a validated VAD', () => {
  assert.equal(chineseVoiceStats(tone(.4, .03, 100)).voiced, true);
});
test('analysis leaves the original PCM, including its DC offset, unchanged', () => {
  const backing = join(silence(.2), tone(.2, .01, 300, .1), silence(.5));
  const original = backing.slice(); const view = backing.subarray(3200);
  assert.equal(chineseVoiceStats(view).voiced, true);
  assert.deepEqual(backing, original);
});
test('incomplete final frame is retained by caller, never fabricated as an extra voice frame', () => {
  const pcm = tone(.06);
  assert.equal(chineseVoiceStats(pcm.subarray(0, 959)).voiced, false);
  assert.equal(chineseVoiceStats(pcm).voiced, true);
});
