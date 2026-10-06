import { z } from "zod";
import type { UploadReference } from "./types";

export const APPAREL_LAYOUT_VERSION = "1.0.0";
const text = (max: number) => z.string().trim().min(1).max(max);
export const apparelBriefSchema = z.object({
  name: text(160),
  sku: z.string().trim().max(160),
  color: text(200),
  composition: text(1000),
  care: text(2000),
  size: text(200),
  measurements: z.object({
    length: text(80),
    chest: text(80),
    shoulder: text(80),
    sleeve: text(80),
  }),
  weightRecommendation: text(200),
  design: text(2000),
  fabric: text(2000),
});
export const apparelPlanSchema = z
  .object({
    engine: z.literal("apparel-catalog"),
    scene: z.literal("apparel-catalog"),
    layoutVersion: z.literal(APPAREL_LAYOUT_VERSION),
    brief: apparelBriefSchema,
    sources: z.object({
      mains: z.array(z.uuid()).length(5),
      displays: z
        .array(z.object({ id: z.uuid(), name: text(255) }))
        .min(1)
        .max(20),
      logo: z.uuid(),
    }),
    fabricCrop: z
      .tuple([z.number(), z.number(), z.number(), z.number()])
      .default([0.24, 0.2, 0.76, 0.57]),
  })
  .superRefine((plan, ctx) => {
    const ids = [
      ...plan.sources.mains,
      ...plan.sources.displays.map((source) => source.id),
      plan.sources.logo,
    ];
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        path: ["sources"],
        message: "每个素材只能用于一个上传位置。",
      });
    const [x1, y1, x2, y2] = plan.fabricCrop;
    if (!(0 <= x1 && x1 < x2 && x2 <= 1 && 0 <= y1 && y1 < y2 && y2 <= 1))
      ctx.addIssue({
        code: "custom",
        path: ["fabricCrop"],
        message: "面料裁切坐标须在 0–1 内，且右下角大于左上角。",
      });
  })
  .transform((plan) => ({
    ...plan,
    sources: {
      ...plan.sources,
      displays: [...plan.sources.displays].sort(
        (a, b) =>
          a.name.localeCompare(b.name, "zh-CN", { numeric: true }) ||
          a.id.localeCompare(b.id),
      ),
    },
  }));
export type ApparelPlan = z.infer<typeof apparelPlanSchema>;
export type ApparelBrief = z.infer<typeof apparelBriefSchema>;
export const apparelAssetSchema = z.object({
  kind: z.literal("layout").default("layout"),
  id: z.uuid(),
  name: text(255),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mimeType: z.literal("image/jpeg"),
  url: z.string().optional(),
  expired: z.boolean().default(false),
  expiresAt: z.string(),
});
export const apparelRunSchema = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  revision: z.number().int().positive(),
  status: z.enum(["processing", "succeeded", "failed"]),
  createdAt: z.string(),
  assets: z.array(apparelAssetSchema),
  error: z.string().optional(),
});
export const apparelTaskSchema = z.object({
  id: z.uuid(),
  sessionId: z.string().min(1),
  engine: z.literal("apparel-catalog"),
  revision: z.number().int().positive(),
  plan: apparelPlanSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  runs: z.array(apparelRunSchema),
  selectedRunId: z.uuid().optional(),
  archived: z.boolean().default(false),
});
export type ApparelTask = z.infer<typeof apparelTaskSchema>;
export type ApparelRun = z.infer<typeof apparelRunSchema>;
export const apparelCreateSchema = z.object({
  requestId: z.uuid(),
  sessionId: z.string().min(1),
  plan: apparelPlanSchema,
});
export const apparelSaveSchema = z.object({
  requestId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  plan: apparelPlanSchema,
});
export const apparelSubmitSchema = z.object({
  requestId: z.uuid(),
  revision: z.number().int().positive(),
});
export const apparelSelectSchema = apparelSubmitSchema.extend({
  runId: z.uuid(),
});
export const apparelExportSchema = apparelSelectSchema;
export const apparelExportResultSchema = z.object({
  runId: z.uuid(),
  items: z.array(apparelAssetSchema),
});

export function apparelOutputNames(plan: ApparelPlan) {
  return [
    ...Array.from({ length: 5 }, (_, index) => `主图/${index + 1}.jpg`),
    ...[
      1,
      3,
      4,
      5,
      6,
      ...plan.sources.displays.map((_, index) => index + 7),
    ].map((index) => `images/详情2_${String(index).padStart(2, "0")}.jpg`),
  ];
}
export interface ApparelGateway {
  list(sessionId: string): Promise<ApparelTask[]>;
  get(taskId: string): Promise<ApparelTask>;
  create(input: z.input<typeof apparelCreateSchema>): Promise<ApparelTask>;
  save(
    taskId: string,
    input: z.input<typeof apparelSaveSchema>,
  ): Promise<ApparelTask>;
  submit(
    taskId: string,
    input: z.infer<typeof apparelSubmitSchema>,
  ): Promise<ApparelTask>;
  select(
    taskId: string,
    input: z.infer<typeof apparelSelectSchema>,
  ): Promise<ApparelTask>;
  export(
    taskId: string,
    input: z.infer<typeof apparelExportSchema>,
  ): Promise<z.infer<typeof apparelExportResultSchema>>;
  download(
    taskId: string,
    input: z.infer<typeof apparelExportSchema>,
  ): Promise<Blob>;
  upload(sessionId: string, reference: UploadReference): Promise<string>;
}
