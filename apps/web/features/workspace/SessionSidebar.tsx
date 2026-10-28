import { ActionButton, AnchoredPanel, BusyIndicator, TextField, ConfirmAction } from '@/features/controls/NativeControls';
import type { Session } from "@zimage/domain";

import Link from "next/link";
import {
  Check,
  Pencil,
  ArrowUpRight,
  Trash2,
  X,
  MoreHorizontal,
} from "lucide-react";
import { SidebarTooltip } from "./SidebarTooltip";
import { BrandMark } from "@/features/brand/BrandMark";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { useState } from "react";

import styles from "./workspace.module.css";
import filters from "./session-sidebar.module.css";
import { CategoryFilters, type Category } from "./CategoryFilters";

import { sessionCategory } from "./session-category";

const activityLabels = {
  general: "普通创作",
  commerce: "电商生图",
  unknown: "类型待确认",
} as const;

interface SessionSidebarProps {
  collapsed?: boolean;
  activeSessionId?: string;
  commerceDraftIds?: ReadonlySet<string>;
  busySessionIds?: ReadonlySet<string>;
  sessions: Session[];
  deleting?: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onCreate: () => void;
  onCollapse?: () => void;
  onDelete: (sessionId: string) => void | Promise<void>;
  onRename: (sessionId: string, title: string) => void;
  onSelect: (sessionId: string) => void;
}

export function SessionSidebar({
  collapsed = false,
  activeSessionId,
  busySessionIds,
  commerceDraftIds,
  sessions,
  deleting = false,
  loading = false,
  error,
  onRetry,
  onCreate,
  onCollapse,
  onDelete,
  onRename,
  onSelect,
}: SessionSidebarProps) {
  const [editingId, setEditingId] = useState<string>();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const typeOf = (session: Session) =>
    sessionCategory(session, commerceDraftIds?.has(session.id));
  const visibleSessions = sessions.filter(
    (session) => category === "all" || typeOf(session) === category,
  );

  const beginRename = (session: Session) => {
    setEditingId(session.id);
    setTitle(session.title);
  };

  const finishRename = () => {
    if (editingId && title.trim()) onRename(editingId, title);
    setEditingId(undefined);
  };

  return (
    <div
      className={`${styles.panelInner} ${collapsed ? filters.collapsed : ""}`}
    >
      <div className={styles.brandRow}>
        {!collapsed && (
          <Link href="/home" className={styles.sidebarHeading}>
            <BrandMark/><span>ZImage<span className={styles.brandCaption}>灵感，让创作发生</span></span>
          </Link>
        )}
        {onCollapse && (
          <SidebarTooltip enabled={collapsed}
            title={collapsed ? "展开侧栏" : "折叠侧栏"}
          >
            <ActionButton
              aria-label={collapsed ? "展开会话侧栏" : "折叠会话侧栏"}
              icon={<WorkspaceIcon name={collapsed ? "expand" : "collapse"} />}
              onClick={onCollapse}
              variant="text"
            />
          </SidebarTooltip>
        )}
      </div>
      <SidebarTooltip enabled={collapsed} title="新对话">
        <ActionButton
          aria-label="新对话"
          className={styles.newButton}
          icon={<WorkspaceIcon name="create" />}
          onClick={onCreate}
          variant="default"
        >
          {!collapsed && "新对话"}
        </ActionButton>
      </SidebarTooltip>
      <SidebarTooltip enabled={collapsed} title="电商生图">
        <Link
          aria-label="电商生图"
          className={styles.commerceNav}
          href="/create"
        >
          <WorkspaceIcon name="commerce" />
          {!collapsed && (
            <>
              <span>电商生图</span>
              <ArrowUpRight aria-hidden size={15} />
            </>
          )}
        </Link>
      </SidebarTooltip>
      {collapsed ? (
        <SidebarTooltip enabled={collapsed} title="筛选会话"><AnchoredPanel

          placement="rightTop"
          content={
            <CategoryFilters value={category} onChange={(value) => { setCategory(value); setEditingId(undefined); }} />
          }
        >

            <ActionButton
              aria-label="筛选会话"
              className={filters.filterButton}
              variant="text"
              icon={<WorkspaceIcon name="filter" />}
            />
        </AnchoredPanel></SidebarTooltip>
      ) : (
        <>
          <CategoryFilters value={category} onChange={(value) => { setCategory(value); setEditingId(undefined); }} />
          <div className={styles.sectionLabel}>
            最近会话<span>{visibleSessions.length}</span>
          </div>
        </>
      )}
      <div
        className={styles.sessionList}
        role="region"
        aria-label="会话列表"
        aria-busy={deleting || loading}
      >
        {deleting && (
          <div className={styles.sessionDeleting} role="status">
            <BusyIndicator size="small" />
            <span>正在删除会话…</span>
          </div>
        )}
        {loading && <p role="status">正在加载会话…</p>}
        {error && (
          <p role="alert">
            会话加载失败{" "}
            <button type="button" onClick={onRetry}>
              重试会话
            </button>
          </p>
        )}
        {!loading && !error && !visibleSessions.length && (
          <p className={filters.empty}>暂无此类会话</p>
        )}
        {visibleSessions.map((session) => (
          <div
            className={`${styles.sessionItem} ${
              activeSessionId === session.id ? styles.sessionActive : ""
            }`}
            key={session.id}
          >
            {collapsed ? (
              <>
                <SidebarTooltip enabled={collapsed}
                  title={session.title}
                      >
                  <button
                    type="button"
                    className={filters.iconSession}
                    aria-label={session.title}
                    aria-current={
                      activeSessionId === session.id ? "page" : undefined
                    }
                    disabled={deleting}
                    onClick={() => onSelect(session.id)}
                  >
                    <WorkspaceIcon
                      name={
                        typeOf(session) === "commerce"
                          ? "commerce"
                          : "conversation"
                      }
                      seed={session.id}
                    />
                    {busySessionIds?.has(session.id) && (
                      <BusyIndicator
                        size="small"
                        aria-label={`${session.title} 正在处理`}
                        className={filters.iconBusy}
                      />
                    )}
                  </button>
                </SidebarTooltip>
                <AnchoredPanel

                  placement="rightTop"
                  content={
                    <div className={filters.compactActions}>
                      {editingId === session.id ? (
                        <>
                          <TextField
                            aria-label="会话名称"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            onEnter={finishRename}
                          />
                          <ActionButton onClick={finishRename}>保存会话名称</ActionButton>
                          <ActionButton onClick={() => setEditingId(undefined)}>
                            取消重命名
                          </ActionButton>
                        </>
                      ) : (
                        <>
                          <ActionButton
                            aria-label={`重命名 ${session.title}`}
                            onClick={() => beginRename(session)}
                            icon={<Pencil size={14} />}
                          >
                            重命名
                          </ActionButton>
                          <ConfirmAction
                            title="删除这个会话？"
                            description="会话及其中的创作记录将被删除。"
                            confirmLabel="确认删除"
                            cancelLabel="取消"

                            onConfirm={() => onDelete(session.id)}
                            disabled={deleting}
                          >
                            <ActionButton
                              disabled={deleting}
                              aria-label={`删除 ${session.title}`}
                              danger
                              icon={<Trash2 size={14} />}
                            >
                              删除
                            </ActionButton>
                          </ConfirmAction>
                        </>
                      )}
                    </div>
                  }
                >
                  <button
                    type="button"
                    aria-label={`${session.title} 的操作`}
                    className={filters.moreButton}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </AnchoredPanel>
              </>
            ) : editingId === session.id ? (
              <TextField
                aria-label="会话名称"
                autoFocus
                onChange={(event) => setTitle(event.target.value)}
                onEnter={finishRename}
                size="small"
                value={title}
              />
            ) : (
              <div className={filters.sessionContent}>
                <div className={styles.sessionTitleRow}>
                  <WorkspaceIcon
                    name={
                      typeOf(session) === "commerce"
                        ? "commerce"
                        : "conversation"
                    }
                    seed={session.id}
                    size={22}
                  />
                  <SidebarTooltip enabled={collapsed}
                    title={session.title}
                          >
                    <button
                      className={styles.sessionTitle}
                      disabled={deleting}
                      onClick={() => onSelect(session.id)}
                      style={{
                        background: "none",
                        border: 0,
                        cursor: "pointer",
                        padding: 0,
                        textAlign: "left",
                      }}
                      type="button"
                    >
                      {session.title}
                    </button>
                  </SidebarTooltip>
                  {busySessionIds?.has(session.id) && (
                    <BusyIndicator
                      aria-label={`${session.title} 正在处理`}
                      className={styles.sessionBusy}
                      size="small"
                    />
                  )}
                </div>
                <div className={filters.badges} aria-label="会话类型">
                  <span className={filters.badge}>
                    {activityLabels[typeOf(session)]}
                  </span>
                </div>
              </div>
            )}
            {!collapsed && (
              <div className={styles.sessionActions}>
                {editingId === session.id ? (
                  <>
                    <SidebarTooltip enabled={collapsed} title="保存">
                      <ActionButton
                        aria-label="保存会话名称"
                        icon={<Check size={13} />}
                        onClick={finishRename}
                        size="small"
                        variant="text"
                      />
                    </SidebarTooltip>
                    <SidebarTooltip enabled={collapsed} title="取消">
                      <ActionButton
                        aria-label="取消重命名"
                        icon={<X size={13} />}
                        onClick={() => setEditingId(undefined)}
                        size="small"
                        variant="text"
                      />
                    </SidebarTooltip>
                  </>
                ) : (
                  <>
                    <SidebarTooltip enabled={collapsed} title="重命名">
                      <ActionButton
                        disabled={deleting}
                        aria-label={`重命名 ${session.title}`}
                        icon={<Pencil size={13} />}
                        onClick={() => beginRename(session)}
                        size="small"
                        variant="text"
                      />
                    </SidebarTooltip>
                    <ConfirmAction
                      title="删除这个会话？"
                      description="会话及其中的创作记录将被删除。"
                      confirmLabel="确认删除"
                      cancelLabel="取消"

                      onConfirm={() => onDelete(session.id)}
                      disabled={deleting}
                    >
                      <ActionButton
                        disabled={deleting}
                        aria-label={`删除 ${session.title}`}
                        danger
                        icon={<Trash2 size={13} />}
                        size="small"
                        variant="text"
                      />
                    </ConfirmAction>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
