/** One canonical transform shared by rendering, erasure and model context. */
export type ObjectPose = { x: number; y: number; scale: number; rotation?: number };
export function poseTransform(pose: ObjectPose): string {
  return `translate(${pose.x} ${pose.y})${pose.rotation ? ` rotate(${pose.rotation})` : ''} scale(${pose.scale})`;
}
export function inversePoseTransform(pose: ObjectPose): string {
  return `scale(${1 / pose.scale})${pose.rotation ? ` rotate(${-pose.rotation})` : ''} translate(${-pose.x} ${-pose.y})`;
}
export function localToPaper(point: { x: number; y: number }, pose: ObjectPose) {
  const angle = (pose.rotation ?? 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return { x: pose.x + pose.scale * (point.x * c - point.y * s), y: pose.y + pose.scale * (point.x * s + point.y * c) };
}
export function paperToLocal(point: { x: number; y: number }, pose: ObjectPose) {
  const angle = (pose.rotation ?? 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const x = (point.x - pose.x) / pose.scale, y = (point.y - pose.y) / pose.scale;
  return { x: x * c + y * s, y: -x * s + y * c };
}
