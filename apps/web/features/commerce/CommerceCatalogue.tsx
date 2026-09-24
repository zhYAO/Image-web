"use client";

import {
  COMMERCE_PLATFORMS,
  COMMERCE_PRIMARY_SCENE_IDS,
  COMMERCE_SCENES,
  COMMERCE_TEMPLATES,
  type CommerceScene,
} from "@zimage/domain";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { TemplatePreview } from "./TemplatePreview";
import { commerceExampleForScene } from "./commerce-examples";
import { useState } from "react";
import { useAuthStatus } from "@/features/auth/AuthStatusProvider";
import { commerceHref } from "@/features/workspace/workspace-route";
import styles from "./commerce.module.css";

export function CommerceCatalogue() {
  const featured = COMMERCE_PRIMARY_SCENE_IDS.map(id => COMMERCE_SCENES.find(scene => scene.id === id)!);
  const extra = COMMERCE_SCENES.filter(scene => !COMMERCE_PRIMARY_SCENE_IDS.some(id => id === scene.id));
  const { status } = useAuthStatus();
  const [platform, setPlatform] = useState("all");
  const platformName = COMMERCE_PLATFORMS.find(
    (item) => item.id === platform,
  )?.name;
  const launchUrl = (scene: string, templateId?: string) => commerceHref(scene as CommerceScene, platform, templateId);
  return (
    <div className={styles.cataloguePage}>
      <main className={styles.catalogue}>
        <nav className={styles.catalogueNav} aria-label="电商创作导航">
          <Link className={styles.catalogueBrand} href="/">
            <Sparkles size={20} aria-hidden />
            ZImage <span>工作区</span>
          </Link>
          <div className={styles.sceneNavigation}>
            {featured.map((scene) => (
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
            <p>从商品套图、A+ 详情页、复刻、批量或 AI 商品图开始创作。</p>
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
                ? `${platformName} · 五条核心生图流程，进入后可调整用途`
                : "五条核心电商生图流程，历史创作仍可继续"}
            </p>
          </div>
        </header>
        <div className={styles.catalogueSectionHeading}>
          <h2>电商生图</h2>
          <span>上传素材 → 填写描述 → 一键生成</span>
        </div>
        <div className={styles.catalogueGrid}>
          {featured.map((scene, index) => (
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
                  <span>{scene.id === 'batch' ? '最多 20 个商品任务' : scene.id === 'clone' ? '最多 20 张参考图' : scene.id === 'detail' ? '最多 16 个模块' : scene.id === 'product-set' ? '默认 7 张 · 最多 20 张' : '每次最多 4 张'}</span>
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
        <section className={styles.moreCreations}><div className={styles.catalogueSectionHeading}><h2>更多创作</h2><span>保留原有入口与历史任务</span></div>
          <div className={styles.moreCreationLinks}>{extra.map(scene => <Link href={launchUrl(scene.id)} key={scene.id}>{scene.name} →</Link>)}</div>
        </section>
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
            商品原图最多 6 张、复刻参考图最多 20 张 PNG、JPEG 或 WebP，每张不超过 10 MB。上传、保存和生成需登录；修改图片文字需要重新生成。
          </p>
          <Link href="/">继续最近创作 →</Link>
        </footer>
      </main>
    </div>
  );
}
