import { CommerceSelect } from "./CommerceSelect";
import {
  COMMERCE_TEMPLATES,
  type CommercePlan,
  type CommerceSlot,
  type ProviderCapability,
} from "@zimage/domain";
import styles from "./commerce.module.css";

export function CommercePlanFields({
  plan,
  capabilities,
  onChange,
  numbers,
  disabled = false,
}: {
  plan: CommercePlan;
  numbers?: number[];
  disabled?: boolean;
  capabilities: ProviderCapability[];
  onChange: (plan: CommercePlan) => void;
}) {
  const update = (id: string, patch: Partial<CommerceSlot>) =>
    onChange({
      ...plan,
      slots: plan.slots.map((slot) =>
        slot.id === id ? { ...slot, ...patch } : slot,
      ),
    });
  return (
    <div className={styles.planGrid}>
      <p className={styles.note}>
        商品：{plan.brief.name} · {plan.brief.facts || "仅使用真实商品可见外观"}
        。商品事实优先，保持颜色、轮廓、结构和可见标识。模板 v
        {COMMERCE_TEMPLATES.find((item) => item.id === plan.templateId)
          ?.version ?? "历史版本"}
        。无已知规格或价格时不添加。
      </p>
      {plan.slots.map((slot, index) => {
        const number = numbers?.[index] ?? index + 1;
        const model = capabilities
          .find((item) => item.provider === slot.provider)
          ?.models.find((item) => item.id === slot.model);
        return (
          <fieldset className={styles.slot} key={slot.id} disabled={disabled}>
            <legend>
              第 {number} 张 · {slot.role}
            </legend>
            <label>
              图片角色
              <input
                aria-label={`第 ${number} 张角色`}
                value={slot.role}
                maxLength={80}
                onChange={(event) =>
                  update(slot.id, { role: event.target.value })
                }
              />
            </label>
            <label>
              场景、布局与调整要求
              <textarea
                aria-label={`第 ${number} 张要求`}
                value={slot.instruction}
                maxLength={2000}
                onChange={(event) =>
                  update(slot.id, { instruction: event.target.value })
                }
              />
            </label>
            <label>
              准确文案
              <textarea
                aria-label={`第 ${number} 张文案`}
                value={slot.exactText}
                maxLength={1000}
                placeholder="留空则不添加营销文字"
                onChange={(event) =>
                  update(slot.id, { exactText: event.target.value })
                }
              />
            </label>
            <label>
              生成模型
              <CommerceSelect
                disabled={disabled}
                aria-label={`第 ${number} 张模型`}
                value={`${slot.provider}::${slot.model}`}
                onChange={(value) => {
                  const [provider, model] = value.split("::");
                  update(slot.id, { provider, model });
                }}
              >
                {capabilities.flatMap((provider) =>
                  provider.models.map((model) => (
                    <option
                      key={`${provider.provider}::${model.id}`}
                      value={`${provider.provider}::${model.id}`}
                    >
                      {provider.provider} · {model.label}
                    </option>
                  )),
                )}
              </CommerceSelect>
            </label>
            <div className={styles.twoColumns}>
              <label>
                比例
                <CommerceSelect
                  disabled={disabled}
                  aria-label={`第 ${number} 张比例`}
                  value={slot.aspectRatio}
                  onChange={(value) =>
                    update(slot.id, {
                      aspectRatio: value as CommerceSlot["aspectRatio"],
                    })
                  }
                >
                  {Array.from(
                    new Set([slot.aspectRatio, ...(model?.aspectRatios ?? [])]),
                  ).map((ratio) => (
                    <option key={ratio}>{ratio}</option>
                  ))}
                </CommerceSelect>
              </label>
              <label>
                分辨率
                <CommerceSelect
                  disabled={disabled}
                  aria-label={`第 ${number} 张分辨率`}
                  value={slot.resolution}
                  onChange={(value) =>
                    update(slot.id, {
                      resolution: value as CommerceSlot["resolution"],
                    })
                  }
                >
                  {Array.from(
                    new Set([slot.resolution, ...(model?.resolutions ?? [])]),
                  ).map((resolution) => (
                    <option key={resolution}>{resolution}</option>
                  ))}
                </CommerceSelect>
              </label>
            </div>
            <p className={styles.note}>
              引用：
              {
                slot.referenceIds.filter((id) =>
                  plan.brief.productReferenceIds.includes(id),
                ).length
              }{" "}
              张商品图、
              {
                slot.referenceIds.filter((id) =>
                  plan.brief.styleReferenceIds.includes(id),
                ).length
              }{" "}
              张风格图。改字也需重新生成并消耗图片额度。
            </p>
          </fieldset>
        );
      })}
    </div>
  );
}
