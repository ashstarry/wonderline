import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const names = ['companion-material', 'pencil-material'];
const files = names.map(name => new URL(`../.sites-runtime/companion-material-test-${name}.mjs`, import.meta.url));
const rendererFile = new URL('../.sites-runtime/companion-material-test-renderer.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
for (const [index, name] of names.entries()) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  await writeFile(files[index], ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const bundled = await build({ stdin: { contents: "export {default as SceneCanvas} from './components/SceneCanvas';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic', write: false });
await writeFile(rendererFile, bundled.outputFiles[0].text);
after(() => Promise.all([...files, rendererFile].map(file => unlink(file))));
const { materialSubject } = await import(files[0].href);
const { pencilMaterial } = await import(files[1].href);
const { SceneCanvas } = await import(rendererFile.href);
const mark = { type: 'ellipse', x: 0, y: 0, w: 80, h: 100 };

test('ordinary unnamed object descriptors are exactly unchanged', () => {
  for (const kind of ['drawing', 'cat', 'person', 'tree', 'lake']) {
    for (const label of [undefined, '', 'blue bear', 'a lake', 'green meadow', '水面', '草地', 'bear beside a lake']) {
      assert.equal(materialSubject({ kind, label }), `${kind} ${label ?? ''}`);
    }
  }
});

test('only the saved-name prefix is removed, leaving the full descriptive suffix', () => {
  assert.equal(materialSubject({ kind: 'drawing', label: 'River · blue bear' }), 'drawing blue bear');
  assert.equal(materialSubject({ kind: 'drawing', label: 'Meadow · green bear' }), 'drawing green bear');
  assert.equal(materialSubject({ kind: 'drawing', label: '小河 · 蓝色小熊' }), 'drawing 蓝色小熊');
  assert.equal(materialSubject({ kind: 'drawing', label: 'Coco · bear · blue scarf' }), 'drawing bear · blue scarf');
  assert.equal(materialSubject({ kind: 'drawing', label: 'Coco·blue bear' }), 'drawing Coco·blue bear');
});

for (const [name, descriptor, fill] of [
  ['River', 'blue bear', '#88bbdd'], ['Ocean', 'blue puppy', '#88bbdd'], ['Meadow', 'green bear', '#77bb66'],
  ['Hill', 'green creature', '#77bb66'], ['小河', '蓝色小熊', '#88bbdd'], ['草地', '绿色小熊', '#77bb66'],
]) {
  test(`naming a pencil character ${name} preserves every material parameter`, () => {
    const original = { kind: 'drawing', label: descriptor };
    const named = { ...original, label: `${name} · ${descriptor}` };
    const before = pencilMaterial(mark, fill, materialSubject(original));
    const after = pencilMaterial(mark, fill, materialSubject(named));
    assert.equal(before.surface, 'form');
    assert.deepEqual(after, before);
  });
}

test('genuine ground and water descriptors keep their original material after naming', () => {
  for (const [label, fill, surface] of [['blue lake', '#88bbdd', 'water'], ['green meadow', '#77bb66', 'ground']]) {
    const original = pencilMaterial(mark, fill, materialSubject({ kind: 'drawing', label }));
    const named = pencilMaterial(mark, fill, materialSubject({ kind: 'drawing', label: `Coco · ${label}` }));
    assert.equal(original.surface, surface); assert.deepEqual(named, original);
  }
});

test('a named object without a descriptive label retains its kind classification', () => {
  for (const kind of ['cat', 'person', 'drawing']) {
    for (const fill of ['#88bbdd', '#77bb66', '#dd9977']) {
      const original = pencilMaterial(mark, fill, materialSubject({ kind }));
      const named = pencilMaterial(mark, fill, materialSubject({ kind, label: `River · ${kind}` }));
      assert.deepEqual(named, original);
    }
  }
});

test('both built-in shapes and free marks pass the same material descriptor', async () => {
  const renderer = await readFile(new URL('../components/SceneCanvas.tsx', import.meta.url), 'utf8');
  assert.match(renderer, /brushLegacy\(drawBaseObject\(object\)[^\n]+subject: materialSubject\(object\)/);
  assert.match(renderer, /<BrushMark[^\n]+subject=\{materialSubject\(object\)\}/);
});

test('naming preserves actual rendered pigment in all three media, including built-in objects', () => {
  const rendered = (object, style) => renderToStaticMarkup(createElement(SceneCanvas, { scene: { title: 'Our picture', sky: 'paper', ground: 'none', weather: 'clear', objects: [object] }, style, id: 'companion-material-test', motionMode: 'still' }))
    .replace(/data-scene-key="[^"]*"/g, '').replace(/<title>[^<]*<\/title>/g, '');
  for (const style of ['crayon', 'pencil', 'watercolor']) {
    for (const kind of ['drawing', 'cat']) {
      for (const [name, label, color] of [['River', 'blue bear', '#88bbdd'], ['Meadow', 'green bear', '#77bb66']]) {
        const object = { id: 'friend', kind, label, x: 300, y: 300, scale: 1, color, marks: kind === 'drawing' ? [{ ...mark, fill: color, stroke: '#556644' }] : undefined };
        assert.equal(rendered({ ...object, label: `${name} · ${label}` }, style), rendered(object, style), `${style}/${kind}/${name}`);
      }
    }
  }
});
