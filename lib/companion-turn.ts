import type { Scene, SceneObject } from './scene';
import type { PaperViewport } from './paper-viewport';
import { isBackdropObject } from './scene-paint-order';
import { CompanionError, companionObjectId, namedObjectLabel, placeCompanion, renameCompanionLabel, type Companion } from './story-companions';
import { findCompanionMentions, parseCompanionIdeaRequest, parseCompanionRecall, parseCompanionRemember, parseCompanionSave } from './companion-voice';

/** Used only by the experimental voice integration. Ordinary requests return
 * their original scene and keep their normal speculative-generation path. */
export function isCompanionTurn(text: string, entries: readonly Companion[]): boolean {
  return !!parseCompanionSave(text) || parseCompanionRemember(text) || parseCompanionIdeaRequest(text) || findCompanionMentions(text, entries).length > 0;
}

export function shouldDeferCompanionLookahead(text: string, entries: readonly Companion[], scene: Scene): boolean {
  if (parseCompanionSave(text) || parseCompanionRemember(text) || parseCompanionIdeaRequest(text)) return true;
  const recall = parseCompanionRecall(text, entries);
  if (!recall) return false;
  const entry = entries.find(item => item.id === recall.companionId)!;
  return recall.pure || !namedCompanionObject(scene, entry);
}

export function namedCompanionObject(scene: Scene, entry: Companion): SceneObject | undefined {
  const stable = scene.objects.find(object => object.id === companionObjectId(entry));
  if (stable) return stable;
  const name = entry.name.normalize('NFKC').toLocaleLowerCase('en');
  const matches = scene.objects.filter(object => {
    const label = object.label?.normalize('NFKC').toLocaleLowerCase('en');
    return label === name || label?.startsWith(`${name} · `);
  });
  return matches.length === 1 ? matches[0] : undefined;
}

/** Rename scene metadata in-place in history: no new drawing turn, movement,
 * erasing or model request. Match the old name before changing the library. */
export function renameCompanionInScene(scene: Scene, previous: Companion, next: Companion): Scene {
  if (previous.id !== next.id || previous.name === next.name) return scene;
  const object = namedCompanionObject(scene, previous);
  if (!object) {
    const name = previous.name.normalize('NFKC').toLocaleLowerCase('en');
    const matches = scene.objects.filter(item => {
      const label = item.label?.normalize('NFKC').toLocaleLowerCase('en');
      return label === name || label?.startsWith(`${name} · `);
    });
    if (matches.length > 1) throw new CompanionError('duplicate-name');
    return scene;
  }
  const renamed = renameCompanionLabel(object, previous.name, next.name);
  const updated = renamed === object ? { ...object, label: namedObjectLabel(next.name, object) } : renamed;
  return { ...scene, objects: scene.objects.map(item => item.id === object.id ? updated : item) };
}

export function prepareCompanionRecall(text: string, scene: Scene, entries: readonly Companion[], viewport: PaperViewport) {
  const intent = parseCompanionRecall(text, entries);
  if (!intent) return null;
  const entry = entries.find(item => item.id === intent.companionId)!;
  const existing = namedCompanionObject(scene, entry);
  const name = entry.name.normalize('NFKC').toLocaleLowerCase('en');
  if (!existing && scene.objects.filter(object => {
    const label = object.label?.normalize('NFKC').toLocaleLowerCase('en');
    return label === name || label?.startsWith(`${name} · `);
  }).length > 1) throw new CompanionError('duplicate-name');
  const placed = existing ? { scene, objectId: existing.id, added: false } : placeCompanion(scene, entry, viewport);
  return { ...placed, entry, pure: intent.pure };
}

/** Resolve explicit labels first. A pronoun follows the last committed subject,
 * even while its strokes are still playing; ambiguity asks the child to choose. */
export function companionSubject(scene: Scene, selectedId: string | null, recentIds: readonly string[], target?: string): SceneObject | undefined {
  const candidates = scene.objects.filter(object => !object.id.startsWith('hand-'));
  const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (target) {
    const wanted = normalize(target);
    const matches = candidates.filter(object => {
      const label = normalize(object.label ?? object.kind);
      return label === wanted || (` ${label} `).includes(` ${wanted} `) || (/\p{Script=Han}/u.test(wanted) && label.includes(wanted));
    });
    return matches.length === 1 ? matches[0] : undefined;
  }
  const selected = selectedId && candidates.find(object => object.id === selectedId);
  if (selected) return selected;
  const recent = candidates.filter(object => recentIds.includes(object.id));
  if (recent.length === 1) return recent[0];
  const foreground = candidates.filter(object => !isBackdropObject(object));
  return foreground.length === 1 ? foreground[0] : candidates.length === 1 ? candidates[0] : undefined;
}

export function newlyDrawnSubjects(before: Scene, after: Scene): string[] {
  const added = after.objects.filter(object => !before.objects.some(old => old.id === object.id) && !object.id.startsWith('hand-'));
  const foreground = added.filter(object => !isBackdropObject(object));
  return (foreground.length ? foreground : added).map(object => object.id);
}
