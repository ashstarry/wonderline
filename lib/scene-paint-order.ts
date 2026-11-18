import type { Scene, SceneObject } from './scene';

/** Actual back-to-front object order; the renderer inserts the fixed ground
 * between background brushes and foreground objects in landscape mode. */
export function getScenePaintOrder(scene: Scene): SceneObject[] {
  const promoted = scene.objects.filter(object => object.stackRank !== undefined).sort((a, b) => a.stackRank! - b.stackRank!);
  const ordinary = scene.objects.filter(object => object.stackRank === undefined);
  if (scene.ground === 'none') return [...ordinary, ...promoted];
  const layer = (object: SceneObject) => ['sun', 'moon', 'star'].includes(object.kind) ? 0
    : object.kind === 'mountain' ? 1 : ['cloud', 'bird'].includes(object.kind) ? 2 : 3;
  const sorted = [...ordinary].sort((a, b) => {
    if (a.id.startsWith('hand-') !== b.id.startsWith('hand-')) return a.id.startsWith('hand-') ? 1 : -1;
    return layer(a) - layer(b) || a.y - b.y;
  });
  // Match the renderer's two passes, including unusual hand-* background kinds.
  return [...sorted.filter(isBackdropObject), ...sorted.filter(object => !isBackdropObject(object)), ...promoted];
}

export function isBackdropObject(object: SceneObject): boolean {
  return ['sun', 'moon', 'star', 'mountain', 'cloud', 'bird'].includes(object.kind);
}
