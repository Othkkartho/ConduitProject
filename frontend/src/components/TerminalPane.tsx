import React, { useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import { BookmarkPlus, GripVertical, Search, X } from 'lucide-react';
import {
  canDropOnPane,
  getProtocolBadge,
  useAppStore,
} from '../store/useAppStore';
import {
  detachTerminal,
  ensureAndAttachTerminal,
  fitAndResizeTerminal,
  focusTerminal,
  searchTerminal,
} from '../utils/terminalRegistry';
import type { DropZone, PaneNode } from '../types';

interface TerminalPaneProps {
  tabId: string;
  pane: PaneNode;
}

function detectDropZone(
  clientX: number,
  clientY: number,
  rect: DOMRect
): DropZone {
  const rx = (clientX - rect.left) / Math.max(1, rect.width);
  const ry = (clientY - rect.top) / Math.max(1, rect.height);
  if (ry < 0.25) return 'top';
  if (ry > 0.75) return 'bottom';
  if (rx < 0.28) return 'left';
  if (rx > 0.72) return 'right';
  return 'center';
}

const ZONE_LABEL: Record<DropZone, string> = {
  left: '좌측 분할',
  right: '우측 분할',
  top: '상단 분할',
  bottom: '하단 분할',
  center: '위치 교환',
};

export const TerminalPane: React.FC<TerminalPaneProps> = ({ tabId, pane }) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const {
    transport,
    tabs,
    activePaneId,
    searchPaneId,
    draggingItem,
    setActivePane,
    setPaneSession,
    setPaneDetectedHostname,
    openSaveBookmarkFromPane,
    requestClosePane,
    toggleSearchPane,
    setDraggingItem,
    dropOnPane,
  } = useAppStore();

  const [searchText, setSearchText] = useState('');
  const [dropHint, setDropHint] = useState<{
    zone: DropZone;
    allowed: boolean;
    reason?: string;
  } | null>(null);

  const isFocused = activePaneId === pane.id;
  const isSearchOpen = searchPaneId === pane.id;
  const isPaneDragActive =
    draggingItem !== null &&
    (draggingItem.kind === 'pane' ||
      draggingItem.kind === 'tab' ||
      draggingItem.kind === 'bookmark');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const currentSettings = useAppStore.getState().settings;
    ensureAndAttachTerminal(
      pane.id,
      pane.config,
      container,
      transport,
      currentSettings,
      {
        onSessionReady: (sid) => setPaneSession(pane.id, sid, 'connected'),
        onSessionClosed: (sid) => setPaneSession(pane.id, sid, 'closed'),
        onSessionError: (msg) => setPaneSession(pane.id, null, 'error', msg),
        onTitleChange: (hostname) => setPaneDetectedHostname(pane.id, hostname),
      }
    );

    let resizeTimer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        fitAndResizeTerminal(pane.id);
      }, 40);
    });
    observer.observe(container);

    return () => {
      window.clearTimeout(resizeTimer);
      observer.disconnect();
      detachTerminal(pane.id);
    };
  }, [pane.id, transport, setPaneSession, setPaneDetectedHostname]);

  const handleDragOver = (e: React.DragEvent) => {
    const payload = draggingItem ?? useAppStore.getState().draggingItem;
    if (
      !payload ||
      payload.kind === 'dock-view' ||
      payload.kind === 'folder'
    ) {
      return;
    }
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const zone = detectDropZone(
      e.clientX,
      e.clientY,
      wrapper.getBoundingClientRect()
    );
    const check = canDropOnPane(
      useAppStore.getState().tabs,
      tabId,
      pane.id,
      zone,
      payload
    );
    if (check.allowed || check.reason) {
      e.preventDefault();
      e.dataTransfer.dropEffect = check.allowed ? 'move' : 'none';
      setDropHint({ zone, allowed: check.allowed, reason: check.reason });
    } else {
      setDropHint(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    const payload = draggingItem ?? useAppStore.getState().draggingItem;
    if (
      !payload ||
      payload.kind === 'dock-view' ||
      payload.kind === 'folder'
    ) {
      return;
    }
    e.preventDefault();
    const wrapper = wrapperRef.current;
    const zone = wrapper
      ? detectDropZone(e.clientX, e.clientY, wrapper.getBoundingClientRect())
      : dropHint?.zone;
    setDropHint(null);
    setDraggingItem(null);
    if (!zone) return;
    const check = canDropOnPane(
      useAppStore.getState().tabs,
      tabId,
      pane.id,
      zone,
      payload
    );
    if (!check.allowed) return;
    void dropOnPane(tabId, pane.id, zone, payload);
  };

  return (
    <div
      ref={wrapperRef}
      className={`pane-wrapper ${isFocused ? 'focused' : ''} ${
        isPaneDragActive ? 'drag-active' : ''
      }`}
      onMouseDown={() => {
        setActivePane(pane.id);
        focusTerminal(pane.id);
      }}
      onDragEnter={(e) => {
        if (isPaneDragActive) e.preventDefault();
      }}
      onDragOver={handleDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDropHint(null);
        }
      }}
      onDrop={handleDrop}
    >
      <div
        className="pane-header"
        draggable
        title="헤더를 드래그해 다른 쉘에 놓으면 자동 분할(최대 2×2), 탭 바에 놓으면 새 탭 분리"
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', pane.id);
          setDraggingItem({ kind: 'pane', tabId, paneId: pane.id });
        }}
        onDragEnd={() => {
          setDraggingItem(null);
          setDropHint(null);
        }}
      >
        <div className="pane-title-group">
          <GripVertical
            size={12}
            style={{ color: 'var(--text-muted)', cursor: 'grab', flexShrink: 0 }}
          />
          <span className="proto-tag">{getProtocolBadge(pane.protocol)}</span>
          <span className="row-label">{pane.title}</span>
          {pane.detectedHostname && pane.protocol === 'ssh' && (
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              ({pane.detectedHostname})
            </span>
          )}
          {pane.status === 'connecting' && (
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              연결 중...
            </span>
          )}
          {pane.status === 'error' && (
            <span style={{ color: 'var(--danger)', fontSize: 11 }}>오류</span>
          )}
        </div>

        <div className="pane-actions">
          <button
            className="icon-btn"
            style={{ padding: 3 }}
            onClick={(e) => {
              e.stopPropagation();
              openSaveBookmarkFromPane(pane);
            }}
            title="현재 세션을 북마크에 저장 (Ctrl+Shift+D)"
          >
            <BookmarkPlus size={12} />
          </button>
          <button
            className="icon-btn"
            style={{ padding: 3 }}
            onClick={(e) => {
              e.stopPropagation();
              toggleSearchPane(pane.id);
            }}
            title="검색 (Ctrl+Shift+F)"
          >
            <Search size={12} />
          </button>
          <button
            className="icon-btn"
            style={{ padding: 3 }}
            onClick={(e) => {
              e.stopPropagation();
              requestClosePane(tabId, pane.id);
            }}
            title="패인 닫기"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {isSearchOpen && (
        <div className="pane-search-bar">
          <input
            type="text"
            placeholder="터미널 출력 검색..."
            value={searchText}
            autoFocus
            onChange={(e) => {
              setSearchText(e.target.value);
              searchTerminal(pane.id, e.target.value, 'next');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchText) {
                searchTerminal(
                  pane.id,
                  searchText,
                  e.shiftKey ? 'prev' : 'next'
                );
              } else if (e.key === 'Escape') {
                toggleSearchPane(null);
              }
            }}
          />
          <button
            className="btn-secondary"
            style={{ padding: '4px 8px' }}
            onClick={() => searchTerminal(pane.id, searchText, 'prev')}
          >
            이전
          </button>
          <button
            className="btn-secondary"
            style={{ padding: '4px 8px' }}
            onClick={() => searchTerminal(pane.id, searchText, 'next')}
          >
            다음
          </button>
          <button className="icon-btn" onClick={() => toggleSearchPane(null)}>
            <X size={13} />
          </button>
        </div>
      )}

      <div className="pane-stage">
        <div ref={containerRef} className="pane-xterm" />

        {dropHint && (
          <div
            className={`drop-overlay zone-${dropHint.zone} ${
              dropHint.allowed ? 'allowed' : 'blocked'
            }`}
          >
            <span>
              {dropHint.allowed
                ? ZONE_LABEL[dropHint.zone]
                : dropHint.reason ?? '분할 불가'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
