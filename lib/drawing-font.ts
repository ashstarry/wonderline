import { studioAsset } from './studio-endpoint';
// The bundled font's unmodified upstream file and OFL notice live together.
// Embed only for exports containing intentional text; ordinary drawings never
// fetch a font or pay its download/encoding cost.
let fontData:Promise<string>|undefined;
export async function embedDrawingFont(svg:SVGElement){
 if(!svg.querySelector('text'))return;
 fontData??=fetch(studioAsset('/fonts/LXGWMarkerGothic-Regular.ttf')).then(async response=>{
  if(!response.ok)throw new Error('字体暂时无法载入');
  const blob=await response.blob();return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob);});
 }).catch(error=>{fontData=undefined;throw error;});
 const style=document.createElementNS('http://www.w3.org/2000/svg','style');
 style.textContent=`@font-face{font-family:'LXGW Marker Gothic';src:url('${await fontData}') format('truetype');font-weight:400;font-style:normal}`;svg.insertBefore(style,svg.firstChild);
}
