import type { Session } from '@zimage/domain';
import { Button, Input, Popconfirm, Spin, Tooltip } from 'antd';
import Link from 'next/link';
import { Check, ChevronsLeft, MessageSquarePlus, Pencil, ShoppingBag, ArrowUpRight, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import styles from './workspace.module.css';

interface SessionSidebarProps {
  activeSessionId?: string;
  busySessionIds?: ReadonlySet<string>;
  sessions: Session[];
  deleting?: boolean;
  onCreate: () => void;
  onCollapse?: () => void;
  onDelete: (sessionId: string) => void | Promise<void>;
  onRename: (sessionId: string, title: string) => void;
  onSelect: (sessionId: string) => void;
}

export function SessionSidebar({
  activeSessionId,
  busySessionIds,
  sessions,
  deleting = false,
  onCreate,
  onCollapse,
  onDelete,
  onRename,
  onSelect,
}: SessionSidebarProps) {
  const [editingId, setEditingId] = useState<string>();
  const [title, setTitle] = useState('');

  const beginRename = (session: Session) => {
    setEditingId(session.id);
    setTitle(session.title);
  };

  const finishRename = () => {
    if (editingId && title.trim()) onRename(editingId, title);
    setEditingId(undefined);
  };

  return (
    <div className={styles.panelInner}>
      <div className={styles.brandRow}>
        <div className={styles.sidebarHeading}>ZImage<span className={styles.brandCaption}>灵感，让创作发生</span></div>
        {onCollapse && (
          <Tooltip title="折叠侧栏">
            <Button aria-label="折叠会话侧栏" icon={<ChevronsLeft size={17} />} onClick={onCollapse} type="text" />
          </Tooltip>
        )}
      </div>
      <Button
        className={styles.newButton}
        icon={<MessageSquarePlus size={16} />}
        onClick={onCreate}
        type="default"
      >
        新对话
      </Button>
      <Link className={styles.commerceNav} href="/create"><ShoppingBag aria-hidden size={17} /><span>电商生图</span><ArrowUpRight aria-hidden size={15} /></Link>
      <div className={styles.sectionLabel}>最近会话<span>{sessions.length}</span></div>
      <div className={styles.sessionList} role="region" aria-label="会话列表" aria-busy={deleting}>
        {deleting && <div className={styles.sessionDeleting} role="status"><Spin size="small" /><span>正在删除会话…</span></div>}
        {sessions.map((session) => (
          <div
            className={`${styles.sessionItem} ${
              activeSessionId === session.id ? styles.sessionActive : ''
            }`}
            key={session.id}
          >
            {editingId === session.id ? (
              <Input
                aria-label="会话名称"
                autoFocus
                onChange={(event) => setTitle(event.target.value)}
                onPressEnter={finishRename}
                size="small"
                value={title}
              />
            ) : (
              <div className={styles.sessionTitleRow}>
                <button
                  className={styles.sessionTitle}
                  disabled={deleting}
                  onClick={() => onSelect(session.id)}
                  style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0, textAlign: 'left' }}
                  type="button"
                >
                  {session.title}
                </button>
                {busySessionIds?.has(session.id) && (
                  <Spin aria-label={`${session.title} 正在处理`} className={styles.sessionBusy} size="small" />
                )}
              </div>
            )}
            <div className={styles.sessionActions}>
              {editingId === session.id ? (
                <>
                  <Tooltip title="保存">
                    <Button aria-label="保存会话名称" icon={<Check size={13} />} onClick={finishRename} size="small" type="text" />
                  </Tooltip>
                  <Tooltip title="取消">
                    <Button aria-label="取消重命名" icon={<X size={13} />} onClick={() => setEditingId(undefined)} size="small" type="text" />
                  </Tooltip>
                </>
              ) : (
                <>
                  <Tooltip title="重命名">
                    <Button disabled={deleting} aria-label={`重命名 ${session.title}`} icon={<Pencil size={13} />} onClick={() => beginRename(session)} size="small" type="text" />
                  </Tooltip>
                  <Popconfirm title="删除这个会话？" description="会话及其中的创作记录将被删除。" okText="确认删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => onDelete(session.id)} disabled={deleting}>
                    <Button disabled={deleting} aria-label={`删除 ${session.title}`} danger icon={<Trash2 size={13} />} size="small" type="text" />
                  </Popconfirm>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
