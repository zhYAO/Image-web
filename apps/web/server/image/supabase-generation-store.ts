import { creditsEnabled, creditCall } from "@/server/credits/credit-service";
import type { CreditConfirmation } from "@zimage/domain";
import { IMAGE_MODEL_UPGRADE_MESSAGE } from "@zimage/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ApiRouteError } from "@/server/api-error";

import type { GenerationSubmissionStore, GenerationSubmissionSnapshot } from "./image-service";

const submissionResultSchema = z.object({
  batchId: z.uuid(),
  deduplicated: z.boolean(),
  sessionId: z.uuid(),
  status: z.literal('pending'),
});

function submissionFailure(error: { code?: string; message?: string } | null) {
  const diagnostic = `${error?.code ?? ""} ${error?.message ?? ""}`;
  if (/seedream_upgrade_required|image_model_upgrade_required|image_model_unavailable/.test(diagnostic))
    return new ApiRouteError({ code: 'bad_request', status: 400, message: IMAGE_MODEL_UPGRADE_MESSAGE, retryable: false });
  if (diagnostic.includes('quota_exceeded')) {
    return new ApiRouteError({
      code: 'quota_exceeded',
      message: '今日 30 张图片额度已用完，请在额度重置后继续。',
      retryable: false,
      status: 429,
    });
  }
  if (diagnostic.includes('provider_unavailable')) {
    return new ApiRouteError({
      code: 'provider_error',
      message: '所选图片服务暂时不可用，请选择其他 provider。',
      retryable: true,
      status: 503,
    });
  }
  if (diagnostic.includes('idempotency_conflict')) {
    return new ApiRouteError({
      code: 'conflict',
      message: '相同幂等键已用于另一份请求，请重新提交。',
      retryable: false,
      status: 409,
    });
  }
  if (diagnostic.includes('reference_expired_or_forbidden')) {
    return new ApiRouteError({
      code: 'asset_expired',
      message: '参考图已过期或不可访问，请重新上传。',
      retryable: false,
      status: 410,
    });
  }
  if (diagnostic.includes('session_not_found')) {
    return new ApiRouteError({
      code: 'not_found',
      message: '会话不存在或无权访问。',
      retryable: false,
      status: 404,
    });
  }
  if (diagnostic.includes('batch_not_found')) {
    return new ApiRouteError({
      code: 'not_found',
      message: '原批次不存在或无权访问。',
      retryable: false,
      status: 404,
    });
  }
  if (
    diagnostic.includes('generation_id_')
    || diagnostic.includes('invalid_recreate_mode')
    || diagnostic.includes('no_generations_to_recreate')
  ) {
    return new ApiRouteError({
      code: 'bad_request',
      message: '当前批次没有符合条件的可重生成图片。',
      retryable: false,
      status: 400,
    });
  }
  return new ApiRouteError({
    code: 'network',
    message: '生图任务暂时无法入队，请稍后重试。',
    retryable: true,
    status: 503,
  });
}

export class SupabaseGenerationStore implements GenerationSubmissionStore {
  constructor(private readonly adminClient: SupabaseClient) {}

  async lookupSubmission(input: { userId: string; idempotencyKey: string }): Promise<GenerationSubmissionSnapshot | null> {
    const { data, error } = await this.adminClient.from('generation_batches')
      .select('id,session_id,config,model,provider,request_hash,skill_id,skill_version,source')
      .eq('user_id', input.userId).eq('idempotency_key', input.idempotencyKey).maybeSingle();
    if (error) throw submissionFailure(error);
    if (!data) return null;
    const owner = await this.adminClient.from('sessions').select('id')
      .eq('id', data.session_id).eq('user_id', input.userId).eq('status', 'active').maybeSingle();
    if (owner.error) throw submissionFailure(owner.error);
    if (!owner.data) throw new ApiRouteError({ code: 'not_found', status: 404, message: '会话不存在或无权访问。', retryable: false });
    const row = z.object({ id: z.uuid(), session_id: z.uuid(), config: z.object({ registryVersion: z.string().optional() }),
      model: z.string().min(1), provider: z.string().min(1), request_hash: z.string().min(1),
      skill_id: z.string().nullable(), skill_version: z.string().nullable(), source: z.enum(['direct', 'chat_tool']) }).parse(data);
    return { batchId: row.id, sessionId: row.session_id, config: row.config, model: row.model, provider: row.provider,
      requestHash: row.request_hash, skillId: row.skill_id ?? undefined, skillVersion: row.skill_version ?? undefined, source: row.source };
  }

  async submit(input: Parameters<GenerationSubmissionStore["submit"]>[0]) {
    if (creditsEnabled())
      return submissionResultSchema.parse(
        await creditCall(this.adminClient, input.userId, "image", {
          ...input,
          requestId: input.idempotencyKey,
        }),
      );
    const { data, error } = await this.adminClient.rpc(
      "submit_image_generation",
      {
      p_config: input.config,
      p_correlation_id: input.correlationId,
      p_idempotency_key: input.idempotencyKey,
      p_model: input.model,
      p_parent_batch_id: null,
      p_prompt: input.prompt,
      p_provider: input.provider,
      p_request_hash: input.requestHash,
      p_session_id: input.sessionId ?? null,
      p_skill_id: input.skillId ?? null,
      p_skill_version: input.skillVersion ?? null,
      p_source: input.source,
      p_user_id: input.userId,
    },
    );
    if (error || !data) throw submissionFailure(error);
    return submissionResultSchema.parse(data);
  }

  async recreate(input: {
    billing?: CreditConfirmation;
    batchId: string;
    correlationId: string;
    generationId?: string;
    idempotencyKey: string;
    mode: "single" | "failed" | "all";
    requestHash: string;
    userId: string;
  }) {
    if (creditsEnabled())
      return submissionResultSchema.parse(
        await creditCall(this.adminClient, input.userId, "recreate", {
          ...input,
          requestId: input.idempotencyKey,
        }),
      );
    const { data, error } = await this.adminClient.rpc(
      "recreate_image_generation",
      {
      p_batch_id: input.batchId,
      p_correlation_id: input.correlationId,
      p_generation_id: input.generationId ?? null,
      p_idempotency_key: input.idempotencyKey,
      p_mode: input.mode,
      p_request_hash: input.requestHash,
      p_user_id: input.userId,
    },
    );
    if (error || !data) throw submissionFailure(error);
    return submissionResultSchema.parse(data);
  }
}
