/** Public addresses only. Secrets remain in the hosted Worker. */
declare const __WONDERLINE_PAGES__: boolean | undefined;
export const CLOUD_STUDIO_ORIGIN = 'https://softspoken-paper-garden.dongyuanshun.chatgpt.site';
export function isPagesBuild() { return typeof __WONDERLINE_PAGES__ !== 'undefined' && __WONDERLINE_PAGES__ === true; }
export function studioApi(path: string) { return isPagesBuild() ? `${CLOUD_STUDIO_ORIGIN}${path}` : path; }
const DRAWING_SPEED_KEY = 'wonderline-drawing-speed-v1';
let chosenSpeed: boolean | undefined;
/** Public first visits keep Luna. A choice applies to this tab, not other tabs. */
export function drawingExperimentEnabled() {
  if (typeof window === 'undefined') return false;
  if (chosenSpeed !== undefined) return chosenSpeed;
  try { const saved = window.sessionStorage.getItem(DRAWING_SPEED_KEY); if (saved === 'quick' || saved === 'classic') return saved === 'quick'; } catch { /* Storage is optional. */ }
  return !isPagesBuild() && new URLSearchParams(window.location.search).get('draw-lab') !== 'luna';
}
export function chooseDrawingSpeed(quick: boolean) {
  chosenSpeed = quick;
  try { window.sessionStorage.setItem(DRAWING_SPEED_KEY, quick ? 'quick' : 'classic'); } catch { /* Keep this visit's choice in memory. */ }
}
/** Model switching never changes papers or transcript storage. */
export function drawingPaperStorageKey(key: string) {
  const labPaper = !isPagesBuild() && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('draw-lab') !== 'luna';
  return labPaper ? `${key}-lab-mercury3` : key;
}
function browserBase() {
  return typeof window === 'undefined' || window.location?.hostname === 'ashstarry.github.io' ? '/wonderline/' : '/';
}
export function studioPage(path: string) { return isPagesBuild() ? `${browserBase()}${path === '/' ? '' : `?view=${path.slice(1)}`}` : path; }
export function studioAsset(path: string) { return isPagesBuild() ? `${browserBase()}${path.split('/').pop()}` : path; }
