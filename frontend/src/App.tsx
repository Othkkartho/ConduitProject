import React, { useEffect } from 'react';
import { ActivityBar } from './components/ActivityBar';
import { BookmarkTransferModal } from './components/BookmarkTransferModal';
import { ConfirmCloseModal } from './components/ConfirmCloseModal';
import { ConfirmDeleteModal } from './components/ConfirmDeleteModal';
import { BottomPanel, SidePanel } from './components/DockPanels';
import { QuickConnectModal } from './components/QuickConnectModal';
import { SettingsModal } from './components/SettingsModal';
import { SplitLayout } from './components/SplitLayout';
import { SshPasswordModal } from './components/SshPasswordModal';
import { TopBar } from './components/TopBar';
import { UserManualModal } from './components/UserManualModal';
import { useAppStore } from './store/useAppStore';
import { getThemePreset } from './themes/presets';

export const App: React.FC = () => {
  const {
    transport,
    tabs,
    activeTabId,
    settings,
    initialize,
    openLocalTab,
    cycleTab,
    openQuickSshModal,
    openSaveBookmarkFromPane,
    toggleZoneOpen,
    toggleView,
    setSettingsOpen,
    openManual,
    toggleSearchPane,
    getActivePane,
  } = useAppStore();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Apply selected theme CSS variables to document root
  useEffect(() => {
    const preset = getThemePreset(settings.theme);
    const root = document.documentElement.style;
    root.setProperty('--bg-base', preset.ui.bgBase);
    root.setProperty('--bg-surface', preset.ui.bgSurface);
    root.setProperty('--bg-elevated', preset.ui.bgElevated);
    root.setProperty('--border-color', preset.ui.border);
    root.setProperty('--text-primary', preset.ui.textPrimary);
    root.setProperty('--text-muted', preset.ui.textMuted);
    root.setProperty('--accent', preset.ui.accent);
    root.setProperty('--accent-text', preset.ui.accentText);
    root.setProperty('--broadcast', preset.ui.broadcast);
    root.setProperty('--danger', preset.ui.danger);
  }, [settings.theme]);

  // Native Desktop menu bar events
  useEffect(() => {
    if (!transport.onHostMenuEvent) return;
    let cleanup: (() => void) | undefined;
    void transport
      .onHostMenuEvent((event) => {
        switch (event) {
          case 'open-user-manual':
            openManual();
            break;
          case 'open-settings':
            setSettingsOpen(true);
            break;
          case 'open-quick-ssh':
            openQuickSshModal();
            break;
          case 'save-bookmark-from-pane': {
            const pane = getActivePane();
            if (pane) openSaveBookmarkFromPane(pane);
            break;
          }
          case 'toggle-left-sidebar':
            toggleZoneOpen('left');
            break;
          case 'toggle-right-sidebar':
            toggleZoneOpen('right');
            break;
          case 'toggle-bottom-panel':
            toggleZoneOpen('bottom');
            break;
          case 'toggle-view-bookmarks':
            toggleView('bookmarks');
            break;
          case 'toggle-view-broadcast':
            toggleView('broadcast');
            break;
          case 'toggle-view-sftp':
            toggleView('sftp');
            break;
        }
      })
      .then((fn) => {
        cleanup = fn;
      });
    return () => cleanup?.();
  }, [
    transport,
    openManual,
    setSettingsOpen,
    openQuickSshModal,
    openSaveBookmarkFromPane,
    getActivePane,
    toggleZoneOpen,
    toggleView,
  ]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === 'F1') {
        e.preventDefault();
        openManual();
        return;
      }
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      if (!e.ctrlKey) return;

      const key = e.key.toUpperCase();
      if (e.altKey && key === 'B') {
        e.preventDefault();
        toggleZoneOpen('right');
        return;
      }
      if (!e.shiftKey && !e.altKey) {
        if (key === 'B') {
          e.preventDefault();
          toggleZoneOpen('left');
          return;
        }
        if (key === 'J') {
          e.preventDefault();
          toggleZoneOpen('bottom');
          return;
        }
      }

      if (!e.shiftKey) return;
      if (key === 'T') {
        e.preventDefault();
        openLocalTab();
      } else if (key === 'E') {
        e.preventDefault();
        openQuickSshModal();
      } else if (key === 'D') {
        e.preventDefault();
        const pane = getActivePane();
        if (pane) openSaveBookmarkFromPane(pane);
      } else if (key === 'B') {
        e.preventDefault();
        toggleView('bookmarks');
      } else if (key === 'M') {
        e.preventDefault();
        toggleView('broadcast');
      } else if (key === 'S') {
        e.preventDefault();
        toggleView('sftp');
      } else if (key === 'F') {
        e.preventDefault();
        const pane = getActivePane();
        if (pane) toggleSearchPane(pane.id);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    cycleTab,
    openManual,
    setSettingsOpen,
    openLocalTab,
    openQuickSshModal,
    openSaveBookmarkFromPane,
    toggleZoneOpen,
    toggleView,
    getActivePane,
    toggleSearchPane,
  ]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div className="app-shell">
      <TopBar />
      <div className="workspace-body">
        <ActivityBar zone="left" />
        <SidePanel zone="left" />

        <main className="center-column">
          <div className="terminal-stage">
            {activeTab ? (
              <SplitLayout tabId={activeTab.id} node={activeTab.root} />
            ) : (
              <div className="empty-state">
                <p>열려 있는 터미널 세션이 없습니다.</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary" onClick={openLocalTab}>
                    새 로컬 터미널 (Ctrl+Shift+T)
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={openQuickSshModal}
                  >
                    간편 SSH 연결 (Ctrl+Shift+E)
                  </button>
                  <button className="btn-secondary" onClick={() => openManual()}>
                    사용자 매뉴얼 (F1)
                  </button>
                </div>
              </div>
            )}
          </div>
          <BottomPanel />
          <ActivityBar zone="bottom" />
        </main>

        <SidePanel zone="right" />
        <ActivityBar zone="right" />
      </div>

      <QuickConnectModal />
      <SshPasswordModal />
      <SettingsModal />
      <UserManualModal />
      <ConfirmCloseModal />
      <ConfirmDeleteModal />
      <BookmarkTransferModal />
    </div>
  );
};

export default App;
