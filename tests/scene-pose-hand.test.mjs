import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const compiledPath = new URL('../.sites-runtime/scene-pose-hand-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../components/scene-pose-hand.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
await writeFile(compiledPath, compiled.outputFiles[0].text);
const { createPoseHand } = await import(compiledPath.href);
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
  inverse() {
    const { a, b, c, d, e, f } = this, det = a*d-b*c;
    return new Matrix([d/det,-b/det,-c/det,a/det,(c*f-d*e)/det,(b*e-a*f)/det]);
  }
  toString() { return `matrix(${[this.a, this.b, this.c, this.d, this.e, this.f].join(',')})`; }
}

function fixture({ box = { x: 20, y: 40, width: 100, height: 200 }, screenScale = 1, parentScale = screenScale } = {}) {
  const names = ['document', 'DOMMatrix'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const nodes = [];
  function makeNode() {
    const attrs = new Map(), children = [];
    const node = {
      attrs, children, style: {}, innerHTML: '', isConnected: false, animations: [],
      setAttribute: (name, value) => attrs.set(name, value),
      getAttribute: name => attrs.get(name) ?? null,
      appendChild(child) { children.push(child); child.parentNode = this; child.isConnected = true; return child; },
      remove() { node.isConnected = false; if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1); },
      animate(frames, timing) {
        const animation = { frames, timing, startTime: null, cancelled: false, playbackRate: 1, cancel() { this.cancelled = true; } };
        this.animations.push(animation); return animation;
      },
    };
    nodes.push(node); return node;
  }
  Object.defineProperty(globalThis, 'DOMMatrix', { value: Matrix, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', { value: { createElementNS: () => makeNode() }, configurable: true, writable: true });
  const canvas = makeNode();
  canvas.getScreenCTM = () => new Matrix([screenScale, 0, 0, screenScale, 0, 0]);
  const element = { getBBox: () => box, getAttribute: () => 'teddy', parentElement: { getScreenCTM: () => new Matrix([parentScale, 0, 0, parentScale, 0, 0]) } };
  return { canvas, element, nodes, restore() {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  } };
}

function sourceAnimation(frames = [{ transform: 'matrix(1,0,0,1,-100,-50)' }, { transform: 'matrix(1,0,0,1,0,0)' }]) {
  const timing = { duration: 620, easing: 'cubic-bezier(.22,.7,.25,1)' };
  return { effect: { getKeyframes: () => frames, getTiming: () => timing }, playbackRate: 1.2, startTime: 1234, ready: Promise.resolve(), frames, timing };
}

test('gripper holds the side midpoint, leaving the delete and resize corners unobstructed', async () => {
  const f = fixture();
  try {
    const decoration = createPoseHand(f.canvas, f.element), source = sourceAnimation();
    assert.equal(f.canvas.children.length, 0, 'creating decoration must not add pigment');
    decoration.follow(source);
    const root = f.canvas.children[0], motion = root.children[0], anchor = motion.children[0];
    assert.equal(anchor.getAttribute('transform'), 'translate(20 140)');
    assert.equal(root.getAttribute('data-playback-artifact'), 'pose-hand');
    assert.equal(root.getAttribute('data-pose-hand-for'), 'teddy');
    assert.equal(root.getAttribute('pointer-events'), 'none');
    assert.equal(root.getAttribute('aria-hidden'), 'true');
    assert.equal(root.getAttribute('data-manual-object'), null, 'decoration must never become selectable artwork');
    assert.deepEqual(motion.animations[0].frames, source.frames);
    assert.deepEqual(motion.animations[0].timing, source.timing);
    assert.equal(motion.animations[0].playbackRate, 1.2);
    await Promise.resolve();
    assert.equal(motion.animations[0].startTime, source.startTime);
    decoration.dispose();
    assert.equal(f.canvas.children.length, 0);
    assert.equal(motion.animations[0].cancelled, true);
  } finally { f.restore(); }
});

test('viewport and object-scale compensation keeps the gripper small on large and small screens', () => {
  for (const screenScale of [.4, 1, 2]) for (const parentScale of [.5, 1, 3]) for (const motionScale of [1, 2.5]) {
    const f = fixture({ screenScale, parentScale });
    try {
      const decoration = createPoseHand(f.canvas, f.element);
      decoration.follow(sourceAnimation([{ transform: `matrix(${motionScale},0,0,${motionScale},-100,-50)` }, { transform: 'matrix(1,0,0,1,0,0)' }]));
      const hand = f.canvas.children[0].children[0].children[0].children[0];
      const scale = Number(hand.getAttribute('transform').slice(6, -1));
      assert.ok(Math.abs(scale * parentScale * motionScale - .82) < 1e-9, 'peak physical icon size stays constant');
      decoration.dispose();
    } finally { f.restore(); }
  }
});

test('disposal before animation readiness cannot reconnect a stale gripper', async () => {
  const f = fixture();
  try {
    let ready;
    const source = sourceAnimation(); source.ready = new Promise(resolve => { ready = resolve; });
    const decoration = createPoseHand(f.canvas, f.element);
    decoration.follow(source);
    const animation = f.canvas.children[0].children[0].animations[0];
    decoration.dispose(); ready(); await Promise.resolve();
    assert.equal(f.canvas.children.length, 0);
    assert.equal(animation.startTime, null);
    assert.equal(animation.cancelled, true);
  } finally { f.restore(); }
});

test('missing or invalid measurements leave the existing object and canvas untouched', () => {
  for (const mode of ['box', 'screen', 'parent', 'throws']) {
    const f = fixture();
    try {
      if (mode === 'box') f.element.getBBox = () => ({ x: NaN, y: 0, width: 1, height: 1 });
      if (mode === 'screen') f.canvas.getScreenCTM = () => null;
      if (mode === 'parent') f.element.parentElement.getScreenCTM = () => null;
      if (mode === 'throws') f.element.getBBox = () => { throw new Error('detached'); };
      assert.equal(createPoseHand(f.canvas, f.element), undefined);
      assert.equal(f.canvas.children.length, 0);
    } finally { f.restore(); }
  }
});
