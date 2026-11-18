import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const file = new URL(`../.sites-runtime/object-action-placement-${process.pid}.mjs`, import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../components/object-action-placement.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(file, compiled.outputFiles[0].text);
after(() => unlink(file));
const { companionActionPosition } = await import(file.href);

const paper = { x: 0, y: 0, width: 1000, height: 640 };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} ≈ ${expected}`);
function assertSafe(rect, box, viewport, scale, width = 134, height = 44) {
  assert.ok(rect, 'a visible action fits');
  assert.ok(rect.x >= viewport.x + 8 / scale - 1e-6);
  assert.ok(rect.y >= viewport.y + 8 / scale - 1e-6);
  assert.ok(rect.x + rect.width <= viewport.x + viewport.width - 8 / scale + 1e-6);
  assert.ok(rect.y + rect.height <= viewport.y + viewport.height - 8 / scale + 1e-6);
  near(rect.width * scale, width, 'screen width');
  near(rect.height * scale, height, 'screen height');
  const handles = [
    { x: box.x + box.width + 5 / scale, y: box.y - 5 / scale },
    { x: clamp(box.x + box.width + 5 / scale, viewport.x + 12 / scale, viewport.x + viewport.width - 12 / scale), y: clamp(box.y + box.height + 5 / scale, viewport.y + 12 / scale, viewport.y + viewport.height - 12 / scale) },
  ];
  for (const handle of handles) {
    const distance = Math.hypot(handle.x - clamp(handle.x, rect.x, rect.x + rect.width), handle.y - clamp(handle.y, rect.y, rect.y + rect.height));
    assert.ok(distance * scale >= 26 - 1e-6, `all of each 22px touch circle plus 4px clearance stays free (${distance * scale})`);
  }
}

test('normal selections anchor to the frame lower-left with a 6px gap at every zoom', () => {
  for (const scale of [.35, .6, 1, 2]) {
    const box = { x: 300, y: 200, width: 220 / scale, height: 90 / scale };
    const rect = companionActionPosition(box, { x: 0, y: 0, width: 2000, height: 1600 }, scale, 158);
    assertSafe(rect, box, { x: 0, y: 0, width: 2000, height: 1600 }, scale, 158);
    near(rect.x, box.x - 5 / scale, 'aligned with dashed left edge');
    near((rect.y - box.y - box.height) * scale, 11, '5px frame pad plus 6px gap');
  }
});

test('a slightly narrow selection shifts along its frame instead of falling far below or into a canvas corner', () => {
  const box = { x: 270, y: 205, width: 150, height: 90 };
  const rect = companionActionPosition(box, paper, 1, 158);
  assertSafe(rect, box, paper, 1, 158);
  near(rect.y, 306, 'stays 6px below the dashed frame');
  assert.ok(rect.x < 265 && rect.x > 240, 'only the small local left shift needed for the resize handle');
});

test('a small phone selection keeps the 6px frame gap by shifting left around its resize handle', () => {
  const viewport = { x: 0, y: 0, width: 326, height: 398 };
  const box = { x: 191.35, y: 210.96, width: 34.31, height: 40.69 };
  const rect = companionActionPosition(box, viewport, 1, 158);
  assertSafe(rect, box, viewport, 1, 158);
  near(rect.y, 262.65, '6px below the dashed bottom edge');
  assert.ok(rect.x > 45 && rect.x < 50, 'stays on the nearby lower-left edge, clear of resize');
});

test('a bottom-edge selection uses the nearby upper-left edge', () => {
  const box = { x: 300, y: 525, width: 230, height: 115 };
  const rect = companionActionPosition(box, paper, 1, 158);
  assertSafe(rect, box, paper, 1, 158);
  near(rect.x, 295, 'upper-left alignment');
  near(rect.y + rect.height, 514, '6px above the dashed top edge');
});

test('tiny, edge and full-paper objects stay nearby and clear of both controls across zoom levels', () => {
  for (const scale of [.35, .6, 1, 2]) {
    for (const width of [134, 158]) {
      for (const box of [
        { x: 0, y: 0, width: 120, height: 160 },
        { x: 850, y: 480, width: 150, height: 160 },
        { x: 0, y: 480, width: 150, height: 160 },
        { x: 850, y: 0, width: 150, height: 160 },
        { x: 0, y: 0, width: 1000, height: 640 },
        { x: 490, y: 300, width: 20, height: 20 },
        { x: 490, y: 300, width: 1, height: 1 },
      ]) {
        const rect = companionActionPosition(box, paper, scale, width);
        assertSafe(rect, box, paper, scale, width);
        const frameGap = Math.hypot(Math.max(box.x - 5 / scale - rect.x - rect.width, rect.x - box.x - box.width - 5 / scale, 0), Math.max(box.y - 5 / scale - rect.y - rect.height, rect.y - box.y - box.height - 5 / scale, 0));
        assert.ok(frameGap * scale <= 26 + 1e-6, 'stays beside the frame instead of escaping to a distant corner');
      }
    }
  }
});

test('short translated canvases use a close safe inset when no exterior position fits', () => {
  const viewport = { x: -120, y: -30, width: 320, height: 151 };
  for (const box of [
    { ...viewport },
    { x: -50, y: 35, width: 40, height: 60 },
    { x: 155, y: 80, width: 40, height: 40 },
  ]) {
    assertSafe(companionActionPosition(box, viewport, 1, 158), box, viewport, 1, 158);
  }
  const inset = companionActionPosition(viewport, viewport, 1, 158);
  near(inset.x, viewport.x + 8, 'nearest inset left edge');
  near(inset.y + inset.height, viewport.y + viewport.height - 8, 'nearest inset bottom edge');
});

test('placement is deterministic, honors touch size and never mutates its geometry inputs', () => {
  const box = Object.freeze({ x: 490, y: 300, width: 20, height: 20 });
  const viewport = Object.freeze({ ...paper });
  const before = JSON.stringify({ box, viewport });
  const first = companionActionPosition(box, viewport, 1, 158);
  for (let i = 0; i < 10; i++) assert.deepEqual(companionActionPosition(box, viewport, 1, 158), first);
  assert.equal(JSON.stringify({ box, viewport }), before);
  assertSafe(companionActionPosition(box, viewport, 1, 158, 40), box, viewport, 1, 158, 40);
  assertSafe(companionActionPosition(box, viewport, 1, 158, 24), box, viewport, 1, 158, 40);
  assert.deepEqual(companionActionPosition(box, viewport, NaN, 158), first);
});

test('unusable viewport or invalid geometry returns no clipped touch target', () => {
  const box = { x: 270, y: 205, width: 150, height: 90 };
  assert.equal(companionActionPosition(box, { ...paper, width: 173 }, 1, 158), null);
  assert.equal(companionActionPosition(box, { ...paper, height: 59 }, 1, 158), null);
  assert.equal(companionActionPosition({ ...box, x: NaN }, paper, 1, 158), null);
  assert.equal(companionActionPosition(box, paper, 1, Infinity), null);
});
