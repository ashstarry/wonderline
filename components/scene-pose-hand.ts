/** A transient companion to an existing pose animation. It never belongs to
 * an object, so selection bounds, model geometry and saved pigment stay intact. */
export function createPoseHand(canvas: SVGSVGElement, element: SVGElement) {
  const ns = 'http://www.w3.org/2000/svg';
  const root = document.createElementNS(ns, 'g');
  let animation: Animation | undefined;
  try {
    const box = (element as SVGGraphicsElement).getBBox();
    const screen = canvas.getScreenCTM();
    const parent = (element.parentElement as unknown as SVGGraphicsElement)?.getScreenCTM();
    if (!screen || !parent || !Number.isFinite(box.x + box.y + box.width + box.height)) return;
    const parentMatrix = screen.inverse().multiply(parent);
    const motion = document.createElementNS(ns, 'g');
    const anchor = document.createElementNS(ns, 'g');
    const hand = document.createElementNS(ns, 'g');
    root.setAttribute('data-playback-artifact', 'pose-hand');
    root.setAttribute('data-pose-hand-for', element.getAttribute('data-manual-object') ?? '');
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('pointer-events', 'none');
    root.setAttribute('transform', parentMatrix.toString());
    motion.style.transformOrigin = '0 0';
    motion.style.transformBox = 'view-box';
    anchor.setAttribute('transform', `translate(${box.x} ${box.y + box.height * .5})`);
    // A side-on pinch holds the left edge between curled index finger and
    // thumb. Leave every corner clear for selection/delete/resize controls.
    hand.innerHTML = '<path d="M-26-6L-21-7C-20-12-15-15-11-14L-3-11C1-10 3-7 1-4C0-2-3-2-5-3L-11-5L-13-1L-9 4L-3 0C0-2 3 0 2 3C1 5-4 9-8 11C-13 14-19 10-21 6L-26 5Z" fill="#fff7e7" stroke="#7b725c" stroke-width="1.7" stroke-linejoin="round"/><path d="M-31-8H-25V7H-31Z" fill="#a7bb8b" stroke="#7b725c" stroke-width="1.5" stroke-linejoin="round"/><path d="M-20-6Q-16-5-15-2M-20 0Q-17 1-16 4M-16 7Q-13 8-11 7" fill="none" stroke="#c6b99b" stroke-width="1.3" stroke-linecap="round"/>';
    anchor.appendChild(hand); motion.appendChild(anchor); root.appendChild(motion);
    const dispose = () => { animation?.cancel(); root.remove(); };
    return {
      follow(source: Animation) {
        try {
          const effect = source.effect as KeyframeEffect | null;
          if (!effect) return;
          const frames = effect.getKeyframes();
          // Keep the hand small even when a large object is being shrunk.
          const largestScale = Math.max(1, ...frames.map(frame => {
            const m = new DOMMatrix(String(frame.transform ?? 'none'));
            return Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
          }));
          const scale = .82 / (Math.max(.01, Math.hypot(parent.a, parent.b)) * largestScale);
          hand.setAttribute('transform', `scale(${scale})`);
          canvas.appendChild(root);
          animation = motion.animate(frames, effect.getTiming());
          animation.playbackRate = source.playbackRate;
          // Same timeline, keyframes, easing and deadline; never wait for this
          // decoration before committing a scene or processing another idea.
          void source.ready.then(() => {
            if (root.isConnected && animation && source.startTime !== null) animation.startTime = source.startTime;
          }).catch(() => {});
        } catch { dispose(); }
      },
      dispose,
    };
  } catch { root.remove(); return; }
}
