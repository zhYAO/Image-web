import * as domain from '@zimage/domain';
import { z } from 'zod';

type Schema = Record<string, unknown>;
type Content = Record<string, { schema?: Schema }>;
type Parameter = { in: string; name: string; required: boolean; schema: Schema; description?: string };
type ApiResponse = { description: string; content: Content; headers?: Record<string, { schema: Schema }> };
type Operation = {
  operationId: string; description: string; responses: Record<string, ApiResponse>;
  security: { anonymousSession: never[] }[]; parameters: Parameter[];
  requestBody?: { required: boolean; content: Content }; deprecated?: boolean;
  'x-auth-policy': string; 'x-cache-control': string;
  'x-sse'?: { framing: string; schema: string; events: string[]; terminalEvents: string[] };
};
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const json = (schema?: Schema): Content => ({ 'application/json': schema ? { schema } : {} });
const binary = (...types: string[]): Content => Object.fromEntries(types.map(type => [type, { schema: { type: 'string', format: 'binary' } }]));
const union = (...names: string[]): Schema => ({ anyOf: names.map(ref) });
const array = (name: string): Schema => ({ type: 'array', items: ref(name) });
const query = (name: string, schema: Schema = { type: 'string' }, required = false): Parameter => ({ in: 'query', name, required, schema });
const idempotency: Parameter = { in: 'header', name: 'idempotency-key', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Reuse this UUID for the same logical request. Different payload under the same UUID conflicts.' };
const billing = 'Integer Minor amounts (100 minor units = 1 credit); billing {version,totalMinor} confirms prices independently reconstructed by the server. Keep the stable request identity on retry. An unknown result requires reconciliation; never automatically refund, resubmit or purchase again.';
type ErrorStatus = 400 | 401 | 402 | 403 | 404 | 408 | 409 | 410 | 413 | 429 | 500 | 503;
const errorDescriptions: Record<ErrorStatus, string> = {
  '400': 'Invalid input, CAPTCHA or model selection.',
  '401': 'Missing, invalid or revoked identity/session; not a dependency outage.',
  '402': 'Insufficient credits; admission rejected.',
  '403': 'Missing or untrusted Origin for a state-changing request.',
  '404': 'Resource absent, inactive or not owned; local mocks are hidden outside their local boundary.',
  '408': 'Upload ingestion deadline exceeded; retain the original file before retrying.',
  '409': 'Request/revision conflict, price_changed or billing_pending; unknown results require reconciliation.',
  '410': 'Asset expired or unavailable.', '413': 'Multipart payload too large.',
  '429': 'Rate limit, independent preview quota or daily image quota exceeded.',
  '500': 'Unexpected failure normalized to the safe API error envelope.',
  '503': 'Identity, configuration, database, storage, provider or credit service unavailable; not evidence of logout.',
};
function operation(operationId: string, description: string, options: {
  auth?: string; cache?: string; success?: string; content?: Content; errors?: readonly ErrorStatus[];
  body?: Schema; bodyContent?: Content; parameters?: Parameter[];
} = {}): Operation {
  const auth = options.auth ?? 'verified-user-and-route-specific-ownership';
  const cache = options.cache ?? 'not-set-by-handler';
  return {
    operationId, description, security: auth === 'verified-user-and-route-specific-ownership' ? [{ anonymousSession: [] }] : [],
    parameters: options.parameters ?? [], 'x-auth-policy': auth, 'x-cache-control': cache,
    ...(options.body || options.bodyContent ? { requestBody: { required: true, content: options.bodyContent ?? json(options.body) } } : {}),
    responses: {
      [options.success ?? '200']: { description: 'Success', content: options.content ?? json(),
        ...(cache === 'not-set-by-handler' ? {} : { headers: { 'Cache-Control': { schema: { type: 'string', const: cache } } } }),
      },
      ...Object.fromEntries((options.errors ?? [400, 401, 500, 503] as const).map(status => [String(status), { description: errorDescriptions[status], content: json(ref('ApiError')) }])),
    },
  };
}
function retired(operationId: string): Operation {
  return { operationId, description: 'Retired batch write. Always 410 before authentication, database access, claiming or submission. Authenticated history reads remain available.', deprecated: true, security: [], parameters: [], 'x-auth-policy': 'retired-before-auth', 'x-cache-control': 'no-store', responses: {
    '410': { description: 'Batch creation/advancement is disabled.', content: json(ref('Gone')), headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } } },
  } };
}
function schemas(): Record<string, Schema> {
  const contracts: Record<string, z.ZodType> = {
    ApiError: domain.apiErrorSchema, Account: domain.accountSchema, AccountPatch: domain.accountPatchSchema,
    Credentials: domain.credentialsSchema, Registration: domain.registrationSchema, EmailAuth: domain.emailAuthSchema, Otp: domain.otpSchema,
    ChatRequest: domain.chatRequestSchema, ChatEvent: domain.chatEventSchema,
    ImageRequest: domain.imageRequestSchema, RecreateImageRequest: domain.recreateImageRequestSchema,
    ImageSubmission: domain.imageSubmissionResponseSchema, ImageBatch: domain.generationBatchResponseSchema,
    GenerationAssetUrl: domain.generationAssetUrlResponseSchema, ReferenceUpload: domain.referenceUploadResponseSchema,
    CreateSession: domain.createSessionRequestSchema, RenameSession: domain.renameSessionRequestSchema,
    Session: domain.sessionResponseSchema, Sessions: domain.listSessionsResponseSchema, DeleteSession: domain.deleteSessionResponseSchema, Timeline: domain.timelineResponseSchema,
    Skills: domain.skillsResponseSchema, ProviderStatus: domain.providerStatusResponseSchema, Quota: domain.quotaSchema,
    CreditWallet: domain.creditWalletSchema, CreditLedger: domain.creditLedgerSchema, CreditCatalog: domain.creditCatalogSchema, CreditQuote: domain.creditQuoteSchema, CreditConfirmation: domain.creditConfirmationSchema,
    CreditQuoteRequest: z.union([z.strictObject({ items: z.array(domain.creditItemSchema).min(1).max(8) }), z.strictObject({ action: z.enum(['image', 'recreate', 'commerce']), input: z.record(z.string(), z.unknown()) })]),
    OptimizeRequest: domain.creativeTextOptimizeRequestSchema, OptimizeResult: domain.creativeTextOptimizeResponseSchema,
    PackageRequest:domain.packageRequestSchema,PackageOrder:domain.packageOrderViewSchema,PackageQuote:domain.packageQuoteResponseSchema,PackageAvailability:z.object({enabled:z.boolean()}),PackageOrders:z.object({orders:z.array(z.object({id:z.uuid()})).max(100)}),
    CommerceTask: domain.commerceTaskSchema, ApparelTask: domain.apparelTaskSchema,
    CommerceCreate: domain.commerceCreateSchema, ApparelCreate: domain.apparelCreateSchema,
    CommerceSave: domain.commerceSaveSchema, ApparelSave: domain.apparelSaveSchema,
    CommerceSubmit: domain.commerceSubmitSchema, ApparelSubmit: domain.apparelSubmitSchema,
    CommerceSelect: domain.commerceSelectSchema, ApparelSelect: domain.apparelSelectSchema,
    CommerceExport: domain.commerceExportSchema, ApparelExport: domain.apparelExportSchema,
    CommerceExportResult: domain.commerceExportResultSchema, ApparelExportResult: domain.apparelExportResultSchema,
    CommerceArchive: domain.commerceArchiveSchema, CommerceCancel: domain.commerceCancelSchema,
    CommercePromote: domain.commercePromoteSchema, CommercePromoteResult: domain.commercePromoteResultSchema,
    CreativeBatch: domain.creativeBatchSchema,
    CommerceDownload: domain.commerceExportSchema.extend({ mode: z.enum(['single', 'zip', 'long']), format: z.enum(['jpg', 'png']), focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(), safeExport: z.literal('ec03-white-8').optional() }),
    DeleteAccount: domain.credentialsSchema.pick({ password: true }).extend({ confirmation: z.literal('DELETE') }),
    PasswordRequest: z.object({ password: z.string(), recovery: z.boolean().default(false) }), RecoveryVerify: domain.otpSchema.extend({ password: z.string() }),
    Accepted: z.object({ accepted: z.literal(true) }),
    PasswordResult: z.union([z.object({ updated: z.literal(false), reason: z.string().optional() }), z.object({ updated: z.literal(true), reauthenticationRequired: z.boolean() })]),
    Gone: z.object({ code: z.literal('gone'), message: z.string() }), VerifiedSession: z.object({ id: z.uuid() }),
    SignedReference: z.object({ url: z.string(), expiresAt: z.iso.datetime() }), UploadCount: z.object({ count: z.number().int().min(0), limit: z.literal(64) }),
  };
  // Input projection represents apparel's pre-transform shape too. Runtime
  // refinements/normalization, ownership and engine dispatch remain authoritative.
  const result: Record<string, Schema> = Object.fromEntries(Object.entries(contracts).map(([name, schema]) => {
    const { $schema: dialect, ...shape } = z.toJSONSchema(schema, { io: 'input' });
    void dialect;
    return [name, shape];
  }));
  // These runtime schemas use preprocess. Preserve their exact wire allowlists
  // explicitly instead of turning an unsupported conversion into an empty schema.
  const publicValue = (maxLength: number) => ({ anyOf: [{ type: 'string', minLength: 1, maxLength, description: 'Trimmed nonblank string, no control characters; runtime refinement applies.' }, { type: 'null' }] });
  result.PublicConfig = {
    type: 'object', additionalProperties: false,
    required: ['schemaVersion', 'formalAuth', 'dataMode', 'captchaSiteKey', 'approvedLegalVersion', 'registrationEnabled'],
    properties: { schemaVersion: { type: 'integer', const: 1 }, formalAuth: { type: 'boolean' }, dataMode: { type: 'string', const: 'http' }, captchaSiteKey: publicValue(2048), approvedLegalVersion: publicValue(80), registrationEnabled: { type: 'boolean' } },
    allOf: [{ if: { properties: { registrationEnabled: { const: true } }, required: ['registrationEnabled'] }, then: { properties: { formalAuth: { const: true }, captchaSiteKey: { type: 'string' }, approvedLegalVersion: { type: 'string' } } } }],
    'x-domain-schema': 'publicConfigSchema',
  };
  result.ApiMeta = { type: 'object', additionalProperties: false, required: ['schemaVersion', 'backendRelease', 'api', 'capabilities'], properties: {
    schemaVersion: { type: 'integer', const: 1 }, backendRelease: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' },
    api: { type: 'object', additionalProperties: false, required: ['major', 'minor'], properties: { major: { type: 'integer', const: 1 }, minor: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } } },
    capabilities: { type: 'array', maxItems: 256, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$' } },
  }, 'x-domain-schema': 'apiMetaSchema' };
  return result;
}
export function buildOpenApiDocument() {
  const readErrors = [400, 401, 404, 500, 503] as const;
  const writeErrors = [400, 401, 403, 404, 409, 410, 429, 500, 503] as const;
  const paidErrors = [400, 401, 402, 403, 404, 409, 410, 429, 500, 503] as const;
  const paths: Record<string, Record<string, Operation>> = {
    '/api/account': {
      get: operation('getAccount', 'Current verified owner profile and email.', { content: json(ref('Account')) }),
      patch: operation('updateAccount', 'Update display name and return the verified account.', { body: ref('AccountPatch'), content: json(ref('Account')), errors: [400, 401, 403, 500, 503] }),
      delete: operation('requestAccountDeletion', 'Reauthenticate password and confirmation DELETE. HTTP 200 may contain accepted:false. Accepted asynchronous deletion signs out locally.', { body: ref('DeleteAccount'), content: json({ type: 'object', required: ['accepted'], properties: { accepted: { type: 'boolean' }, status: { const: 'deleting' } } }), errors: [400, 401, 403, 500, 503] }),
    },
    '/api/auth/session': { get: operation('getVerifiedSession', 'Verified owner ID only; no profile or email. A 503 is not evidence of logout.', { cache: 'private, no-store', content: json(ref('VerifiedSession')), errors: [401, 500, 503] }) },
    '/api/health/ready': { get: operation('getReleaseHealth', 'Public liveness/build version only, not database, authentication, queue or provider readiness.', { auth: 'public', cache: 'no-store', errors: [], content: json({ type: 'object', required: ['status', 'version'], properties: { status: { const: 'ok' }, version: { type: 'string' } } }) }) },
    '/api/public-config': { get: operation('getPublicConfig', 'Runtime HTTP allowlist. Registration requires formalAuth, approved legal version and CAPTCHA site key; backend registration remains authoritative. Mock/invalid configuration returns 503.', { auth: 'public', cache: 'no-store', content: json(ref('PublicConfig')), errors: [503] }) },
    '/api/meta': { get: operation('getApiMeta', 'Backend release, API major/minor and implemented capabilities, not dependency health or permission to charge. Missing/invalid release identity returns 503. Deployment checks must also verify the exact backend combination.', { auth: 'public', cache: 'no-store', content: json(ref('ApiMeta')), errors: [503] }) },
    '/api/credits': { get: operation('getCreditWallet', 'Owner availableMinor, frozenMinor and spentMinor; 100 minor units = 1 credit.', { cache: 'no-store', content: json(ref('CreditWallet')) }) },
    '/api/credits/ledger': { get: operation('getCreditLedger', 'Append-only owner ledger newest first; items and nextCursor.', { cache: 'no-store', content: json(ref('CreditLedger')), parameters: [query('cursor', { type: 'string', pattern: '^\\d{1,18}$' })] }) },
    '/api/credits/pricing': { get: operation('getCreditPrices', 'Versioned trial prices and enabled flag; does not enable provider models.', { cache: 'no-store', content: json(ref('CreditCatalog')) }) },
    '/api/credits/quote': { post: operation('quoteCredits', `POST priced items or action image/recreate/commerce and input; returns version, totalMinor and priced items. ${billing}`, { cache: 'no-store', body: ref('CreditQuoteRequest'), content: json(ref('CreditQuote')), errors: paidErrors }) },
    '/api/chat': { post: operation('streamChat', `SSE data frames contain chatEventSchema JSON. Before headers failures use HTTP errors; afterward stream.failed. Disconnect aborts upstream but cannot prove zero cost. Credit mode requires a stable requestId for replay/recovery. ${billing}`, { cache: 'no-cache, no-transform', body: ref('ChatRequest'), content: { 'text/event-stream': { schema: { type: 'string', description: 'data: <chatEventSchema JSON> followed by two newlines' } } }, errors: paidErrors }) },
    '/api/creative-text/optimize': { post: operation('optimizeCreativeText', `Optimize a field with field-specific limits. Credit mode requires a stable requestId. ${billing}`, { cache: 'no-store', body: ref('OptimizeRequest'), content: json(ref('OptimizeResult')), errors: paidErrors }) },
    '/api/image': { post: operation('submitImage', `Direct generation admission; skillId requires saved Skill confirmation and returns 409 here. Recover matching idempotency-key before new admission. ${billing}`, { success: '202', parameters: [idempotency], body: ref('ImageRequest'), content: json(ref('ImageSubmission')), errors: paidErrors }) },
    '/api/image/recreate': { post: operation('recreateImage', `Recreate single/failed/all; generationId is required only for single mode. ${billing}`, { success: '202', parameters: [idempotency], body: ref('RecreateImageRequest'), content: json(ref('ImageSubmission')), errors: paidErrors }) },
    '/api/image/{id}': { get: operation('getImageBatch', 'Owner generation batch in an active business session.', { content: json(ref('ImageBatch')), errors: readErrors }) },
    '/api/generations/{id}/asset-url': { get: operation('signGenerationAsset', 'Owner/active-session checks before signing a private asset for 60 seconds; expiry is 410. Handler does not explicitly set Cache-Control.', { content: json(ref('GenerationAssetUrl')), errors: [400, 401, 404, 410, 500, 503] }) },
    '/api/references/{id}/asset-url': { get: operation('signReferenceAsset', 'Owner/active-session reference lookup; active unexpired upload signed for one hour.', { cache: 'no-store', content: json(ref('SignedReference')), errors: [400, 401, 404, 410, 500, 503] }) },
    '/api/commerce-packages':{
      get:operation('getCommercePackage','Read availability or recover the original owned order. Existing recovery remains available when new paid calls are disabled.',{cache:'private, no-store',content:json(union('PackageAvailability','PackageOrder','PackageOrders')),parameters:[query('active',{type:'string',enum:['1']}),query('orderId',{type:'string',format:'uuid'}),query('quoteId',{type:'string',format:'uuid'})],errors:[400,401,404,409,500,503]}),
      post:operation('manageCommercePackage','Confirm a frozen maximum, analyze, review facts, plan and submit one whole A+ package. Settle only verified actual usage; missing evidence or cap overruns require review. Cancellation before image submission refunds all. Cost configuration and both feature switches start disabled.',{cache:'private, no-store',body:ref('PackageRequest'),content:json(union('PackageQuote','PackageOrder')),errors:[400,401,402,403,404,409,410,413,429,500,503]}),
    },
    '/api/commerce-analysis': { post: operation('analyzeCommerceImages', 'Verified-user analysis admission is closed pending approved metered pricing and durable recovery. Always returns service_not_ready; never uploads, reserves credit or calls a provider.', { success: '503', errors: [401, 403, 503] }) },
    '/api/health/providers': { get: operation('getProviderHealth', 'Verified user only. Stored provider health and registry capabilities; this read does not call providers.', { content: json(ref('ProviderStatus')), errors: [401, 500, 503] }) },
    '/api/quotas': { get: operation('getQuota', 'Verified owner independent daily image quota.', { content: json(ref('Quota')), errors: [401, 500, 503] }) },
    '/api/sessions': {
      get: operation('listSessions', 'List authenticated owner sessions.', { content: json(ref('Sessions')), errors: [401, 500, 503] }),
      post: operation('createSession', 'Create one session; optional requestId is the preview reservation business identity.', { success: '201', body: ref('CreateSession'), content: json(ref('Session')), errors: writeErrors }),
    },
    '/api/sessions/{id}': {
      delete: operation('deleteSession', 'Mark an owned session deleting; accepted deletion is asynchronous.', { success: '202', content: json(ref('DeleteSession')), errors: writeErrors }),
      patch: operation('renameSession', 'Rename an owned active session.', { body: ref('RenameSession'), content: json(ref('Session')), errors: writeErrors }),
    },
    '/api/sessions/{id}/timeline': { get: operation('getTimeline', 'Owned session timeline with cursor and optional task state.', { content: json(ref('Timeline')), parameters: [query('after', { type: 'integer', minimum: 1 }), query('limit', { type: 'integer', minimum: 1, maximum: 100, default: 50 })], errors: readErrors }) },
    '/api/skills': { get: operation('listSkills', 'Public registry metadata; no provider calls.', { auth: 'public', content: json(ref('Skills')), errors: [500] }) },
    '/api/creative-templates': { get: operation('listCreativeTemplates', 'Public scenes and template metadata (id/name/version/source/validation/published). Nested metadata shape is not fully modeled.', { auth: 'public', errors: [] }) },
    '/api/openapi.json': { get: operation('getOpenApiDocument', 'This structural API document. Inventory and local fixtures do not constitute HTTP/Proxy acceptance.', { auth: 'public', cache: 'public, max-age=300', errors: [] }) },
    '/api/uploads': {
      get: operation('countReferenceUploads', 'Count owner active/pending references in an active session; server limit 64 (composer selection limit remains 4).', { cache: 'private, no-store', content: json(ref('UploadCount')), parameters: [query('sessionId', { type: 'string', format: 'uuid' }, true)], errors: readErrors }),
      post: operation('uploadReference', 'Multipart file and sessionId. PNG/JPEG/WebP <=10 MiB; invalid file validation remains HTTP 400. Total multipart ingestion is bounded to 10 MiB + 256 KiB and 30 seconds, with two admitted uploads per process through Storage finalization. Validate identity and active-session ownership before private Storage write; existing durable intents and compensation remain.', {
        success: '201', content: json(ref('ReferenceUpload')), errors: [...writeErrors, 408, 413],
        bodyContent: { 'multipart/form-data': { schema: {
          type: 'object', required: ['file', 'sessionId'],
          properties: { file: { type: 'string', format: 'binary' }, sessionId: { type: 'string', format: 'uuid' } },
        } } },
      }),
    },
    '/api/commerce/import-url': { post: operation('importPublicProductImage', 'Import public HTTPS image bytes with server-side SSRF, redirect, DNS/address, type and size checks; no provider generation.', { cache: 'private, no-store', body: { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri', maxLength: 2048 } } }, content: binary('image/png', 'image/jpeg', 'image/webp'), errors: [400, 401, 403, 500, 503] }) },
    '/api/creative-batches': { post: retired('createRetiredCreativeBatch'), get: operation('listCreativeBatchHistory', 'Read owner history by sessionId; does not resume or submit pending items.', { cache: 'no-store', parameters: [query('sessionId', { type: 'string', format: 'uuid' }, true)], content: json(array('CreativeBatch')), errors: readErrors }) },
    '/api/creative-batches/{id}': { get: operation('getCreativeBatchHistory', 'Read owned historical batch; launch remains retired.', { cache: 'no-store', content: json(ref('CreativeBatch')), errors: readErrors }), post: retired('advanceRetiredCreativeBatch') },
    '/api/creative-batches/{id}/progress': { get: operation('getCreativeBatchProgress', 'Read owned historical progress including terminal state; shape is not fully modeled. Does not advance work.', { cache: 'no-store', errors: readErrors }) },
    '/api/creative-batches/{id}/download': { post: operation('downloadCreativeBatch', 'Owner history ZIP validates current tasks/assets and includes a report for partial/empty results. Does not restart generation.', { cache: 'private, no-store', content: binary('application/zip'), errors: writeErrors }) },
    '/api/internal/creative-batch-worker': { post: retired('runRetiredCreativeBatchWorker') },
    '/api/creative-tasks': {
      get: operation('listCreativeTasks', 'List owned tasks by sessionId; engine=apparel-catalog chooses the existing apparel handler.', { cache: 'no-store', parameters: [query('sessionId', { type: 'string', format: 'uuid' }, true)], content: json({ anyOf: [array('CommerceTask'), array('ApparelTask')] }), errors: readErrors }),
      post: operation('createCreativeTask', 'Save a commerce/apparel plan; engine selected by query or plan.engine. Returns 200, not generation admission.', { cache: 'no-store', body: union('CommerceCreate', 'ApparelCreate'), content: json(union('CommerceTask', 'ApparelTask')), errors: writeErrors }),
    },
    '/api/creative-tasks/{id}': {
      get: operation('getCreativeTask', 'Read owned commerce/apparel task with existing engine dispatch.', { cache: 'no-store', content: json(union('CommerceTask', 'ApparelTask')), errors: readErrors }),
      patch: operation('saveCreativeTask', 'Save owned plan with revision checks.', { cache: 'no-store', body: union('CommerceSave', 'ApparelSave'), content: json(union('CommerceTask', 'ApparelTask')), errors: writeErrors }),
    },
    '/api/creative-tasks/{id}/select': { post: operation('selectCreativeTaskAsset', 'Select existing generation/run with revision checks.', { cache: 'no-store', body: union('CommerceSelect', 'ApparelSelect'), content: json(union('CommerceTask', 'ApparelTask')), errors: writeErrors }) },
    '/api/creative-tasks/{id}/export': { post: operation('exportCreativeTask', 'Validate owner selection and return export metadata, not bytes.', { cache: 'no-store', body: union('CommerceExport', 'ApparelExport'), content: json(union('CommerceExportResult', 'ApparelExportResult')), errors: writeErrors }) },
    '/api/creative-tasks/{id}/archive': { post: operation('archiveCreativeTask', 'Archive commerce task; apparel engine rejects this operation with 400.', { cache: 'no-store', body: ref('CommerceArchive'), content: json(ref('CommerceTask')), errors: writeErrors }) },
    '/api/creative-tasks/{id}/cancel': { post: operation('cancelCreativeTask', 'Cancel supported commerce work without assuming unknown outcomes refundable. Apparel rejects this operation with 400.', { cache: 'no-store', body: ref('CommerceCancel'), content: json(ref('CommerceTask')), errors: writeErrors }) },
    '/api/creative-tasks/{id}/promote': { post: operation('promoteCreativeTaskReference', 'Promote an owned result into a reference with durable intent/compensation checks.', { body: ref('CommercePromote'), content: json(ref('CommercePromoteResult')), errors: writeErrors }) },
    '/api/creative-tasks/{id}/assets/{assetId}': { get: operation('readApparelTaskAsset', 'Owner-checked apparel JPEG bytes with nosniff.', { cache: 'private, no-store', content: binary('image/jpeg'), errors: [400, 401, 404, 410, 500, 503] }) },
    '/api/creative-tasks/{id}/download': { post: operation('downloadCreativeTask', 'Owner single/zip/long JPG/PNG or apparel ZIP. safeExport ec03-white-8 requires one current selection, single PNG, valid revision and eligible detail template; apparel rejects safeExport. Live selection checks remain authoritative.', { cache: 'private, no-store', body: union('CommerceDownload', 'ApparelExport'), content: binary('application/zip', 'image/jpeg', 'image/png'), errors: writeErrors }) },
  };
  const submit = operation('submitCreativeTask', `Submit saved task with stable body requestId and revision. Commerce admission returns 202; apparel rendering returns 200. Existing submission gates remain authoritative. ${billing}`, { cache: 'no-store', success: '202', body: union('CommerceSubmit', 'ApparelSubmit'), content: json(ref('CommerceTask')), errors: paidErrors });
  submit.responses['200'] = { description: 'Apparel rendering result', content: json(ref('ApparelTask')), headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } } };
  paths['/api/creative-tasks/{id}/submit'] = { post: submit };
  for (const [path, id, download] of [
    ['/api/creative-tasks/mock-apparel-render', 'renderLocalMockApparel', false],
    ['/api/creative-tasks/mock-apparel-render/download', 'downloadLocalMockApparel', true],
  ] as const) paths[path] = { post: operation(id, 'Explicit local demo only: mock data mode, opt-in ZIMAGE_LOCAL_MOCK_RENDER_ENABLED=true, loopback hostname, no Vercel/deployed environment, trusted Origin. Otherwise 404; never a production fallback. Multipart plan/source assets or finished JPEG images; renderer/filename/size validation remains authoritative. Multipart/result shape is not fully modeled.', {
    auth: 'local-mock-only', cache: download ? 'private, no-store' : 'no-store', bodyContent: { 'multipart/form-data': {} }, content: download ? binary('application/zip') : json(), errors: download ? [400, 403, 404, 500] : [400, 403, 404, 413, 500],
  }) };
  for (const [path, methods] of Object.entries(paths)) for (const method of Object.values(methods)) {
    for (const match of path.matchAll(/\{([^}]+)\}/g)) {
      const name = match[1];
      if (name) method.parameters.push({ in: 'path', name, required: true, schema: method.deprecated ? { type: 'string' } : { type: 'string', format: 'uuid' }, description: 'Validated by the route/domain helper; API ownership checks remain mandatory.' });
    }
    if (path.startsWith('/api/creative-tasks') && !path.includes('mock-apparel') && !path.includes('/assets/') && !path.endsWith('/promote')) method.parameters.push(query('engine', { type: 'string', enum: ['apparel-catalog'] }));
  }
  for (const [path, id, body, content, errors] of [
    ['login', 'loginAccount', 'Credentials', json({ type: 'object', required: ['authenticated'], properties: { authenticated: { const: true } } }), [400, 401, 403, 429, 500, 503]],
    ['register', 'registerAccount', 'Registration', json(ref('Accepted')), [400, 403, 429, 500, 503]],
    ['resend', 'resendSignupOtp', 'EmailAuth', json(ref('Accepted')), [400, 403, 429, 500, 503]],
    ['recovery', 'requestPasswordRecovery', 'EmailAuth', json(ref('Accepted')), [400, 403, 429, 500, 503]],
    ['verify', 'verifySignupOtp', 'Otp', json({ type: 'object', required: ['returnTo', 'userId'], properties: { returnTo: { type: 'string' }, userId: { type: 'string' } } }), [400, 401, 403, 429, 500, 503]],
    ['recovery/verify', 'verifyPasswordRecovery', 'RecoveryVerify', json(ref('PasswordResult')), [400, 403, 429, 500, 503]],
  ] as const) paths[`/api/auth/${path}`] = { post: operation(id, 'Authentication flow requires exact trusted Origin, flow-specific CAPTCHA and server rate limiting. Register requires matching APPROVED_LEGAL_VERSION; mail requests avoid account enumeration. OTP consumed only by explicit POST, never page opening. Password result HTTP 200 may contain updated:false. Server normalizes returnTo.', { auth: 'auth-flow-specific-checks', body: ref(body), content, errors: [...errors] }) };
  paths['/api/auth/logout'] = { post: operation('logoutAccount', 'Sign out the local session with trusted Origin and JSON body.', { auth: 'auth-flow-specific-checks', body: { type: 'object' }, content: json({ type: 'object', required: ['signedOut'], properties: { signedOut: { const: true } } }), errors: [400, 401, 403, 500] }) };
  paths['/api/auth/password'] = { post: operation('updatePassword', 'Verified owner password change; policy failure returns updated:false with HTTP 200. recovery=true signs out globally; otherwise signs out other sessions.', { body: ref('PasswordRequest'), content: json(ref('PasswordResult')), errors: [400, 401, 403, 500, 503] }) };
  for (const path of ['/api/public-config', '/api/meta']) {
    const unavailable = paths[path]?.get?.responses['503'];
    if (!unavailable) throw new Error(`Missing runtime API unavailable response: ${path}`);
    unavailable.headers = { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } };
  }
  const chat = paths['/api/chat']?.post;
  if (!chat) throw new Error('Missing chat API documentation');
  chat['x-sse'] = { framing: 'data: <JSON>\n\n', schema: 'chatEventSchema', events: domain.chatEventSchema.options.map(option => option.shape.type.value), terminalEvents: ['message.completed', 'stream.failed'] };
  return {
    openapi: '3.1.0',
    info: { title: 'ZImage Web API', version: '1.0.0', description: 'Existing v1 methods plus runtime discovery. No provider secrets. Structural input-schema projections retain domain fields; custom refinements, normalization, ownership and engine dispatch remain enforced by existing handlers. Media types without schema are explicitly unmodeled, not complete DTO contracts. x-cache-control records success-handler evidence only; not-set-by-handler does not assert public caching. Implicit HEAD/OPTIONS, Proxy/Cookie refresh, ingress/CDN behavior and real provider/queue/billing readiness require separate HTTP/environment acceptance.' },
    components: { schemas: schemas(), securitySchemes: {
      // Preserve the published key for consumers; actual Supabase SSR cookies
      // may be project-specific/chunked. Cookie presence never proves ownership.
      anonymousSession: { in: 'cookie', name: 'sb-access-token', type: 'apiKey', description: 'Legacy documentation key. Existing Supabase SSR session cookies are verified via require_verified_user_id and route ownership; this historical name is illustrative, not a new token endpoint.' },
    } },
    paths, security: [{ anonymousSession: [] }], servers: [{ url: '/' }],
  };
}
