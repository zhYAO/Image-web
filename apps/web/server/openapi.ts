const json = { "application/json": { schema: { type: "object" } } };
const sse = { "text/event-stream": { schema: { type: "string" } } };

function responses(
  successStatus = "200",
  content: Record<string, { schema: { type: string } }> = json,
) {
  return {
    [successStatus]: { content, description: "Success" },
    "402": {
      content: json,
      description: "Insufficient credits; no admission occurred",
    },
    "409": {
      content: json,
      description:
        "Price changed, request conflict, or result awaiting reconciliation",
    },
    "429": {
      content: json,
      description: "Independent daily image quota or rate limit exceeded",
    },
    "503": {
      content: json,
      description: "Creation or credit service not ready",
    },
    "400": { content: json, description: "Invalid request" },
    "401": { content: json, description: "Invalid anonymous identity" },
    "500": { content: json, description: "Safe normalized failure" },
  };
}

export function buildOpenApiDocument() {
  return {
    components: {
      securitySchemes: {
        anonymousSession: {
          in: "cookie",
          name: "sb-access-token",
          type: "apiKey",
        },
      },
    },
    info: {
      description: 'ZImage Phase 1 Web application API. Provider errors and secrets are never returned.',
      title: 'ZImage Web API',
      version: '1.0.0',
    },
    openapi: "3.1.0",
    paths: {
      "/api/credits": {
        get: {
          operationId: "getCreditWallet",
          description:
            "Verified owner only. Integer availableMinor, frozenMinor and spentMinor; 100 minor units = 1 credit.",
          responses: responses(),
        },
      },
      "/api/credits/ledger": {
        get: {
          operationId: "getCreditLedger",
          description:
            "Append-only owner ledger, newest first. Optional cursor; response items and nextCursor.",
          responses: responses(),
        },
      },
      "/api/credits/pricing": {
        get: {
          operationId: "getCreditPrices",
          description:
            "Versioned trial prices and enabled flag; does not enable provider models.",
          responses: responses(),
        },
      },
      "/api/credits/quote": {
        post: {
          operationId: "quoteCredits",
          description:
            "POST items (operation, provider, model, resolution, count), or action image/recreate/commerce and input. Returns version, totalMinor and priced items. Submission must include billing {version,totalMinor} plus stable requestId; server independently reconstructs prices.",
          responses: responses(),
        },
      },
      "/api/creative-text/optimize": {
        post: { operationId: "optimizeCreativeText", responses: responses() },
      },
      "/api/chat": {
        post: { operationId: "streamChat", responses: responses("200", sse) },
      },
      "/api/generations/{id}/asset-url": {
        get: {
          operationId: "signGenerationAsset",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { format: "uuid", type: "string" },
            },
          ],
          responses: responses(),
        },
      },
      "/api/health/providers": {
        get: { operationId: "getProviderHealth", responses: responses() },
      },
      "/api/image": {
        post: { operationId: "submitImage", responses: responses("202") },
      },
      "/api/image/recreate": {
        post: { operationId: "recreateImage", responses: responses("202") },
      },
      "/api/image/{id}": {
        get: {
          operationId: "getImageBatch",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { format: "uuid", type: "string" },
            },
          ],
          responses: responses(),
        },
      },
      "/api/quotas": {
        get: { operationId: "getQuota", responses: responses() },
      },
      '/api/sessions': {
        get: { operationId: 'listSessions', responses: responses() },
        post: { operationId: 'createSession', responses: responses('201') },
      },
      '/api/sessions/{id}': {
        delete: { operationId: 'deleteSession', responses: responses('202') },
        patch: { operationId: 'renameSession', responses: responses() },
      },
      "/api/sessions/{id}/timeline": {
        get: { operationId: "getTimeline", responses: responses() },
      },
      "/api/skills": {
        get: { operationId: "listSkills", responses: responses() },
      },
      "/api/uploads": {
        post: { operationId: "uploadReference", responses: responses("201") },
      },
    },
    security: [{ anonymousSession: [] }],
    servers: [{ url: "/" }],
  } as const;
}
