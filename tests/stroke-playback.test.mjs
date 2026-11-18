import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const temporary = new URL('../.sites-runtime/stroke-playback-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const source = await readFile(new URL('../components/stroke-playback-queue.ts', import.meta.url), 'utf8');
await writeFile(temporary, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
const { StrokePlaybackQueue, reorderedStrokeOwners } = await import(temporary.href);
after(() => unlink(temporary));

function fixture(capacity) {
  const tasks = new Map();
  const events = [];
  const states = [];
  const queue = new StrokePlaybackQueue(({ key, target }) => {
    const task = {
      hasColor: target.color !== false,
      fillOnly: target.fillOnly ?? false,
      target,
      painters: [],
      assignPainter(index) { this.painters.push(index); },
      callbacks: [],
      yields: [],
      yieldRequests: 0,
      plays: [],
      disposed: false,
      retarget(next) { this.target = next; events.push(`retarget:${key}`); },
      play(phase, complete, yielded) { this.plays.push(phase); this.callbacks.push(complete); this.yields.push(yielded); events.push(`${phase}:${key}`); },
      requestYield() { this.yieldRequests++; },
      dispose() { this.disposed = true; events.push(`dispose:${key}`); },
      finish() { const complete = this.callbacks.at(-1); assert.ok(complete); complete(); },
    };
    tasks.set(key, task);
    return task;
  }, value => states.push(value), capacity,undefined,()=>{},()=>true);
  return { queue, tasks, events, states };
}
const target = (key, color = true) => ({ key, target: { label: key, color } });

test('a second artist starts the goldfish immediately while the mermaid contour is unfinished', () => {
  const {queue,tasks}=fixture();queue.reconcile([]);
  const mermaid=Array.from({length:8},(_,i)=>({...target(`mermaid-${i}`),owner:'mermaid'}));
  queue.reconcile(mermaid,false,1);
  const first=tasks.get('mermaid-0');
  queue.reconcile([...mermaid,{...target('fish'),owner:'goldfish'}],false,2);
  assert.deepEqual(first.plays,['outline']);assert.equal(first.disposed,false);
  assert.deepEqual(tasks.get('fish').plays,['outline']);
  assert.notEqual(first.painters[0],tasks.get('fish').painters[0]);
  assert.deepEqual(queue.snapshot().painters.map(p=>p.owner),['mermaid','goldfish']);
  tasks.get('fish').finish();
  assert.equal(queue.snapshot().colorKey,'fish','one artist can color while the other is still outlining');
  assert.deepEqual(first.plays,['outline'],'never fast-forward or restart the old contour');
});

test('both artists can color different subjects together and finish independently', () => {
  const {queue,tasks}=fixture();queue.reconcile([]);
  queue.reconcile([target('mermaid'),target('goldfish')]);
  tasks.get('mermaid').finish();tasks.get('goldfish').finish();
  assert.deepEqual(queue.snapshot().painters.map(p=>p.phase),['color','color']);
  tasks.get('goldfish').finish();assert.equal(queue.snapshot().drawing,true);
  tasks.get('mermaid').finish();assert.equal(queue.snapshot().drawing,false);
});

test('each artist finishes its own complete contour then colors, without cross-subject hopping', () => {
  const {queue,tasks}=fixture();queue.reconcile([]);
  const parts=Array.from({length:6},(_,i)=>({...target(`house-${i}`),owner:'house'}));
  const tree={...target('tree'),owner:'tree'},whale={...target('whale'),owner:'whale'},star={...target('star'),owner:'star'};
  queue.reconcile([parts[0],tree,...parts.slice(1),star],false,1);
  queue.reconcile([parts[0],tree,...parts.slice(1),star,whale],false,2);
  for(let i=0;i<5;i++){tasks.get(`house-${i}`).finish();assert.equal(queue.snapshot().painters[0].key,`house-${i+1}`);assert.equal(queue.snapshot().colorKey,null);}
  tasks.get('house-5').finish();assert.equal(queue.snapshot().colorKey,'house-0');
  assert.deepEqual(tasks.get('whale').plays,[],'all three artists are occupied');
  tasks.get('house-0').finish();assert.equal(queue.snapshot().colorKey,'house-1');
  tasks.get('tree').finish();tasks.get('tree').finish();
  assert.deepEqual(tasks.get('whale').plays,['outline'],'the free colleague takes the newest idea');
  assert.equal(queue.snapshot().painters[0].owner,'house');
});

test('late contour data pauses the same subject brush at a stroke boundary', () => {
  const {queue,tasks}=fixture();queue.reconcile([]);
  const first={...target('face'),owner:'child'},second={...target('hair'),owner:'child'};
  queue.reconcile([first]);tasks.get('face').finish();
  queue.reconcile([first,second]);assert.equal(tasks.get('face').yieldRequests,1);
  assert.deepEqual(tasks.get('hair').plays,[]);
  tasks.get('face').yields.at(-1)();assert.equal(queue.snapshot().activeKey,'hair');assert.equal(queue.snapshot().colorKey,null);
  tasks.get('hair').finish();assert.equal(queue.snapshot().colorKey,'face');
  assert.deepEqual(tasks.get('face').plays,['outline','color','color']);
});

test('a fill-only background can start its brush while a character contour is drawn', () => {
  const {queue,tasks}=fixture();queue.reconcile([]);
  const wash={key:'lake',owner:'lake',target:{fillOnly:true,color:true}};
  queue.reconcile([wash,{...target('house'),owner:'house'}]);
  assert.deepEqual(tasks.get('lake').plays,['color']);
  assert.equal(queue.snapshot().activeKey,'house');assert.equal(queue.snapshot().colorKey,'lake');
});

test('reset cancels both painters and their stale callbacks cannot resume either lane', () => {
  const {queue,tasks}=fixture();queue.reconcile([]);queue.reconcile([target('house'),target('tree')]);
  tasks.get('house').finish();
  const color=tasks.get('house').callbacks.at(-1),outline=tasks.get('tree').callbacks.at(-1);
  assert.equal(queue.snapshot().colorKey,'house');assert.equal(queue.snapshot().activeKey,'tree');
  queue.reconcile([],true);color();outline();
  assert.equal(queue.snapshot().drawing,false);assert.ok(tasks.get('house').disposed&&tasks.get('tree').disposed);
});

test('an erasure waits for both artists to stop and completes before replacement strokes', () => {
  const tasks=new Map(),events=[];
  const make=(key,color=true)=>{const task={hasColor:color,retarget(){},dispose(){},requestYield(){events.push(`yield-request:${key}`);},play(phase,done,yielded){task.done=done;task.yielded=yielded;events.push(`${phase}:${key}`);}};tasks.set(key,task);return task;};
  const queue=new StrokePlaybackQueue(({key})=>make(key),()=>{},2048,()=>make('erase',false));
  const old=target('old');queue.reconcile([old]);queue.reconcile([old,target('house'),target('tree')]);
  tasks.get('house').done();queue.reconcile([target('house'),target('tree'),target('replacement')]);
  assert.ok(events.includes('yield-request:house'));assert.ok(!events.includes('erase:erase'));
  tasks.get('house').yielded();assert.ok(!events.includes('erase:erase'));
  tasks.get('tree').done();assert.equal(events.at(-1),'erase:erase');
  assert.ok(!events.includes('outline:replacement'));
  tasks.get('erase').done();assert.equal(queue.snapshot().colorKey,'house');
  assert.ok(!events.includes('outline:replacement'),'without independent-region evidence the third artist waits');
  tasks.get('house').done();assert.ok(events.includes('outline:replacement'));
});

test('a stale yield callback cannot revive a cancelled drawing', () => {
  const {queue,tasks}=fixture();queue.reconcile([]);queue.reconcile([target('old')]);
  tasks.get('old').finish();const yieldOld=tasks.get('old').yields.at(-1);
  queue.reconcile([],true);yieldOld();
  assert.equal(queue.snapshot().drawing,false);assert.equal(queue.snapshot().pending,0);
});

test('initial art is baseline; at most three new subject outlines start', () => {
  const { queue, tasks, states } = fixture();
  const old = target('old');
  queue.reconcile([old]);
  assert.equal(tasks.size, 0);
  queue.reconcile([old, target('one'), target('two'), target('three'), target('four')]);
  assert.deepEqual(tasks.get('one').plays, ['outline']);
  assert.deepEqual(tasks.get('two').plays, ['outline']);
  assert.deepEqual(tasks.get('three').plays, ['outline']);
  assert.deepEqual(tasks.get('four').plays, []);
  assert.equal(queue.snapshot().painters.length,3);
  assert.deepEqual(states, [true]);
  assert.equal(queue.snapshot().pending, 1);
});

test('incremental scenes append work without restarting the current stroke or old art', () => {
  const { queue, tasks, events } = fixture();
  queue.reconcile([]);
  const a = target('a');
  const b = target('b');
  queue.reconcile([a]);
  const firstTask = tasks.get('a');
  queue.reconcile([a, b]);
  queue.reconcile([a, b]);
  assert.equal(tasks.get('a'), firstTask);
  assert.deepEqual(firstTask.plays, ['outline']);
  assert.equal(firstTask.disposed, false);
  assert.deepEqual(events, ['outline:a','outline:b']);
});

test('when three artists are occupied the next subject waits for one to finish, without stealing a cursor', () => {
  const {queue,tasks}=fixture();queue.reconcile([]);
  const a=target('a'),b=target('b'),c=target('c',false),d=target('d',false);
  queue.reconcile([a,b,d]);tasks.get('a').finish();queue.reconcile([a,b,d,c]);
  tasks.get('b').finish();assert.deepEqual(tasks.get('c').plays,[]);
  tasks.get('a').finish();assert.deepEqual(tasks.get('c').plays,['outline']);
  assert.equal(tasks.get('c').painters[0],tasks.get('a').painters[0]);
  tasks.get('c').finish();tasks.get('b').finish();tasks.get('d').finish();assert.equal(queue.snapshot().drawing,false);
});

test('deleting one active shape cancels only that shape and advances to the next', () => {
  const { queue, tasks, states } = fixture();
  queue.reconcile([]);
  const a = target('a');
  const b = target('b', false);
  queue.reconcile([a, b]);
  const late = tasks.get('a').callbacks[0];
  queue.reconcile([b]);
  assert.equal(tasks.get('a').disposed, true);
  assert.equal(tasks.get('b').disposed, false);
  assert.equal(queue.snapshot().activeKey, 'b');
  late();
  assert.equal(queue.snapshot().activeKey, 'b');
  tasks.get('b').finish();
  assert.deepEqual(states, [true, false]);
});

test('deleting a queued mark releases it without running or interrupting active work', () => {
  const { queue, tasks } = fixture();
  queue.reconcile([]);
  const a = {...target('a'),owner:'one'};
  const b = {...target('b'),owner:'one'};
  queue.reconcile([a, b]);
  queue.reconcile([a]);
  assert.deepEqual(tasks.get('b').plays, []);
  assert.equal(tasks.get('b').disposed, true);
  assert.equal(tasks.get('a').disposed, false);
  assert.equal(queue.snapshot().activeKey, 'a');
});

test('same stroke signature with a replaced DOM target transfers progress rather than replaying', () => {
  const { queue, tasks } = fixture();
  queue.reconcile([]);
  queue.reconcile([target('a')]);
  const replacement = target('a');
  queue.reconcile([replacement]);
  assert.equal(tasks.get('a').target, replacement.target);
  assert.deepEqual(tasks.get('a').plays, ['outline']);
  assert.equal(tasks.get('a').disposed, false);
});

test('explicit reset/reduced-motion snap releases every hold and prevents late callbacks restarting work', () => {
  const { queue, tasks, states } = fixture();
  queue.reconcile([]);
  const entries = [target('a'), target('b')];
  queue.reconcile(entries);
  const late = tasks.get('a').callbacks[0];
  queue.reconcile(entries, true);
  assert.ok([...tasks.values()].every(task => task.disposed));
  assert.deepEqual(states, [true, false]);
  late();
  queue.reconcile(entries);
  assert.equal(queue.snapshot().drawing, false);
  assert.deepEqual(tasks.get('a').plays, ['outline']);
});

test('finished strokes remain finished through unrelated scene changes and order changes', () => {
  const { queue, tasks } = fixture();
  queue.reconcile([]);
  const a = target('a', false);
  const b = target('b', false);
  queue.reconcile([a]);
  tasks.get('a').finish();
  queue.reconcile([b, a]);
  assert.deepEqual(tasks.get('a').plays, ['outline']);
  assert.equal(queue.snapshot().activeKey, 'b');
});

test('retained history is bounded by the current scene rather than the conversation length', () => {
  const { queue } = fixture(8);
  queue.reconcile([]);
  for (let turn = 0; turn < 100; turn++) queue.reconcile(Array.from({ length: 20 }, (_, index) => target(`${turn}-${index}`)));
  assert.equal(queue.snapshot().retained, 8);
  assert.equal(queue.snapshot().pending, 5);
  queue.reconcile([]);
  assert.deepEqual(queue.snapshot(), { activeKey: null, phase: null, colorKey: null, painters: [], pending: 0, retained: 0, drawing: false });
});

test('synchronous unsupported/empty geometry completion does not recurse or stall the pen', () => {
  let completed = 0;
  const queue = new StrokePlaybackQueue(() => ({ hasColor: false, retarget() {}, play(_phase, finish) { finish(); }, dispose() { completed++; } }));
  queue.reconcile([]);
  queue.reconcile(Array.from({ length: 1000 }, (_, index) => target(`empty-${index}`)));
  assert.equal(completed, 1000);
  assert.equal(queue.snapshot().drawing, false);
});

test('unmount disposes active and queued tasks and reports an idle state', () => {
  const { queue, tasks, states } = fixture();
  queue.reconcile([]);
  queue.reconcile([target('a'), target('b')]);
  queue.dispose();
  assert.deepEqual(states, [true, false]);
  assert.equal(queue.snapshot().retained, 0);
  assert.ok([...tasks.values()].every(task => task.disposed));
});

function erasingFixture() {
  const events = [], tasks = new Map(), states = [];
  const make = (key, hasColor = true) => {
    const task = { hasColor, disposed: false, callbacks: [], retarget() {},
      play(phase, finish) { events.push(`${phase}:${key}`); this.callbacks.push(finish); },
      dispose() { this.disposed = true; },
      finish() { this.callbacks.at(-1)(); },
    };
    tasks.set(key, task);
    return task;
  };
  const queue = new StrokePlaybackQueue(({ key }) => make(key), value => states.push(value), 2048,
    entries => {
      for (const { key, task, state } of entries) {
        assert.ok(!task?.disposed, 'every visible snapshot is captured before live tasks are disposed');
        events.push(`snapshot:${key}:${state}:${Boolean(task)}`);
      }
      return make(`erase-${entries.map(entry => entry.key).join('+')}`, false);
    },()=>{},()=>true);
  return { queue, events, tasks, states };
}

test('editing an arm erases only its old stroke before drawing its replacement', () => {
  const { queue, events, tasks } = erasingFixture();
  const head = target('head'), arm = target('old-arm'), feet = target('feet'), raised = target('raised-arm');
  queue.reconcile([head, arm, feet]);
  queue.reconcile([head, raised, feet]);
  assert.deepEqual(events, ['snapshot:old-arm:done:false', 'erase:erase-old-arm']);
  assert.equal(tasks.get('raised-arm').callbacks.length, 0);
  assert.equal(tasks.has('head'), false);
  assert.equal(tasks.has('feet'), false);
  tasks.get('erase-old-arm').finish();
  assert.equal(events.at(-1), 'outline:raised-arm');
  tasks.get('raised-arm').finish();
  assert.equal(events.at(-1), 'color:raised-arm');
  tasks.get('raised-arm').finish();
  assert.equal(queue.snapshot().drawing, false);
});

test('a removal with no additions still plays the eraser and reaches idle', () => {
  const { queue, tasks, states } = erasingFixture();
  queue.reconcile([target('hat')]);
  queue.reconcile([]);
  assert.equal(queue.snapshot().phase, 'erase');
  tasks.get('erase-hat').finish();
  assert.deepEqual(states, [true, false]);
});

test('all removed visible marks erase before newly generated marks are released', () => {
  const { queue, tasks, events } = erasingFixture();
  queue.reconcile([target('sleeve'), target('hand')]);
  queue.reconcile([target('new-sleeve'), target('new-hand')]);
  assert.equal(events.at(-1), 'erase:erase-sleeve+hand');
  assert.equal(queue.snapshot().pending, 2, 'the removed marks share one active erase, with only new drawing pending');
  tasks.get('erase-sleeve+hand').finish();
  assert.deepEqual(events.slice(-2), ['outline:new-sleeve','outline:new-hand']);
});

test('reset during erasure removes snapshots and holds, and stale eraser completion is harmless', () => {
  const { queue, tasks, states } = erasingFixture();
  queue.reconcile([target('old')]);
  const replacement = target('new');
  queue.reconcile([replacement]);
  const late = tasks.get('erase-old').callbacks[0];
  queue.reconcile([replacement], true);
  assert.equal(tasks.get('erase-old').disposed, true);
  assert.equal(tasks.get('new').disposed, true);
  late();
  assert.equal(queue.snapshot().drawing, false);
  assert.deepEqual(states, [true, false]);
});

test('removing a not-yet-drawn mark produces no fake erasing', () => {
  const { queue, events } = erasingFixture();
  queue.reconcile([]);
  const first = {...target('first'),owner:'one'}, queued = {...target('queued'),owner:'one'};
  queue.reconcile([first, queued]);
  queue.reconcile([first]);
  assert.equal(events.some(event => event.includes('snapshot:queued')), false);
  assert.equal(queue.snapshot().activeKey, 'first');
});

test('stream changes during erasure preserve the eraser and replace only hidden pending work', () => {
  const { queue, tasks, events } = erasingFixture();
  queue.reconcile([target('old-arm')]);
  queue.reconcile([target('interim-arm')]);
  const eraser = tasks.get('erase-old-arm');
  queue.reconcile([target('final-arm')]);
  assert.equal(tasks.get('erase-old-arm'), eraser);
  assert.equal(eraser.disposed, false);
  assert.equal(tasks.get('interim-arm').disposed, true);
  assert.equal(events.some(event => event.startsWith('snapshot:interim-arm')), false);
  eraser.finish();
  assert.equal(events.at(-1), 'outline:final-arm');
});

test('owner inversions exclude additions, removals and changes within an owner', () => {
  assert.deepEqual([...reorderedStrokeOwners(['a', 'b', 'c'], ['a', 'new', 'b', 'c'])], []);
  assert.deepEqual([...reorderedStrokeOwners(['a', 'b', 'c'], ['a', 'c'])], []);
  assert.deepEqual([...reorderedStrokeOwners(['a', 'a', 'b', 'c'], ['b', 'a', 'a', 'c'])].sort(), ['a', 'b']);
  assert.deepEqual([...reorderedStrokeOwners(['a', 'b', 'c'], ['c', 'b', 'a'])].sort(), ['a', 'b', 'c']);
});

test('changing overlap erases the affected old owners before drawing their unchanged shapes in new order', () => {
  const { queue, tasks, events } = erasingFixture();
  const a = { ...target('a-shape'), owner: 'a' }, b = { ...target('b-shape'), owner: 'b' }, c = { ...target('c-shape'), owner: 'c' };
  queue.reconcile([a, b, c]);
  queue.reconcile([b, a, c]);
  assert.deepEqual(events, ['snapshot:a-shape:done:false', 'snapshot:b-shape:done:false', 'erase:erase-a-shape+b-shape']);
  assert.equal(tasks.has('c-shape'), false, 'unaffected neighboring art stays visible');
  tasks.get('erase-a-shape+b-shape').finish();
  assert.deepEqual(events.slice(-2), ['outline:b-shape','outline:a-shape']);
  tasks.get('b-shape').finish();
  assert.equal(queue.snapshot().activeKey, 'a-shape');
  assert.equal(queue.snapshot().colorKey, 'b-shape');
});

test('inserting a new subject between finished owners does not erase existing artwork', () => {
  const { queue, tasks, events } = erasingFixture();
  const a = { ...target('a-shape'), owner: 'a' }, b = { ...target('b-shape'), owner: 'b' }, added = { ...target('new-shape'), owner: 'new' };
  queue.reconcile([a, b]);
  queue.reconcile([a, added, b]);
  assert.deepEqual(events, ['outline:new-shape']);
  assert.equal(tasks.has('a-shape'), false);
  assert.equal(tasks.has('b-shape'), false);
});

test('reordering overlapping marks inside one subject erases only the inverted marks', () => {
  const { queue, tasks, events } = erasingFixture();
  const blue = { ...target('blue-rect'), owner: 'body' }, red = { ...target('red-circle'), owner: 'body' }, eye = { ...target('eye'), owner: 'body' };
  queue.reconcile([blue, red, eye]);
  queue.reconcile([red, blue, eye]);
  assert.deepEqual(events, ['snapshot:blue-rect:done:false', 'snapshot:red-circle:done:false', 'erase:erase-blue-rect+red-circle']);
  assert.equal(tasks.has('eye'), false);
  tasks.get('erase-blue-rect+red-circle').finish();
  assert.equal(events.at(-1), 'outline:red-circle');
});

test('adding and removing details inside a subject preserves the remaining marks', () => {
  const { queue, tasks, events } = erasingFixture();
  const face = { ...target('face'), owner: 'child' }, eye = { ...target('eye'), owner: 'child' }, hat = { ...target('hat'), owner: 'child' };
  queue.reconcile([face, eye]);
  queue.reconcile([face, hat, eye]);
  assert.deepEqual(events, ['outline:hat']);
  queue.reconcile([hat, eye]);
  assert.equal(events.filter(event => event.startsWith('snapshot:')).length, 1);
  assert.ok(events.includes('snapshot:face:done:false'));
  assert.equal(tasks.has('eye'), false);
});


test('one paper wipe batches completed and partially drawn pigment, excluding unstarted marks', () => {
  const { queue, tasks, events } = erasingFixture();
  const old = target('old');
  queue.reconcile([old]);
  queue.reconcile([old, {...target('partial'),owner:'one'}, {...target('unstarted'),owner:'one'}]);
  const late = tasks.get('partial').callbacks[0];
  queue.reconcile([]);
  assert.deepEqual(events.filter(event => event.startsWith('snapshot:')), ['snapshot:old:done:false', 'snapshot:partial:active:true']);
  assert.equal(events.at(-1), 'erase:erase-old+partial');
  assert.equal(queue.snapshot().pending, 0);
  assert.ok(tasks.get('partial').disposed && tasks.get('unstarted').disposed);
  late();
  assert.equal(queue.snapshot().phase, 'erase');
  tasks.get('erase-old+partial').finish();
  assert.equal(queue.snapshot().drawing, false);
});

test('a later edit queues a new wipe without restarting the current shared wipe', () => {
  const { queue, tasks, events } = erasingFixture();
  const a = target('a'), b = target('b'), c = target('c'), d = target('d');
  queue.reconcile([a, b, c, d]);
  queue.reconcile([c, d]);
  const first = tasks.get('erase-a+b');
  queue.reconcile([]);
  assert.equal(first.disposed, false);
  assert.equal(queue.snapshot().pending, 1);
  first.finish();
  assert.equal(events.at(-1), 'erase:erase-c+d');
  const late = tasks.get('erase-c+d').callbacks[0];
  queue.reconcile([], true);
  assert.equal(tasks.get('erase-c+d').disposed, true);
  late();
  assert.equal(queue.snapshot().drawing, false);
});


test('an idle artist takes the latest waiting idea, while the other keeps its original subject and cursor', () => {
  const {queue,tasks}=fixture();queue.reconcile([]);
  const a=target('mermaid',false),b=target('fish',false),c=target('old-background',false),d=target('new-star',false),e=target('turtle',false);
  queue.reconcile([a,b,e,c],false,1);queue.reconcile([a,b,e,c,d],false,2);
  assert.equal(queue.snapshot().painters.length,3);
  tasks.get('fish').finish();
  assert.deepEqual(tasks.get('new-star').plays,['outline']);assert.deepEqual(tasks.get('old-background').plays,[]);
  assert.deepEqual(tasks.get('mermaid').plays,['outline']);
  assert.equal(tasks.get('new-star').painters[0],tasks.get('fish').painters[0]);
  tasks.get('fish').callbacks[0]();
  assert.equal(queue.snapshot().painters[1].key,'new-star','a stale completion cannot release a reassigned cursor');
});

test('removing three concurrently drawn subjects captures all in one shared erasure', () => {
  const {queue,tasks,events}=erasingFixture();queue.reconcile([]);
  queue.reconcile([target('mermaid'),target('fish'),target('waiting')]);
  const lateMermaid=tasks.get('mermaid').callbacks[0],lateFish=tasks.get('fish').callbacks[0];
  queue.reconcile([]);
  assert.deepEqual(events.filter(event=>event.startsWith('snapshot:')),['snapshot:mermaid:active:true','snapshot:fish:active:true','snapshot:waiting:active:true']);
  assert.equal(queue.snapshot().painters.length,0);assert.equal(queue.snapshot().phase,'erase');
  lateMermaid();lateFish();assert.equal(queue.snapshot().phase,'erase');
  tasks.get('erase-mermaid+fish+waiting').finish();assert.equal(queue.snapshot().drawing,false);
});

test('explicit bring-to-front and undo retain ink for the object and all crossed neighbours', () => {
  const {queue,tasks,events}=erasingFixture();
  const a={...target('castle'),owner:'castle'},b={...target('child'),owner:'child'},c={...target('bird'),owner:'bird'};
  queue.reconcile([a,b,c]);
  queue.reconcile([b,c,a],false,1,new Set(['castle']));
  assert.equal(queue.snapshot().drawing,false);
  assert.equal(tasks.size,0);
  assert.deepEqual(events,[]);
  queue.reconcile([a,b,c],false,2,new Set(['castle']));
  assert.equal(queue.snapshot().drawing,false);
  assert.deepEqual(events,[]);
  queue.dispose();
});

test('failed-turn rollback erases only its provisional ink while an earlier successful painter keeps its task', () => {
  const {queue,tasks,events}=erasingFixture();
  const tree={...target('tree'),owner:'tree'},wolf={...target('wolf'),owner:'wolf'};
  queue.reconcile([]);
  queue.reconcile([tree],false,1);
  const existingPainter=tasks.get('tree');
  queue.reconcile([tree,wolf],false,2);
  const staleWolfCallback=tasks.get('wolf').callbacks[0];
  queue.reconcile([tree],false,2);
  assert.equal(tasks.get('tree'),existingPainter,'rollback must not reset earlier drawing progress');
  assert.equal(existingPainter.disposed,false);
  assert.deepEqual(events.filter(e=>e.startsWith('snapshot:')),['snapshot:wolf:active:true']);
  assert.equal(tasks.get('wolf').disposed,true);
  staleWolfCallback();
  existingPainter.finish(); // Reach a safe boundary before the eraser starts.
  assert.ok(events.includes('erase:erase-wolf'));
  tasks.get('erase-wolf').finish();
  assert.equal(existingPainter.disposed,false);
  existingPainter.finish();
  assert.equal(queue.snapshot().drawing,false);
  queue.dispose();
});
