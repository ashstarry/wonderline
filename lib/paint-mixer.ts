export const PAINT_COLORS = ['red', 'yellow', 'blue', 'white'] as const;
export type PaintColor = typeof PAINT_COLORS[number];
export type PaintDrops = readonly PaintColor[];
export const MAX_DROPS_PER_COLOR = 6;
export const MAX_PAINT_DROPS = MAX_DROPS_PER_COLOR * PAINT_COLORS.length;
export const PAINT_POTS: Record<PaintColor, string> = {
  red: '#d85a67', yellow: '#ebc75c', blue: '#639dd1', white: '#fffdf3',
};
type Rgb = readonly [number, number, number];
const RGB: Record<PaintColor | 'orange' | 'green' | 'purple' | 'brown', Rgb> = {
  red: [216, 90, 103], yellow: [235, 199, 92], blue: [99, 157, 209], white: [255, 253, 243],
  orange: [233, 148, 72], green: [116, 165, 94], purple: [157, 119, 186], brown: [150, 106, 79],
};

export function paintCounts(drops: PaintDrops): Record<PaintColor, number> {
  const counts = { red: 0, yellow: 0, blue: 0, white: 0 };
  for (const color of drops.slice(0, MAX_PAINT_DROPS)) {
    if (PAINT_COLORS.includes(color) && counts[color] < MAX_DROPS_PER_COLOR) counts[color]++;
  }
  return counts;
}

export function addPaintDrop(drops: PaintDrops, color: PaintColor): PaintDrops {
  if (!PAINT_COLORS.includes(color) || drops.length >= MAX_PAINT_DROPS || paintCounts(drops)[color] >= MAX_DROPS_PER_COLOR) return drops;
  return [...drops, color];
}

export function undoPaintDrop(drops: PaintDrops): PaintDrops {
  return drops.length ? drops.slice(0, -1) : drops;
}

/** A playful RYB approximation, not a simulation of physical paint pigments.
 * Equal pairs follow the children's art color wheel; equal primaries make brown.
 * The recipe alone determines the result, regardless of the order of the drops. */
export function mixPaint(drops: PaintDrops): string | null {
  const counts = paintCounts(drops);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  const result = [0, 0, 0];
  const add = (color: Rgb, amount: number) => color.forEach((channel, i) => { result[i] += channel * amount; });
  const common = Math.min(counts.red, counts.yellow, counts.blue);
  add(RGB.brown, common * 3);
  counts.red -= common; counts.yellow -= common; counts.blue -= common;
  for (const [a, b, mixture] of [
    ['red', 'yellow', 'orange'], ['yellow', 'blue', 'green'], ['red', 'blue', 'purple'],
  ] as const) {
    const pair = Math.min(counts[a], counts[b]);
    add(RGB[mixture], pair * 2);
    counts[a] -= pair; counts[b] -= pair;
  }
  for (const color of PAINT_COLORS) add(RGB[color], counts[color]);
  return `#${result.map(channel => Math.round(channel / total).toString(16).padStart(2, '0')).join('')}`;
}
