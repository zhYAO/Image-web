import { referenceUploadResponseSchema } from '@zimage/domain';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ApiRouteError } from '@/server/api-error';
import { validateReferenceUpload } from '@/server/assets/reference-upload-service';
import {
  createPreviewUsageGuard,
  PreviewUsageRetentionError,
  withPreviewUsageReservation,
} from '@/server/preview/preview-usage-guard';
import { assertTrustedOrigin, executeRoute, requireVerifiedUserId } from '@/server/route-context';

export const runtime = 'nodejs';

function temporaryFailure(message: string) {
  return new ApiRouteError({ code: 'network', message, retryable: true, status: 503 });
}

export async function POST(request: Request) {
  return executeRoute(async (correlationId) => {
    assertTrustedOrigin(request);
    const userClient = await createSupabaseServerClient();
    const userId = await requireVerifiedUserId(userClient);
    const formData = await request.formData();
    const file = formData.get('file');
    const sessionId = z.uuid().parse(formData.get('sessionId'));
    if (!(file instanceof File)) {
      throw new ApiRouteError({
        code: 'bad_request',
        details: { field: 'file' },
        message: '请选择一张参考图。',
        retryable: false,
        status: 400,
      });
    }

    const ownership = await userClient
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (ownership.error) throw temporaryFailure('暂时无法验证会话，请稍后重试。');
    if (!ownership.data) {
      throw new ApiRouteError({
        code: 'not_found',
        message: '会话不存在或无权访问。',
        retryable: false,
        status: 404,
      });
    }

    const existing = await userClient
      .from('reference_uploads')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .eq('status', 'active');
    if (existing.error) throw temporaryFailure('暂时无法验证参考图数量，请稍后重试。');
    if ((existing.count ?? 0) >= 4) {
      throw new ApiRouteError({
        code: 'bad_request',
        details: { field: 'file' },
        message: '每个会话最多保留 4 张有效参考图。',
        retryable: false,
        status: 400,
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const metadata = await validateReferenceUpload({
      bytes,
      mimeType: file.type,
      name: file.name,
      size: file.size,
    });
    const uploadId = crypto.randomUUID();
    const storagePath = `${userId}/${sessionId}/references/${uploadId}/reference.${metadata.extension}`;
    const admin = createSupabaseAdminClient();
    return withPreviewUsageReservation(createPreviewUsageGuard(admin), {
      bytes: file.size,
      businessKey: `upload:${correlationId}`,
      correlationId,
      createsSession: false,
      operation: 'upload',
      userId,
    }, async () => {
      const persisted = await admin
        .from('reference_uploads')
        .insert({
          height: metadata.height,
          id: uploadId,
          mime_type: file.type,
          original_filename: file.name,
          session_id: sessionId,
          size_bytes: file.size,
          storage_path: storagePath,
          user_id: userId,
          width: metadata.width,
        })
        .select('id,original_filename,mime_type,size_bytes,width,height,upload_expires_at')
        .single();
      if (persisted.error || !persisted.data) {
        throw temporaryFailure('参考图元数据保存失败，请稍后重试。');
      }

      const uploaded = await admin.storage.from('uploads').upload(storagePath, bytes, {
        cacheControl: '3600',
        contentType: file.type,
        upsert: false,
      });
      if (uploaded.error) {
        const failure = temporaryFailure('参考图上传失败，请稍后重试。');
        const removedObject = await admin.storage.from('uploads').remove([storagePath]);
        const removedMetadata = await admin
          .from('reference_uploads')
          .delete()
          .eq('id', uploadId)
          .eq('user_id', userId);
        if (removedObject.error || removedMetadata.error) throw new PreviewUsageRetentionError(failure);
        throw failure;
      }

      return NextResponse.json(referenceUploadResponseSchema.parse({
        expiresAt: persisted.data.upload_expires_at,
        height: persisted.data.height,
        id: persisted.data.id,
        mimeType: persisted.data.mime_type,
        name: persisted.data.original_filename,
        size: persisted.data.size_bytes,
        width: persisted.data.width,
      }), { status: 201 });
    });
  });
}
