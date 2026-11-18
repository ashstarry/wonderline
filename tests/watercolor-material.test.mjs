import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const temporary = new URL('../.sites-runtime/watercolor-material-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const compiled = await build({
  stdin: {
    contents: "export { watercolorMaterial } from './lib/watercolor-material'; export { BrushMark, BrushDefinitions, brushLegacy } from './components/BrushMarks';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic', write: false,
});
await writeFile(temporary, compiled.outputFiles[0].text);
const { watercolorMaterial, BrushMark, BrushDefinitions, brushLegacy } = await import(temporary.href);
after(() => unlink(temporary));

const round = { type: 'ellipse', x: 100, y: 100, w: 90, h: 90, stroke: '#333333', strokeWidth: 2 };
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
const shapes = svg => [...svg.matchAll(/<[^>]*data-playback-shape="true"[^>]*>/g)].map(match => attrs(match[0]));
const options = { style: 'watercolor', objectColor: '#68b96b', ink: '#333333', uid: 'water-test', markKey: 'sun' };
function render(mark, props = {}) {
  return renderToStaticMarkup(createElement('svg', { xmlns: 'http://www.w3.org/2000/svg' },
    createElement('defs', null, createElement(BrushDefinitions, { uid: options.uid })),
    createElement(BrushMark, { ...options, mark, ...props }),
  ));
}

test('yellow sunshine, blue water, green leaves and peach cheeks keep their actual pigments', () => {
  for (const fill of ['#ffd43b', '#4eb9e5', '#65b96c', '#f2a383']) {
    const svg = render({ ...round, fill });
    const shape = shapes(svg)[0];
    assert.equal(shape.fill, fill);
    assert.ok(Number(shape['fill-opacity']) > .95, 'wash pigment must not start with a pale global fade');
    assert.equal(shape.stroke, fill, 'a colored wash should not receive a generic grey outline');
    assert.match(svg, /-water-wash\)/);
    assert.match(svg, /-water-bloom\)/);
    assert.match(svg, /-water-pool\)/);
    assert.doesNotMatch(svg, /context-(?:fill|stroke)/, 'exported colors must be explicit');
  }
});

test('white animals stay opaque and tiny dark eyes stay sharp and dark', () => {
  const white = shapes(render({ ...round, fill: '#fffdf7' }))[0];
  assert.equal(Number(white['fill-opacity']), 1);
  assert.match(white.filter, /water-edge/, 'white fur keeps its shape without a translucent pigment wash');
  assert.ok(Number(white['stroke-opacity']) > .8, 'pale animals still need a readable contour');
  const eye = render({ type: 'ellipse', x: 5, y: 5, w: 4, h: 5, fill: '#243830', stroke: 'none' });
  const shape = shapes(eye)[0];
  assert.equal(shape.fill, '#243830');
  assert.equal(Number(shape['fill-opacity']), 1);
  assert.equal(shape.filter, undefined, 'small eyes should not blur or fade');
  const decoration = eye.split('data-playback-decoration="true"')[1];
  assert.doesNotMatch(decoration, /<(?:path|ellipse|rect)\b/, 'an eye should not be covered in blooms');
});

test('bright yellow counts as colored pigment even when its luminance is high', () => {
  const material = watercolorMaterial(round, '#ffff33', '#333333');
  assert.equal(material.white, false);
  assert.equal(material.edge, '#ffff33');
  const rgb = material.pigment.match(/\d+/g).map(Number);
  assert.ok(rgb[0] > rgb[2] + 100 && rgb[1] > rgb[2] + 100);
});

test('a background gradient stays a fill and never gets copied into contour paint', () => {
  const node = brushLegacy(createElement('path', { d: 'M0 300Q300 200 1000 300V640H0Z', fill: 'url(#meadow)', stroke: '#333333' }), { ...options, ownerId: 'ground' });
  const svg = renderToStaticMarkup(createElement('svg', null, node));
  assert.equal(shapes(svg)[0].fill, 'url(#meadow)');
  assert.doesNotMatch(svg, /stroke="url\(#meadow\)"/);
  assert.notEqual(shapes(svg)[0].stroke, 'none');
  assert.ok(svg.includes(watercolorMaterial(round, 'url(#meadow)', '#333333', '#68b96b').pigment), 'edge pooling uses the representative green pigment');
});

test('straight hand-drawn water strokes keep their selected color and nonzero visible geometry', () => {
  for (const d of ['M10 30L300 30', 'M50 30L50 400']) {
    const shape = shapes(render({ type: 'path', d, fill: 'none', stroke: '#e35a4c', strokeWidth: 8 }, { preserveStrokeColor: true }))[0];
    assert.equal(shape.stroke, '#e35a4c');
    assert.equal(shape.filter, undefined);
    assert.equal(shape.fill, 'none');
    assert.ok(Number(shape['stroke-opacity']) > .9);
  }
});

test('watercolor blooms and tide marks remain local decorations of one playback shape', () => {
  const svg = render({ ...round, fill: '#65b96c' });
  assert.equal(shapes(svg).length, 1);
  const decoration = svg.split('data-playback-decoration="true"')[1];
  assert.doesNotMatch(decoration, /data-playback-shape|<rect\b/, 'large uniform overlay rectangles must not paint over the whole scene');
  assert.match(decoration, /clip-path="url\(#[^"]+\)"/);
  assert.match(decoration, /stroke="url\(#[^"]+-water-pool\)"/);
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const [, reference] of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(reference), `missing exported definition ${reference}`);
  assert.equal(svg, render({ ...round, fill: '#65b96c' }), 'redraws and export should preserve the same wash');
});

test('neighboring subjects have separate, deterministic water blooms instead of plastic radial highlights', () => {
  const tree = render({ ...round, fill: '#65b96c' }, { markKey: 'tree' });
  const lake = render({ ...round, fill: '#4eb9e5' }, { markKey: 'lake' });
  const materialIds = value => [...value.matchAll(/<(?:linearGradient|radialGradient) id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(materialIds(tree).filter(id => materialIds(lake).includes(id)).length, 0);
  assert.doesNotMatch(tree, /<radialGradient/);
  const bloomSeed = svg => /<filter id="[^"]+-water-bloom"[^>]*><feTurbulence[^>]+seed="([^"]+)"/.exec(svg)?.[1];
  assert.ok(bloomSeed(tree));
  assert.notEqual(bloomSeed(tree), bloomSeed(lake));
  assert.match(tree, /result="granules"/, 'fine granulation is confined to the painted pigment filter');
});

test('legacy fragments inherit paint and receive the same material as neighboring ground', () => {
  const node = brushLegacy(createElement('g', { fill: '#4eb9e5' }, createElement(Fragment, null,
    createElement('ellipse', { cx: 200, cy: 200, rx: 150, ry: 50 }),
    createElement('path', { d: 'M50 200H350', fill: 'none', stroke: '#ffffff' }),
  )), { ...options, ownerId: 'lake' });
  const svg = renderToStaticMarkup(createElement('svg', null, node));
  const painted = shapes(svg);
  assert.equal(painted.length, 2);
  assert.equal(painted[0].fill, '#4eb9e5');
  assert.equal(painted[1].stroke, '#ffffff');
  assert.equal((svg.match(/data-brush-medium="watercolor"/g) ?? []).length, 2);
});
