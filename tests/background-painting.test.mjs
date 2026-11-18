import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const temporary = new URL('../.sites-runtime/background-painting-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const compiled = await build({
  stdin: { contents: "export { default as SceneCanvas } from './components/SceneCanvas'; export { appendErasure, backgroundErasureKey } from './lib/eraser';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic', write: false,
});
await writeFile(temporary, compiled.outputFiles[0].text);
const { SceneCanvas, appendErasure, backgroundErasureKey } = await import(temporary.href);
after(() => unlink(temporary));

const media = ['crayon', 'pencil', 'watercolor'];
const blank = { title: '白纸上的第一个想法', sky: 'paper', ground: 'none', weather: 'clear', objects: [] };
const landscape = (ground = 'lake', sky = 'day') => ({ ...blank, sky, ground });
const render = (scene, style) => renderToStaticMarkup(createElement(SceneCanvas, { scene, style, id: 'background-test', motionMode: 'still' }));
const shapeTags = new Set(['path', 'ellipse', 'circle', 'rect', 'line', 'text']);

// The renderer's output is XML without script/style contents. A small element
// tree lets these tests check actual ownership and clipping ancestry, not just
// the presence of disconnected attributes in the generated string.
function tree(markup) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  const stack = [root], nodes = [];
  for (const match of markup.matchAll(/<\/?[\w:-]+(?:\s[^<>]*?)?\s*\/?>/g)) {
    const tag = /^<\/?([\w:-]+)/.exec(match[0])[1];
    if (match[0].startsWith('</')) { assert.equal(stack.pop().tag, tag); continue; }
    const attrs = Object.fromEntries([...match[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]]));
    const node = { tag, attrs, children: [], parent: stack.at(-1) };
    node.parent.children.push(node); nodes.push(node);
    if (!match[0].endsWith('/>')) stack.push(node);
  }
  assert.equal(stack.length, 1);
  return nodes;
}
function ancestor(node, predicate) { for (let next = node; next; next = next.parent) if (predicate(next)) return next; return null; }
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
const visibleShape = node => shapeTags.has(node.tag) && !ancestor(node, item => ['defs', 'mask', 'pattern', 'clipPath', 'filter'].includes(item.tag));
const areaOf = node => ancestor(node, item => item.attrs['data-playback-area'] === 'true');
const ownerOf = node => ancestor(node, item => item.attrs['data-object-id'] || item.attrs['data-marks-for']);
const areas = nodes => nodes.filter(node => node.attrs['data-playback-area'] === 'true' && descendants(node).some(visibleShape));

test('the first landscape sentence supplies owned sky and ground washes in every medium', () => {
  for (const style of media) for (const ground of ['meadow', 'lake', 'coast']) for (const sky of ['day', 'sunset', 'night']) {
    const scene = landscape(ground, sky), nodes = tree(render(scene, style));
    for (const layer of ['sky', 'ground']) {
      const key = backgroundErasureKey(scene, layer);
      const area = areas(nodes).find(node => node.attrs['data-object-id'] === key);
      assert.ok(area, `${style} ${sky} ${ground} needs a queued ${layer} wash`);
      assert.equal(area.attrs['data-drawing-mark'], key);
      assert.equal(area.attrs['data-playback-fill-only'], 'true', 'a backdrop should reveal pigment rather than trace a rectangle before filling it');
      assert.equal(area.attrs['data-brush-medium'], style);
      assert.equal(ancestor(area, node => node.attrs['data-erasure-target'])?.attrs['data-erasure-target'], key);
      assert.ok(ancestor(area, node => node.attrs['data-scene-layer'] === 'true'), 'background snapshots must share the same coordinate layer as the drawing');
      assert.equal(area.attrs['data-playback-artifact'], undefined, 'a canonical background must survive SVG/PNG export cleanup');
    }
  }
});

test('blank paper, paper grain and the paper border never enter the paint queue', () => {
  for (const style of media) {
    const nodes = tree(render(blank, style));
    assert.equal(areas(nodes).length, 0, `${style} must not start painting an empty page`);
    const paper = nodes.filter(visibleShape);
    assert.equal(paper.length, 3, 'an empty page contains its base, grain and border only');
    for (const node of paper) {
      assert.equal(ownerOf(node), null, 'the paper is not a drawing object');
      assert.equal(areaOf(node), null, 'paper texture must remain visible while pigment is being drawn');
      assert.equal(ancestor(node, parent => parent.attrs['data-erasure-target']), null, 'an eraser removes pigment, never the paper');
    }
  }
});

test('landscape detail has a paint owner so reeds cannot pop ahead of the wash', () => {
  for (const style of media) {
    const nodes = tree(render(landscape(), style));
    const unowned = nodes.filter(node => visibleShape(node) && node.tag !== 'rect' && !ownerOf(node));
    assert.deepEqual(unowned.map(node => node.attrs.d || node.tag), [], `${style} landscape details need an animated owner`);
  }
});

test('weather pigment participates in stroke playback and erasure rather than popping as an unowned overlay', () => {
  for (const weather of ['rain', 'snow']) {
    const scene = { ...blank, weather }, nodes = tree(render(scene, 'crayon'));
    const weatherShapes = nodes.filter(node => visibleShape(node) && ancestor(node, item => item.attrs['data-erasure-target'] === backgroundErasureKey(scene, 'weather')));
    assert.ok(weatherShapes.length > 0);
    assert.ok(weatherShapes.every(node => ownerOf(node)), `${weather} must remain editable through the same stroke queue`);
  }
});

test('watercolor pigment and texture stay grouped inside their single background wash', () => {
  const nodes = tree(render(landscape(), 'watercolor'));
  const main = areas(nodes).filter(node => ['background:sky:day:upper', 'background:ground:lake:day'].includes(node.attrs['data-object-id']));
  assert.equal(main.length, 2);
  for (const area of main) {
    const shapes = descendants(area).filter(visibleShape);
    assert.ok(shapes.some(node => node.attrs['data-playback-shape'] === 'true'), 'wash needs canonical pigment geometry');
    assert.ok(shapes.some(node => ancestor(node, parent => parent.attrs['data-playback-decoration'] === 'true')), 'pigment variation must be part of the same reveal');
    for (const shape of shapes) assert.equal(areaOf(shape), area, 'all underlying paint and decoration shares one area task');
  }
});

test('adding a character during streaming keeps the existing background identities and source pigment', () => {
  const before = landscape();
  const after = { ...before, title: '太阳下的小朋友', objects: [{ id: 'friend', kind: 'person', x: 400, y: 500, scale: 1, color: '#f2c954' }] };
  for (const style of media) {
    const a = areas(tree(render(before, style))), b = areas(tree(render(after, style)));
    assert.deepEqual(a.map(node => node.attrs), b.map(node => node.attrs), 'unchanged backgrounds must retain stable queue owners');
    for (let index = 0; index < a.length; index++) {
      const shape = node => descendants(node).find(visibleShape)?.attrs;
      assert.deepEqual(shape(a[index]), shape(b[index]), 'unrelated object additions must not restart a background wash');
    }
  }
});

test('permanent erasure surrounds complete background washes and all exported references resolve', () => {
  const erased = appendErasure(landscape(), [{ x: 500, y: 100 }, { x: 500, y: 600 }], 24, 'erase-backdrop');
  for (const style of media) {
    const markup = render(erased, style), nodes = tree(markup);
    const ids = nodes.map(node => node.attrs.id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, `${style} background materials and erasures need unique definition IDs`);
    for (const [, id] of markup.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(id), `export must include ${id}`);
    for (const area of areas(nodes)) {
      const wrapper = ancestor(area, node => node.attrs['data-erasure-target']);
      assert.match(wrapper.attrs.mask, /^url\(#erasure-/);
      const mask = descendants(wrapper).find(node => node.attrs['data-permanent-erasure-mask'] === 'true');
      assert.ok(mask, 'the permanent mask remains beside the background in the exportable SVG');
      assert.equal(mask.attrs['data-playback-artifact'], undefined);
      assert.ok(descendants(mask).some(node => node.tag === 'path' && node.attrs.stroke === 'black'));
    }
  }
});
