import type { Scene, SceneObject, DrawingMark } from '../lib/scene';
export const experimentBlank: Scene={title:'A little room for wonder',sky:'paper',weather:'clear',ground:'none',paper:{x:0,y:0,width:1000,height:640},objects:[]};
const path=(d:string,fill:string,stroke='#5a777e',width=3):DrawingMark=>({type:'path',d,fill,stroke,strokeWidth:width});
const ellipse=(x:number,y:number,w:number,h:number,fill:string,stroke='#695b46'):DrawingMark=>({type:'ellipse',x,y,w,h,fill,stroke,strokeWidth:2});
export const mountains:SceneObject={id:'experiment-mountains',kind:'drawing',label:'Distant mountains',x:0,y:0,scale:1,color:'#92b9c0',marks:[
 path('M85 535 L280 210 L445 535 Z','#b6cfd0'),path('M255 535 L480 78 L765 535 Z','#83afb9'),path('M590 535 L760 238 L925 535 Z','#a3c6c9'),
 path('M421 197 L480 78 L551 191 L510 179 L478 207 L453 176 Z','#f6f4dc','none'),path('M237 282 L280 210 L320 289 L278 277 Z','#f6f4dc','none'),
 path('M718 310 L760 238 L806 310 L773 299 L751 318 Z','#f6f4dc','none'),
 ]};
export const temple:SceneObject={id:'experiment-temple',kind:'drawing',label:'Temple in the foreground',x:500,y:553,scale:1.08,color:'#f1d89b',marks:[
 path('M-93 0V-123H93V0Z','#f1d89b','#987248'),
 path('M-114-121Q-91-118-63-142Q0-181 63-142Q91-118 114-121Q90-100 65-111H-65Q-90-100-114-121Z','#c7684f','#995d47'),
 path('M-94-156Q-68-150-45-171Q0-197 45-171Q68-150 94-156Q67-140 43-148H-43Q-67-140-94-156Z','#d98359','#995d47'),
 path('M-28 0V-66Q0-84 28-66V0Z','#906744','#77563e'),
 {type:'rect',x:-71,y:-91,w:28,h:35,fill:'#a6c9bf',stroke:'#987248',strokeWidth:3},
 {type:'rect',x:43,y:-91,w:28,h:35,fill:'#a6c9bf',stroke:'#987248',strokeWidth:3},
 path('M-105 0H105V12H-105Z','#d9bd8d','#987248'),path('M0-67V0','none','#d9a46a',2),
 ]};
export const dog:SceneObject={id:'experiment-dog',kind:'drawing',label:'Little dog',x:760,y:570,scale:.85,color:'#d99764',marks:[
 ellipse(0,-28,98,56,'#d99764'),ellipse(-39,-64,55,52,'#e5af79'),
 path('M-63-79Q-91-75-73-42Q-58-38-55-61Z','#a86c49','#815c42',2),
 path('M-35-6L-38 20L-26 20L-21-3M20-3L23 20H35L36-8','none','#93633e',7),
 path('M44-31Q76-40 62-69','none','#9a6842',7),ellipse(-49,-67,6,8,'#584936'),ellipse(-63,-54,11,8,'#584936'),path('M-57-44Q-45-38-36-47','none','#815c42',2),
 ]};
export const ufo:SceneObject={id:'experiment-ufo',kind:'drawing',label:'Flying saucer',x:790,y:133,scale:.85,color:'#a5d1d3',marks:[
 path('M-38 0Q-31-53 0-49Q32-50 39 0Z','#b7dfda','#53848b'),ellipse(0,3,145,43,'#a4d1cc','#53848b'),
 path('M-63 0Q0 22 63 0','none','#7aa9ac',3),ellipse(-40,7,10,8,'#f7d578','none'),ellipse(0,12,10,8,'#f7d578','none'),ellipse(40,7,10,8,'#f7d578','none'),
 ]};
