import { isPagesRequest, pagesPreflight, pagesResponse } from '../lib/studio-origin';
import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import { routerSpeechWebSocket } from "../lib/router-speech";
import { speechWebSocket } from "../lib/cloud-speech";
import { chineseRouterSpeechWebSocket } from '../lib/chinese-router-speech';
import { speechOnlyEnglishWebSocket } from '../lib/speech-only-english';

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const publicAccess = (env as unknown as Record<string, unknown>).PUBLIC_ACCESS_ENABLED === 'true';
    const preflight = pagesPreflight(request, publicAccess);
    if (preflight) return preflight;
    if (new URL(request.url).pathname === '/api/speech/english') return speechOnlyEnglishWebSocket(request, env as unknown as Record<string, unknown>, ctx, async () => (await import('../lib/chinese-neural-runtime')).createChineseNoiseGate());
    if (['/api/speech/chinese', '/api/speech/chinese-clean'].includes(new URL(request.url).pathname)) return chineseRouterSpeechWebSocket(request, env as unknown as Record<string, unknown>, ctx, isPagesRequest(request) && new URL(request.url).pathname === '/api/speech/chinese' ? undefined : async () => (await import('../lib/chinese-neural-runtime')).createChineseNoiseGate());
    if (new URL(request.url).pathname === '/api/speech/realtime') return ((env as unknown as Record<string, unknown>).ASR_PROVIDER === 'openrouter' ? routerSpeechWebSocket : speechWebSocket)(request, env as unknown as Record<string, unknown>, ctx);
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return pagesResponse(request, await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx)), publicAccess);
  },
};
