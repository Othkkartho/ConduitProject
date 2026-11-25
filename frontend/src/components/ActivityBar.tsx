import React, { useState } from 'react';
import { FolderOpen, FolderTree, Radio } from 'lucide-react';
import { getViewsInZone, useAppStore } from '../store/useAppStore';
import type { DockViewId, DockZone } from '../types';

const VIEW_META: Record<
  DockViewId,
  { label: string; shortcut: string; icon: React.FC<{ size?: number }> }
> = {
  bookmarks: {
    label: '세션 북마크',
    shortcut: 'Ctrl+Shift+B',
    icon: ({ size = 18 }) => <FolderTree size={size} />,
  },
  broadcast: {
    label: 'Broadcast 입력',
    shortcut: 'Ctrl+Shift+M',
    icon: ({ size = 18 }) => <Radio size={size} />,
  },
  sftp: {
    label: 'SFTP 탐색기',
    shortcut: 'Ctrl+Shift+S',
    icon: ({ size = 18 }) => <FolderOpen size={size} />,
  },
};

interface ActivityBarProps {
  zone: DockZone;
}

export const ActivityBar: React.FC<ActivityBarProps> = ({ zone }) => {
  const {
    viewZone,
    leftOpen,
    leftActiveView,
    rightOpen,
    rightActiveView,
    bottomOpen,
    bottomActiveView,
    draggingItem,
    toggleView,
    moveViewToZone,
    setDraggingItem,
  } = useAppStore();

  const [dropHover, setDropHover] = useState(false);

  const views = getViewsInZone(viewZone, zone);
  const isOpen =
    zone === 'left' ? leftOpen : zone === 'right' ? rightOpen : bottomOpen;
  const activeView =
    zone === 'left'
      ? leftActiveView
      : zone === 'right'
        ? rightActiveView
        : bottomActiveView;

  const isDockDragging = draggingItem?.kind === 'dock-view';

  return (
    <nav
      className={`activity-bar zone-${zone} ${
        views.length === 0 ? 'is-empty' : ''
      } ${isDockDragging ? 'dock-target-ready' : ''} ${
        dropHover ? 'dock-target-hover' : ''
      }`}
      aria-label={`${zone} activity bar`}
      onDragOver={(e) => {
        if (draggingItem?.kind === 'dock-view') {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropHover(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDropHover(false);
        }
      }}
      onDrop={(e) => {
        setDropHover(false);
        if (draggingItem?.kind === 'dock-view') {
          e.preventDefault();
          moveViewToZone(draggingItem.viewId, zone);
          setDraggingItem(null);
        }
      }}
    >
      {views.map((viewId) => {
        const meta = VIEW_META[viewId];
        const Icon = meta.icon;
        const active = isOpen && activeView === viewId;
        const tooltip = `${meta.label} (${meta.shortcut})`;
        return (
          <button
            key={viewId}
            className={`activity-icon-btn ${active ? 'active' : ''}`}
            onClick={() => toggleView(viewId)}
            draggable
            data-tooltip={tooltip}
            aria-label={tooltip}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', viewId);
              setDraggingItem({ kind: 'dock-view', viewId });
            }}
            onDragEnd={() => {
              setDropHover(false);
              setDraggingItem(null);
            }}
          >
            <Icon size={18} />
          </button>
        );
      })}
    </nav>
  );
};
