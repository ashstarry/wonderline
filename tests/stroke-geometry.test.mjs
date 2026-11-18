import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const temporary = new URL('../.sites-runtime/stroke-geometry-test.mjs', import.meta.url);
const colorTemporary = new URL('../.sites-runtime/natural-color-test.mjs', import.meta.url);
const queueTemporary = new URL('../.sites-runtime/stroke-geometry-queue.mjs', import.meta.url);
const regionsTemporary = new URL('../.sites-runtime/stroke-geometry-regions.mjs', import.meta.url);
const paceTemporary = new URL('../.sites-runtime/stroke-geometry-pace.mjs', import.meta.url);
const soundsTemporary = new URL('../.sites-runtime/stroke-geometry-sounds.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const source = await readFile(new URL('../components/svg-stroke-playback.ts', import.meta.url), 'utf8');
await writeFile(temporary, compile(source).replace("'./stroke-playback-queue'", "'./stroke-geometry-queue.mjs'").replace("'./natural-color-strokes'", "'./natural-color-test.mjs'").replace("'./drawing-sounds'", "'./stroke-geometry-sounds.mjs'").replace("'./painter-regions'", "'./stroke-geometry-regions.mjs'").replace("'./drawing-pace'", "'./stroke-geometry-pace.mjs'"));
await writeFile(paceTemporary, compile(await readFile(new URL('../components/drawing-pace.ts', import.meta.url), 'utf8')));
await writeFile(regionsTemporary, compile(await readFile(new URL('../components/painter-regions.ts', import.meta.url), 'utf8')));
await writeFile(soundsTemporary, compile(await readFile(new URL('../components/drawing-sounds.ts', import.meta.url), 'utf8')));
await writeFile(queueTemporary, compile(await readFile(new URL('../components/stroke-playback-queue.ts', import.meta.url), 'utf8')));
await writeFile(colorTemporary, compile(await readFile(new URL('../components/natural-color-strokes.ts', import.meta.url), 'utf8')));
const { planNaturalColor, contactColorStrokes, MAX_COLOR_BRUSH_PX, distanceToPaintStroke, paintStrokeReaches, naturalColorStrokeDuration, penLiftDuration, handProgress } = await import(colorTemporary.href);
const { splitStrokeSubpaths, createBrushSweep, removePlaybackArtifacts, VirtualPen, DrawingFrameClock, outlinePlaybackDuration, colorPlaybackDuration, isBroadColorArea, playbackBounds, erasurePlaybackDuration, projectedPathLength, virtualToolScale, strokeVisualIdentity, freezePaintDependencies, retainViewportStrokeKeys, eraserMayTouch } = await import(temporary.href);
after(() => Promise.all([unlink(temporary), unlink(queueTemporary), unlink(colorTemporary),unlink(soundsTemporary),unlink(regionsTemporary),unlink(paceTemporary)]));

// Only the browser's endpoint calculation is mocked. These fixtures use straight
// segments, making the expected relative moveto endpoints unambiguous.
class FakePath {
  tagName = 'path';
  constructor(d) { this.d = d; }
  getAttribute(name) { return name === 'd' ? this.d : null; }
  setAttribute(name, value) { if (name === 'd') this.d = value; }
  cloneNode() { return new FakePath(this.d); }
  getTotalLength() { return 10; }
  getPointAtLength() {
    const tokens = this.d.match(/[MLmlZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g);
    let x = 0, y = 0, origin = null, command;
    for (let i = 0; i < tokens.length;) {
      if (/^[MLmlZz]$/.test(tokens[i])) command = tokens[i++];
      if (command.toUpperCase() === 'Z') { [x, y] = origin; break; }
      const dx = Number(tokens[i++]), dy = Number(tokens[i++]);
      if (command === command.toLowerCase()) { x += dx; y += dy; } else { x = dx; y = dy; }
      if (command.toUpperCase() === 'M') { origin = [x, y]; command = command === 'M' ? 'L' : 'l'; }
    }
    return { x, y };
  }
}

test('separate absolute subpaths become separate pen-down strokes', () => {
  const parts = splitStrokeSubpaths(new FakePath('M 0 0 L 20 20 M 40 20 L 50 40'));
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map(part => part.getPointAtLength()), [{ x: 20, y: 20 }, { x: 50, y: 40 }]);
});

test('relative moveto preserves the previous endpoint and following implicit relative segments', () => {
  const parts = splitStrokeSubpaths(new FakePath('M 10 20 L 30 40 m 5 -10 2 3'));
  assert.equal(parts[1].d, 'M 35 30 l 2 3');
  assert.deepEqual(parts[1].getPointAtLength(), { x: 37, y: 33 });
});

test('relative moveto after a closed contour starts from its closed endpoint', () => {
  const parts = splitStrokeSubpaths(new FakePath('M 10 20 L 30 40 Z m .5 -2.5 L 70 80'));
  assert.match(parts[1].d, /^M 10\.5 17\.5 L 70 80$/);
});

test('the existing eraser sweep remains finite for tiny shapes', () => {
  for (const box of [{ x: -100, y: -50, width: 200, height: 100 }, { x: 0, y: 0, width: 0, height: .1 }]) {
    const sweep = createBrushSweep(box);
    assert.equal((sweep.d.match(/M /g) ?? []).length, 1);
    assert.ok((sweep.d.match(/ L /g) ?? []).length >= 3);
    assert.ok((sweep.d.match(/ Q /g) ?? []).length >= 2);
    assert.ok(sweep.strokeWidth > 0 && Number.isFinite(sweep.strokeWidth));
    assert.ok(sweep.x <= box.x && sweep.y <= box.y);
    assert.ok(sweep.x + sweep.width >= box.x + box.width);
    assert.ok(sweep.y + sweep.height >= box.y + box.height);
  }
});

test('small strokes remain visible while larger contours finish without delaying the conversation', () => {
  const smallCircle = outlinePlaybackDuration(2 * Math.PI * 12, true);
  assert.ok(smallCircle >= 90 && smallCircle <= 160);
  assert.ok(outlinePlaybackDuration(10) >= 50);
  assert.ok(outlinePlaybackDuration(10) < smallCircle);
  const circleLength = 2 * Math.PI * 50;
  assert.ok(outlinePlaybackDuration(circleLength, true) > smallCircle);
  assert.ok(outlinePlaybackDuration(circleLength, true) < 750);
  assert.ok(outlinePlaybackDuration(circleLength * 3, true) < 2300);
  assert.equal(outlinePlaybackDuration(circleLength * 3, true), outlinePlaybackDuration(circleLength, true) * 3);
  assert.ok(outlinePlaybackDuration(20000, true) >= 20000 / 680 * 1000, 'a long real contour cannot be compressed into a frantic 1.8-second gesture');
});

test('paint speed follows real travel distance instead of compressing long paths to a deadline', () => {
  assert.ok(colorPlaybackDuration(100) >= 120);
  assert.ok(colorPlaybackDuration(1000) > 1000);
  assert.equal(colorPlaybackDuration(20000), 20000 / (690 * .85) * 1000);
  for (const length of [0, 10, 100, 1000, 20000]) assert.ok(erasurePlaybackDuration(length) >= 180 && erasurePlaybackDuration(length) <= 1400);
});

test('trajectory length measures actual displayed scaling, including a nonuniform transform', () => {
  const radius = 50, circumference = 2 * Math.PI * radius;
  const circle = distance => ({ x: radius * Math.cos(distance / radius), y: radius * Math.sin(distance / radius) });
  const normal = projectedPathLength(circumference, circle, { a: 1, b: 0, c: 0, d: 1 });
  const large = projectedPathLength(circumference, circle, { a: 3, b: 0, c: 0, d: 3 });
  assert.ok(Math.abs(normal - circumference) < circumference * .001);
  assert.ok(Math.abs(large - normal * 3) < .001);
  const diagonal = projectedPathLength(Math.sqrt(200), distance => ({ x: distance / Math.SQRT2, y: distance / Math.SQRT2 }), { a: 3, b: 0, c: 0, d: 2 });
  assert.ok(Math.abs(diagonal - Math.hypot(30, 20)) < .001);
});

test('rotated and reflected uniform transforms have exact length without native point sampling', () => {
  const noSample = () => { throw new Error('uniform paths must not be sampled'); };
  for (const scale of [.25, 1, 3.5]) for (const angle of [0, .38, 1.9]) for (const reflection of [-1, 1]) {
    const a = Math.cos(angle) * scale, b = Math.sin(angle) * scale;
    const c = -Math.sin(angle) * scale * reflection, d = Math.cos(angle) * scale * reflection;
    assert.ok(Math.abs(projectedPathLength(137.25, noSample, {a,b,c,d}) - 137.25 * scale) < 1e-8);
  }
});

test('fast local coverage preserves round caps, bends, tiny segments and distant exclusions', () => {
  const strokes = [
    {points:[{x:0,y:0},{x:100,y:0}]},
    {points:[{x:-30,y:20},{x:0,y:-40},{x:25,y:10},{x:28,y:10.0001}]},
    {points:[{x:4,y:5},{x:4,y:5},{x:4.00001,y:5.00001}]},
  ].map(stroke=>({...stroke,d:'',width:10}));
  for (const stroke of strokes) for (const radius of [0, .5, 3, 12, 50]) {
    for (let x=-70; x<=140; x+=3.7) for (let y=-80; y<=100; y+=4.3) {
      const point={x,y};
      assert.equal(paintStrokeReaches(point,stroke,radius),distanceToPaintStroke(point,stroke)<=radius);
    }
  }
  assert.equal(paintStrokeReaches({x:-5,y:0},strokes[0],5),true);
  assert.equal(paintStrokeReaches({x:-5.01,y:0},strokes[0],5),false);
});

test('the pen and eraser retain screen size on narrow canvases without moving their tip', () => {
  assert.equal(virtualToolScale({ a: .476, b: 0, c: 0, d: .476 }) * .476, 1);
  assert.equal(virtualToolScale({ a: 2, b: 0, c: 0, d: 2 }), .5);
  assert.equal(virtualToolScale({ a: 0, b: .5, c: -.5, d: 0 }), 2);
});

test('a long blocked frame advances only a short arc instead of completing the contour', () => {
  const clock = new DrawingFrameClock();
  clock.reset(100);
  assert.equal(clock.advance(116), 16);
  assert.equal(clock.advance(616), 56);
  assert.ok((clock.elapsed - 16) / outlinePlaybackDuration(75, true) < .5);
  assert.equal(clock.advance(632), 72);
  clock.resume(20000);
  assert.equal(clock.advance(20016), 88);
  clock.reset(30000);
  assert.equal(clock.advance(30016), 16);
});

test('steady frames retain natural elapsed time without accumulating a speed penalty', () => {
  const clock = new DrawingFrameClock();
  clock.reset(0);
  for (let frame = 1; frame <= 120; frame++) clock.advance(frame * (1000 / 60));
  assert.ok(Math.abs(clock.elapsed - 2000) < .001);
});

function painted(point, plan) { return plan.strokes.some(stroke => distanceToPaintStroke(point, stroke) <= stroke.width / 2); }
function totalPaintDuration(plan, scale = 1, medium = 'crayon') {
  return plan.strokes.reduce((total, stroke, index) => {
    const length = stroke.points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - stroke.points[i].x, point.y - stroke.points[i].y), 0) * scale;
    const previous = plan.strokes[index - 1]?.points.at(-1), first = stroke.points[0];
    return total + naturalColorStrokeDuration(length, medium, plan.broad) + (previous ? penLiftDuration(Math.hypot(previous.x - first.x, previous.y - first.y) * scale) : 0);
  }, 0);
}

test('a meadow uses independent local curved gestures with complete coverage and no full-width swipe', () => {
  const box = { x: 0, y: 340, width: 1000, height: 300 };
  for (const scale of [.45, 1, 1.5]) {
    const plan = planNaturalColor(box, { scale });
    assert.equal(plan.broad, true);
    assert.ok(plan.strokes.length >= 8 && plan.strokes.length < 160);
    assert.ok(totalPaintDuration(plan, scale) < 30000, 'large fills retain bounded travel with a visibly honest brush footprint');
    for (const stroke of plan.strokes) {
      assert.equal((stroke.d.match(/M /g) ?? []).length, 1);
      assert.match(stroke.d, / Q /);
      const width = Math.max(...stroke.points.map(p => p.x)) - Math.min(...stroke.points.map(p => p.x));
      assert.ok(width < box.width * .6, 'no brush traverses the whole meadow width');
    }
    for (let y = box.y; y <= box.y + box.height; y += 10) for (let x = 0; x <= box.width; x += 10) assert.ok(painted({ x, y }, plan), `unpainted meadow at ${x},${y}`);
  }
});

test('circle and ellipse color follows their form, covers the interior and retains separate lifted arcs', () => {
  for (const [rx, ry] of [[50, 50], [90, 45], [8, 5]]) {
    const ellipse = { cx: 120, cy: 80, rx, ry };
    const plan = planNaturalColor({ x: 120 - rx, y: 80 - ry, width: rx * 2, height: ry * 2 }, { ellipse });
    assert.ok(plan.strokes.slice(1).every(stroke => stroke.d.includes(' A ')), 'round forms use arcs, not hatch swipes');
    for (let y = -ry; y <= ry; y += Math.max(.5, ry / 30)) for (let x = -rx; x <= rx; x += Math.max(.5, rx / 30)) {
      if ((x / rx) ** 2 + (y / ry) ** 2 <= 1) assert.ok(painted({ x: 120 + x, y: 80 + y }, plan), `ellipse hole ${x},${y}`);
    }
  }
});

test('arbitrary concave filled shapes keep their original shape and color all thin appendages', () => {
  const contains = p => (p.x >= 0 && p.x <= 200 && p.y >= 0 && p.y <= 200) && (p.x <= 55 || p.y >= 150);
  const boundary = [];
  for (let x = 0; x <= 200; x += 2) { boundary.push({ x, y: 150 }, { x, y: 200 }); }
  for (let y = 0; y <= 200; y += 2) { boundary.push({ x: 0, y }, { x: 55, y }); }
  const plan = planNaturalColor({ x: 0, y: 0, width: 200, height: 200 }, { contains, boundary });
  for (let y = 0; y <= 200; y += 2) for (let x = 0; x <= 200; x += 2) if (contains({ x, y })) assert.ok(painted({ x, y }, plan), `concave fill hole ${x},${y}`);
});

test('thin beams and elongated ellipses cannot generate hundreds of tiny strokes', () => {
  for (const box of [{ x: 0, y: 0, width: 1000, height: 2 }, { x: 0, y: 0, width: 5, height: 300 }]) {
    const ellipse = { cx: box.width / 2, cy: box.height / 2, rx: box.width / 2, ry: box.height / 2 };
    for (const options of [{}, { ellipse }]) {
      const start = performance.now();
      const plan = planNaturalColor(box, options);
      assert.ok(plan.strokes.length <= 6);
      assert.ok(totalPaintDuration(plan) < 3000);
      assert.ok(performance.now() - start < 200);
      for (let y = 0; y <= box.height; y += Math.max(.5, box.height / 20)) for (let x = 0; x <= box.width; x += Math.max(.5, box.width / 20)) assert.ok(painted({ x, y }, plan));
    }
  }
});

test('tiny filled eyes are a single quick dab with no ring-by-ring coloring', () => {
  const plan = planNaturalColor({ x: 0, y: 0, width: 6, height: 8 }, { ellipse: { cx: 3, cy: 4, rx: 3, ry: 4 } });
  assert.equal(plan.strokes.length, 1);
  assert.ok(totalPaintDuration(plan) <= 100);
  for (let y = 0; y <= 8; y += .5) for (let x = 0; x <= 6; x += .5) {
    if (((x - 3) / 3) ** 2 + ((y - 4) / 4) ** 2 <= 1) assert.ok(painted({ x, y }, plan));
  }
});

test('small round details have one continuous fill and finish quickly at their displayed size', () => {
  for (const medium of ['crayon', 'pencil', 'watercolor']) for (const scale of [.5, 1, 2]) for (const diameter of [16, 24, 40, 64]) {
    const radius = diameter / (2 * scale);
    const box = { x: -radius, y: -radius, width: radius * 2, height: radius * 2 };
    const plan = planNaturalColor(box, { scale, medium, ellipse: { cx: 0, cy: 0, rx: radius, ry: radius } });
    assert.equal(plan.strokes.length, 1, 'no repeated lifts for a little circle');
    const duration = totalPaintDuration(plan, scale, medium) + outlinePlaybackDuration(diameter * Math.PI, true);
    assert.ok(duration < (diameter <= 24 ? 400 : 1000), `${medium} ${diameter}px took ${duration}ms`);
    for (let y = -radius; y <= radius; y += radius / 20) for (let x = -radius; x <= radius; x += radius / 20) {
      if (x*x+y*y <= radius*radius) assert.ok(painted({ x, y }, plan), 'no last-frame fill flash');
    }
  }
});

test('compact arbitrary fills cover corners and concavities without slow fine hatching', () => {
  const contains = ({x,y}) => x <= 16 || y >= 28;
  const plan = planNaturalColor({ x: 0, y: 0, width: 40, height: 40 }, { contains });
  assert.ok(totalPaintDuration(plan) < 900);
  for (let y=0;y<=40;y++) for(let x=0;x<=40;x++) if(contains({x,y})) assert.ok(painted({x,y},plan));
});

test('wider elongated ellipses do not fall back to hundreds of concentric rings', () => {
  for (const [width, height] of [[300, 49], [300, 50], [300, 60], [1000, 100], [1000, 150]]) {
    const ellipse = { cx: width / 2, cy: height / 2, rx: width / 2, ry: height / 2 };
    const plan = planNaturalColor({ x: 0, y: 0, width, height }, { ellipse });
    assert.ok(plan.strokes.length < 65, `${width}×${height}: too many separate gestures`);
    assert.ok(totalPaintDuration(plan) < 14000, `${width}×${height}: ${totalPaintDuration(plan)}ms`);
    for (let y = 0; y <= height; y += height / 24) for (let x = 0; x <= width; x += width / 80) {
      if (((x - ellipse.cx) / ellipse.rx) ** 2 + ((y - ellipse.cy) / ellipse.ry) ** 2 <= 1) assert.ok(painted({ x, y }, plan), `ellipse hole at ${x},${y}`);
    }
  }
});

test('the hand accelerates gently without reversing, and medium plans remain deterministic', () => {
  let previous = 0;
  for (let i = 0; i <= 100; i++) { const progress = handProgress(i / 100); assert.ok(progress >= previous); previous = progress; }
  assert.equal(handProgress(0), 0); assert.equal(handProgress(1), 1);
  assert.ok(handProgress(.1) < .1);
  const box = { x: 0, y: 0, width: 300, height: 200 };
  assert.deepEqual(planNaturalColor(box, { medium: 'pencil' }), planNaturalColor(box, { medium: 'pencil' }));
  assert.notDeepEqual(planNaturalColor(box, { medium: 'pencil' }).strokes, planNaturalColor(box, { medium: 'watercolor' }).strokes);
});

test('layered sky washes cover the glow below their first rectangle, while ordinary marks keep their own bounds', () => {
  const sky = { getAttribute: name => name === 'data-playback-area' ? 'true' : null, getBBox: () => ({ x: 0, y: 0, width: 1000, height: 450 }) };
  const skyRect = { getBBox: () => ({ x: 0, y: 0, width: 1000, height: 430 }) };
  const bounds = playbackBounds(sky, skyRect);
  assert.deepEqual(bounds, { x: 0, y: 0, width: 1000, height: 450 });
  const sweep = planNaturalColor(bounds).bounds;
  assert.ok(sweep.y + sweep.height >= 450, 'the lower glow is swept before the final art is released');
  const mark = { getAttribute: () => null, getBBox: () => ({ x: -30, y: -30, width: 60, height: 60 }) };
  const circle = { getBBox: () => ({ x: -20, y: -20, width: 40, height: 40 }) };
  assert.deepEqual(playbackBounds(mark, circle), { x: -20, y: -20, width: 40, height: 40 });
});

test('large fill detection is screen based and does not broaden skinny details', () => {
  assert.equal(isBroadColorArea({ width: 1000, height: 300 }, .45), true);
  assert.equal(isBroadColorArea({ width: 100, height: 100 }, 1), false);
  assert.equal(isBroadColorArea({ width: 1000, height: 20 }, 1), false);
  assert.equal(isBroadColorArea({ width: 200, height: 200 }, 1), true);
  assert.equal(isBroadColorArea({ width: 400, height: 400 }, .5), true);
});

test('export cleanup removes pen, masks, and temporary art while keeping canonical geometry', () => {
  const removed = [];
  const svg = { querySelectorAll(selector) { assert.equal(selector, '[data-playback-artifact]'); return ['pen', 'mask', 'outline'].map(name => ({ remove() { removed.push(name); } })); } };
  assert.equal(removePlaybackArtifacts(svg), svg);
  assert.deepEqual(removed, ['pen', 'mask', 'outline']);
});

test('the tool becomes fully hidden after erasing and can resume as a pencil', () => {
  class SvgNode {
    attributes = new Map();
    children = [];
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    appendChild(child) { this.children.push(child); }
    getScreenCTM() { return { inverse() { return this; } }; }
  }
  const oldDocument = globalThis.document, oldPoint = globalThis.DOMPoint;
  globalThis.document = { createElementNS() { return new SvgNode(); } };
  globalThis.DOMPoint = class { constructor(x, y) { this.x = x; this.y = y; } matrixTransform() { return this; } };
  try {
    const pen = new VirtualPen(new SvgNode());
    const geometry = new SvgNode();
    geometry.getPointAtLength = () => ({ x: 12, y: 28 });
    pen.move(geometry, 4, geometry, 'eraser');
    assert.equal(pen.element.getAttribute('display'), null);
    assert.equal(pen.element.getAttribute('data-pen-contact'), 'down');
    assert.equal(pen.element.children[1].getAttribute('visibility'), 'visible');
    pen.hide();
    assert.equal(pen.element.getAttribute('display'), 'none');
    assert.equal(pen.element.getAttribute('data-pen-contact'), null);
    assert.ok(pen.element.children.every(child => child.getAttribute('visibility') === 'hidden'));
    pen.move(geometry, 5);
    assert.equal(pen.element.getAttribute('display'), null);
    assert.equal(pen.element.children[0].getAttribute('visibility'), 'visible');
    assert.equal(pen.element.children[1].getAttribute('visibility'), 'hidden');
    pen.move(geometry, 5, geometry, 'wash');
    assert.equal(pen.element.children[0].getAttribute('visibility'), 'hidden');
    assert.equal(pen.element.children[1].getAttribute('visibility'), 'hidden');
    assert.equal(pen.element.children[2].getAttribute('visibility'), 'visible');
    pen.movePoint({ x: 14, y: 18 }, geometry, 'wash', true);
    assert.equal(pen.element.getAttribute('data-pen-contact'), 'up');
    pen.hide();
    assert.ok(pen.element.children.every(child => child.getAttribute('visibility') === 'hidden'));
  } finally {
    globalThis.document = oldDocument;
    globalThis.DOMPoint = oldPoint;
  }
});

// This tiny SVG tree supplies only ordinary DOM storage operations. The actual
// visual comparison and recursive definition collection run unchanged.
class SvgTree {
  children = [];
  parentElement = null;
  textContent = '';
  constructor(tagName, attributes = {}, children = []) {
    this.tagName = tagName; this.values = new Map(Object.entries(attributes));
    children.forEach(child => this.appendChild(child));
  }
  get attributes() { return [...this.values].map(([name, value]) => ({ name, value: String(value) })); }
  get firstChild() { return this.children[0] ?? null; }
  hasAttribute(name) { return this.values.has(name); }
  getAttribute(name) { return this.values.has(name) ? String(this.values.get(name)) : null; }
  setAttribute(name, value) { this.values.set(name, String(value)); }
  removeAttribute(name) { this.values.delete(name); }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  insertBefore(child, before) { this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, child); child.parentElement = this; }
  querySelectorAll(selector) {
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    return selector === '*' ? all : selector === '[id]' ? all.filter(child => child.hasAttribute('id')) : all.filter(child => child.tagName === selector);
  }
  getElementById(id) { return [this, ...this.querySelectorAll('*')].find(child => child.getAttribute('id') === id) ?? null; }
  cloneNode(deep) { const clone = new SvgTree(this.tagName, Object.fromEntries(this.values), deep ? this.children.map(child => child.cloneNode(true)) : []); clone.textContent = this.textContent; return clone; }
}
const svg = (tag, attributes, children) => new SvgTree(tag, attributes, children);

test('visual identity includes position, inherited transparency and all background pigment', () => {
  const first = svg('rect', { width: 1000, height: 400, fill: '#def' });
  const glow = svg('ellipse', { cx: 600, cy: 200, rx: 200, ry: 100, fill: '#fea' });
  const area = svg('g', { 'data-playback-area': 'true' }, [first, glow]);
  const object = svg('g', { transform: 'translate(100 200) scale(1)', opacity: '.8' }, [area]);
  const canvas = svg('svg', { viewBox: '0 0 1000 640' }, [svg('g', { 'data-scene-layer': 'true' }, [object])]);
  const initial = strokeVisualIdentity(area, canvas);
  object.setAttribute('transform', 'translate(200 200) scale(1)');
  assert.notEqual(strokeVisualIdentity(area, canvas), initial, 'moving an unchanged local path requires erasing its old location');
  object.setAttribute('transform', 'translate(100 200) scale(1)'); object.setAttribute('opacity', '.4');
  assert.notEqual(strokeVisualIdentity(area, canvas), initial);
  object.setAttribute('opacity', '.8'); glow.setAttribute('fill', '#fac');
  assert.notEqual(strokeVisualIdentity(area, canvas), initial, 'a second background shape also participates');
  glow.setAttribute('fill', '#fea'); canvas.setAttribute('viewBox', '-200 0 1400 640');
  assert.equal(strokeVisualIdentity(area, canvas), initial, 'screen and viewport changes alone do not move world-space strokes');
});

test('pigment identity follows referenced definitions while generated IDs and playback artifacts are irrelevant', () => {
  const stop = svg('stop', { 'stop-color': '#f84' });
  const gradient = svg('linearGradient', { id: 'warm' }, [stop]);
  const pattern = svg('pattern', { id: 'pigment', width: 8, height: 8 }, [svg('rect', { width: 8, height: 8, fill: 'url(#warm)' })]);
  const mark = svg('g', {}, [svg('path', { d: 'M0 0L30 10Z', fill: 'url(#pigment)' })]);
  const canvas = svg('svg', {}, [svg('defs', {}, [gradient, pattern]), mark]);
  const initial = strokeVisualIdentity(mark, canvas);
  stop.setAttribute('stop-color', '#48f');
  assert.notEqual(strokeVisualIdentity(mark, canvas), initial, 'same gradient URL with different content must repaint');
  stop.setAttribute('stop-color', '#f84'); gradient.setAttribute('id', 'renamed'); pattern.children[0].setAttribute('fill', 'url("#renamed")');
  mark.appendChild(svg('path', { 'data-playback-artifact': 'outline', d: 'M0 0L99 99', stroke: 'red' }));
  assert.equal(strokeVisualIdentity(mark, canvas), initial);
});

test('permanent eraser paths change visual identity, but resizing the mask allocation does not', () => {
  const cover = svg('rect', { x: -128, y: -128, width: 1256, height: 896, fill: 'white' });
  const hole = svg('path', { d: 'M20 20L50 20', stroke: 'black', 'stroke-width': 20 });
  const mask = svg('mask', { id: 'rub', 'data-permanent-erasure-mask': 'true', x: -128, y: -128, width: 1256, height: 896 }, [cover, svg('g', { transform: 'scale(1) translate(0 0)' }, [hole])]);
  const mark = svg('circle', { cx: 50, cy: 50, r: 40, fill: '#f84' });
  const canvas = svg('svg', {}, [svg('defs', {}, [mask]), svg('g', { mask: 'url(#rub)' }, [mark])]);
  const initial = strokeVisualIdentity(mark, canvas);
  mask.setAttribute('width', 2000); cover.setAttribute('width', 2000); cover.setAttribute('x', -500);
  assert.equal(strokeVisualIdentity(mark, canvas), initial);
  hole.setAttribute('d', 'M20 20L80 20');
  assert.notEqual(strokeVisualIdentity(mark, canvas), initial, 'eraser undo/redo must update affected pigment');
});

test('snapshots own recursive paint dependencies and stay unchanged after live recoloring', () => {
  const stop = svg('stop', { 'stop-color': '#f84' });
  const gradient = svg('linearGradient', { id: 'warm' }, [stop]);
  const pattern = svg('pattern', { id: 'pigment' }, [svg('rect', { fill: 'url(#warm)' })]);
  const unrelated = svg('pattern', { id: 'unused' }, []);
  const canvas = svg('svg', {}, [svg('defs', {}, [gradient, pattern, unrelated])]);
  const frozen = svg('g', {}, [svg('path', { fill: 'url(#pigment)' }), svg('path', { stroke: 'url(#pigment)' })]);
  const oldDocument = globalThis.document;
  globalThis.document = { createElementNS(_namespace, tag) { return svg(tag); } };
  try { freezePaintDependencies(frozen, canvas); } finally { globalThis.document = oldDocument; }
  assert.deepEqual(frozen.querySelectorAll('[id]').map(node => node.getAttribute('id')).sort(), ['pigment', 'warm']);
  stop.setAttribute('stop-color', '#48f');
  assert.equal(frozen.getElementById('warm').children[0].getAttribute('stop-color'), '#f84');
  assert.equal(canvas.getElementById('warm').children[0].getAttribute('stop-color'), '#48f');
});

test('resize preserves active background keys through later renders but never disguises a real edit', () => {
  const entry = (visualKey, layoutSlot, viewportDependent) => ({ key: visualKey, target: { visualKey, layoutSlot, viewportDependent } });
  const old = [entry('sky-small', 'sky:0', true), entry('circle', 'boy:0', false)];
  const resized = [entry('sky-wide', 'sky:0', true), entry('circle', 'boy:0', false)];
  const retained = retainViewportStrokeKeys(resized, old, true);
  assert.deepEqual(retained.map(item => item.key), ['sky-small', 'circle']);
  assert.deepEqual(retainViewportStrokeKeys(resized, retained, false).map(item => item.key), ['sky-small', 'circle']);
  const moved = [entry('sky-wider', 'sky:0', true), entry('moved-circle', 'boy:0', false)];
  assert.deepEqual(retainViewportStrokeKeys(moved, retained, true).map(item => item.key), ['sky-wider', 'moved-circle']);
  assert.deepEqual(retainViewportStrokeKeys(resized, old, false).map(item => item.key), ['sky-wide', 'circle'], 'a genuine background change must erase then draw');
});


test('off-subject erasure paths do not change untouched paint, including shared mask definitions', () => {
  const matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const measured = (node, box, transform=matrix) => { node.getBBox=()=>box; node.getScreenCTM=()=>transform; return node; };
  const cover=svg('rect',{fill:'white',x:-1000,y:-1000,width:2000,height:2000});
  const hole=measured(svg('path',{d:'M320 240L430 330',stroke:'black','stroke-width':22}),{x:320,y:240,width:110,height:90});
  const mask=svg('mask',{id:'local-rub','data-permanent-erasure-mask':'true'},[cover,svg('g',{},[hole])]);
  const near=measured(svg('circle',{cx:350,cy:270,r:55,fill:'#f84'}),{x:295,y:215,width:110,height:110});
  const far=measured(svg('path',{d:'M580 285Q620 220 670 290',stroke:'#88a','stroke-width':6}),{x:580,y:250,width:90,height:40});
  const wrapper=svg('g',{},[near,far]),canvas=svg('svg',{},[svg('defs',{},[mask]),wrapper]);
  const oldNear=strokeVisualIdentity(near,canvas),oldFar=strokeVisualIdentity(far,canvas);
  wrapper.setAttribute('mask','url(#local-rub)');
  const cache=new Map();
  assert.notEqual(strokeVisualIdentity(near,canvas,cache),oldNear);
  assert.equal(strokeVisualIdentity(far,canvas,cache),oldFar,'a shared mask is evaluated separately for each target');
  assert.equal(eraserMayTouch(hole,far),false);
  assert.equal(eraserMayTouch(hole,near),true);
  far.getScreenCTM=()=>({...matrix,e:-220});
  assert.equal(eraserMayTouch(hole,far),true,'object transforms participate in intersection');
  far.getScreenCTM=()=>null;
  assert.equal(eraserMayTouch(hole,far),true,'unmeasurable shapes retain conservative animation');
});


test('a wider eraser keeps its footprint and needs fewer passes even on tiny marks', () => {
  const box = { x: 10, y: 20, width: 150, height: 120 };
  const small = createBrushSweep(box, 28), larger = createBrushSweep(box, 38);
  assert.equal(larger.strokeWidth, 38);
  assert.ok((larger.d.match(/ L /g) ?? []).length < (small.d.match(/ L /g) ?? []).length);
  const tiny = createBrushSweep({ x: 0, y: 0, width: 3, height: 2 }, 38);
  assert.equal(tiny.strokeWidth, 38);
  assert.equal((tiny.d.match(/ L /g) ?? []).length, 1);
});


test('small components need one short color stroke; large components retain multiple gestures', () => {
 for(const medium of ['crayon','pencil','watercolor']) {
  for(const size of [12,24,32]){
   const plan=planNaturalColor({x:0,y:0,width:size,height:size},{medium});
   assert.equal(plan.strokes.length,1);
   assert.ok(totalPaintDuration(plan,1,medium)<120);
   for(let y=0;y<=size;y++)for(let x=0;x<=size;x++)assert.ok(painted({x,y},plan));
  }
  const ellipse={cx:0,cy:0,rx:30,ry:20};
  const round=planNaturalColor({x:-30,y:-20,width:60,height:40},{medium,ellipse});
  assert.equal(round.strokes.length,1);
  assert.ok(totalPaintDuration(round,1,medium)<220,'one orbit, not repeated spirals');
  for(let y=-20;y<=20;y++)for(let x=-30;x<=30;x++)if((x/30)**2+(y/20)**2<=1)assert.ok(painted({x,y},round));
  assert.ok(planNaturalColor({x:0,y:0,width:400,height:250},{medium}).strokes.length>8);
 }
});

test('small path fills share a screen-size budget across all materials and zoom levels', () => {
  for (const medium of ['crayon', 'pencil', 'watercolor']) for (const scale of [.35, 1, 2.5]) {
    for (const [pixels, limit] of [[8,1],[40,1],[64,2],[65,2],[80,2],[96,2],[120,3],[144,3]]) {
      const size=pixels/scale, box={x:-size*.3,y:17,width:size,height:size};
      // Real paths may contain corners, concavities and holes. All their
      // pigment must be revealed before releasing the canonical art.
      const contains=({x,y})=>x<box.x+size*.3||y>box.y+size*.65;
      for(const options of [{}, {contains}]) {
        const plan=planNaturalColor(box,{medium,scale,...options});
        assert.ok(plan.strokes.length<=limit,`${medium} ${pixels}px: ${plan.strokes.length} strokes`);
        // The calmer brush takes about 18% longer without adding extra passes.
        assert.ok(totalPaintDuration(plan,scale,medium)<(pixels<=96?530:1060));
        for(let iy=0;iy<=32;iy++)for(let ix=0;ix<=32;ix++) {
          const point={x:box.x+size*ix/32,y:box.y+size*iy/32};
          if(!options.contains||contains(point))assert.ok(painted(point,plan),`unpainted corner ${pixels}px`);
        }
      }
    }
    const larger=planNaturalColor({x:0,y:0,width:300/scale,height:240/scale},{medium,scale});
    assert.ok(larger.strokes.length>3,'large areas retain a visibly longer paint job');
    for(const [w,h] of [[180,40],[60,200],[240,96]]) {
      const narrow=planNaturalColor({x:0,y:0,width:w/scale,height:h/scale},{medium,scale});
      assert.ok(narrow.strokes.length<=2,'a narrow component is not a large area just because it is long');
      assert.ok(totalPaintDuration(narrow,scale,medium)<1060);
      for(let y=0;y<=h;y+=h/20)for(let x=0;x<=w;x+=w/20)assert.ok(painted({x:x/scale,y:y/scale},narrow));
    }
  }
});

test('small circles do not acquire many extra rings just above 64 screen pixels', () => {
  for(const medium of ['crayon','pencil','watercolor']) for(const scale of [.4,1,2]) for(const pixels of [63,64,65,80,96,112,120,144,200,400]) {
    for(const aspect of [1,1.7,2.5]) {
      const rx=pixels/scale/2,ry=rx/aspect,ellipse={cx:3,cy:7,rx,ry};
      const plan=planNaturalColor({x:3-rx,y:7-ry,width:2*rx,height:2*ry},{ellipse,scale,medium});
      if(pixels<=96)assert.equal(plan.strokes.length,1);
      if(pixels<=112)assert.ok(plan.strokes.length<=3);
      if(pixels<=144)assert.ok(totalPaintDuration(plan,scale,medium)<750);
      for(let iy=-30;iy<=30;iy++)for(let ix=-30;ix<=30;ix++) {
        if((ix/30)**2+(iy/30)**2<=1)assert.ok(painted({x:3+rx*ix/30,y:7+ry*iy/30},plan),'inset arcs must still reach the rim');
      }
    }
  }
});


test('fill mask diameter never exceeds the visible compact brush at any zoom',()=>{
 for(const scale of [.35,1,2.5])for(const medium of ['pencil','crayon','watercolor'])for(const size of [12,64,96,144,400,1200]){
  const ellipse={cx:0,cy:0,rx:size/scale/2,ry:size/scale/2};
  for(const extra of [{},{ellipse}]){
   const plan=planNaturalColor({x:-ellipse.rx,y:-ellipse.ry,width:2*ellipse.rx,height:2*ellipse.ry},{scale,medium,...extra});
   assert.ok(plan.strokes.every(stroke=>stroke.width*scale<=MAX_COLOR_BRUSH_PX+.01));
  }
 }
});

test('paint contact breaks at blank holes instead of sweeping across them',()=>{
 const contains=({x,y})=>x>=0&&x<=120&&y>=0&&y<=60&&!(x>40&&x<80);
 const plan=planNaturalColor({x:0,y:0,width:120,height:60},{contains});
 const contacts=contactColorStrokes(plan.strokes,contains);
 assert.ok(contacts.length>0);
 for(const stroke of contacts){
  assert.ok(stroke.points.every(contains));
  assert.ok(stroke.points.every(p=>p.x<=40)||stroke.points.every(p=>p.x>=80),'lift over the hole');
 }
 for(let y=0;y<=60;y+=2)for(let x=0;x<=120;x+=2)if(contains({x,y}))assert.ok(contacts.some(stroke=>paintStrokeReaches({x,y},stroke,stroke.width/2+.5)));
});
