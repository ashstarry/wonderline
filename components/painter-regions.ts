export type SubjectRegion = {left:number;top:number;right:number;bottom:number};
/** Conservative third-painter admission: complete geometry with a clear gap.
 * Missing bounds or a still-growing neighboring object means wait. */
export function independentThirdSubject(owner:string,busyOwners:string[],regions:ReadonlyMap<string,SubjectRegion>,confirmed:ReadonlySet<string>|null,gap=18){
 const box=regions.get(owner);
 if(!box||!Object.values(box).every(Number.isFinite)||(confirmed&&!confirmed.has(owner)))return false;
 return busyOwners.every(other=>{
  const next=regions.get(other);
  if(!next||!Object.values(next).every(Number.isFinite)||(confirmed&&!confirmed.has(other)))return false;
  return box.right+gap<next.left||next.right+gap<box.left||box.bottom+gap<next.top||next.bottom+gap<box.top;
 });
}
