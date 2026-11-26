import React, { useState } from 'react';
import {
  BookOpen,
  Plus,
  Settings,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

const LayoutLeftIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect
      x="1.75"
      y="2.75"
      width="14.5"
      height="12.5"
      rx="2.5"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    {active ? (
      <path
        d="M2.2 5.2C2.2 3.85 3.1 3.1 4.4 3.1H6.5V14.9H4.4C3.1 14.9 2.2 14.15 2.2 12.8V5.2Z"
        fill="currentColor"
      />
    ) : (
      <line x1="6.5" y1="3" x2="6.5" y2="15" stroke="currentColor" strokeWidth="1.5" />
    )}
  </svg>
);

const LayoutBottomIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect
      x="1.75"
      y="2.75"
      width="14.5"
      height="12.5"
      rx="2.5"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    {active ? (
      <path
        d="M2.2 11H15.8V12.8C15.8 14.15 14.9 14.9 13.6 14.9H4.4C3.1 14.9 2.2 14.15 2.2 12.8V11Z"
        fill="currentColor"
      />
    ) : (
      <line x1="2" y1="11" x2="16" y2="11" stroke="currentColor" strokeWidth="1.5" />
    )}
  </svg>
);

const LayoutRightIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect
      x="1.75"
      y="2.75"
      width="14.5"
      height="12.5"
      rx="2.5"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    {active ? (
      <path
        d="M11.5 3.1H13.6C14.9 3.1 15.8 3.85 15.8 5.2V12.8C15.8 14.15 14.9 14.9 13.6 14.9H11.5V3.1Z"
        fill="currentColor"
      />
    ) : (
      <line x1="11.5" y1="3" x2="11.5" y2="15" stroke="currentColor" strokeWidth="1.5" />
    )}
  </svg>
);

export const TopBar: React.FC = () => {
  const {
    tabs,
    activeTabId,
    leftOpen,
    rightOpen,
    bottomOpen,
    draggingItem,
    openLocalTab,
    openQuickSshModal,
    setActiveTab,
    requestCloseTab,
    toggleZoneOpen,
    setSettingsOpen,
    openManual,
    setDraggingItem,
    detachPaneToNewTab,
  } = useAppStore();

  const [tabDropHover, setTabDropHover] = useState(false);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand-pill">
          <Terminal size={16} />
          <span>Conduit</span>
        </div>

        <div
          className={`tab-strip ${tabDropHover ? 'tab-strip-drop' : ''}`}
          onDragOver={(e) => {
            if (draggingItem?.kind === 'pane') {
              e.preventDefault();
              setTabDropHover(true);
            }
          }}
          onDragLeave={() => setTabDropHover(false)}
          onDrop={(e) => {
            setTabDropHover(false);
            if (draggingItem?.kind === 'pane') {
              e.preventDefault();
              detachPaneToNewTab(draggingItem.tabId, draggingItem.paneId);
              setDraggingItem(null);
            }
          }}
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`tab-item ${tab.id === activeTabId ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              role="button"
              tabIndex={0}
              draggable
              title="드래그하여 다른 창에 놓으면 2×2 분할됩니다"
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', tab.id);
                setDraggingItem({ kind: 'tab', tabId: tab.id });
              }}
              onDragEnd={() => setDraggingItem(null)}
            >
              <span className="tab-title">{tab.title}</span>
              <button
                className="icon-btn"
                style={{ padding: 2 }}
                onClick={(e) => {
                  e.stopPropagation();
                  requestCloseTab(tab.id);
                }}
                title="탭 닫기"
              >
                <X size={12} />
              </button>
            </div>
          ))}

          <button
            className="icon-btn"
            onClick={openLocalTab}
            title="새 로컬 터미널 탭 (Ctrl+Shift+T)"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      <div className="topbar-actions">
        <button
          className="icon-btn"
          onClick={openQuickSshModal}
          title="간편 SSH 연결 (Ctrl+Shift+E)"
        >
          <Zap size={15} />
          <span>새 연결</span>
        </button>

        <div className="layout-toggle-group" aria-label="패널 레이아웃 토글">
          <button
            className={`layout-toggle-btn ${leftOpen ? 'is-on' : ''}`}
            onClick={() => toggleZoneOpen('left')}
            title="좌측 사이드바 토글 (Ctrl+B)"
          >
            <LayoutLeftIcon active={leftOpen} />
          </button>
          <button
            className={`layout-toggle-btn ${bottomOpen ? 'is-on' : ''}`}
            onClick={() => toggleZoneOpen('bottom')}
            title="하단 패널 토글 (Ctrl+J)"
          >
            <LayoutBottomIcon active={bottomOpen} />
          </button>
          <button
            className={`layout-toggle-btn ${rightOpen ? 'is-on' : ''}`}
            onClick={() => toggleZoneOpen('right')}
            title="우측 사이드바 토글 (Ctrl+Alt+B)"
          >
            <LayoutRightIcon active={rightOpen} />
          </button>
        </div>

        <button
          className="icon-btn"
          onClick={() => setSettingsOpen(true)}
          title="설정 (Ctrl+,)"
        >
          <Settings size={15} />
        </button>

        <button
          className="icon-btn"
          onClick={() => openManual()}
          title="사용자 매뉴얼 (F1)"
        >
          <BookOpen size={15} />
          <span>매뉴얼</span>
        </button>
      </div>
    </header>
  );
};
