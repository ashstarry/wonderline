/** A turn can be skipped; a service failure needs a connection/account remedy. */
export type DrawingFailureKind = 'turn' | 'service';

export class DrawingFailure extends Error {
  constructor(message: string, public kind: DrawingFailureKind) {
    super(message);
    this.name = 'DrawingFailure';
  }
}

/** The UI has discarded this turn's artwork and words. Keep the diagnostic
 * category, but never hold or retry a request the child can no longer see. */
export class RolledBackDrawingFailure extends DrawingFailure {
  constructor(message: string, kind: DrawingFailureKind) {
    super(message, kind);
    this.name = 'RolledBackDrawingFailure';
  }
}

export function drawingFailureKind(cause: unknown): DrawingFailureKind {
  if (cause instanceof DrawingFailure) return cause.kind;
  // fetch and interrupted response streams reject with TypeError in browsers.
  return cause instanceof TypeError ? 'service' : 'turn';
}

/** Compatibility for older servers that do not yet include failureKind. */
export function httpDrawingFailureKind(status: number): DrawingFailureKind {
  return [401, 402, 403, 408, 429].includes(status) || status >= 500 ? 'service' : 'turn';
}

/** Log a bounded diagnostic category, never speech, generated JSON or provider
 * response text. Stream failures are HTTP 200, so request logs alone miss them. */
export function drawingFailureDiagnostic(cause: unknown) {
  const issues = cause && typeof cause === 'object' && 'issues' in cause && Array.isArray(cause.issues) ? cause.issues : [];
  if (issues.length) {
    const paths = issues.map(issue => issue && typeof issue === 'object' && Array.isArray(issue.path) ? issue.path : []);
    const metadataLength = issues.every((issue, index) => issue?.code === 'too_big' && ['label', 'title', 'message'].includes(paths[index].at(-1)));
    return { reason: paths.some(path => path.includes('marks')) ? 'invalid_geometry' : paths.some(path => path.includes('layout')) ? 'invalid_layout' : metadataLength ? 'metadata_length' : 'invalid_schema', issueCount: issues.length };
  }
  const reasons: Record<string, string> = {
    'Invalid or incomplete model JSON': 'invalid_json',
    'Invalid scene references': 'invalid_references',
    'Layout refers to a missing object': 'invalid_layout_reference',
    'Layout bounds or anchors exceed the current paper': 'off_paper_layout',
    'Object order must contain each resulting object ID exactly once': 'invalid_object_order',
    'An ignored utterance cannot change the scene': 'contradictory_ignore',
  };
  return { reason: cause instanceof Error ? reasons[cause.message] ?? 'upstream_or_unknown' : 'unknown', issueCount: 0 };
}
