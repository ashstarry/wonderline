import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const temporary = new URL('../.sites-runtime/pencil-material-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const compiled = await build({
  stdin: {
    contents: "export { pencilMaterial } from './lib/pencil-material'; export { BrushMark, BrushDefinitions } from './components/BrushMarks'; export { default as SceneCanvas } from './components/SceneCanvas';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic', write: false,
});
await writeFile(temporary, compiled.outputFiles[0].text);
const { pencilMaterial, BrushMark, BrushDefinitions, SceneCanvas } = await import(temporary.href);
after(() => unlink(temporary));

// These fixtures represent visible user artwork rather than the renderer's
// implementation: the same round subject at different tones, water, clothing,
// an eye, a pale reflection, and an unfilled line.
const round = { type: 'ellipse', x: 100, y: 100, w: 90, h: 90, stroke: '#3c3c3c', strokeWidth: 2 };
const grey = color => {
  if (color.startsWith('#')) return parseInt(color.slice(1, 3), 16);
  return Number(color.match(/^rgb\((\d+)/)?.[1]);
};
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
const playbackShapes = svg => [...svg.matchAll(/<[^>]*data-playback-shape="true"[^>]*>/g)].map(match => attributes(match[0]));
// A crayon's holes now repeat inside a small paint tile, so the canonical
// shape references a paint server. Verify its actual pigment rather than
// assuming every material stores a flat hex color on the shape attribute.
const pigment = (svg, paint) => {
  const reference = /^url\(#([^)]+)\)$/.exec(paint);
  if (!reference) return paint;
  const pattern = [...svg.matchAll(/<pattern\b([^>]*)>([\s\S]*?)<\/pattern>/g)].find(match => attributes(match[1]).id === reference[1]);
  assert.ok(pattern, `missing paint server ${reference[1]}`);
  const tile = /<rect\b[^>]*>/.exec(pattern[2]);
  assert.ok(tile, `missing pigment tile for ${reference[1]}`);
  return attributes(tile[0]).fill;
};
function render(mark, options = {}) {
  return renderToStaticMarkup(createElement('svg', { xmlns: 'http://www.w3.org/2000/svg' },
    createElement('defs', null, createElement(BrushDefinitions, { uid: 'pencil-test' })),
    createElement(BrushMark, { mark, style: 'pencil', objectColor: '#808080', ink: '#333333', uid: 'pencil-test', markKey: 'subject', ...options }),
  ));
}

test('colored pencil retains ordered values as well as color, without flattening every object to paper', () => {
  const fills = ['#151515', '#666666', '#b2b2b2', '#ffffff'];
  const rendered = fills.map(fill => playbackShapes(render({ ...round, fill }))[0].fill);
  const levels = rendered.map(grey);
  assert.equal(new Set(rendered).size, fills.length);
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] > levels[i - 1], `${fills[i]} should look lighter than ${fills[i - 1]}`);
  assert.ok(levels.at(-1) - levels[0] >= 35, 'the tonal range must remain visible at canvas size');
});

test('water gets horizontal material while ordinary blue clothing keeps form shading', () => {
  const water = pencilMaterial({ type: 'ellipse', w: 320, h: 100 }, '#45b9e8', '湖泊');
  const shirt = pencilMaterial({ type: 'rect', w: 50, h: 70 }, '#45b9e8', '穿蓝色衣服的男孩');
  const grass = pencilMaterial({ type: 'path', d: 'M0 0H300V200H0Z' }, '#6fa75b', '草地');
  assert.equal(water.surface, 'water');
  assert.equal(shirt.surface, 'form');
  assert.equal(grass.surface, 'ground');
  assert.ok(water.shade < shirt.shade, 'water should retain a lighter, less modeled surface');
  assert.notEqual(water.base, grass.base);
});

test('a wide blue UFO or scarf does not become water merely because it is shallow', () => {
  for (const [mark, subject] of [
    [{ type: 'ellipse', w: 200, h: 45 }, '蓝色飞碟'],
    [{ type: 'rect', w: 200, h: 35 }, '男孩的蓝色围巾'],
  ]) {
    assert.equal(pencilMaterial(mark, '#45b9e8', subject).surface, 'form', subject);
    const svg = render({ ...mark, fill: '#45b9e8' }, { subject });
    assert.match(svg, /data-pencil-surface="form"/);
    assert.doesNotMatch(svg, /data-pencil-grain="water"/);
  }
});

test('a subject near grass or water keeps its own material instead of taking its surroundings', () => {
  const dinosaur = pencilMaterial(round, '#6fa75b', 'drawing 草地旁的小恐龙');
  const boy = pencilMaterial({ type: 'rect', w: 60, h: 90 }, '#45b9e8', 'drawing 湖边的小男孩');
  const slope = pencilMaterial({ type: 'path', d: 'M0 200Q140 90 300 200V300H0Z' }, '#6fa75b', 'drawing 草坡');
  assert.equal(dinosaur.surface, 'form');
  assert.equal(boy.surface, 'form');
  assert.equal(slope.surface, 'ground');
});

test('white highlights stay light and small dark eyes remain solid and legible', () => {
  const highlight = { type: 'line', x: 0, y: 0, x2: 40, y2: 0, stroke: '#ffffff', strokeWidth: 2 };
  const highlightShape = playbackShapes(render(highlight))[0];
  assert.ok(grey(highlightShape.stroke) > 240, 'a white reflection must not become a dark graphite line');
  const eye = { type: 'ellipse', x: 8, y: 8, w: 6, h: 8, fill: '#121212', stroke: 'none' };
  const eyeShape = playbackShapes(render(eye))[0];
  assert.ok(grey(eyeShape.fill) < 100, 'tiny eyes must not become pale paper with hatching');
  assert.equal(eyeShape.stroke, 'none');
  const paper = pencilMaterial({ ...round, fill: '#ffffff' }, '#ffffff');
  assert.equal(paper.hatch, 0);
  assert.equal(paper.shade, 0);
});

test('unfilled pencil lines and contours remain unfilled and do not gain a shading layer', () => {
  for (const mark of [
    { type: 'line', x: 0, y: 0, x2: 50, y2: 30, stroke: '#333333', strokeWidth: 2 },
    { type: 'path', d: 'M0 0Q20 30 40 0', fill: 'none', stroke: '#333333', strokeWidth: 2 },
  ]) {
    const svg = render(mark);
    assert.equal(playbackShapes(svg)[0].fill, 'none');
    const decoration = svg.split('data-playback-decoration="true"')[1];
    assert.doesNotMatch(decoration, /<(?:path|ellipse|rect|line)\b/, 'open marks must not acquire painted decorations');
  }
});

test('straight horizontal and vertical strokes remain paintable in all three media', () => {
  const marks = [
    { type: 'path', d: 'M285.5 321.5L721.8 321.5', fill: 'none', stroke: '#b42929', strokeWidth: 7 },
    { type: 'path', d: 'M321.5 85L321.5 490', fill: 'none', stroke: '#b42929', strokeWidth: 7 },
    { type: 'line', x: 10, y: 100, x2: 400, y2: 100, stroke: '#b42929', strokeWidth: 7 },
    { type: 'line', x: 100, y: 10, x2: 100, y2: 400, stroke: '#b42929', strokeWidth: 7 },
  ];
  for (const style of ['crayon', 'pencil', 'watercolor']) for (const mark of marks) {
    const svg = render(mark, { style, preserveStrokeColor: true });
    const shape = playbackShapes(svg)[0];
    assert.equal(shape.fill, 'none');
    assert.equal(pigment(svg, shape.stroke), '#b42929');
    assert.ok(Number(shape['stroke-width']) > 0);
    if (style === 'pencil') assert.equal(Number(shape['stroke-width']), 7);
    assert.equal(shape.filter, undefined, `${style} must not clip a zero-height/width geometry to an empty objectBoundingBox filter region`);
    assert.equal(shape['stroke-linecap'], 'round');
  }
  for (const style of ['crayon', 'pencil', 'watercolor']) {
    const shape = playbackShapes(render({ ...round, fill: '#77bb66' }, { style }))[0];
    assert.match(shape.filter, /^url\(#/, 'filled objects retain their material effects');
  }
});

test('pencil definitions and texture remain deterministic through rerenders and export', () => {
  const mark = { ...round, fill: '#617b54' };
  const first = render(mark, { subject: '树冠' });
  assert.equal(first, render(mark, { subject: '树冠' }));
  const ids = [...first.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'exported SVG must not have duplicate definition IDs');
  for (const [, reference] of first.matchAll(/url\(#([^)]+)\)/g)) {
    assert.ok(ids.includes(reference), `exported SVG must retain definition ${reference}`);
  }
  for (const [, reference] of first.matchAll(/\b(?:xlink:)?href="#([^"]+)"/g)) {
    assert.ok(ids.includes(reference), `exported SVG must retain inherited pattern ${reference}`);
  }
});

test('each pencil mark retains one canonical playback shape with local shading and sparse material texture', () => {
  const mark = { ...round, fill: '#617b54' };
  const svg = render(mark, { subject: '树冠' });
  assert.equal(playbackShapes(svg).length, 1);
  const decoration = svg.split('data-playback-decoration="true"')[1];
  assert.match(decoration, /<ellipse[^>]+fill="url\(#[^"]+-shade\)"/, 'shading must follow the object geometry');
  assert.doesNotMatch(decoration, /<rect\b/, 'pencil texture must not use a canvas-sized diagonal overlay');
  assert.doesNotMatch(svg, /graphite-(?:light|mid|dark)/, 'the old repeated uniform-density hatches must be absent');
  const patterns = new Map([...svg.matchAll(/<pattern\b[^>]*>/g)].map(([tag]) => {
    const props = attributes(tag);
    return [props.id, props];
  }));
  const textureIds = [...decoration.matchAll(/fill="url\(#([^)]+)\)"/g)].map(([, id]) => id);
  assert.ok(textureIds.some(id => patterns.get(id)?.['data-pencil-grain'] === 'form'), 'the painted form texture must resolve to local colored pencil strokes');
  assert.doesNotMatch(decoration, /data-playback-shape/, 'decorations must not be scheduled as extra complete shapes');
});

test('separate pencil objects retain independent local gradient and clip definitions', () => {
  const first = render({ ...round, fill: '#617b54' }, { markKey: 'tree', subject: '树冠' });
  const second = render({ ...round, fill: '#45b9e8' }, { markKey: 'lake', subject: '湖泊' });
  const gradientIds = svg => [...svg.matchAll(/<linearGradient id="([^"]+)"/g)].map(match => match[1]);
  assert.ok(gradientIds(first).length > 0);
  assert.equal(gradientIds(first).filter(id => gradientIds(second).includes(id)).length, 0, 'editing one object must not overwrite its neighbor’s shading');
});

const rgb = color => color.startsWith('#')
  ? [1,3,5].map(index => parseInt(color.slice(index,index+2),16))
  : color.match(/[\d.]+/g).map(Number);
const spread = color => Math.max(...rgb(color))-Math.min(...rgb(color));
test('yellow clothing, blue water, peach skin and green meadows retain their recognizable hues', () => {
  const fixtures = [
    ['#f5cf45', '黄色衣服', ([r,g,b]) => r>b+70 && g>b+60],
    ['#45b9e8', '湖泊', ([r,g,b]) => b>r+70 && g>r+40],
    ['#edac89', '小朋友的脸', ([r,g,b]) => r>g+25 && g>b+15],
    ['#6fa75b', '草地', ([r,g,b]) => g>r+30 && g>b+40],
  ];
  for (const [fill,subject,isHue] of fixtures) {
    const material = pencilMaterial(round,fill,subject);
    const visible = playbackShapes(render({...round,fill},{subject}))[0];
    assert.ok(isHue(rgb(visible.fill)), `${subject} must retain its source hue`);
    assert.ok(spread(material.pigment)>35, `${subject} hatching must use colored pigment`);
    assert.ok(spread(visible.stroke)>20, `${subject} outline must not be a generic grey contour`);
    assert.notEqual(visible.fill,fill,'visible paper should soften the pigment');
    const svg=render({...round,fill},{subject});
    assert.ok(svg.includes(`stroke="${material.pigment}"`),'local hatch marks must carry the actual pigment');
    assert.ok(svg.includes(`stop-color="${material.pigment}"`),'pressure shading must build the same pigment');
  }
});

test('bright yellow is colored pigment rather than a white paper highlight', () => {
  const yellow=pencilMaterial(round,'#ffff33','太阳');
  assert.equal(yellow.surface,'form');
  assert.ok(yellow.hatch>0);
  assert.ok(rgb(yellow.base)[2]<150);
  const ray=playbackShapes(render({type:'line',x:0,y:0,x2:20,y2:0,stroke:'#ffff33',strokeWidth:2}))[0];
  assert.ok(rgb(ray.stroke)[2]<100, 'bright yellow sun rays must not become white highlights');
});

test('manual pencil marks retain the selected color and thickness exactly', () => {
  const mark={type:'path',d:'M0 0L40 30L80 10',fill:'none',stroke:'#de45c1',strokeWidth:7};
  const shape=playbackShapes(render(mark,{preserveStrokeColor:true}))[0];
  assert.equal(shape.stroke,mark.stroke);
  assert.equal(Number(shape['stroke-width']),mark.strokeWidth);
  assert.equal(shape.d,mark.d);
});

test('pencil legacy sky, water, ground and object colors remain cheerful instead of grayscale', () => {
  const scene={title:'阳光下的小朋友',sky:'day',weather:'clear',ground:'lake',objects:[
    {id:'child',kind:'person',x:200,y:400,scale:1,color:'#f5cf45'},
  ]};
  const svg=renderToStaticMarkup(createElement(SceneCanvas,{scene,style:'pencil',id:'legacy-color',motionMode:'still'}));
  const stops=id=>[...svg.match(new RegExp(`<linearGradient id="drawing-legacy-color-${id}"[^>]*>(.*?)</linearGradient>`))[1].matchAll(/stop-color="([^"]+)"/g)].map(match=>match[1]);
  assert.ok(stops('sky').some(color=>rgb(color)[2]>rgb(color)[0]+10),'sky should keep its blue');
  assert.ok(stops('lake').every(color=>rgb(color)[2]>rgb(color)[0]+15),'lake should keep its blue');
  assert.ok(stops('pencil-near').every(color=>rgb(color)[1]>rgb(color)[2]+30),'meadow should keep its green');
  const fills=playbackShapes(svg).map(shape=>shape.fill).filter(fill=>fill && fill!=='none' && !fill.startsWith('url'));
  assert.ok(fills.some(color=>{const [r,g,b]=rgb(color);return r>b+70&&g>b+60;}),'legacy yellow shirt should keep its yellow');
  assert.match(svg,/background-color:#fffaf0/,'paper should use warm ivory');
});

test('crayon and watercolor keep their source fills and existing stroke behavior', () => {
  const mark={...round,fill:'#45b9e8',stroke:'#333333',strokeWidth:2};
  for (const style of ['crayon','watercolor']) {
    const svg=render(mark,{style});
    const shape=playbackShapes(svg)[0];
    assert.equal(pigment(svg,shape.fill),mark.fill);
    assert.equal(Number(shape['stroke-width']),style==='crayon'?3.2:1.3);
    assert.equal(pigment(svg,shape.stroke),style==='crayon'?mark.stroke:mark.fill);
  }
});

test('crayon pigment and grain cover expanded paper coordinates without a page-sized mask', () => {
  for (const [x,y] of [[-9000,-9000],[9000,9000]]) {
    const mark={...round,x,y,fill:'#45b9e8',stroke:'#b42929'};
    const svg=render(mark,{style:'crayon'});
    const shape=playbackShapes(svg)[0];
    assert.equal(Number(shape.cx),x);
    assert.equal(Number(shape.cy),y);
    assert.equal(pigment(svg,shape.fill),mark.fill);
    assert.equal(pigment(svg,shape.stroke),mark.stroke);
    assert.equal(shape.mask,undefined,'a whole-shape mask must not clip remote paper coordinates');
    for (const match of svg.matchAll(/<mask\b[^>]*>/g)) {
      const mask=attributes(match[0]);
      assert.ok(Number(mask.width)<=29&&Number(mask.height)<=23,'rasterize only the repeatable pigment tile');
    }
    const decoration=svg.split('data-playback-decoration="true"')[1];
    assert.match(decoration,new RegExp(`cx="${x}" cy="${y}"`),'grain follows the original shape even far from the old paper');
  }
});
