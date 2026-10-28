import { PreviewImage } from '@/features/controls/PreviewImage';
import type { CommerceTask } from "@zimage/domain";

import styles from "./commerce.module.css";

/** Use the same slot order and current selections as the long-image exporter. */
export function CommerceDetailPreview({ task }: { task: CommerceTask }) {
  return (
    <details className={styles.detailPreview}>
      <summary>模块顺序与长图预览</summary>
      <p>
        按当前方案顺序拼接；未完成、已过期模块显示占位，下载只包含可用选图。
      </p>
      <div className={styles.detailPreviewColumns}>
        {(["standard", "desktop", "mobile"] as const).map((spec) => {
          const slots = task.slots.filter(
            (slot) =>
              slot.outputSpec === spec ||
              (!slot.outputSpec && spec === "standard"),
          );
          if (!slots.length) return null;
          return (
            <section key={spec} aria-label={`${spec} 模块顺序`}>
              <h3>
                {spec === "standard"
                  ? "普通 A+"
                  : spec === "desktop"
                    ? "高级 A+ · 桌面"
                    : "高级 A+ · 移动"}
              </h3>
              <ol>
                {slots.map((slot, index) => {
                  const selection = task.selections.find(
                    (item) => item.slotId === slot.id,
                  );
                  const image = task.runs
                    .flatMap((run) => run.items)
                    .find(
                      (item) =>
                        item.slotId === slot.id &&
                        item.generationId === selection?.generationId,
                    );
                  return (
                    <li key={slot.id}>
                      <span>
                        {index + 1}. {slot.module || slot.role}
                      </span>
                      {image?.url && !image.expired ? (
                        <PreviewImage
                          src={image.url}
                          alt={`${slot.module || slot.role}长图预览`}
                          style={{
                            aspectRatio:
                              spec === "mobile"
                                ? "600 / 450"
                                : spec === "desktop"
                                  ? "1464 / 600"
                                  : "970 / 600",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <div className={styles.detailPreviewPlaceholder}>
                          {image?.expired ? "图片已到期" : "等待模块结果"}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </details>
  );
}
