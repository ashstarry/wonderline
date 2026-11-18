import { drawingTrace, type DrawingTrace } from '../../../lib/diagnostics';
import { requestsLettering } from '../../../lib/drawing-text';
import { CONTENT_BLOCKED_MESSAGE, inspectText } from '../../../lib/content-filter';
import { DEFAULT_PAPER } from '../../../lib/paper-viewport';
import { SYSTEM_PROMPT, LIVE_PROMPT, COMPACT_MARK_PROMPT, EFFICIENT_MARK_PROMPT, LOOKAHEAD_PROMPT, RECOVERY_PROMPT } from '../../../lib/drawing-prompt';
import { ApiError, authorizeRequest, errorResponse, getOpenRouterConfig, jsonResponse, openRouterCompletion, openRouterStreamingCompletion, readJson } from '../../../lib/openrouter';
import { compactPatchJsonSchema, efficientPatchJsonSchema, imagineInputSchema, patchJsonSchema } from '../../../lib/scene-validation';
import { EXPERIMENT_DRAWING_MODEL, getDrawingModelSettings, requestedDrawingExperiment } from '../../../lib/drawing-model';
import { imagineStreamResponse } from '../../../lib/imagine-stream';
import { modelCanvasContext } from '../../../lib/canvas-context-validation';
import { drawingFailureKind, drawingFailureDiagnostic } from '../../../lib/drawing-failure';
import { ScenePreviewBuilder } from '../../../lib/scene-stream';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let trace: DrawingTrace | undefined;
  try {
    await authorizeRequest(request, 'imagine');
    const input = imagineInputSchema.safeParse(await readJson(request, 512_000));
    if (!input.success) throw new ApiError(400, '这次描述或画面格式有点问题，请用 600 字以内描述你的想法。');
    if (inspectText(input.data.text).blocked) return jsonResponse({ scene: input.data.scene, action: 'ignore', message: CONTENT_BLOCKED_MESSAGE });
    const { key, model: configuredModel } = await getOpenRouterConfig();
    const model = requestedDrawingExperiment(request.url) ? EXPERIMENT_DRAWING_MODEL : configuredModel;
    if (!key) throw new ApiError(503, '画室的 AI 还没有接通。请先配置 OpenRouter，再来试试。');
    trace = drawingTrace(request, { model, language: input.data.language ?? 'zh', mode: input.data.mode, lookahead: !!input.data.lookahead, objects: input.data.scene.objects.length, marks: input.data.scene.objects.reduce((n, object) => n + (object.marks?.length ?? 0), 0), text: input.data.text, scene: input.data.scene }, key);
    if (model === EXPERIMENT_DRAWING_MODEL) return await (await import('../../../lib/mercury/route')).mercuryResponse(request, input.data, trace);
    const allowText=requestsLettering(`${input.data.clarification?.instruction??''} ${input.data.text}`);
    const settings = getDrawingModelSettings(model);
    const canvasContext = modelCanvasContext(input.data.scene, input.data.canvasContext, input.data.clarification ? `${input.data.clarification.instruction} ${input.data.text}` : input.data.text);
    const systemPrompt = `${input.data.mode === 'live' ? `${SYSTEM_PROMPT}\n\n${LIVE_PROMPT}` : SYSTEM_PROMPT}${input.data.lookahead ? `\n\n${LOOKAHEAD_PROMPT}` : ''}${input.data.unfinished?.length ? `\n\n${RECOVERY_PROMPT}` : ''}`;
    const formatPrompt = settings.schema === 'efficient' ? EFFICIENT_MARK_PROMPT : settings.schema === 'compact' ? COMPACT_MARK_PROMPT : '';
    const outputSchema = settings.schema === 'efficient' ? efficientPatchJsonSchema : settings.schema === 'compact' ? compactPatchJsonSchema : patchJsonSchema;
    const completionRequest = {
      ...settings.request,
      max_tokens: input.data.mode === 'live' ? 9000 : 12000,
      messages: [
        { role: 'system', content: formatPrompt ? `${systemPrompt}\n\n${formatPrompt}` : systemPrompt },
        { role: 'user', content: JSON.stringify({ reply_language: input.data.language === 'en' ? 'English' : '简体中文', mode: input.data.mode, canvas_viewport: input.data.scene.paper ?? DEFAULT_PAPER, instruction: input.data.text, ...(input.data.lookahead ? {parallel_reservations:input.data.lookahead} : {}), recent_instructions: input.data.recent ?? [], ...(input.data.unfinished?.length ? {unfinished_instructions:input.data.unfinished} : {}), clarification: input.data.clarification ?? null, ...(canvasContext ? { canvas_context: canvasContext } : {}), current_scene: input.data.scene }) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'scene_patch', strict: true, schema: outputSchema } },
    };
    if (request.headers.get('accept')?.toLowerCase().split(',').some(value => value.trim().split(';')[0] === 'application/x-ndjson')) {
      return imagineStreamResponse(input.data.scene, signal => openRouterStreamingCompletion(completionRequest, signal, model, trace), {
        allowText, trace,
        signal: request.signal,
        errorMessage: error => error instanceof ApiError ? error.message : '这一笔没接上，已有画面保留了，可以接着说。',
        errorKind: drawingFailureKind,
        onFailure: diagnostic => console.warn('drawing_generation_failed', diagnostic),
      });
    }
    const content = await openRouterCompletion(completionRequest, request.signal, model, trace);
    trace.firstContent();
    let result;
    try {
      // Use the streaming path's strict parser here too: duplicate action keys
      // must never turn malformed model output into a transcript deletion.
      const parsed = new ScenePreviewBuilder(input.data.scene,{allowText});
      parsed.push(content);
      result = parsed.finish();
    } catch (cause) {
      trace.failure(cause, 'final_validation');
      console.warn('drawing_generation_failed', {stage:'final_validation',previews:0,...drawingFailureDiagnostic(cause)});
      throw new ApiError(502, '这一笔没接上，已有画面保留了，可以接着说。', 'turn');
    }
    trace.complete(result);
    return jsonResponse(result);
  } catch (error) { if (request.signal.aborted) trace?.cancel(); else trace?.failure(error, 'request'); return errorResponse(error); }
}
