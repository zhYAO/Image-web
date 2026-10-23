"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";

const questions: [string, string][] = [
  [
    "我可以从哪里开始？",
    "点击“开始创作”进入对话工作台。你可以输入创作想法、添加本地参考图，或直接选择一个电商创作场景。",
  ],
  [
    "五种电商场景有什么区别？",
    "商品套图适合统一系列视觉；A+ 详情页帮助组织卖点；爆款图复刻用于参考构图；AI 商品图探索拍摄场景；服装商品图片专注服装展示。",
  ],
  [
    "这里会真的生成图片吗？",
    "工作台沿用 ZImage 的图片生成服务。正式服务模式下，提交前会显示模型、预计积分和确认信息；本地模拟模式会明确标注，不调用真实模型。",
  ],
  [
    "上传的参考图会保存在哪里？",
    "正式服务模式下，参考图通过私有存储上传，并按当前账号与会话管理。预览和下载使用短期链接；具体保存期限与可用状态以工作台提示为准。",
  ],
];

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const hoverOpened = useRef(false);
  const hovered = useRef(false);
  return (
    <div
      className="zl-faq-item"
      onPointerEnter={(event) => {
        if (
          event.pointerType !== "touch" &&
          window.matchMedia("(hover: hover) and (pointer: fine)").matches
        ) {
          hovered.current = true;
          if (!open) {
            hoverOpened.current = true;
            setOpen(true);
          }
        }
      }}
      onPointerLeave={(event) => {
        hovered.current = false;
        if (
          hoverOpened.current &&
          !event.currentTarget.contains(document.activeElement)
        ) {
          hoverOpened.current = false;
          setOpen(false);
        }
      }}
      onBlurCapture={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !hovered.current &&
          hoverOpened.current
        ) {
          hoverOpened.current = false;
          setOpen(false);
        }
      }}
    >
      <details open={open}>
        <summary
          onClick={(event) => {
            event.preventDefault();
            hoverOpened.current = false;
            setOpen((value) => !value);
          }}
        >
          {question}
          <span aria-hidden="true">
            <Plus />
          </span>
        </summary>
        <p>{answer}</p>
      </details>
    </div>
  );
}
export function LandingFaq() {
  return (
    <div className="zl-faq-list">
      {questions.map(([question, answer]) => (
        <FaqItem key={question} question={question} answer={answer} />
      ))}
    </div>
  );
}
