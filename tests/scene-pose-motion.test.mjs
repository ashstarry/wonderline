import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// The real decorative SVG is checked in the browser. Here a stub isolates the
// established pose lifecycle, so a cosmetic addition cannot change its timing.
const compiledPath = new URL('../.sites-runtime/scene-pose-motion-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../components/scene-pose-motion.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'decorative-hand-fixture', setup(builder) {
    builder.onResolve({ filter: /(?:^|\/)scene-pose-hand$/ }, () => ({ path: 'pose-hand', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: 'export function createPoseHand(canvas, element) { return globalThis.__poseHandFixture(canvas, element); }',
      loader: 'js',
    }));
  } }],
});
await writeFile(compiledPath, compiled.outputFiles[0].text);
const { ScenePoseMotion } = await import(compiledPath.href);
after(() => unlink(compiledPath));

class Matrix {
  constructor(values = [1, 0, 0, 1, 0, 0]) {
    if (values === 'none') values = [1, 0, 0, 1, 0, 0];
    if (typeof values === 'string') values = values.slice(values.indexOf('(') + 1, -1).split(',').map(Number);
    [this.a, this.b, this.c, this.d, this.e, this.f] = values;
  }
  multiply(n) {
    const m = this;
    return new Matrix([m.a*n.a+m.c*n.b, m.b*n.a+m.d*n.b, m.a*n.c+m.c*n.d, m.b*n.c+m.d*n.d, m.a*n.e+m.c*n.f+m.e, m.b*n.e+m.d*n.f+m.f]);
  }
  toString() { return `matrix(${[this.a, this.b, this.c, this.d, this.e, this.f].join(',')})`; }
}

function fixture(ids = ['castle']) {
  const names = ['DOMMatrix', 'getComputedStyle', 'performance', '__poseHandFixture'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const hands = [], nodes = new Map();
  const clock = { now: 1000 };
  const factory = { enabled: true };
  for (const id of ids) {
    const attrs = new Map([['data-manual-object', id]]);
    const node = {
      isConnected: true, renderedTransform: 'none', animations: [],
      getAttribute: name => attrs.get(name) ?? null,
      setAttribute: (name, value) => attrs.set(name, value),
      removeAttribute: name => attrs.delete(name),
      animate(keyframes, options) {
        const animation = { keyframes, options, cancelled: false, onfinish: null,
          cancel() { this.cancelled = true; node.renderedTransform = 'none'; },
          finish() { node.renderedTransform = 'none'; this.onfinish?.(); },
        };
        node.animations.push(animation);
        node.renderedTransform = keyframes[0].transform;
        return animation;
      },
    };
    nodes.set(id, node);
  }
  const canvas = { querySelectorAll(selector) {
    assert.ok(['[data-manual-object]', '[data-pose-moving]'].includes(selector), selector);
    return [...nodes.values()].filter(node => node.isConnected && (selector === '[data-manual-object]' || node.getAttribute('data-pose-moving')));
  } };
  const install = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  install('DOMMatrix', Matrix);
  install('getComputedStyle', node => ({ transform: node.renderedTransform }));
  install('performance', { now: () => clock.now });
  install('__poseHandFixture', (owner, element) => {
    assert.equal(owner, canvas);
    if (!factory.enabled) return undefined;
    const hand = { element, followed: [], disposed: false, disposeCalls: 0,
      follow(animation) { this.followed.push(animation); },
      dispose() { this.disposed = true; this.disposeCalls++; },
    };
    hands.push(hand);
    return hand;
  });
  const motion = new ScenePoseMotion(canvas);
  return { motion, canvas, nodes, clock, hands, factory,
    restore() {
      motion.clear();
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

const change = (id = 'castle', from = { x: 10, y: 20, scale: 1 }, to = { x: 110, y: 70, scale: 1 }) =>
  new Map([[id, { before: Object.freeze(from), after: Object.freeze(to) }]]);

test('decoration shares the existing animation without changing its keyframes, duration or reconciliation boundary', () => {
  const f = fixture();
  try {
    const updates = change(), before = JSON.stringify([...updates]);
    const play = f.motion.prepare(updates, false), node = f.nodes.get('castle');
    assert.equal(node.animations.length, 0, 'prepare must leave final geometry measurable');
    assert.equal(f.hands.length, 0, 'decoration starts only after playback reconciliation');
    play();
    assert.equal(node.animations.length, 1);
    const animation = node.animations[0];
    assert.deepEqual(animation.keyframes, [{ transform: 'matrix(1,0,0,1,-100,-50)' }, { transform: 'matrix(1,0,0,1,0,0)' }]);
    assert.deepEqual(animation.options, { duration: 620, easing: 'cubic-bezier(.22,.7,.25,1)' });
    assert.equal(node.getAttribute('data-pose-moving'), 'true');
    assert.equal(f.hands.length, 1);
    assert.deepEqual(f.hands[0].followed, [animation], 'the hand follows the exact existing animation');
    assert.equal(JSON.stringify([...updates]), before, 'decoration cannot mutate canonical poses');
    animation.finish();
    assert.equal(node.getAttribute('data-pose-moving'), null);
    assert.equal(f.hands[0].disposed, true);
  } finally { f.restore(); }
});

test('an unrelated streamed update retains the original deadline and stale finish cannot hide the replacement hand', () => {
  const f = fixture();
  try {
    f.motion.prepare(change(), false)();
    const node = f.nodes.get('castle'), first = node.animations[0], staleFinish = first.onfinish;
    node.renderedTransform = 'matrix(1,0,0,1,-35,-15)';
    f.clock.now += 220;
    const resume = f.motion.prepare(new Map(), false);
    assert.equal(first.cancelled, true);
    assert.equal(f.hands[0].disposed, true);
    assert.equal(node.getAttribute('data-pose-moving'), null);
    assert.equal(node.renderedTransform, 'none', 'canonical destination is available during reconciliation');
    resume();
    const replacement = node.animations[1];
    assert.deepEqual(replacement.options, { duration: 400, easing: 'cubic-bezier(.22,.7,.25,1)' });
    assert.equal(replacement.keyframes[0].transform, 'matrix(1,0,0,1,-35,-15)');
    assert.equal(f.hands.length, 2);
    staleFinish();
    assert.equal(node.getAttribute('data-pose-moving'), 'true');
    assert.equal(f.hands[1].disposed, false);
    replacement.finish();
    assert.equal(f.hands[1].disposed, true);
    assert.equal(node.getAttribute('data-pose-moving'), null);
  } finally { f.restore(); }
});

test('a second move preserves existing interrupted-motion composition and starts no separate hand timeline', () => {
  const f = fixture();
  try {
    f.motion.prepare(change(), false)();
    const node = f.nodes.get('castle');
    node.renderedTransform = 'matrix(1,0,0,1,-40,-20)';
    f.clock.now += 180;
    f.motion.prepare(change('castle', { x: 110, y: 70, scale: 1 }, { x: 160, y: 100, scale: 1 }), false)();
    assert.equal(f.hands[0].disposed, true);
    assert.equal(node.animations.length, 2);
    assert.equal(node.animations[1].keyframes[0].transform, 'matrix(1,0,0,1,-90,-50)');
    assert.equal(node.animations[1].options.duration, 620);
    assert.deepEqual(f.hands[1].followed, [node.animations[1]]);
  } finally { f.restore(); }
});

test('reset, reduced motion and repeated clear remove decoration without restarting artwork', () => {
  const f = fixture();
  try {
    f.motion.prepare(change(), false)();
    const node = f.nodes.get('castle'), animation = node.animations[0];
    f.motion.prepare(change(), true)();
    assert.equal(animation.cancelled, true);
    assert.equal(f.hands[0].disposed, true);
    assert.equal(node.getAttribute('data-pose-moving'), null);
    assert.equal(node.animations.length, 1);
    assert.equal(f.hands.length, 1);
    f.motion.clear();
    f.motion.clear();
    assert.equal(node.animations.length, 1);
    assert.equal(f.hands.length, 1);
    f.motion.prepare(change(), false)();
    f.motion.clear();
    assert.equal(node.animations[1].cancelled, true);
    assert.equal(f.hands[1].disposed, true);
    assert.equal(node.getAttribute('data-pose-moving'), null);
  } finally { f.restore(); }
});

test('removed objects and expired motion never resurrect a cursor on the next streamed update', () => {
  for (const expired of [false, true]) {
    const f = fixture();
    try {
      f.motion.prepare(change(), false)();
      const node = f.nodes.get('castle');
      if (expired) f.clock.now += 700;
      else node.isConnected = false;
      f.motion.prepare(new Map(), false)();
      assert.equal(f.hands[0].disposed, true);
      assert.equal(node.animations.length, 1);
      assert.equal(f.hands.length, 1);
      assert.equal(node.getAttribute('data-pose-moving'), null);
      f.motion.prepare(change('missing'), false)();
      assert.equal(f.hands.length, 1);
    } finally { f.restore(); }
  }
});

test('unmeasurable decoration is optional and cannot prevent the original move from finishing', () => {
  const f = fixture();
  try {
    f.factory.enabled = false;
    f.motion.prepare(change(), false)();
    const node = f.nodes.get('castle');
    assert.equal(node.animations.length, 1);
    assert.equal(node.animations[0].options.duration, 620);
    assert.equal(f.hands.length, 0);
    node.animations[0].finish();
    assert.equal(node.getAttribute('data-pose-moving'), null);
  } finally { f.restore(); }
});

test('simultaneous objects finish independently without altering one another or the shared scene', () => {
  const f = fixture(['castle', 'tree']);
  try {
    f.motion.prepare(new Map([...change('castle'), ...change('tree')]), false)();
    const castle = f.nodes.get('castle'), tree = f.nodes.get('tree');
    assert.equal(f.hands.length, 2);
    castle.animations[0].finish();
    assert.equal(f.hands[0].disposed, true);
    assert.equal(f.hands[1].disposed, false);
    assert.equal(tree.getAttribute('data-pose-moving'), 'true');
    assert.equal(tree.animations[0].cancelled, false);
    tree.animations[0].finish();
    assert.ok(f.hands.every(hand => hand.disposed));
  } finally { f.restore(); }
});
