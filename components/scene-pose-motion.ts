import { poseDelta, type PoseChange } from '../lib/scene-reframe';
import { createPoseHand } from './scene-pose-hand';

/** Compositor transforms move existing pigment, including its in-flight brush
 * overlays and eraser holes. They never restart the drawing queue. */
export class ScenePoseMotion {
  private animations = new Map<string, { animation: Animation; element: SVGElement; deadline: number; hand?: ReturnType<typeof createPoseHand> }>();
  constructor(private canvas: SVGSVGElement) {}
  prepare(changes: Map<string, PoseChange>, immediate: boolean) {
    const starts = new Map<string, { element: SVGElement; matrix: DOMMatrix; duration: number }>();
    if (immediate) { this.clear(); return () => {}; }
    // Remove visual interpolation while the engine measures canonical geometry.
    // A streamed mark arriving mid-motion must not capture temporary positions.
    const now = performance.now();
    for (const [id, {animation, element, deadline, hand}] of this.animations) {
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      animation.cancel();
      hand?.dispose();
      element.removeAttribute('data-pose-moving');
      if (element.isConnected && deadline > now) starts.set(id, {element, matrix, duration: deadline-now});
    }
    this.animations.clear();
    for (const [id, change] of changes) {
      const element = Array.from(this.canvas.querySelectorAll<SVGElement>('[data-manual-object]')).find(node=>node.getAttribute('data-manual-object')===id);
      if (!element) continue;
      const prior = starts.get(id)?.matrix ?? new DOMMatrix();
      starts.set(id, { element, matrix: prior.multiply(new DOMMatrix(poseDelta(change.before, change.after))), duration: 620 });
    }
    // Call after playback reconciliation: snapshots must measure final geometry,
    // not an interpolated frame, so later erasures use the correct location.
    return () => {
      for (const [id, { element, matrix, duration }] of starts) {
        const animation = element.animate([{ transform: matrix.toString() }, { transform: 'matrix(1,0,0,1,0,0)' }], { duration, easing: 'cubic-bezier(.22,.7,.25,1)' });
        const deadline = performance.now()+duration;
        const hand = createPoseHand(this.canvas, element);
        hand?.follow(animation);
        this.animations.set(id, {animation, element, deadline, hand}); element.setAttribute('data-pose-moving','true');
        animation.onfinish = () => { hand?.dispose(); if (this.animations.get(id)?.animation === animation) { this.animations.delete(id); element.removeAttribute('data-pose-moving'); } };
      }
    };
  }
  clear() { for (const {animation,hand} of this.animations.values()) { animation.cancel(); hand?.dispose(); } this.animations.clear(); this.canvas.querySelectorAll('[data-pose-moving]').forEach(node=>node.removeAttribute('data-pose-moving')); }
}
