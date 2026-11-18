import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const temporary = new URL('../.sites-runtime/eraser-render-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const compiled = await build({
  stdin: { contents: "export { default as SceneCanvas } from './components/SceneCanvas'; export * from './lib/eraser'; export * from './lib/manual-tools';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic', write: false,
});
await writeFile(temporary, compiled.outputFiles[0].text);
const { SceneCanvas, appendErasure, objectMarkKeys, legacyErasureKey, backgroundErasureKey, preserveErasures, manualEraserWidth, MANUAL_SIZES } = await import(temporary.href);
after(() => unlink(temporary));

const scene = {
  title: '一起画的纸', sky: 'sunset', ground: 'lake', weather: 'rain', objects: [
    { id: 'ai-circle', kind: 'drawing', x: 100, y: 200, scale: 2, color: '#77ccdd', marks: [{ type: 'ellipse', x: 10, y: 20, w: 80, h: 80, fill: '#77ccdd', stroke: '#335566', strokeWidth: 3 }] },
    { id: 'hand-line', kind: 'drawing', x: 0, y: 0, scale: 1, color: '#bb4488', marks: [{ type: 'path', d: 'M40 200L200 200', fill: 'none', stroke: '#bb4488', strokeWidth: 5 }] },
    { id: 'house', kind: 'house', x: 350, y: 400, scale: .5, color: '#eeaa88' },
  ],
};
const erased = appendErasure(scene, [{ x: 100, y: 200 }, { x: 180, y: 200 }], 24, 'wipe-1');
const render = (value, style = 'crayon') => renderToStaticMarkup(createElement(SceneCanvas, { scene: value, style, id: 'erase-test', motionMode: 'still' }));
const wrappers = svg => [...svg.matchAll(/<g data-erasure-target="([^"]+)"([^>]*)>/g)].map(match => ({ key: match[1], mask: / mask="url\(#([^)]+)\)"/.exec(match[2])?.[1] }));
const masks = svg => [...svg.matchAll(/<mask [^>]*data-permanent-erasure-mask="true"[^>]*>[\s\S]*?<\/mask>/g)].map(match => match[0]);

test('each manual eraser size retains its visible diameter at different zoom levels and survives model continuation', () => {
  for (const scale of [.5, 1, 2]) {
    const widths = MANUAL_SIZES.map(size => manualEraserWidth(size.value, scale));
    assert.ok(widths[0] < widths[1] && widths[1] < widths[2]);
    for (const [index, width] of widths.entries()) {
      assert.equal(width * scale, MANUAL_SIZES[index].eraserPixels);
      const next = appendErasure(scene, [{x:100,y:200},{x:180,y:200}], width, `size-${index}`);
      const restored = JSON.parse(JSON.stringify(next));
      const continued = preserveErasures(restored, {...scene,objects:[...scene.objects,{id:'new-star',kind:'star',x:300,y:80,scale:1,color:'#ffcc66'}]});
      assert.equal(continued.erasures[0].width, width);
      for (const mask of masks(render(continued))) assert.ok(mask.includes(`stroke-width="${width}"`));
    }
  }
});

test('extreme or missing display scales cannot create an invalid erasure width', () => {
  for (const scale of [0, -1, NaN, Infinity, .001, 1e6]) {
    const width = manualEraserWidth(9, scale);
    assert.ok(Number.isFinite(width) && width >= 1 && width <= 256);
    assert.doesNotThrow(()=>appendErasure(scene,[{x:100,y:200}],width,'safe-size'));
  }
});

test('one gesture cuts through AI marks, hand marks, built-in art and every background layer', () => {
  const svg = render(erased);
  const targets = wrappers(svg);
  const expected = [...objectMarkKeys(scene.objects[0]), ...objectMarkKeys(scene.objects[1]), legacyErasureKey(scene.objects[2]), ...['sky', 'ground', 'weather'].map(layer => backgroundErasureKey(scene, layer))];
  for (const key of expected) assert.ok(targets.some(target => target.key === key && target.mask), `missing permanent mask for ${key}`);
  assert.equal(new Set(targets.map(target => target.mask)).size, targets.length, 'the two ground layers must have distinct SVG mask IDs');
  assert.equal((svg.match(/data-playback-shape="true"/g) ?? []).length, (render(scene).match(/data-playback-shape="true"/g) ?? []).length, 'erasure preserves canonical geometry rather than deleting whole shapes');
});

test('eraser paths use their original object frame and preserve the requested round width', () => {
  const svg = render(erased);
  assert.ok(svg.includes('transform="scale(0.5) translate(-100 -200)"'));
  assert.ok(svg.includes('transform="scale(2) translate(-350 -400)"'));
  for (const mask of masks(svg)) {
    assert.ok(mask.includes('maskUnits="userSpaceOnUse"'));
    assert.ok(mask.includes('maskContentUnits="userSpaceOnUse"'));
    assert.ok(mask.includes('mask-type:luminance'));
    assert.ok(mask.includes('stroke="black" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"'));
    assert.ok(!mask.includes('data-playback-artifact'), 'export cleanup must leave permanent erasures in place');
  }
});

test('moving a subject carries the hole with it without recalculating the original erase frame', () => {
  const next = preserveErasures(erased, { ...scene, objects: [{ ...scene.objects[0], x: 500, y: 300, scale: 1.5 }, ...scene.objects.slice(1)] });
  const svg = render(next);
  assert.ok(svg.includes('transform="translate(500 300) scale(1.5)"'));
  assert.ok(svg.includes('transform="scale(0.5) translate(-100 -200)"'));
});

test('mask raster bounds follow the current object frame and stay near page size', () => {
  const next = preserveErasures(erased, { ...scene, objects: [{ ...scene.objects[0], x: 500, y: 300, scale: 4 }, { ...scene.objects[1], scale: .15 }, scene.objects[2]] });
  const svg = render(next);
  const targets = wrappers(svg);
  for (const object of next.objects) {
    const key = object.kind === 'drawing' ? objectMarkKeys(object)[0] : legacyErasureKey(object);
    const id = targets.find(target => target.key === key).mask;
    const tag = masks(svg).find(mask => mask.includes(`id="${id}"`)).split('>')[0];
    const number = name => Number(new RegExp(` ${name}="([^"]+)"`).exec(tag)?.[1]);
    const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < .001, `${actual} must remain near ${expected}`);
    near(number('x') * object.scale + object.x, -128);
    near(number('y') * object.scale + object.y, -128);
    near(number('width') * object.scale, 1256);
    near(number('height') * object.scale, 896);
    assert.ok(number('width') > 0 && number('height') > 0, 'even a straight hand line needs a nonzero user-space mask area');
  }
});

test('new pigment can fill an erased spot while existing pigment remains masked', () => {
  const fresh = { id: 'hand-new', kind: 'drawing', x: 0, y: 0, scale: 1, color: '#aa5533', marks: [{ type: 'path', d: 'M100 180L100 220', fill: 'none', stroke: '#aa5533', strokeWidth: 8 }] };
  const next = preserveErasures(erased, { ...scene, objects: [...scene.objects, fresh] });
  const targets = wrappers(render(next));
  assert.ok(targets.find(target => target.key === objectMarkKeys(scene.objects[0])[0]).mask);
  assert.equal(targets.find(target => target.key === objectMarkKeys(fresh)[0]).mask, undefined);
});

test('all media erase whole pigment groups including decorative grain and watercolor bleed', () => {
  for (const style of ['crayon', 'pencil', 'watercolor']) {
    const svg = render(erased, style);
    assert.ok(svg.includes(`data-brush-medium="${style}"`));
    assert.ok(svg.includes('data-playback-decoration="true"'));
    const firstMarkKey = objectMarkKeys(scene.objects[0])[0];
    const targetStart = svg.indexOf(`data-erasure-target="${firstMarkKey}"`);
    const decoration = svg.indexOf('data-playback-decoration="true"', targetStart);
    const nextTarget = svg.indexOf('data-erasure-target=', targetStart + 1);
    assert.ok(decoration > targetStart && decoration < nextTarget, `${style} decorations should remain inside the same permanent mask as their outline`);
  }
});

test('square erasures use filled footprint sweeps and retain the inverse rotation frame',()=>{
 const tilted={...scene,objects:[{...scene.objects[0],rotation:30}]};
 const cut=appendErasure(tilted,[{x:110,y:210},{x:130,y:230}],24,'square-cut',undefined,'square');
 for(const style of ['crayon','pencil','watercolor']){
  const svg=render(cut,style);
  assert.match(svg,/translate\(100 200\) rotate\(30\) scale\(2\)/);
  assert.match(svg,/scale\(0.5\) rotate\(-30\) translate\(-100 -200\)/);
  assert.ok(masks(svg).every(mask=>mask.includes('fill="black"')));
  assert.ok(masks(svg).every(mask=>!mask.includes('stroke="black"')));
 }
});
