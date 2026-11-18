import { z } from 'zod';
import type { ImagineResult, Scene } from './scene';

export const OBJECT_KINDS = ['house', 'tree', 'pine', 'mountain', 'cloud', 'sun', 'moon', 'star', 'flower', 'bird', 'boat', 'bench', 'lamp', 'cat', 'bush', 'mushroom', 'person', 'drawing'] as const;
const id = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const pageX = z.number().finite().min(-10000).max(10000);
const pageY = z.number().finite().min(-10000).max(10000);
export const paperViewportSchema = z.object({
  x: pageX, y: pageY, width: z.number().finite().positive().max(20000), height: z.number().finite().positive().max(20000),
}).strict().refine(paper => paper.x + paper.width <= 10000 && paper.y + paper.height <= 10000, 'Paper exceeds the coordinate limit');
// An object's transform origin may sit outside the page while visible geometry
// crosses into it (for example the upper arc of a large cropped background).
const objectX = z.number().finite().min(-10000).max(10000);
const objectY = z.number().finite().min(-10000).max(10000);
const scale = z.number().finite().min(0.2).max(3.5);
const rotation = z.number().finite().min(-180).max(180).optional();
const sky = z.enum(['day', 'sunset', 'night', 'paper']);
const weather = z.enum(['clear', 'rain', 'snow']);
const ground = z.enum(['lake', 'meadow', 'coast', 'none']);

export const ERASURE_LIMITS = { gestures: 200, paths: 600, pathCharacters: 120_000, targets: 40_000, targetsPerGesture: 493, width: 256 } as const;

/** Eraser sweeps contain only absolute, on-paper M/L segments, never arbitrary SVG. */
export function isSafeErasurePath(value: string): boolean {
  if (!value || value.length > 2500 || !/^M[-+\d.]+ [-+\d.]+(?:L[-+\d.]+ [-+\d.]+)+$/.test(value)) return false;
  const pairs = [...value.matchAll(/[ML]([-+\d.]+) ([-+\d.]+)/g)];
  return pairs.length >= 2 && pairs.every(pair => {
    const x = Number(pair[1]), y = Number(pair[2]);
    return Number.isFinite(x) && Number.isFinite(y) && x >= -10000 && x <= 10000 && y >= -10000 && y <= 10000;
  });
}

export const erasureTargetSchema = z.object({
  key: z.string().min(1).max(200).regex(/^[a-zA-Z0-9_:.-]+$/), x: objectX, y: objectY, scale, rotation,
}).strict();
export const erasureStrokeSchema = z.object({
  id, paths: z.array(z.string().max(2500).refine(isSafeErasurePath, 'Unsafe or invalid eraser path')).min(1).max(ERASURE_LIMITS.paths),
  width: z.number().finite().min(1).max(ERASURE_LIMITS.width),
  shape: z.enum(['round', 'square']).optional(),
  targets: z.array(erasureTargetSchema).min(1).max(ERASURE_LIMITS.targetsPerGesture),
}).strict().refine(stroke => new Set(stroke.targets.map(target => target.key)).size === stroke.targets.length, 'Erasure target keys must be unique');

export function isSafeDrawingPath(value: string): boolean {
  if (!value || value.length > 2500 || !/^[Mm]/.test(value.trim()) || /[^MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]/.test(value)) return false;
  const tokens = value.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  if (tokens.join('') !== value.replace(/[\s,]/g, '')) return false;
  const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index++].toUpperCase();
    const count = arity[command];
    if (count === undefined) return false;
    const numbers: number[] = [];
    while (index < tokens.length && !/^[A-Za-z]$/.test(tokens[index])) {
      const number = Number(tokens[index++]);
      if (!Number.isFinite(number) || Math.abs(number) > 10000) return false;
      numbers.push(number);
    }
    if (count === 0 ? numbers.length !== 0 : numbers.length === 0 || numbers.length % count !== 0) return false;
    if (command === 'A') {
      for (let offset = 0; offset < numbers.length; offset += 7) {
        if (numbers[offset] < 0 || numbers[offset + 1] < 0 || ![0, 1].includes(numbers[offset + 3]) || ![0, 1].includes(numbers[offset + 4])) return false;
      }
    }
  }
  return tokens.length > 0;
}

const localCoordinate = z.number().finite().min(-10000).max(10000);
const markColor = z.string().regex(/^(#[0-9a-fA-F]{6}|none)$/);
export const drawingMarkSchema = z.object({
  type: z.enum(['path', 'ellipse', 'rect', 'line', 'text']),
  d: z.string().max(2500).refine(isSafeDrawingPath, 'Unsafe or invalid drawing path').optional(),
  x: localCoordinate.optional(), y: localCoordinate.optional(),
  w: z.number().finite().positive().max(20000).optional(), h: z.number().finite().positive().max(20000).optional(),
  x2: localCoordinate.optional(), y2: localCoordinate.optional(),
  fill: markColor.optional(), stroke: markColor.optional(),
  strokeWidth: z.number().finite().min(0).max(24).optional(), opacity: z.number().finite().min(0).max(1).optional(),
  text: z.string().max(60).optional(),
}).strict().superRefine((mark, context) => {
  const needed = mark.type === 'path' ? ['d'] : mark.type === 'line' ? ['x', 'y', 'x2', 'y2'] : mark.type === 'text' ? ['x', 'y', 'text'] : ['x', 'y', 'w', 'h'];
  for (const field of needed) if (mark[field as keyof typeof mark] === undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: `Missing ${field} for ${mark.type}`, path: [field] });
});

const markFields = new Set(['d', 'x', 'y', 'w', 'h', 'x2', 'y2', 'fill', 'stroke', 'strokeWidth', 'opacity', 'text']);
// Strict output schemas use null for unused fields; canonical scene data omits them.
const modelMarkSchema = z.preprocess(value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).filter(([key, entry]) => !(entry === null && markFields.has(key)))) : value, drawingMarkSchema);

// Presentation metadata must not discard valid geometry. Normalize only model
// descriptions; saved/input scenes, IDs, visible text and marks remain strict.
const modelDescription = (limit: number, minimum = 0) => z.string().max(2000).trim().min(minimum).transform(value => {
  if (value.length <= limit) return value;
  const prefix = value.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, '');
  const wordEnd = prefix.lastIndexOf(' ');
  return `${(wordEnd >= limit * .6 ? prefix.slice(0, wordEnd) : prefix).trimEnd()}…`;
});

const sceneObjectBaseSchema = z.object({
  id, kind: z.enum(OBJECT_KINDS), x: objectX, y: objectY, scale, rotation, color,
  stackRank: z.number().int().min(1).max(40).optional(),
  label: z.string().max(40).optional(),
  marks: z.array(drawingMarkSchema).max(100).optional(),
}).strict();
export const sceneObjectSchema = sceneObjectBaseSchema.refine(object => object.kind !== 'drawing' || Boolean(object.marks?.length), 'A drawing needs visible marks');
export const modelObjectSchema = sceneObjectBaseSchema.extend({
  label: modelDescription(40).nullable(),
  marks: z.array(modelMarkSchema).max(100).nullable().optional(),
}).transform(({ label, marks, ...object }) => ({ ...object, ...(label === null ? {} : { label }), ...(marks == null ? {} : { marks }) })).pipe(sceneObjectSchema);

export const sceneSchema = z.object({
  title: z.string().min(1).max(60), sky, weather, ground,
  objects: z.array(sceneObjectSchema).max(40),
  paper: paperViewportSchema.optional(),
  erasures: z.array(erasureStrokeSchema).max(ERASURE_LIMITS.gestures).optional(),
}).strict()
  .refine(scene => new Set(scene.objects.map(object => object.id)).size === scene.objects.length, 'Object IDs must be unique')
  .refine(scene => scene.objects.reduce((sum, object) => sum + (object.marks?.length ?? 0), 0) <= 450, 'Too many drawing marks')
  .refine(scene => scene.objects.reduce((sum, object) => sum + (object.marks?.reduce((length, mark) => length + (mark.d?.length ?? 0), 0) ?? 0), 0) <= 60_000, 'Drawing paths are too large')
  .refine(scene => new Set(scene.erasures?.map(stroke => stroke.id)).size === (scene.erasures?.length ?? 0), 'Erasure IDs must be unique')
  .refine(scene => (scene.erasures ?? []).reduce((sum, stroke) => sum + stroke.paths.length, 0) <= ERASURE_LIMITS.paths, 'Too many erasure paths')
  .refine(scene => (scene.erasures ?? []).reduce((sum, stroke) => sum + stroke.paths.reduce((length, path) => length + path.length, 0), 0) <= ERASURE_LIMITS.pathCharacters, 'Erasure paths are too large')
  .refine(scene => (scene.erasures ?? []).reduce((sum, stroke) => sum + stroke.targets.length, 0) <= ERASURE_LIMITS.targets, 'Too many erasure targets')
  .refine(scene => !scene.paper || (scene.erasures ?? []).every(stroke => stroke.paths.every(path =>
    [...path.matchAll(/[ML]([-+\d.]+) ([-+\d.]+)/g)].every(pair => {
      const x = Number(pair[1]), y = Number(pair[2]), paper = scene.paper!;
      return x >= paper.x && x <= paper.x + paper.width && y >= paper.y && y <= paper.y + paper.height;
    }))), 'Erasure leaves the saved paper');

// Generation-only coordinates: the final scene stores geometry, never this plan.
// These checks establish valid page coordinates, not semantic relationships or
// proof that every generated path follows its declared bounds/anchors.
const layoutItemSchema = z.object({
  id,
  bounds: z.object({
    x: pageX, y: pageY, width: z.number().finite().positive().max(20000), height: z.number().finite().positive().max(20000),
  }).strict().refine(bounds => bounds.x + bounds.width <= 10000 && bounds.y + bounds.height <= 10000, 'Layout bounds exceed coordinate limits'),
  anchors: z.array(z.object({ name: z.string().trim().min(1).max(40), x: pageX, y: pageY }).strict()).max(8)
    .refine(anchors => new Set(anchors.map(anchor => anchor.name)).size === anchors.length, 'Anchor names must be unique per object'),
}).strict();
export const layoutSchema = z.array(layoutItemSchema).max(40)
  .refine(layout => new Set(layout.map(item => item.id)).size === layout.length, 'Layout object IDs must be unique');

// The model returns only a patch. Unmentioned objects retain their exact values.
export const imagineInputSchema = z.object({
  text: z.string().trim().min(1).max(600), scene: sceneSchema,
  language: z.enum(['en', 'zh']).optional(),
  // Optional measurements are bounded and matched to this scene in the route.
  // Malformed/stale context is discarded there, never a failed drawing request.
  canvasContext: z.unknown().optional(),
  lookahead: z.object({ reservations: layoutSchema, instruction: z.string().max(600) }).strict().optional(),
  canvasViewport: paperViewportSchema.optional(),
  mode: z.enum(['live', 'finish']).default('finish'),
  recent: z.array(z.string().max(600)).max(5).optional(),
  unfinished: z.array(z.string().trim().min(1).max(600)).max(2).optional(),
  clarification: z.object({ instruction: z.string().trim().min(1).max(600), question: z.string().trim().min(1).max(200) }).strict().optional(),
}).strict();

export const scenePatchSchema = z.object({
  action: z.enum(['update', 'undo', 'clarify', 'ignore']),
  message: modelDescription(160, 1),
  title: modelDescription(60, 1).nullable(),
  sky: sky.nullable(), weather: weather.nullable(), ground: ground.nullable(),
  layout: layoutSchema.optional(),
  additions: z.array(modelObjectSchema).max(40),
  updates: z.array(z.object({
    id, x: objectX.nullable(), y: objectY.nullable(), scale: scale.nullable(), color: color.nullable(), label: modelDescription(40).nullable(),
    kind: z.literal('drawing').nullable().optional(),
    marks: z.array(modelMarkSchema).max(100).nullable().optional(),
  }).strict()).max(40),
  removals: z.array(id).max(40),
  object_order: z.array(id).max(40).nullable().optional(),
}).strict();

export type ScenePatch = z.infer<typeof scenePatchSchema>;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const markProperties = {
  type: { type: 'string', enum: ['path', 'ellipse', 'rect', 'line', 'text'] },
  d: nullable({ type: 'string' }), x: nullable({ type: 'number' }), y: nullable({ type: 'number' }),
  w: nullable({ type: 'number' }), h: nullable({ type: 'number' }), x2: nullable({ type: 'number' }), y2: nullable({ type: 'number' }),
  fill: nullable({ type: 'string' }), stroke: nullable({ type: 'string' }), strokeWidth: nullable({ type: 'number' }), opacity: nullable({ type: 'number' }), text: nullable({ type: 'string' }),
};
const marksJsonSchema = { type: 'array', items: { type: 'object', properties: markProperties, required: Object.keys(markProperties), additionalProperties: false } };
const objectProperties = {
  id: { type: 'string' }, kind: { type: 'string', enum: [...OBJECT_KINDS] },
  x: { type: 'number' }, y: { type: 'number' }, scale: { type: 'number' }, color: { type: 'string' }, label: nullable({ type: 'string' }),
  marks: nullable(marksJsonSchema),
};
const layoutJsonSchema = {
  // Google AI Studio rejects this nested structured output with maxItems on
  // both arrays. Cardinality stays strictly bounded in layoutSchema above.
  type: 'array',
  items: {
    type: 'object', additionalProperties: false, required: ['id', 'bounds', 'anchors'],
    properties: {
      id: { type: 'string' },
      bounds: {
        type: 'object', additionalProperties: false, required: ['x', 'y', 'width', 'height'],
        properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
      },
      anchors: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['name', 'x', 'y'],
          properties: { name: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } },
        },
      },
    },
  },
};

export const patchJsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['update', 'undo', 'clarify', 'ignore'] },
    message: { type: 'string' }, title: nullable({ type: 'string' }),
    sky: nullable({ type: 'string', enum: ['day', 'sunset', 'night', 'paper'] }),
    weather: nullable({ type: 'string', enum: ['clear', 'rain', 'snow'] }),
    ground: nullable({ type: 'string', enum: ['lake', 'meadow', 'coast', 'none'] }),
    object_order: { ...nullable({ type: 'array', items: { type: 'string' } }), description: 'Back-to-front paint order: first ID is farthest behind, last ID covers earlier IDs. Put new backgrounds BEFORE existing subjects. Include every surviving ID exactly once; preserve the relative order of unchanged objects. Null keeps the old order and appends additions on top.' },
    layout: layoutJsonSchema,
    additions: { type: 'array', items: { type: 'object', properties: objectProperties, required: Object.keys(objectProperties), additionalProperties: false } },
    updates: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, x: nullable({ type: 'number' }), y: nullable({ type: 'number' }), scale: nullable({ type: 'number' }), color: nullable({ type: 'string' }), label: nullable({ type: 'string' }),
      kind: nullable({ type: 'string', enum: ['drawing'] }),
      marks: nullable(marksJsonSchema),
    }, required: ['id', 'x', 'y', 'scale', 'color', 'label', 'kind', 'marks'], additionalProperties: false } },
    removals: { type: 'array', items: { type: 'string' } },
  },
  required: ['action', 'message', 'title', 'sky', 'weather', 'ground', 'layout', 'additions', 'updates', 'removals', 'object_order'],
};

// Gemini accepts optional properties in structured output. Omit irrelevant mark
// fields instead of generating twelve nulls for every stroke. The same local
// validator still checks required geometry, numeric limits and safe SVG paths.
const compactMarksJsonSchema = {
  ...marksJsonSchema,
  items: {
    ...marksJsonSchema.items,
    properties: Object.fromEntries(Object.entries(markProperties).map(([name, schema]) => [
      name, 'anyOf' in schema ? schema.anyOf[0] : schema,
    ])),
    required: ['type'],
  },
};
export const compactPatchJsonSchema = {
  ...patchJsonSchema,
  properties: {
    ...patchJsonSchema.properties,
    additions: {
      ...patchJsonSchema.properties.additions,
      items: {
        ...patchJsonSchema.properties.additions.items,
        properties: { ...objectProperties, marks: nullable(compactMarksJsonSchema) },
      },
    },
    updates: {
      ...patchJsonSchema.properties.updates,
      items: {
        ...patchJsonSchema.properties.updates.items,
        properties: { ...patchJsonSchema.properties.updates.items.properties, marks: nullable(compactMarksJsonSchema) },
      },
    },
  },
};

// OpenAI strict output requires every property of a chosen object branch, not
// every property of every possible shape. Keep only that shape's geometry and
// the shared nullable styles; the canonical modelMarkSchema still validates
// all coordinates, paths, colors and scene limits after generation.
const efficientGeometryProperties: Record<string, { type: string }> = {
  d: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
  w: { type: 'number' }, h: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' },
  text: { type: 'string' },
};
function strictShapeMark(type: string, geometry: readonly string[]) {
  const properties = {
    type: { type: 'string', enum: [type] },
    ...Object.fromEntries(geometry.map(field => [field, efficientGeometryProperties[field]])),
    fill: markProperties.fill, stroke: markProperties.stroke,
    strokeWidth: markProperties.strokeWidth, opacity: markProperties.opacity,
  };
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}
const efficientMarksJsonSchema = {
  type: 'array', items: { anyOf: [
    strictShapeMark('path', ['d']),
    strictShapeMark('ellipse', ['x', 'y', 'w', 'h']),
    strictShapeMark('rect', ['x', 'y', 'w', 'h']),
    strictShapeMark('line', ['x', 'y', 'x2', 'y2']),
    strictShapeMark('text', ['x', 'y', 'text']),
  ] },
};
const efficientPatchProperties = {
  action: patchJsonSchema.properties.action,
  sky: patchJsonSchema.properties.sky, weather: patchJsonSchema.properties.weather, ground: patchJsonSchema.properties.ground,
  // Declare depth before streaming a background's first mark, so it never
  // briefly covers old characters and then forces them through a redraw.
  object_order: patchJsonSchema.properties.object_order,
  // Keep the spatial plan before geometry. Faster output must not skip support
  // surfaces, proportions or contact coordinates to gain a token advantage.
  layout: layoutJsonSchema,
  additions: {
    ...patchJsonSchema.properties.additions,
    items: {
      ...patchJsonSchema.properties.additions.items,
      properties: { ...objectProperties, marks: nullable(efficientMarksJsonSchema) },
    },
  },
  updates: {
    ...patchJsonSchema.properties.updates,
    items: {
      ...patchJsonSchema.properties.updates.items,
      properties: { ...patchJsonSchema.properties.updates.items.properties, marks: nullable(efficientMarksJsonSchema) },
    },
  },
  removals: patchJsonSchema.properties.removals,
  title: patchJsonSchema.properties.title, message: patchJsonSchema.properties.message,
};
export const efficientPatchJsonSchema = {
  ...patchJsonSchema, properties: efficientPatchProperties, required: Object.keys(efficientPatchProperties),
};

export function applyScenePatch(scene: Scene, rawPatch: unknown): ImagineResult {
  const patch = scenePatchSchema.parse(rawPatch);
  // Ignoring speech may remove its transcript span. Contradictory or malformed
  // output must fail rather than be treated as evidence that the child said noise.
  if (patch.action === 'ignore' && (patch.title !== null || patch.sky !== null || patch.weather !== null || patch.ground !== null ||
    patch.additions.length || patch.updates.length || patch.removals.length || patch.layout?.length || patch.object_order != null)) {
    throw new Error('An ignored utterance cannot change the scene');
  }
  if (patch.action !== 'update') return { scene, message: patch.message, action: patch.action };

  const existing = new Set(scene.objects.map(object => object.id));
  const removed = new Set(patch.removals);
  const updated = new Set(patch.updates.map(object => object.id));
  const added = new Set(patch.additions.map(object => object.id));
  if (removed.size !== patch.removals.length || updated.size !== patch.updates.length || added.size !== patch.additions.length ||
    [...removed, ...updated].some(objectId => !existing.has(objectId)) ||
    [...updated].some(objectId => removed.has(objectId)) ||
    [...added].some(objectId => existing.has(objectId))) {
    throw new Error('Invalid scene references');
  }
  const updates = new Map(patch.updates.map(object => [object.id, object]));
  const objects = scene.objects.filter(object => !removed.has(object.id)).map(object => {
    const update = updates.get(object.id);
    if (!update) return object;
    return { ...object, ...Object.fromEntries(Object.entries(update).filter(([, value]) => value !== null)) };
  });
  objects.push(...patch.additions);
  const resultingIds = new Set(objects.map(object => object.id));
  if (patch.layout?.some(item => !resultingIds.has(item.id))) throw new Error('Layout refers to a missing object');
  const paper = scene.paper ?? { x: 0, y: 0, width: 1000, height: 640 };
  const contains = (x: number, y: number) => x >= paper.x && y >= paper.y && x <= paper.x + paper.width && y <= paper.y + paper.height;
  if (patch.layout?.some(item => !contains(item.bounds.x, item.bounds.y) ||
    !contains(item.bounds.x + item.bounds.width, item.bounds.y + item.bounds.height) ||
    item.anchors.some(anchor => !contains(anchor.x, anchor.y)))) throw new Error('Layout bounds or anchors exceed the current paper');
  let orderedObjects = objects;
  if (patch.object_order != null) {
    const byId = new Map(objects.map(object => [object.id, object]));
    const order = patch.object_order;
    if (order.length !== objects.length || new Set(order).size !== order.length || order.some(objectId => !byId.has(objectId))) {
      throw new Error('Object order must contain each resulting object ID exactly once');
    }
    orderedObjects = order.map(objectId => byId.get(objectId)!);
  }
  const next = sceneSchema.parse({
    ...scene, title: patch.title ?? scene.title, sky: patch.sky ?? scene.sky,
    weather: patch.weather ?? scene.weather, ground: patch.ground ?? scene.ground, objects: orderedObjects,
  });
  return { scene: next, message: patch.message, action: 'update' };
}

export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_BASE64 = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;

export function inspectWav(base64: string): { duration: number; silent: boolean } {
  if (!base64 || base64.length > MAX_AUDIO_BASE64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('Invalid audio encoding');
  const data = Buffer.from(base64, 'base64');
  if (data.length < 44 || data.length > MAX_AUDIO_BYTES || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid WAV');
  let byteRate = 0;
  let blockAlign = 0;
  let audioBytes = 0;
  let maximum = 0;
  for (let offset = 12; offset + 8 <= data.length;) {
    const name = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > data.length) throw new Error('Incomplete WAV');
    if (name === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV format');
      const channels = data.readUInt16LE(start + 2);
      const sampleRate = data.readUInt32LE(start + 4);
      const bits = data.readUInt16LE(start + 14);
      byteRate = data.readUInt32LE(start + 8);
      blockAlign = data.readUInt16LE(start + 12);
      if (data.readUInt16LE(start) !== 1 || bits !== 16 || channels < 1 || channels > 2 || sampleRate < 8000 || sampleRate > 48000 || blockAlign !== channels * 2 || byteRate !== sampleRate * blockAlign) throw new Error('Unsupported WAV format');
    }
    if (name === 'data') {
      audioBytes += size;
      for (let sample = start; sample + 1 < start + size; sample += 2) maximum = Math.max(maximum, Math.abs(data.readInt16LE(sample)));
    }
    offset = start + size + (size % 2);
  }
  const duration = audioBytes / byteRate;
  if (!byteRate || !audioBytes || audioBytes % blockAlign || !Number.isFinite(duration) || duration > 30.1 || duration < 0.15) throw new Error('Invalid audio duration');
  return { duration, silent: maximum < 16 };
}
