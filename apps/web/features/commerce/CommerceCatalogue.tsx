"use client";

import {
  COMMERCE_PLATFORMS,
  COMMERCE_SCENES,
  COMMERCE_TEMPLATES,
} from "@zimage/domain";
import Link from "next/link";
import Image from "next/image";
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
  return (
    <main className={styles.catalogue}>
      <nav className={styles.actions}>
        <Link href="/">ZImage 工作区</Link>
        {status === "guest" ? (
          <Link href="/login?returnTo=%2Fcreate">登录</Link>
        ) : (
          <Link href="/account">
            {status === "checking" ? "账号…" : "账号"}
          </Link>
        )}
      </nav>
      <p className={styles.eyebrow}>ZIMAGE / 电商创作</p>
      <h1>让商品成为画面主角</h1>
      <p>上传真实商品图，填写商品名称，一键生成主图、套图和图文内容。</p>
      <div className={styles.actions} role="group" aria-label="平台筛选">
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
      <p aria-live="polite">
        {platformName
          ? `${platformName} · 6 个可用场景，进入后可调整用途`
          : "六个场景，支持淘宝、抖音和小红书"}
      </p>
      <div className={styles.catalogueGrid}>
        {COMMERCE_SCENES.map((scene) => (
          <article className={styles.scene} key={scene.id}>
            <div className={styles.exampleCover}>
              <Image
                src={commerceExampleForScene(scene.id)}
                alt={`${scene.name} · AI 女装详情示例`}
                width={512}
                height={512}
              />
              <span>AI 女装详情示例</span>
            </div>
            <h2>{scene.name}</h2>
            <p>{scene.description}</p>
            <p>
              输入：真实商品图 + 商品名称
              {scene.id === "style-reference"
                ? " + 风格参考图"
                : "，可选风格参考"}
            </p>
            <p>
              产物：建议 {scene.count} 张独立图片，可选 1–8 张。
              {scene.id === "detail" ? "整图文字由 AI 生成，改字需重做。" : ""}
            </p>
            <Link
              className={styles.primaryLink}
              href={`/?scene=${scene.id}${platform !== "all" ? `&platform=${platform}` : ""}`}
            >
              开始{scene.name} →
            </Link>
          </article>
        ))}
      </div>
      <section>
        <h2>原创风格方向</h2>
        <p>选择适合商品的视觉方向，展开查看风格说明。</p>
        <div className={styles.templateGrid}>
          {COMMERCE_TEMPLATES.filter((item) => item.published).map((item) => (
            <details key={item.id}>
              <summary>{item.name}</summary>
              <p>{item.guidance}</p>
              <p>ZImage 原创风格 · 以实际生成效果为准</p>
            </details>
          ))}
        </div>
      </section>
      <Link className={styles.primaryLink} href="/">
        继续最近创作 →
      </Link>
      <p className={styles.note}>
        商品图与风格图合计最多 4 张 PNG、JPEG 或 WebP，每张不超过 10
        MB。上传、保存和生成需登录。请核对生成图片的商品外观与文字。
      </p>
    </main>
  );
}
