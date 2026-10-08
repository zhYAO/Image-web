import { ModelCreditPrice } from "@/features/credits/CreditsProvider";
import { CreativeTextField } from "./CreativeTextField";
import { CommerceSelect } from "./CommerceSelect";
import {
  COMMERCE_TEMPLATES,
  SELLING_LAYOUTS,
  APLUS_SPECS,
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
  selectedSlotId,
  onSelectSlot,
}: {
  plan: CommercePlan;
  numbers?: number[];
  disabled?: boolean;
  selectedSlotId?: string;
  onSelectSlot?: (slotId: string) => void;
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
        {plan.brief.contentMode === "content"
          ? `内容：${plan.brief.name}。按原文分配到每张卡片，不添加未提供的事实。`
          : `商品：${plan.brief.name} · ${plan.brief.facts || "仅使用真实商品可见外观"}。商品事实优先，保持颜色、轮廓、结构和可见标识。无已知规格或价格时不添加。`}
        模板 v
        {COMMERCE_TEMPLATES.find((item) => item.id === plan.templateId)
          ?.version ?? "历史版本"}
        。
      </p>
      {onSelectSlot && (
        <div className={styles.slotSelector} aria-label="分图选择">
          {plan.slots.map((slot, index) => (
            <button
              aria-pressed={(selectedSlotId ?? plan.slots[0]?.id) === slot.id}
              className={styles.slotSelectorItem}
              disabled={disabled}
              key={slot.id}
              onClick={() => onSelectSlot(slot.id)}
              type="button"
            >
              编辑第 {numbers?.[index] ?? index + 1} 张：{slot.role}
            </button>
          ))}
        </div>
      )}
      {plan.slots.map((slot, index) => {
        const number = numbers?.[index] ?? index + 1;
        if (selectedSlotId && slot.id !== selectedSlotId) return null;
        const model = capabilities
          .find((item) => item.provider === slot.provider)
          ?.models.find((item) => item.id === slot.model);
        return (
          <fieldset
            className={styles.slot}
            data-slot-id={slot.id}
            key={slot.id}
            disabled={disabled}
          >
            <legend>
              第 {number} 张 · {slot.role}
            </legend>
            {slot.outputSpec && <p className={styles.note}>{APLUS_SPECS[slot.outputSpec].label}</p>}
            {slot.category === 'selling' && <label>卖点版式<CommerceSelect aria-label={`第 ${number} 张卖点版式`} value={slot.layout ?? '自动分配'} onChange={value => update(slot.id, { layout: value as CommerceSlot['layout'] })}>
              {SELLING_LAYOUTS.map(layout => <option key={layout}>{layout}</option>)}
            </CommerceSelect></label>}
            <CreativeTextField productContext={{
                name: plan.brief.name, facts: plan.brief.facts, description: plan.brief.description,
                sellingPoints: plan.brief.sellingPoints, platform: plan.brief.platform,
                scene: plan.scene, imageRole: slot.role,
                designStyle: COMMERCE_TEMPLATES.find(item => item.id === plan.templateId)?.visual.guidance,
              }}
              label="图片角色"
              aria-label={`第 ${number} 张角色`}
              field="role"
              value={slot.role}
              maxLength={80}
              disabled={disabled}
              onChange={(role) => update(slot.id, { role })}
            />
            <CreativeTextField productContext={{
                name: plan.brief.name, facts: plan.brief.facts, description: plan.brief.description,
                sellingPoints: plan.brief.sellingPoints, platform: plan.brief.platform,
                scene: plan.scene, imageRole: slot.role,
                designStyle: COMMERCE_TEMPLATES.find(item => item.id === plan.templateId)?.visual.guidance,
              }}
              label="场景、布局与调整要求"
              aria-label={`第 ${number} 张要求`}
              field="instruction"
              multiline
              value={slot.instruction}
              maxLength={2000}
              disabled={disabled}
              onChange={(instruction) => update(slot.id, { instruction })}
            />
            <label>文字方式<CommerceSelect aria-label={`第 ${number} 张文字方式`} disabled={disabled} value={slot.textMode ?? (slot.exactText ? 'exact' : 'none')} onChange={value => update(slot.id, { textMode: value as CommerceSlot['textMode'] })}>
              <option value="auto">从商品描述提炼</option><option value="exact">指定准确文案</option><option value="none">不加文字</option>
            </CommerceSelect></label>
            <CreativeTextField productContext={{
                name: plan.brief.name, facts: plan.brief.facts, description: plan.brief.description,
                sellingPoints: plan.brief.sellingPoints, platform: plan.brief.platform,
                scene: plan.scene, imageRole: slot.role,
                designStyle: COMMERCE_TEMPLATES.find(item => item.id === plan.templateId)?.visual.guidance,
              }}
              label="准确文案"
              aria-label={`第 ${number} 张文案`}
              field="exactText"
              multiline
              value={slot.exactText}
              maxLength={1000}
              placeholder="留空则不添加营销文字"
              disabled={disabled}
              onChange={(exactText) => update(slot.id, { exactText, textMode: exactText ? 'exact' : 'none' })}
            />
            <label>
              生成模型
              <CommerceSelect
                disabled={disabled}
                aria-label={`第 ${number} 张模型`}
                value={`${slot.provider}::${slot.model}`}
                onChange={(value) => {
                  const [provider, model] = value.split("::");
                  const selected = capabilities.find(item => item.provider === provider)?.models.find(item => item.id === model);
                  update(slot.id, { provider, model,
                    resolution: selected && !selected.resolutions.includes(slot.resolution) ? selected.resolutions[0] : slot.resolution,
                    aspectRatio: selected && !selected.aspectRatios.includes(slot.aspectRatio) ? selected.aspectRatios[0] : slot.aspectRatio });
                }}
              >
                {!model && <option value={`${slot.provider}::${slot.model}`} disabled>{slot.model}（历史模型，请重新选择）</option>}
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
              <ModelCreditPrice
                operation="image"
                provider={slot.provider}
                model={slot.model}
                resolution={slot.resolution}
              />
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
