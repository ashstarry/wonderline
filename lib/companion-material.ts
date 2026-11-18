import type { SceneObject } from './scene';

/** A companion's name is identity, not paint. The descriptive part of our
 * `name · description` label keeps choosing the same material after naming. */
export function materialSubject(object: Pick<SceneObject, 'kind' | 'label'>): string {
  const label = object.label ?? '';
  const separator = label.indexOf(' · ');
  return `${object.kind} ${separator < 0 ? label : label.slice(separator + 3)}`;
}
