import type { DrawingMark } from './scene';

function channels(value: string): number[] | undefined {
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(value);
  const rgb = /^rgb\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)\s*\)$/.exec(value);
  if (hex) return hex.slice(1).map(channel => parseInt(channel, 16));
  if (short) return short.slice(1).map(channel => parseInt(channel + channel, 16));
  return rgb?.slice(1).map(Number);
}

function tone(rgb: number[] | undefined) {
  return rgb ? (rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722) / 255 : .5;
}

/** Water changes pigment density; it should not turn every color into grey paper. */
export function watercolorMaterial(mark: DrawingMark, fill: string, stroke: string, fallback = '#80b8bc') {
  const paintServer = /^url\(/i.test(fill);
  const rgb = channels(fill) ?? (paintServer ? channels(fallback) : undefined);
  const chroma = rgb ? Math.max(...rgb) - Math.min(...rgb) : 0;
  const white = tone(rgb) > .9 && chroma < 32;
  const tiny = (mark.type === 'ellipse' || mark.type === 'rect') && (mark.w ?? 20) <= 12 && (mark.h ?? 20) <= 12;
  const solid = tiny || mark.type === 'text';
  const pigment = white ? '#a0b8b4' : rgb ? `rgb(${rgb.map(channel => Math.round(channel * .77)).join(',')})` : '#78a9b2';
  const sourceStroke = channels(stroke);
  const neutralOutline = !!sourceStroke && Math.max(...sourceStroke) - Math.min(...sourceStroke) < 48 && tone(sourceStroke) < .5;
  // A gradient belongs to a filled surface, never to its outline. In particular
  // the pale end of a sky/grass gradient must not become a broad blank border.
  const edge = paintServer ? neutralOutline ? pigment : stroke : !white && neutralOutline ? fill : stroke;
  return {
    paintServer, white, solid, pigment, edge,
    fillOpacity: solid || white ? 1 : .97,
    strokeOpacity: solid ? 1 : white ? .82 : fill === 'none' ? .92 : .68,
    // Two uneven washes, followed by the darker tide mark left as water dries.
    washOpacity: white ? .04 : paintServer ? .065 : .11,
    bloomOpacity: white ? .035 : .065,
    poolOpacity: white ? .2 : .43,
  };
}
