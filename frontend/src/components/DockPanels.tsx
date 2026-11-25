import React from 'react';
import { useAppStore } from '../store/useAppStore';
import type { DockViewId } from '../types';
import { BroadcastDrawer } from './BroadcastDrawer';
import { SftpDrawer } from './SftpDrawer';
import { Sidebar } from './Sidebar';

const VIEW_TITLE: Record<DockViewId, string> = {
  bookmarks: '세션 북마크',
  broadcast: 'Broadcast 입력',
  sftp: 'SFTP 탐색기',
};

function renderDockView(viewId: DockViewId): React.ReactNode {
  switch (viewId) {
    case 'bookmarks':
      return <Sidebar />;
    case 'broadcast':
      return <BroadcastDrawer />;
    case 'sftp':
      return <SftpDrawer />;
  }
}

export const SidePanel: React.FC<{ zone: 'left' | 'right' }> = ({ zone }) => {
  const {
    leftOpen,
    leftActiveView,
    leftWidth,
    rightOpen,
    rightActiveView,
    rightWidth,
    setZoneSize,
  } = useAppStore();

  const isOpen = zone === 'left' ? leftOpen : rightOpen;
  const activeView = zone === 'left' ? leftActiveView : rightActiveView;
  const width = zone === 'left' ? leftWidth : rightWidth;

  if (!isOpen || !activeView) return null;

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const onMove = (moveEvent: MouseEvent) => {
      const delta =
        zone === 'left'
          ? moveEvent.clientX - startX
          : startX - moveEvent.clientX;
      setZoneSize(zone, startWidth + delta);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const panelNode = (
    <aside className={`dock-side-panel ${zone}`} style={{ width }}>
      {activeView !== 'bookmarks' && (
        <div className="dock-panel-header">
          <span>{VIEW_TITLE[activeView]}</span>
        </div>
      )}
      <div className="dock-panel-body">{renderDockView(activeView)}</div>
    </aside>
  );

  const resizerNode = (
    <div
      className="panel-resizer-v"
      onMouseDown={handleResizeMouseDown}
      title="드래그하여 패널 너비 조절"
    />
  );

  return zone === 'left' ? (
    <>
      {panelNode}
      {resizerNode}
    </>
  ) : (
    <>
      {resizerNode}
      {panelNode}
    </>
  );
};

export const BottomPanel: React.FC = () => {
  const {
    bottomOpen,
    bottomActiveView,
    bottomHeight,
    setZoneSize,
  } = useAppStore();

  if (!bottomOpen || !bottomActiveView) return null;

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = bottomHeight;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      setZoneSize('bottom', startHeight + delta);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <section className="bottom-dock" style={{ height: bottomHeight }}>
      <div
        className="panel-resizer-h"
        onMouseDown={handleResizeMouseDown}
        title="드래그하여 하단 창 높이 조절"
      />
      <div className="bottom-dock-header">
        <span className="bottom-dock-title">{VIEW_TITLE[bottomActiveView]}</span>
      </div>
      <div className="bottom-dock-body">{renderDockView(bottomActiveView)}</div>
    </section>
  );
};
