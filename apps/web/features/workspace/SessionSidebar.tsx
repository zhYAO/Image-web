import type { Session } from '@zimage/domain';
import { Button, Input, Tooltip } from 'antd';
import { Check, ChevronsLeft, MessageSquarePlus, Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import styles from './workspace.module.css';

interface SessionSidebarProps {
  activeSessionId?: string;
  sessions: Session[];
  onCreate: () => void;
  onCollapse?: () => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  onSelect: (sessionId: string) => void;
}

export function SessionSidebar({
  activeSessionId,
  sessions,
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
        <div className={styles.sidebarHeading}>开启创作</div>
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
      <div className={styles.sectionLabel}>最近会话</div>
      <div className={styles.sessionList}>
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
              <button
                className={styles.sessionTitle}
                onClick={() => onSelect(session.id)}
                style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0, textAlign: 'left' }}
                type="button"
              >
                {session.title}
              </button>
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
                    <Button aria-label={`重命名 ${session.title}`} icon={<Pencil size={13} />} onClick={() => beginRename(session)} size="small" type="text" />
                  </Tooltip>
                  <Tooltip title="删除">
                    <Button aria-label={`删除 ${session.title}`} danger icon={<Trash2 size={13} />} onClick={() => onDelete(session.id)} size="small" type="text" />
                  </Tooltip>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
