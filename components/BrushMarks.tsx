import { Children, Fragment, cloneElement, isValidElement, type ReactElement, type ReactNode, type SVGProps } from 'react';
import type { ArtStyle, DrawingMark } from '../lib/scene';
import { pencilMaterial } from '../lib/pencil-material';
import { watercolorMaterial } from '../lib/watercolor-material';

type ShapeProps = SVGProps<SVGPathElement> & { 'data-playback-shape'?: string };
type Props = { mark: DrawingMark; style: ArtStyle; objectColor: string; ink: string; markKey: string; uid: string; subject?: string; preserveStrokeColor?: boolean };

function geometry(mark: DrawingMark, props: ShapeProps) {
  switch (mark.type) {
    case 'path': return <path {...props} d={mark.d || ''} />;
    case 'ellipse': return <ellipse {...props as SVGProps<SVGEllipseElement>} cx={mark.x ?? 0} cy={mark.y ?? 0} rx={(mark.w ?? 20) / 2} ry={(mark.h ?? 20) / 2} />;
    case 'rect': return <rect {...props as SVGProps<SVGRectElement>} x={mark.x ?? 0} y={mark.y ?? 0} width={mark.w ?? 20} height={mark.h ?? 20} />;
    case 'line': return <line {...props as SVGProps<SVGLineElement>} fill="none" x1={mark.x ?? 0} y1={mark.y ?? 0} x2={mark.x2 ?? 0} y2={mark.y2 ?? 0} />;
    case 'text': return <text {...props as SVGProps<SVGTextElement>} x={mark.x ?? 0} y={mark.y ?? 0} stroke="none" fontSize="18" fontFamily="'LXGW Marker Gothic', 'PingFang SC', sans-serif">{mark.text ?? ''}</text>;
  }
}

function hash(value: string) {
  let n = 2166136261;
  for (const character of value) n = Math.imul(n ^ character.charCodeAt(0), 16777619);
  return (n >>> 0).toString(36);
}

/** Pigment is explicit per mark so exported SVGs need no inherited/context paint. */
function PencilGrain({ id, surface, pigment, transform }: { id: string; surface: string; pigment: string; transform: string }) {
  const water = surface === 'water';
  const ground = surface === 'ground';
  return <pattern id={id} data-pencil-grain={surface} width={water ? 113 : ground ? 93 : 37} height={water ? 49 : ground ? 71 : 31} patternUnits="userSpaceOnUse" patternTransform={transform}>
    {water ? <>
      <path d="M4 11q12-1 27 0M39 9h12M67 30q14-1 30 .2M12 39l15 .4M51 43h7" stroke={pigment} strokeWidth=".65" fill="none" strokeLinecap="round"/>
      <path d="M24 23q13-1 27 0M78 42h21" stroke="#fffdf5" strokeWidth="1.25" opacity=".9" fill="none"/>
    </> : ground ? <>
      <path d="M6 17q9-2 20-1M11 21l10-1M51 49q12-3 26-1M60 53l11-1M72 12l13 1M24 61l12-1" stroke={pigment} strokeWidth=".65" fill="none" strokeLinecap="round"/>
      <path d="M31 35l-2-4m2 4 2-5M81 63l-1-4m1 4 3-3" stroke={pigment} strokeWidth=".55" opacity=".7" fill="none"/>
      <path d="M15 40l13-1M55 16l11-.5M33 66l9-.5" stroke="#fffdf5" strokeWidth="1" opacity=".9"/>
    </> : <>
      <path d="M2 11l5-7M5 13l7-9M10 14l5-6M19 27l7-10M23 28l6-8M20 7l3-4M31 14l3-4" stroke={pigment} strokeWidth=".6" fill="none" strokeLinecap="round"/>
      <path d="M2 23l6-4M5 27l8-5M27 12l4-2M30 25l4-3" stroke={pigment} strokeWidth=".4" opacity=".45"/>
      <path d="M8 16l4-5M17 28l5-7M31 5l2-3" stroke="#fffdf5" strokeWidth=".85" opacity=".85"/>
    </>}
    <path d="M3 8l1-.2M21 3l.7 .3M9 26l1.2-.2M32 19l1-.4" stroke={pigment} strokeWidth=".5" opacity=".22" strokeLinecap="round"/>
  </pattern>;
}

/** Each medium builds marks differently; textures are clipped to painted areas, never laid over the whole picture. */
export function BrushDefinitions({ uid }: { uid: string }) {
  return <>
    {/* Mask only a small repeatable pigment tile. A page-sized mask would clip
        far-away strokes or allocate a huge raster after the paper expands. */}
    <mask id={`${uid}-wax-mask`} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="29" height="23" style={{ maskType: 'luminance' }}>
      <rect width="29" height="23" fill="white" />
      <path d="M2 3l2.4-.5M17 6l4 .2M8 14l2.2-.7M23 19l3-.3M1 20l1.5-.4M13 22l2 .2" stroke="black" strokeWidth=".9" strokeLinecap="round" opacity=".63" />
      <path d="M6 7l1-.4M25 10l2 .2M15 17l1.5-.3" stroke="black" strokeWidth=".65" opacity=".8" />
      <circle cx="12" cy="4" r=".6" fill="black" opacity=".55" /><circle cx="4" cy="16" r=".45" fill="black" />
    </mask>
    <filter id={`${uid}-wax-edge`} x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency=".13" numOctaves="2" seed="13" result="tooth" />
      <feDisplacementMap in="SourceGraphic" in2="tooth" scale="1.8" xChannelSelector="R" yChannelSelector="G" />
    </filter>
    <pattern id={`${uid}-wax-scrub`} width="71" height="59" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
      <path d="M3 7Q11 5 24 7M39 17Q46 18 62 15M11 30Q20 29 34 31M44 48L66 47M3 54L13 53" stroke="#fff8e8" strokeWidth="1.5" strokeLinecap="round" opacity=".12" fill="none" />
      <path d="M28 4L43 3M7 42L25 40M51 32L59 31" stroke="#605044" strokeWidth=".7" opacity=".07" />
    </pattern>
    <filter id={`${uid}-graphite-edge`} x="-4%" y="-4%" width="108%" height="108%">
      <feTurbulence type="fractalNoise" baseFrequency=".35" numOctaves="1" seed="6" result="grain" />
      <feDisplacementMap in="SourceGraphic" in2="grain" scale=".25" xChannelSelector="R" yChannelSelector="G" />
    </filter>
    <filter id={`${uid}-water-bleed`} x="-15%" y="-15%" width="130%" height="130%">
      <feGaussianBlur stdDeviation="1.05" />
    </filter>
    <filter id={`${uid}-water-edge`} x="-8%" y="-8%" width="116%" height="116%">
      <feTurbulence type="fractalNoise" baseFrequency=".032 .024" numOctaves="2" seed="21" result="water" />
      <feDisplacementMap in="SourceGraphic" in2="water" scale="2.1" xChannelSelector="R" yChannelSelector="G" />
    </filter>
    <filter id={`${uid}-water-pigment`} x="-8%" y="-8%" width="116%" height="116%">
      <feTurbulence type="fractalNoise" baseFrequency=".015 .022" numOctaves="3" seed="12" result="clouds" />
      <feColorMatrix in="clouds" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="density" />
      <feComponentTransfer in="density" result="pigment"><feFuncA type="table" tableValues=".80 .81 .85 .94 .98 .99" /></feComponentTransfer>
      <feComposite in="SourceGraphic" in2="pigment" operator="in" result="wash" />
      <feTurbulence type="fractalNoise" baseFrequency=".42 .56" numOctaves="2" seed="7" result="paperGrain" />
      <feColorMatrix in="paperGrain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="grainDensity" />
      <feComponentTransfer in="grainDensity" result="granules"><feFuncA type="table" tableValues=".82 .9 1 1" /></feComponentTransfer>
      <feComposite in="wash" in2="granules" operator="in" result="dryWash" />
      <feDisplacementMap in="dryWash" in2="clouds" scale="1.9" xChannelSelector="R" yChannelSelector="G" />
      <feGaussianBlur stdDeviation=".12" />
    </filter>
  </>;
}

export function BrushMark({ mark, style, objectColor, ink, markKey, uid, subject, preserveStrokeColor = false }: Props) {
  const fill = mark.type === 'line' ? 'none' : mark.fill ?? objectColor;
  const stroke = mark.stroke ?? ink;
  const filled = fill !== 'none';
  const outlined = stroke !== 'none' && (mark.strokeWidth ?? 1.5) > 0;
  const pencil = style === 'pencil';
  const watercolor = style === 'watercolor';
  const crayon = !pencil && !watercolor;
  const graphite = pencilMaterial(mark,fill,subject);
  const water = watercolorMaterial(mark,fill,stroke,objectColor);
  const graphiteSolid = pencil && filled && graphite.solid;
  const clip = `${uid}-mark-${hash(markKey)}`;
  const grainSeed = parseInt(hash(markKey),36);
  const width = mark.strokeWidth ?? 1.5;
  const lineWidth = pencil ? preserveStrokeColor ? width : graphite.lineWidth : watercolor ? Math.max(.5, width * .65) : Math.max(1.5, Math.min(6, width * 1.6));
  const waterPaint = watercolor && filled && !water.solid;
  const base: ShapeProps = {
    'data-playback-shape': 'true', fill: pencil && filled ? graphite.base : crayon && filled ? `url(#${clip}-wax-fill)` : fill,
    fillOpacity: watercolor ? water.fillOpacity : 1,
    stroke: outlined ? pencil ? preserveStrokeColor ? stroke : graphite.stroke : watercolor && filled ? water.edge : crayon ? `url(#${clip}-wax-stroke)` : stroke : 'none', strokeWidth: lineWidth,
    strokeOpacity: watercolor ? water.strokeOpacity : pencil ? .88 : .92,
    strokeLinecap: 'round', strokeLinejoin: 'round',
    // SVG's objectBoundingBox filter region collapses for a perfectly vertical
    // or horizontal stroke. Open marks keep their pigment and wax tooth without
    // a shape filter, so straight hand strokes and model lines stay visible.
    filter: filled && !(watercolor && water.solid) ? `url(#${uid}-${pencil ? 'graphite-edge' : watercolor ? water.white ? 'water-edge' : 'water-pigment' : 'wax-edge'})` : undefined,
  };
  return <g data-drawing-mark={markKey} data-brush-medium={style} data-pencil-surface={pencil?graphite.surface:undefined} data-watercolor-pigment={watercolor ? water.solid ? 'detail' : water.white ? 'white' : 'wash' : undefined} opacity={mark.opacity ?? 1}>
    <defs><clipPath id={clip} clipPathUnits="userSpaceOnUse">{geometry(mark, { fill: '#ffffff', stroke: 'none' })}</clipPath>
      {crayon && <>
        {filled && <pattern id={`${clip}-wax-fill`} width="29" height="23" patternUnits="userSpaceOnUse" patternTransform="rotate(-11)"><rect width="29" height="23" fill={fill} mask={`url(#${uid}-wax-mask)`}/></pattern>}
        {outlined && <pattern id={`${clip}-wax-stroke`} width="29" height="23" patternUnits="userSpaceOnUse" patternTransform="rotate(-11)"><rect width="29" height="23" fill={stroke} mask={`url(#${uid}-wax-mask)`}/></pattern>}
      </>}
      {pencil&&<>
        <PencilGrain id={`${clip}-grain`} surface={graphite.surface} pigment={graphite.pigment} transform={`translate(${grainSeed%31} ${grainSeed%29}) rotate(${graphite.surface==='form'?grainSeed%11-5:0})`}/>

        <linearGradient id={`${clip}-shade`} x1="0" y1="0" x2={graphite.surface==='water'?'.1':'.8'} y2="1"><stop offset=".1" stopColor="#fffdf5" stopOpacity=".25"/><stop offset=".45" stopColor={graphite.pigment} stopOpacity="0"/><stop offset="1" stopColor={graphite.pigment} stopOpacity={graphite.shade}/></linearGradient>
        <linearGradient id={`${clip}-pressure`} x1=".15" y1="0" x2=".8" y2="1"><stop offset="0" stopColor={graphite.pigment} stopOpacity="0"/><stop offset=".42" stopColor={graphite.pigment} stopOpacity=".05"/><stop offset=".85" stopColor={graphite.pigment} stopOpacity="1"/><stop offset="1" stopColor={graphite.pigment} stopOpacity=".5"/></linearGradient>
        <linearGradient id={`${clip}-hatch-fade`} x1="0" y1="0" x2=".75" y2="1"><stop offset="0" stopColor="white" stopOpacity=".2"/><stop offset=".35" stopColor="white" stopOpacity=".45"/><stop offset="1" stopColor="white" stopOpacity=".9"/></linearGradient>
        <mask id={`${clip}-hatch-mask`} maskUnits="objectBoundingBox" x="0" y="0" width="1" height="1" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill={`url(#${clip}-hatch-fade)`}/></mask>
      </>}
      {waterPaint && <>
        <filter id={`${clip}-water-wash`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency=".024 .018" numOctaves="3" seed={grainSeed % 91 + 1} result="clouds" />
          <feColorMatrix in="clouds" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="density" />
          <feComponentTransfer in="density" result="wetPools"><feFuncA type="table" tableValues="0 0 .08 .65 1 1" /></feComponentTransfer>
          <feComposite in="SourceGraphic" in2="wetPools" operator="in" />
        </filter>
        <filter id={`${clip}-water-bloom`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency=".019 .031" numOctaves="2" seed={grainSeed % 79 + 3} result="clouds" />
          <feColorMatrix in="clouds" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="density" />
          <feComponentTransfer in="density" result="waterLifts"><feFuncA type="table" tableValues="0 0 .05 .8 1 1" /></feComponentTransfer>
          <feComposite in="SourceGraphic" in2="waterLifts" operator="in" />
        </filter>
        <linearGradient id={`${clip}-water-pool`} x1=".1" y1="0" x2=".8" y2="1">
          <stop offset="0" stopColor={water.pigment} stopOpacity=".18"/>
          <stop offset=".21" stopColor={water.pigment} stopOpacity=".65"/>
          <stop offset=".4" stopColor={water.pigment} stopOpacity=".12"/>
          <stop offset=".57" stopColor={water.pigment} stopOpacity=".35"/>
          <stop offset=".79" stopColor={water.pigment} stopOpacity=".95"/>
          <stop offset="1" stopColor={water.pigment} stopOpacity=".25"/>
        </linearGradient>
      </>}
    </defs>
    {geometry(mark, base)}
    <g data-playback-decoration="true" pointerEvents="none">
      {filled && !graphiteSolid && pencil && <>
        {geometry(mark,{fill:`url(#${clip}-shade)`,stroke:'none'})}
        {graphite.hatch>0 && <g clipPath={`url(#${clip})`}>
          {geometry(mark,{fill:`url(#${clip}-grain)`,stroke:'none',opacity:graphite.hatch, ...(graphite.surface==='form'?{mask:`url(#${clip}-hatch-mask)`}:{})})}
        </g>}
      </>}
      {pencil && outlined && filled && geometry(mark, { fill:'none', stroke:`url(#${clip}-pressure)`, strokeWidth:lineWidth*1.35, strokeOpacity:graphite.pressure, strokeLinecap:'round', strokeLinejoin:'round' })}
      {crayon && filled && geometry(mark, { fill: `url(#${uid}-wax-scrub)`, stroke: 'none' })}
      {crayon && outlined && geometry(mark, { fill: 'none', stroke: `url(#${clip}-wax-stroke)`, strokeWidth: .9, strokeOpacity: .18, transform: 'translate(.9 -.6)', strokeLinecap: 'round', strokeLinejoin: 'round' })}
      {waterPaint && <>
        <g clipPath={`url(#${clip})`}>
          {geometry(mark, { fill: water.pigment, stroke: 'none', opacity: water.washOpacity, filter: `url(#${clip}-water-wash)` })}
          {geometry(mark, { fill: '#fffdf5', stroke: 'none', opacity: water.bloomOpacity, filter: `url(#${clip}-water-bloom)` })}
          {geometry(mark, { fill: 'none', stroke: `url(#${clip}-water-pool)`, strokeWidth: 2.7, strokeOpacity: water.poolOpacity, filter: `url(#${uid}-water-bleed)`, strokeLinejoin: 'round' })}
        </g>
        {geometry(mark, { fill: 'none', stroke: water.pigment, strokeWidth: 2.4, strokeOpacity: .08, filter: `url(#${uid}-water-bleed)`, strokeLinejoin: 'round' })}
        {geometry(mark, { fill: 'none', stroke: `url(#${clip}-water-pool)`, strokeWidth: .8, strokeOpacity: water.poolOpacity * .7, filter: `url(#${uid}-water-edge)`, strokeLinejoin: 'round' })}
      </>}
    </g>
  </g>;
}

type LegacyOptions = Omit<Props, 'mark' | 'markKey'> & { ownerId: string };
type LegacyProps = Record<string, unknown> & { children?: ReactNode };

/** The initial landscape and shortcut brushes use the same media as free drawings. */
export function brushLegacy(node: ReactNode, options: LegacyOptions): ReactNode {
  function visit(value: ReactNode, path: string, inherited: Record<string, unknown>): ReactNode {
    if (!isValidElement(value)) return value;
    const element = value as ReactElement<LegacyProps>;
    if (element.type === Fragment) return cloneElement(element, undefined, Children.map(element.props.children, (child, index) => visit(child, `${path}-${index}`, inherited)));
    if (typeof element.type !== 'string') return element;
    const props = element.props;
    if (['defs', 'title', 'filter', 'clipPath', 'mask', 'pattern'].includes(element.type)) return element;
    const paint = { ...inherited };
    for (const field of ['fill', 'stroke', 'strokeWidth'] as const) if (props[field] !== undefined) paint[field] = props[field];
    const tag = element.type;
    if (!['path', 'ellipse', 'circle', 'rect', 'line', 'text'].includes(tag)) {
      return cloneElement(element, undefined, Children.map(props.children, (child, index) => visit(child, `${path}-${index}`, paint)));
    }
    const n = (key: string, fallback = 0) => props[key] === undefined ? fallback : Number(props[key]);
    const mark: DrawingMark = {
      type: tag === 'circle' ? 'ellipse' : tag as DrawingMark['type'],
      fill: String(paint.fill ?? options.objectColor), stroke: String(paint.stroke ?? 'none'),
      strokeWidth: Number(paint.strokeWidth ?? 1), opacity: n('opacity', 1),
    };
    if (tag === 'path') mark.d = String(props.d ?? '');
    else if (tag === 'circle' || tag === 'ellipse') Object.assign(mark, { x: n('cx'), y: n('cy'), w: 2 * n(tag === 'circle' ? 'r' : 'rx'), h: 2 * n(tag === 'circle' ? 'r' : 'ry') });
    else if (tag === 'rect') Object.assign(mark, { x: n('x'), y: n('y'), w: n('width'), h: n('height') });
    else if (tag === 'line') Object.assign(mark, { x: n('x1'), y: n('y1'), x2: n('x2'), y2: n('y2') });
    else Object.assign(mark, { x: n('x'), y: n('y'), text: String(props.children ?? '') });
    const key = `${options.ownerId}-legacy${path}`;
    return <g key={element.key ?? key} transform={typeof props.transform === 'string' ? props.transform : undefined}>
      <BrushMark {...options} mark={mark} markKey={key} />
    </g>;
  }
  return visit(node, '0', {});
}
