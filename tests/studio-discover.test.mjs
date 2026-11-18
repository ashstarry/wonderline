import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const source = await readFile(new URL('../components/StudioDiscover.tsx', import.meta.url), 'utf8');
const file = new URL(`../.sites-runtime/studio-discover-test-${process.pid}.mjs`, import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
await writeFile(file, ts.transpileModule(source.replaceAll(/import '\.\/[^']+\.css';/g, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText);
after(() => unlink(file));
const { StudioLibraryNav, StudioCreationActions } = await import(file.href);
const noop = () => {};
const libraryProps = { language: 'en', onCompanions: noop, onPicturebook: noop };
const actionProps = { language: 'en', picking: false, canPick: true, onPick: noop };
const renderLibrary = props => renderToStaticMarkup(createElement(StudioLibraryNav, { ...libraryProps, ...props }));
const renderActions = props => renderToStaticMarkup(createElement(StudioCreationActions, { ...actionProps, ...props }));

test('collections have two readable destinations in navigation without a chooser', () => {
  const html = renderLibrary({});
  assert.match(html, /^<nav[^>]*aria-label="Your collection"/);
  assert.match(html, /My companions/);
  assert.match(html, /Picturebook/);
  assert.equal((html.match(/<button /g) || []).length, 2);
  assert.equal((html.match(/aria-haspopup="dialog"/g) || []).length, 2);
  assert.doesNotMatch(html, /<dialog|<select|studio-door|voice-studio-footer|Need an idea/);
});
test('the page toolbar contains only the direct character picker', () => {
  const html = renderActions({});
  assert.match(html, /Keep a character/);
  assert.equal((html.match(/<button /g) || []).length, 1);
  assert.doesNotMatch(html, /Need an idea|Leave some space|找点灵感|收起灵感|paper-inspiration|aria-expanded|Picturebook|My companions|<dialog|<select/);
});
test('both entry areas provide Chinese labels and contextual descriptions', () => {
  const library = renderLibrary({ language: 'zh' });
  const actions = renderActions({ language: 'zh' });
  for (const text of ['我的伙伴', '画册', '看看收藏的画面和故事']) assert.ok(library.includes(text));
  for (const text of ['留下角色', '直接点选画中的角色']) assert.ok(actions.includes(text));
  assert.equal((actions.match(/<button /g) || []).length, 1);
  assert.doesNotMatch(actions, /找点灵感|收起灵感|paper-inspiration/);
  assert.doesNotMatch(library + actions, /My companions|Picturebook|Keep a character|Need an idea/);
});
test('collection buttons call their destinations directly', () => {
  let companions = 0, pictures = 0;
  const tree = StudioLibraryNav({ ...libraryProps, onCompanions: () => companions++, onPicturebook: () => pictures++ });
  tree.props.children[0].props.onClick();
  assert.deepEqual([companions, pictures], [1, 0]);
  tree.props.children[1].props.onClick();
  assert.deepEqual([companions, pictures], [1, 1]);
});
test('direct canvas picking needs one click', () => {
  let picks = 0;
  const tree = StudioCreationActions({ ...actionProps, onPick: () => picks++ });
  tree.props.children.props.onClick();
  assert.equal(picks, 1);
});
test('an empty canvas disables the single character action', () => {
  const tree = StudioCreationActions({ ...actionProps, canPick: false });
  assert.equal(tree.props.children.props.disabled, true);
  const html = renderActions({ canPick: false });
  assert.equal((html.match(/<button /g) || []).length, 1);
  assert.equal((html.match(/disabled=""/g) || []).length, 1);
  assert.match(html, /Draw a character first/);
});
test('picking state explains the next action and remains cancellable if candidates vanish', () => {
  const tree = StudioCreationActions({ ...actionProps, canPick: false, picking: true });
  assert.equal(tree.props.children.props.disabled, false);
  const html = renderActions({ canPick: false, picking: true });
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /Choose on the page/);
  assert.match(html, /click here to cancel/);
  assert.match(renderActions({ language: 'zh', picking: true }), /点选画中的角色/);
});
test('inactive actions do not imply the character is already selected', () => {
  const html = renderActions({});
  assert.match(html, /aria-pressed="false"/);
  assert.doesNotMatch(html, /is-picking|Choose on the page/);
});

test('the picker stays the only toolbar action in both languages and picking states', () => {
  for (const language of ['en', 'zh']) {
    for (const picking of [false, true]) {
      const html = renderActions({ language, picking });
      assert.equal((html.match(/<button /g) || []).length, 1);
      assert.doesNotMatch(html, /Need an idea|Leave some space|找点灵感|收起灵感|paper-inspiration|aria-expanded|aria-haspopup="dialog"/);
    }
  }
});
