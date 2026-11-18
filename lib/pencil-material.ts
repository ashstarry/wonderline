import type { DrawingMark } from './scene';

export type PencilSurface = 'paper' | 'water' | 'ground' | 'form';
function channels(value: string): number[] | undefined {
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  const rgb = /^rgb\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)\s*\)$/.exec(value);
  return hex ? hex.slice(1).map(channel=>parseInt(channel,16)) : rgb?.slice(1).map(Number);
}
export function graphiteLuminance(value: string): number {
  const parts = channels(value);
  return parts ? (parts[0]*.2126+parts[1]*.7152+parts[2]*.0722)/255 : .5;
}
function blend(value: string, paper: string, amount: number): string {
  const source = channels(value);
  const target = channels(paper);
  if (!source || !target) return value;
  return `rgb(${source.map((channel,index)=>Math.round(channel*(1-amount)+target[index]*amount)).join(',')})`;
}
export function pencilMaterial(mark: DrawingMark, fill: string, subject = '') {
  const tone = graphiteLuminance(fill);
  const rgb = channels(fill);
  const chroma = rgb ? (Math.max(...rgb)-Math.min(...rgb))/255 : 0;
  const blue = !!rgb && rgb[2]>rgb[0]*1.08 && rgb[1]>rgb[0]*1.05;
  const green = !!rgb && rgb[1]>rgb[0]*1.08 && rgb[1]>rgb[2]*1.04;
  const shallow = (mark.type==='ellipse'||mark.type==='rect') && (mark.w??0)>90 && (mark.w??0)>(mark.h??1)*2.1;
  // A character standing beside grass or water is still a character. Only
  // material nouns belonging to this object should change its mark direction.
  const materialSubject = subject.replace(/(?:湖|河|海|水面|草地|草坡|草坪)(?:边|旁|上|里|中)(?:的)?/g,'').replace(/\b(?:by|near|beside|on|in)\s+(?:the\s+)?(?:grass|lake|ground|meadow|ocean|river|pond)\b/gi,'');
  const surface:PencilSurface = tone>.92&&chroma<.1 ? 'paper' : blue && (/湖|河|海|水面|池塘|lake|river|pond|ocean|water/i.test(materialSubject)||!subject.trim()&&shallow) ? 'water' : green && /草地|草坡|草坪|山坡|田野|meadow|grass|hill|ground/i.test(materialSubject) ? 'ground' : 'form';
  const tiny = (mark.type==='ellipse'||mark.type==='rect') && (mark.w??20)<=12 && (mark.h??20)<=12;
  const solid = (tiny||mark.type==='text') && tone<.55;
  const neutralDark = chroma<.12 && tone<.3;
  const pigment = neutralDark ? '#645044' : blend(fill,'#795034',.17);
  const sourceStroke = mark.stroke ?? '#665143';
  const strokeTone = graphiteLuminance(sourceStroke);
  const strokeRgb = channels(sourceStroke);
  const neutralStroke = strokeRgb && Math.max(...strokeRgb)-Math.min(...strokeRgb)<48;
  const whiteStroke = strokeRgb && strokeTone>.88 && Math.max(...strokeRgb)-Math.min(...strokeRgb)<26;
  // Colored pencils keep their pigment hue. Paper lightens the fill while the
  // same pigment builds up in the short strokes and along the shaded edge.
  return {
    surface, solid, tone,
    base: solid ? neutralDark ? '#514139' : blend(fill,'#fffaf0',.08) : blend(fill,'#fffaf0',surface==='paper'?.16:surface==='water'?.30:surface==='ground'?.32:.25),
    pigment,
    shade: solid||surface==='paper' ? 0 : surface==='water' ? .07 : .09+(1-tone)*.12,
    hatch: solid||surface==='paper' ? 0 : surface==='water' ? .38 : surface==='ground' ? .34 : .48+(1-tone)*.1,
    stroke: whiteStroke ? '#fffdf5' : neutralStroke && fill!=='none' && chroma>.12 ? blend(fill,'#70503b',.36) : neutralStroke ? '#665143' : blend(sourceStroke,'#fffaf0',.08),
    lineWidth: Math.max(.85,Math.min(2.35,(mark.strokeWidth??1.5)*.82)),
    // Thin pressure accents taper off; no displaced duplicate of the whole contour.
    pressure: solid||surface==='water'||surface==='paper' ? .10 : .18,
  };
}
