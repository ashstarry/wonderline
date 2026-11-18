import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const temporary = new URL('../.sites-runtime/live-painting-test.mjs', import.meta.url);
const playbackTemporary = new URL('../.sites-runtime/live-painting-playback-test.mjs', import.meta.url);
const failureTemporary = new URL('../.sites-runtime/drawing-failure-live-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const source = await readFile(new URL('../lib/live-painting.ts', import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
await writeFile(failureTemporary, compile(await readFile(new URL('../lib/drawing-failure.ts', import.meta.url), 'utf8')));
await writeFile(temporary, compile(source).replace("'./drawing-failure'", "'./drawing-failure-live-test.mjs'"));
await writeFile(playbackTemporary, compile(await readFile(new URL('../components/stroke-playback-queue.ts', import.meta.url), 'utf8')));
const { StrokePlaybackQueue } = await import(playbackTemporary.href);
const { LivePaintingQueue } = await import(temporary.href);
after(() => Promise.all([unlink(temporary), unlink(failureTemporary), unlink(playbackTemporary)]));
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const segment = (id, text) => ({ id, text });

test('a long speech backlog becomes short conversational turns without dropping or reordering ideas', async () => {
  const calls=[];
  const queue=new LivePaintingQueue(async(text,_signal,segments)=>calls.push({text,ids:segments.map(s=>s.id)}),()=>{});
  const ideas=Array.from({length:9},(_,i)=>segment(String(i),`idea ${i}`));
  queue.add(ideas);await turn();
  assert.equal(calls.length,5);
  assert.ok(calls.every(c=>c.ids.length<=2));
  assert.deepEqual(calls.flatMap(c=>c.ids),ideas.map(s=>`${s.id}:0`));
});

test('only stable segment IDs are applied once; queued phrases are coalesced', async () => {
  const calls = [];
  const queue = new LivePaintingQueue(async text => { calls.push(text); }, () => {});
  queue.add([segment('one', '画一条鲸鱼'), segment('one', '画一条鲸鱼')]);
  queue.add([segment('two', '给它一顶帽子')]);
  await turn();
  queue.add([segment('one', '画一条鲸鱼')]);
  await turn();
  assert.deepEqual(calls, ['画一条鲸鱼\n给它一顶帽子']);
  assert.equal(queue.snapshot().pendingCount, 0);
});

test('speech continues to queue during painting; next dispatch sees the committed latest scene', async () => {
  const gate = deferred();
  let sceneVersion = 0;
  const calls = [];
  const queue = new LivePaintingQueue(async text => {
    calls.push({ text, sceneVersion });
    if (calls.length === 1) await gate.promise;
    sceneVersion++;
  }, () => {});
  queue.add([segment('one', '鲸鱼')]);
  await turn();
  queue.add([segment('two', '蓝色帽子'), segment('three', '再画一颗星星')]);
  await turn();
  assert.equal(calls.length, 1);
  assert.equal(queue.snapshot().painting, true);
  assert.equal(queue.snapshot().pendingCount, 2);
  gate.resolve();
  await turn();
  assert.deepEqual(calls, [{ text: '鲸鱼', sceneVersion: 0 }, { text: '蓝色帽子\n再画一颗星星', sceneVersion: 1 }]);
  assert.equal(sceneVersion, 2);
});

test('a service failure pauses without automatic retries and retains new speech separately', async () => {
  const calls = [];
  let failing = true;
  const queue = new LivePaintingQueue(async text => { calls.push(text); if (failing) throw new TypeError('网络断开'); }, () => {});
  queue.add([segment('one', '鲸鱼')]);
  await turn();
  queue.add([segment('two', '帽子')]);
  await turn();
  assert.deepEqual(calls, ['鲸鱼']);
  assert.equal(queue.snapshot().paused, true);
  assert.equal(queue.snapshot().error, '网络断开');
  assert.equal(queue.snapshot().failureKind, 'service');
  assert.equal(queue.snapshot().failedText, '鲸鱼');
  assert.equal(queue.snapshot().pendingText, '帽子');
  assert.equal(queue.snapshot().pendingCount, 1);
  queue.dismissTurnFailure();
  assert.equal(queue.snapshot().error, '网络断开');
  failing = false;
  queue.retry();
  await turn();
  assert.deepEqual(calls, ['鲸鱼', '鲸鱼\n帽子']);
  assert.equal(queue.snapshot().paused, false);
  assert.equal(queue.snapshot().pendingCount, 0);
  assert.equal(queue.snapshot().failureKind, null);
  assert.equal(queue.snapshot().failedText, '');
});

test('a failed turn cannot block later speech already queued before the rejection', async () => {
  const gate = deferred();
  const calls = [], states = [];
  const queue = new LivePaintingQueue(async text => {
    calls.push(text);
    if (text === '画不出来的想法') await gate.promise;
  }, state => states.push(state));
  queue.add([segment('one', '画不出来的想法')]);
  await turn();
  queue.add([segment('two', '那画一个太阳吧')]);
  gate.reject(new Error('这一笔没有画成'));
  await turn();
  assert.deepEqual(calls, ['画不出来的想法', '那画一个太阳吧']);
  assert.ok(states.some(state => state.failedText === '画不出来的想法' && state.pendingText === '那画一个太阳吧'));
  assert.equal(queue.snapshot().failureKind, null);
  assert.equal(queue.snapshot().error, '');
  assert.equal(queue.snapshot().paused, false);
  queue.add([segment('one', '画不出来的想法'), segment('two', '那画一个太阳吧')]);
  queue.retry();
  await turn();
  assert.equal(calls.length, 2);
});

test('duplicate or empty ASR events do not discard a failed turn; new stable speech does', async () => {
  const calls = [];
  const queue = new LivePaintingQueue(async text => {
    calls.push(text);
    if (text === '鲸鱼') throw new Error('这一笔没有画成');
  }, () => {});
  assert.equal(queue.add([segment('one', '鲸鱼')]), true);
  await turn();
  assert.equal(queue.snapshot().failureKind, 'turn');
  assert.equal(queue.snapshot().paused, false);
  assert.equal(queue.snapshot().pendingCount, 0);
  assert.equal(queue.add([segment('one', '鲸鱼')]), false);
  assert.equal(queue.add([segment('empty', '  \n'), segment('', '月亮')]), false);
  await turn();
  assert.equal(queue.snapshot().failedText, '鲸鱼');
  assert.equal(queue.snapshot().error, '这一笔没有画成');
  assert.deepEqual(calls, ['鲸鱼']);
  // An empty interim observation must not consume the stable ID.
  assert.equal(queue.add([segment('empty', '那画月亮吧')]), true);
  assert.equal(queue.snapshot().failedText, '');
  await turn();
  assert.deepEqual(calls, ['鲸鱼', '那画月亮吧']);
});

test('a new partial hides only a turn failure notice and does not execute or discard work', async () => {
  const calls = [];
  let fail = true;
  const queue = new LivePaintingQueue(async text => {
    calls.push(text);
    if (fail) throw new Error('这一笔没有画成');
  }, () => {});
  queue.add([segment('one', '鲸鱼')]);
  await turn();
  queue.dismissTurnFailure();
  queue.dismissTurnFailure();
  await turn();
  assert.equal(queue.snapshot().error, '');
  assert.equal(queue.snapshot().failedText, '鲸鱼');
  assert.equal(queue.snapshot().failureKind, 'turn');
  assert.deepEqual(calls, ['鲸鱼']);
  fail = false;
  queue.retry();
  await turn();
  assert.deepEqual(calls, ['鲸鱼', '鲸鱼']);
  assert.equal(queue.snapshot().failureKind, null);
});

test('another service failure after explicit retry never starts an automatic retry loop', async () => {
  const calls = [];
  const queue = new LivePaintingQueue(async text => { calls.push(text); throw new TypeError('Failed to fetch'); }, () => {});
  queue.add([segment('one', '鲸鱼')]);
  await turn();
  queue.retry();
  await turn();
  queue.add([segment('two', '星星')]);
  await turn();
  await turn();
  assert.deepEqual(calls, ['鲸鱼', '鲸鱼']);
  assert.equal(queue.snapshot().paused, true);
  assert.equal(queue.snapshot().failedText, '鲸鱼');
  assert.equal(queue.snapshot().pendingText, '星星');
});

test('cancel aborts the outstanding request and clears all future work; late completion cannot restart it', async () => {
  const gate = deferred();
  const calls = [];
  let signal;
  const queue = new LivePaintingQueue(async (text, currentSignal) => { calls.push(text); signal = currentSignal; await gate.promise; }, () => {});
  queue.add([segment('one', '鲸鱼')]);
  await turn();
  queue.add([segment('two', '星星')]);
  queue.cancel();
  assert.equal(signal.aborted, true);
  assert.equal(queue.snapshot().painting, false);
  assert.equal(queue.snapshot().pendingCount, 0);
  gate.resolve();
  queue.add([segment('three', '月亮')]);
  queue.retry();
  await turn();
  assert.deepEqual(calls, ['鲸鱼']);
});

test('cancel before the dispatch microtask prevents the model request completely', async () => {
  let called = false;
  const queue = new LivePaintingQueue(async () => { called = true; }, () => {});
  queue.add([segment('one', '鲸鱼')]);
  queue.cancel();
  await turn();
  assert.equal(called, false);
});

test('a late failure after cancel does not restore an error, failed batch, or pending speech', async () => {
  const gate = deferred();
  const calls = [];
  const queue = new LivePaintingQueue(async text => { calls.push(text); await gate.promise; }, () => {});
  queue.add([segment('one', '鲸鱼')]);
  await turn();
  queue.add([segment('two', '太阳')]);
  queue.cancel();
  gate.reject(new TypeError('Failed to fetch'));
  await turn();
  assert.equal(queue.snapshot().failureKind, null);
  assert.equal(queue.snapshot().failedText, '');
  assert.equal(queue.snapshot().pendingText, '');
  assert.equal(queue.snapshot().error, '');
  assert.equal(queue.add([segment('three', '月亮')]), false);
  assert.deepEqual(calls, ['鲸鱼']);
});

test('large backlogs obey the 600-character request limit without dropping speech', async () => {
  const calls = [];
  const queue = new LivePaintingQueue(async text => { calls.push(text); }, () => {});
  const a = '鲸'.repeat(601), b = '星'.repeat(400), c = '月'.repeat(700);
  queue.add([segment('a', a), segment('b', b), segment('c', c)]);
  await turn();
  assert.ok(calls.length >= 3);
  assert.ok(calls.every(text => text.length <= 600));
  assert.equal(calls.join('').replaceAll('\n', ''), a + b + c);
});

test('a failed 600-character batch is skipped while all later chunks and utterances survive', async () => {
  const calls = [];
  const queue = new LivePaintingQueue(async text => {
    calls.push(text);
    if (calls.length === 1) throw new Error('这一笔没有画成');
  }, () => {});
  const a = '鲸'.repeat(1301), b = '星'.repeat(400), c = '月'.repeat(700);
  queue.add([segment('a', a), segment('b', b), segment('c', c)]);
  await turn();
  assert.ok(calls.every(text => text.length <= 600));
  assert.equal(calls.join('').replaceAll('\n', ''), a + b + c);
  assert.equal(calls.slice(1).join('').replaceAll('\n', ''), a.slice(600) + b + c);
  assert.equal(queue.snapshot().failureKind, null);
  assert.equal(queue.snapshot().pendingCount, 0);
});

test('a clarification result can update context before the next queued answer runs', async () => {
  let clarification = null;
  const gate = deferred();
  const contexts = [];
  const queue = new LivePaintingQueue(async text => {
    contexts.push({ text, clarification });
    if (text === '给它戴上') { await gate.promise; clarification = { instruction: text, question: '戴什么？' }; }
    else clarification = null;
  }, () => {});
  queue.add([segment('one', '给它戴上')]);
  await turn();
  queue.add([segment('two', '一顶黄色的帽子')]);
  gate.resolve();
  await turn();
  assert.deepEqual(contexts[1].clarification, { instruction: '给它戴上', question: '戴什么？' });
  assert.equal(clarification, null);
});

const { StreamUpdateGate } = await import(temporary.href);
const progress = (revision, done = false, sessionId = 'active-session') => ({ sessionId, revision, done });

test('stream completion delivered via onUpdate, done and stop is handled only once', () => {
  const gate = new StreamUpdateGate();
  assert.equal(gate.accept(progress(1)), true);
  assert.equal(gate.accept(progress(2)), true);
  assert.equal(gate.accept(progress(3, true)), true);
  assert.equal(gate.ended, true);
  assert.equal(gate.accept(progress(3, true)), false);
  assert.equal(gate.accept(progress(3, true)), false);
  assert.equal(gate.accept(progress(4)), false);
  assert.equal(gate.fail(), false);
});

test('an error delivered via onError, done rejection and stop rejection settles UI only once', () => {
  const gate = new StreamUpdateGate();
  assert.equal(gate.accept(progress(1)), true);
  assert.equal(gate.fail(), true);
  assert.equal(gate.fail(), false);
  assert.equal(gate.fail(), false);
  assert.equal(gate.accept(progress(2, true)), false);
  assert.equal(gate.ended, true);
});

test('revised partials reject old/duplicate updates and foreign sessions without ending the current one', () => {
  const gate = new StreamUpdateGate();
  assert.equal(gate.accept(progress(2)), true);
  assert.equal(gate.accept(progress(1)), false);
  assert.equal(gate.accept(progress(2)), false);
  assert.equal(gate.accept(progress(3, true, 'old-session')), false);
  assert.equal(gate.ended, false);
  assert.equal(gate.accept(progress(3)), true);
  assert.equal(gate.accept(progress(4, true)), true);
});

test('a final done result with the latest revision still releases a recording once', () => {
  const gate = new StreamUpdateGate();
  assert.equal(gate.accept(progress(3)), true);
  assert.equal(gate.accept(progress(3, true)), true);
  assert.equal(gate.accept(progress(3, true)), false);
});

// The model and the physical painter deliberately have separate deferred work.
// A slow brush must not cause a second model round trip after it finishes.
test('next model request starts before the first subject finishes and uses its committed geometry', async () => {
  const firstModel=deferred(), secondModel=deferred();
  const requests=[], starts=[], finished=[];
  const drawingTasks=new Map();
  let scene=[], drawing=false;
  const playback=new StrokePlaybackQueue(entry=>{
    const task={hasColor:true,assignPainter(index){this.painter=index;},retarget(){},
      play(phase,complete){starts.push({key:entry.key,phase,painter:this.painter});this.complete=complete;},
      dispose(){finished.push(entry.key);}};
    drawingTasks.set(entry.key,task);return task;
  }, value=>drawing=value);
  playback.reconcile([],true);
  const planner=new LivePaintingQueue(async text=>{
    requests.push({text,base:scene.map(entry=>entry.key),drawing});
    await (requests.length===1?firstModel:secondModel).promise;
    const key=requests.length===1?'boy':'teddy';
    scene=[...scene,{key,owner:key,target:{}}];
    playback.reconcile(scene);
  },()=>{});
  planner.add([segment('one','有一个小男孩')]);await turn();
  firstModel.resolve();await turn();
  assert.equal(drawing,true);assert.equal(finished.length,0);
  planner.add([segment('two','手上拿着一个泰迪熊')]);await turn();
  assert.deepEqual(requests[1],{text:'手上拿着一个泰迪熊',base:['boy'],drawing:true});
  assert.equal(planner.snapshot().painting,true);
  secondModel.resolve();await turn();
  assert.deepEqual(starts,[{key:'boy',phase:'outline',painter:0},{key:'teddy',phase:'outline',painter:1}]);
  assert.equal(finished.length,0,'both have started without completing or disposing the first subject');
  assert.equal(planner.snapshot().painting,false,'model has finished while real strokes remain active');
  assert.equal(drawing,true);
  planner.cancel();playback.dispose();
});
