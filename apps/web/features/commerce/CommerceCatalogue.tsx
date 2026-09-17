"use client";

import {
  COMMERCE_PLATFORMS,
  COMMERCE_SCENES,
  COMMERCE_TEMPLATES,
} from "@zimage/domain";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { TemplatePreview } from "./TemplatePreview";
import { commerceExampleForScene } from "./commerce-examples";
import { useState } from "react";
import { useAuthStatus } from "@/features/auth/AuthStatusProvider";
import styles from "./commerce.module.css";

export function CommerceCatalogue() {
  const { status } = useAuthStatus();
  const [platform, setPlatform] = useState("all");
  const platformName = COMMERCE_PLATFORMS.find(
    (item) => item.id === platform,
  )?.name;
  const launchUrl = (scene: string, templateId?: string) =>
    `/?scene=${scene}${scene === "xhs-poster" ? "&platform=xiaohongshu" : platform !== "all" ? `&platform=${platform}` : ""}${templateId ? `&template=${encodeURIComponent(templateId)}` : ""}`;
  return (
    <div className={styles.cataloguePage}>
      <main className={styles.catalogue}>
        <nav className={styles.catalogueNav} aria-label="电商创作导航">
          <Link className={styles.catalogueBrand} href="/">
            <Sparkles size={20} aria-hidden />
            ZImage <span>工作区</span>
          </Link>
          <div className={styles.sceneNavigation}>
            {COMMERCE_SCENES.map((scene) => (
              <Link key={scene.id} href={launchUrl(scene.id)}>
                {scene.name}
              </Link>
            ))}
          </div>
          <Link
            href={status === "guest" ? "/login?returnTo=%2Fcreate" : "/account"}
          >
            {status === "guest"
              ? "登录"
              : status === "checking"
                ? "账号…"
                : "账号"}
          </Link>
        </nav>
        <header className={styles.catalogueIntro}>
          <div>
            <p className={styles.eyebrow}>ZIMAGE / 电商创作</p>
            <h1>选择生图类型</h1>
            <p>商品主图、成套图文或小红书海报，选择类型后开始创作。</p>
          </div>
          <div>
            <div
              className={styles.platformFilter}
              role="group"
              aria-label="平台筛选"
            >
              {[{ id: "all", name: "全部平台" }, ...COMMERCE_PLATFORMS].map(
                (item) => (
                  <button
                    aria-pressed={platform === item.id}
                    key={item.id}
                    onClick={() => setPlatform(item.id)}
                  >
                    {item.name}
                  </button>
                ),
              )}
            </div>
            <p className={styles.filterCaption} aria-live="polite">
              {platformName
                ? `${platformName} · ${COMMERCE_SCENES.length} 种生图类型，进入后可调整用途`
                : "七种生图类型，支持商品创作与内容分享"}
            </p>
          </div>
        </header>
        <div className={styles.catalogueSectionHeading}>
          <h2>七种生图类型</h2>
          <span>商品与内容 → 创作方案 → 成品</span>
        </div>
        <div className={styles.catalogueGrid}>
          {COMMERCE_SCENES.map((scene, index) => (
            <article className={styles.scene} key={scene.id}>
              <div className={styles.exampleCover}>
                <Image
                  src={commerceExampleForScene(scene.id)}
                  alt={`${scene.name} · AI 风格示例`}
                  width={512}
                  height={512}
                  sizes="(min-width: 1700px) 310px, (min-width: 1400px) 23vw, 30vw"
                />
                <span>女装 · AI 风格示例</span>
              </div>
              <div className={styles.sceneDescription}>
                <div className={styles.sceneTitle}>
                  <h2>{scene.name}</h2>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </div>
                <p>{scene.description}</p>
                <div className={styles.sceneFooter}>
                  <span>建议 {scene.count} 张 · 可选 1–8 张</span>
                  <Link
                    aria-label={`开始${scene.name} →`}
                    className={styles.primaryLink}
                    href={launchUrl(scene.id)}
                  >
                    <ArrowUpRight aria-hidden size={19} />
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
        <section>
          <div className={styles.catalogueSectionHeading}>
            <h2>原创风格方向</h2>
            <span>找到适合你的视觉表达</span>
          </div>
          <div className={styles.templateGrid}>
            {COMMERCE_TEMPLATES.filter((item) => item.published).map((item) => (
              <details key={item.id} open>
                <summary>{item.name}</summary>
                <TemplatePreview templateId={item.id} />
                <p>{item.guidance}</p>
                <p>ZImage 原创风格 · 以实际生成效果为准</p>
                <Link href={launchUrl(item.visual.scenes[0]!, item.id)} aria-label={`使用${item.name}模板`}>使用此风格 →</Link>
              </details>
            ))}
          </div>
        </section>
        <footer className={styles.catalogueFooter}>
          <p className={styles.note}>
            商品图与风格图合计最多 4 张 PNG、JPEG 或 WebP，每张不超过 10
            MB。上传、保存和生成需登录。详情图文字由 AI 绘制，改字需要重新生成。
          </p>
          <Link href="/">继续最近创作 →</Link>
        </footer>
      </main>
    </div>
  );
}
