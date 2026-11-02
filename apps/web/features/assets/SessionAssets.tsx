"use client";

import { ImageGallery } from '@/features/controls/PreviewImage';
import { CommerceSelect } from "@/features/commerce/CommerceSelect";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { ArrowUpRight, FolderOpen, Grid2X2, Heart, Plus, Search } from "lucide-react";
import type { Session, TimelineItem, WorkspaceGateway } from "@zimage/domain";
import { VisibleAsset } from "@/features/workspace/WorkspaceTimeline";
import { sessionHref } from "@/features/workspace/workspace-route";
import styles from "./assets.module.css";

/** Session-backed view: no synthetic library, saved URL or second session store. */
export function SessionAssets({
  gateway,
  sessions,
  ownerKey,
  loading,
  error,
  onRetry,
}: {
  gateway: WorkspaceGateway;
  sessions: Session[];
  ownerKey: string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [attempt, setAttempt] = useState(0);
  const session =
    sessions.find((item) => item.id === selected && item.status === "active") ??
    sessions.find((item) => item.status === "active");
  const sessionId = session?.id;
  const scope = JSON.stringify([ownerKey, sessionId, attempt]);
  const [result, setResult] = useState<{
    scope: string;
    gateway: WorkspaceGateway;
    items?: TimelineItem[];
    failed?: boolean;
  }>();
  const current =
    result?.scope === scope && result.gateway === gateway ? result : undefined;
  const resolveAssetUrl = useMemo(
    () => gateway.getGenerationAssetUrl?.bind(gateway),
    [gateway],
  );
  useEffect(() => {
    if (!sessionId || loading || error) return;
    let active = true;
    void gateway.getTimeline(sessionId).then(
      (items) => {
        if (active) setResult({ scope, gateway, items });
      },
      () => {
        if (active) setResult({ scope, gateway, failed: true });
      },
    );
    return () => {
      active = false;
    };
  }, [gateway, sessionId, scope, loading, error]);
  const assets = (current?.items ?? []).flatMap((item) =>
    item.type === "generation"
      ? item.batch.assets
          .filter((asset) => asset.status === "succeeded")
          .map((asset) => ({ asset, batch: item.batch }))
      : [],
  );
  const visible = assets.filter(({ batch }) =>
    batch.prompt
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <section className={styles.library} aria-label="资产库">
      <div className={styles.content}>
      <header className={styles.hero}>
        <div><span className={styles.eyebrow}>YOUR CREATIVE COLLECTION</span>
        <h1>
          让灵感，<span>有处可寻。</span>
        </h1>
        <p>回看会话中的生成图片，让下一次创作从这里开始。</p></div>
        <button className={`${styles.button} ${styles.buttonSecondary}`} disabled title="资产库暂不支持独立导入；请在创作会话中上传参考图。"><Plus />导入素材</button>
      </header>
      <div className={styles.sectionEyebrow}><span>会话作品</span><span>YOUR COLLECTIONS</span></div>
      <div className={styles.collectionGrid}>
        {sessions.filter(item => item.status === 'active').slice(0, 3).map(item => (
          <button type="button" className={styles.collection} key={item.id}
            aria-pressed={sessionId === item.id} onClick={() => setSelected(item.id)}>
            <span className={styles.collectionArt} aria-hidden><FolderOpen /></span>
            <span className={styles.collectionCopy}>
              <span className={styles.collectionTitle}>{item.title}<ArrowUpRight /></span>
              <span>会话中成功生成的图片</span>
              <span className={styles.collectionCount}>{sessionId === item.id && current?.items ? `${assets.length} 张作品` : '查看会话作品'}</span>
            </span>
          </button>
        ))}
      </div>
      <section className={styles.librarySection} aria-label="会话素材">
      <div className={styles.libraryTop}>
        <div className={styles.scopeTabs} role="group" aria-label="素材范围">
          <button type="button" aria-pressed="true"><Grid2X2 />会话作品<span>{assets.length}</span></button>
          <button type="button" disabled title="暂不支持收藏保存"><Heart />已收藏</button>
        </div>
        <span className={styles.libraryLabel}>灵感，从这里延续</span>
      </div>
      <div className={styles.toolbar}>
        <label>
          选择会话
          <CommerceSelect aria-label="选择会话"
            value={sessionId ?? ""}
            onChange={(value) => setSelected(value)}
            disabled={!sessionId}
          >
            <option value="" disabled>
              暂无会话
            </option>
            {sessions
              .filter((item) => item.status === "active")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
          </CommerceSelect>
        </label>
        <label className={styles.search}>
          <Search size={17} />
          <input
            aria-label="搜索当前会话作品"
            placeholder="搜索创作描述"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {session && (
          <Link href={sessionHref(session.id)}>
            查看原会话 <ArrowUpRight size={16} />
          </Link>
        )}
      </div>
      <p className={styles.help}>按会话读取已有生成记录；电商任务的完整结果与下载请进入原会话查看。</p>
      {error ? (
        <div className={styles.empty} role="alert">
          <p>暂时无法读取会话列表。{error}</p>
          <button onClick={onRetry}>重试会话列表</button>
        </div>
      ) : loading ? (
        <div className={styles.empty} role="status">
          正在读取会话列表…
        </div>
      ) : !sessionId ? (
        <div className={styles.empty}>
          <FolderOpen size={32} />
          <h2>作品从一次创作开始</h2>
          <p>生成的图片会随会话出现在这里。</p>
          <Link href="/workspace">开始创作</Link>
        </div>
      ) : current?.failed ? (
        <div className={styles.empty} role="alert">
          <p>暂时无法读取此会话的作品。</p>
          <button onClick={() => setAttempt((value) => value + 1)}>重试</button>
        </div>
      ) : !current?.items ? (
        <div className={styles.empty} role="status">
          正在整理会话作品…
        </div>
      ) : (
        <>
          <p className={styles.count}>{visible.length} 张作品 · 当前会话</p>
          <ImageGallery >
            <div className={styles.grid}>
              {visible.map(({ asset, batch }) => (
                <article className={styles.card} key={asset.id}>
                  <div className={styles.image}>
                    {asset.expired ? (
                      <p>图片已过期</p>
                    ) : (
                      <VisibleAsset
                        key={`${ownerKey}:${asset.id}`}
                        id={asset.id}
                        initialUrl={asset.url}
                        alt={batch.prompt}
                        resolveAssetUrl={resolveAssetUrl}
                      />
                    )}
                  </div>
                  <div className={styles.caption}>
                    <p title={batch.prompt}>{batch.prompt}</p>
                    <span>
                      {new Date(batch.createdAt).toLocaleDateString("zh-CN")}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </ImageGallery>
          {!visible.length && (
            <div className={styles.empty}>
              {assets.length
                ? "未找到匹配作品，请调整搜索。"
                : "此会话还没有成功生成的图片。"}
            </div>
          )}
        </>
      )}
      <p className={styles.bottomNote}>每一个好想法，都值得被好好收藏。<span>ZImage</span></p>
      </section></div>
    </section>
  );
}
