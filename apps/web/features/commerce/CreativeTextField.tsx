"use client";

import { useLayoutEffect, useId, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useCredits, CreditFee } from "@/features/credits/CreditsProvider";
import type {
  CreativeTextOptimizeRequest,
  CreativeTextFieldName,
} from "@zimage/domain";
import { requestCreativeTextOptimization } from '@/gateways/creative-text-gateway';
import { useWorkspaceStore } from "@/store/workspace-store";
import styles from "./creative-text-field.module.css";

export interface CreativeTextFieldProps {
  value: string;
  onChange: (value: string) => void;
  field: CreativeTextFieldName;
  context?: string;
  chatModel?: 'doubao' | 'minimax';
  maxLength?: number;
  multiline?: boolean;
  label?: string;
  'aria-label'?: string;
  rows?: number;
  name?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function CreativeTextField(props: CreativeTextFieldProps) {
  // Field identity owns its request, suggestion and undo. Changing meaning must
  // not transfer a title rewrite into a factual product-name editor.
  return <CreativeTextFieldEditor key={props.field} {...props} />;
}

function CreativeTextFieldEditor({
  value,
  onChange,
  field,
  context,
  chatModel,
  maxLength = 6000,
  multiline,
  label,
  rows = 3,
  name,
  id,
  placeholder,
  disabled,
  "aria-label": ariaLabel,
}: CreativeTextFieldProps) {
  const credits = useCredits();
  const lastRequest = useRef<
    { key: string; input: CreativeTextOptimizeRequest } | undefined
  >(undefined);
  const selectedChatModel = useWorkspaceStore(
    (state) => state.selectedChatModel,
  );
  const optimizationModel = chatModel ?? (selectedChatModel === 'minimax' ? 'minimax' : 'doubao');
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const current = useRef(value);
  const revision = useRef(0);
  const active = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [suggestion, setSuggestion] = useState<string>();
  const [undo, setUndo] = useState<{ before: string; after: string }>();
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    if (current.current !== value) { current.current = value; revision.current += 1; }
  }, [value]);
  useLayoutEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );

  function apply(text: string) {
    setUndo({ before: current.current, after: text });
    current.current = text;
    onChange(text);
    setSuggestion(undefined);
  }
  async function optimize() {
    if (active.current || disabled || !value.trim()) return;
    const controller = new AbortController();
    active.current = controller;
    const submitted = value;
    const startedRevision = revision.current;
    setPending(true);
    setFailed(false);
    setStatus("正在优化…");
    setSuggestion(undefined);
    try {
      const key = JSON.stringify({
        field,
        text: submitted,
        context,
        chatModel: optimizationModel,
        maxLength,
      });
      if (lastRequest.current?.key !== key)
        lastRequest.current = {
          key,
          input: {
            field,
            text: submitted,
            context,
            chatModel: optimizationModel,
            maxLength,
            requestId: crypto.randomUUID(),
            billing: credits.confirm([
              {
                operation: "optimize",
                provider: optimizationModel,
                model: optimizationModel,
                resolution: "",
                count: 1,
              },
            ]),
          },
        };
      const result = await requestCreativeTextOptimization(
        lastRequest.current.input,
        controller.signal,
      );
      lastRequest.current = undefined;
      if (active.current !== controller || controller.signal.aborted) return;
      if (
        current.current !== submitted ||
        revision.current !== startedRevision
      ) {
        setSuggestion(result.text);
        setStatus(
          `${result.mock ? "Mock 演示 · " : ""}你已编辑内容，请确认后应用建议。`,
        );
      } else {
        apply(result.text);
        setStatus(`${result.mock ? 'Mock 演示 · ' : ''}已优化当前内容。`);
      }
    } catch (error) {
      if(error instanceof Error && "newRequest" in error && error.newRequest)lastRequest.current=undefined;
      if (active.current !== controller || controller.signal.aborted) return;
      setFailed(true);
      setStatus(
        error instanceof Error && ("userMessage" in error || /积分|报价|费用/.test(error.message))
          ? `${error.message} 原内容已保留。`
          : "优化失败，原内容已保留，请稍后重试。",
      );
    } finally {
      if (active.current === controller) { active.current = null; setPending(false); }
    }
  }
  const props = {
    id: inputId,
    name,
    value,
    maxLength,
    placeholder,
    disabled,
    "aria-label": ariaLabel,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      revision.current += 1; current.current = event.target.value;
      setUndo(undefined); onChange(event.target.value);
    },
  };
  return (
    <div className={styles.field}>
      {label && <label htmlFor={inputId}>{label}</label>}
      <div className={styles.editor}>
      {multiline ? <textarea {...props} rows={rows} /> : <input {...props} />}
      <button className={styles.sparkle} type="button" title="AI 优化当前内容" aria-label="AI 优化当前内容" disabled={disabled || pending || !value.trim()} onClick={() => void optimize()}><Sparkles size={16} aria-hidden="true" /></button>
    </div>
      <CreditFee
        items={[
          {
            operation: "optimize",
            provider: optimizationModel,
            model: optimizationModel,
            resolution: "",
            count: 1,
          },
        ]}
      />
      {(status || undo || pending) && (
        <div className={styles.feedback}>
          <span role={failed ? "alert" : "status"}>{status}</span>
          {pending && (
            <button type="button" onClick={() => { active.current?.abort(); active.current = null; setPending(false); setStatus('已取消，当前内容已保留。'); }}>取消优化</button>
          )}
          {!pending && undo && value === undo.after && (
            <button type="button" disabled={disabled} onClick={() => { onChange(undo.before); current.current = undo.before; setUndo(undefined); setStatus('已撤销优化。'); }}>撤销优化</button>
          )}
        </div>
      )}
      {suggestion && (
        <div className={styles.suggestion}><p>{suggestion}</p><button type="button" disabled={disabled} onClick={() => { apply(suggestion); setStatus('已应用建议。'); }}>应用建议</button><button type="button" onClick={() => { setSuggestion(undefined); setStatus('已保留当前内容。'); }}>忽略建议</button></div>
      )}
    </div>
  );
}
