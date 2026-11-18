export const DEFAULT_DRAWING_MODEL = 'openai/gpt-6-luna';
export const EXPERIMENT_DRAWING_MODEL = 'inception/mercury-3';

/** An explicit URL is the only way to activate the isolated Site experiment. */
export function requestedDrawingExperiment(url: string): boolean {
  try { return new URL(url).searchParams.get('draw-lab') === 'mercury3'; }
  catch { return false; }
}

export function getDrawingModelSettings(model: string) {
  if (model === EXPERIMENT_DRAWING_MODEL) return {
    schema: 'efficient' as const,
    compactMarks: false,
    request: { reasoning: { enabled: false }, provider: { require_parameters: true } },
  };
  if (model === 'openai/gpt-6-luna') return {
    // Each strict shape branch requires only its own geometry and shared styles.
    schema: 'efficient' as const,
    compactMarks: false,
    request: {
      // Override the transport's sampling default: reasoning requests omit it.
      temperature: undefined,
      reasoning: { effort: 'low' as const },
      provider: { only: ['openai'], require_parameters: true, allow_fallbacks: false },
    },
  };
  const effort = model === 'google/gemini-3.8-flash' ? 'low' as const
    : model === 'google/gemini-3.6-flash' ? 'minimal' as const : undefined;
  return {
    schema: model.startsWith('google/gemini-') ? 'compact' as const : 'full' as const,
    compactMarks: model.startsWith('google/gemini-'),
    request: effort ? {
      reasoning: { effort },
      provider: { only: ['google-ai-studio'], require_parameters: true, allow_fallbacks: false },
    } : {},
  };
}
