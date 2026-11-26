import { create } from 'zustand';
import { getTransport, type AppTransport } from '../transport/factory';
import {
  applySettingsToAllTerminals,
  disposeTerminal,
  focusTerminal,
} from '../utils/terminalRegistry';
import type {
  AppSettings,
  Bookmark,
  BookmarkExportBundle,
  BookmarkImportResult,
  BookmarkTree,
  BroadcastMode,
  DockViewId,
  DockZone,
  DragPayload,
  DropZone,
  Folder,
  ImportMode,
  PaneNode,
  PendingCloseState,
  PendingDeleteState,
  ProtocolType,
  QuickSshModalState,
  QuickSshPromptState,
  SaveFromPaneDraft,
  SessionConfig,
  SessionId,
  SplitDirection,
  SplitNode,
  TabItem,
  TreeReorderRequest,
} from '../types';

const uid = () => Math.random().toString(36).slice(2, 10);

const ALL_DOCK_VIEWS: DockViewId[] = ['bookmarks', 'broadcast', 'sftp'];

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'catppuccin-mocha',
  font_family:
    '"JetBrainsMono Nerd Font", "Cascadia Code", "FiraCode Nerd Font", monospace',
  font_size: 14,
  ligatures: true,
  cursor_style: 'block',
  cursor_blink: true,
  scrollback: 10000,
  confirm_on_close: true,
  shortcuts: {
    manual: 'F1',
    new_tab: 'Ctrl+Shift+T',
    next_tab: 'Ctrl+Tab',
    prev_tab: 'Ctrl+Shift+Tab',
    quick_connect: 'Ctrl+Shift+E',
    save_bookmark: 'Ctrl+Shift+D',
    toggle_bookmarks: 'Ctrl+Shift+B',
    toggle_broadcast: 'Ctrl+Shift+M',
    toggle_sftp: 'Ctrl+Shift+S',
    toggle_left_sidebar: 'Ctrl+B',
    toggle_bottom_panel: 'Ctrl+J',
    toggle_right_sidebar: 'Ctrl+Alt+B',
    search_terminal: 'Ctrl+Shift+F',
    open_settings: 'Ctrl+,',
  },
};

export function createLocalPtyConfig(): SessionConfig {
  return {
    protocol: 'local_pty',
    size: { cols: 100, rows: 30 },
  };
}

function makePane(title: string, config: SessionConfig): PaneNode {
  return {
    type: 'pane',
    id: `pane-${uid()}`,
    title,
    protocol: config.protocol,
    config,
    sessionId: null,
    status: 'connecting',
  };
}

function findPane(node: SplitNode, paneId: string): PaneNode | null {
  if (node.type === 'pane') {
    return node.id === paneId ? node : null;
  }
  return findPane(node.first, paneId) ?? findPane(node.second, paneId);
}

function firstPane(node: SplitNode): PaneNode {
  return node.type === 'pane' ? node : firstPane(node.first);
}

export function collectPanes(node: SplitNode, out: PaneNode[] = []): PaneNode[] {
  if (node.type === 'pane') {
    out.push(node);
  } else {
    collectPanes(node.first, out);
    collectPanes(node.second, out);
  }
  return out;
}

function countPanes(node: SplitNode): number {
  if (node.type === 'pane') return 1;
  return countPanes(node.first) + countPanes(node.second);
}

function collectAncestorDirections(
  node: SplitNode,
  targetPaneId: string,
  acc: SplitDirection[] = []
): SplitDirection[] | null {
  if (node.type === 'pane') {
    return node.id === targetPaneId ? acc : null;
  }
  const inFirst = collectAncestorDirections(node.first, targetPaneId, [
    ...acc,
    node.direction,
  ]);
  if (inFirst) return inFirst;
  return collectAncestorDirections(node.second, targetPaneId, [
    ...acc,
    node.direction,
  ]);
}

function hasDirectionInSubtree(
  node: SplitNode,
  direction: SplitDirection
): boolean {
  if (node.type === 'pane') return false;
  if (node.direction === direction) return true;
  return (
    hasDirectionInSubtree(node.first, direction) ||
    hasDirectionInSubtree(node.second, direction)
  );
}

export function canSplitPaneAt(
  root: SplitNode,
  targetPaneId: string,
  direction: SplitDirection,
  incomingPaneCount = 1,
  incomingNode?: SplitNode
): boolean {
  if (countPanes(root) + incomingPaneCount > 4) return false;
  const ancestors = collectAncestorDirections(root, targetPaneId);
  if (!ancestors) return false;
  if (ancestors.includes(direction)) return false;
  if (incomingNode && hasDirectionInSubtree(incomingNode, direction)) {
    return false;
  }
  return true;
}

function mapPane(
  node: SplitNode,
  paneId: string,
  updater: (p: PaneNode) => PaneNode
): SplitNode {
  if (node.type === 'pane') {
    return node.id === paneId ? updater(node) : node;
  }
  return {
    ...node,
    first: mapPane(node.first, paneId, updater),
    second: mapPane(node.second, paneId, updater),
  };
}

function insertSplitAtPane(
  node: SplitNode,
  targetPaneId: string,
  direction: SplitDirection,
  incoming: SplitNode,
  placeFirst: boolean
): SplitNode {
  if (node.type === 'pane') {
    if (node.id !== targetPaneId) return node;
    return {
      type: 'split',
      id: `split-${uid()}`,
      direction,
      ratio: 0.5,
      first: placeFirst ? incoming : node,
      second: placeFirst ? node : incoming,
    };
  }
  return {
    ...node,
    first: insertSplitAtPane(
      node.first,
      targetPaneId,
      direction,
      incoming,
      placeFirst
    ),
    second: insertSplitAtPane(
      node.second,
      targetPaneId,
      direction,
      incoming,
      placeFirst
    ),
  };
}

function swapPanesInTree(
  node: SplitNode,
  paneIdA: string,
  paneIdB: string
): SplitNode {
  const paneA = findPane(node, paneIdA);
  const paneB = findPane(node, paneIdB);
  if (!paneA || !paneB) return node;

  const replace = (n: SplitNode): SplitNode => {
    if (n.type === 'pane') {
      if (n.id === paneIdA) return paneB;
      if (n.id === paneIdB) return paneA;
      return n;
    }
    return { ...n, first: replace(n.first), second: replace(n.second) };
  };
  return replace(node);
}

function updateSplitRatioInTree(
  node: SplitNode,
  splitId: string,
  ratio: number
): SplitNode {
  if (node.type === 'pane') return node;
  if (node.id === splitId) {
    return { ...node, ratio: Math.min(0.85, Math.max(0.15, ratio)) };
  }
  return {
    ...node,
    first: updateSplitRatioInTree(node.first, splitId, ratio),
    second: updateSplitRatioInTree(node.second, splitId, ratio),
  };
}

function removePaneFromTree(node: SplitNode, paneId: string): SplitNode | null {
  if (node.type === 'pane') {
    return node.id === paneId ? null : node;
  }
  const nextFirst = removePaneFromTree(node.first, paneId);
  const nextSecond = removePaneFromTree(node.second, paneId);
  if (!nextFirst) return nextSecond;
  if (!nextSecond) return nextFirst;
  return { ...node, first: nextFirst, second: nextSecond };
}

export function canDropOnPane(
  tabs: TabItem[],
  targetTabId: string,
  targetPaneId: string,
  zone: DropZone,
  payload: DragPayload | null
): { allowed: boolean; reason?: string } {
  if (
    !payload ||
    payload.kind === 'dock-view' ||
    payload.kind === 'folder'
  ) {
    return { allowed: false };
  }
  const targetTab = tabs.find((t) => t.id === targetTabId);
  if (!targetTab) return { allowed: false };

  if (payload.kind === 'pane') {
    if (payload.paneId === targetPaneId) return { allowed: false };
    if (zone === 'center') return { allowed: true };
    const direction: SplitDirection =
      zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical';
    if (payload.tabId === targetTabId) {
      const reduced = removePaneFromTree(targetTab.root, payload.paneId);
      if (!reduced) return { allowed: false };
      if (!canSplitPaneAt(reduced, targetPaneId, direction, 1)) {
        return { allowed: false, reason: '최대 2×2 분할 제한' };
      }
      return { allowed: true };
    }
    if (!canSplitPaneAt(targetTab.root, targetPaneId, direction, 1)) {
      return { allowed: false, reason: '최대 2×2 분할 제한' };
    }
    return { allowed: true };
  }

  if (payload.kind === 'tab') {
    if (payload.tabId === targetTabId || zone === 'center') {
      return { allowed: false };
    }
    const sourceTab = tabs.find((t) => t.id === payload.tabId);
    if (!sourceTab) return { allowed: false };
    const direction: SplitDirection =
      zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical';
    const incomingCount = countPanes(sourceTab.root);
    if (
      !canSplitPaneAt(
        targetTab.root,
        targetPaneId,
        direction,
        incomingCount,
        sourceTab.root
      )
    ) {
      return { allowed: false, reason: '최대 2×2 분할 제한' };
    }
    return { allowed: true };
  }

  if (payload.kind === 'bookmark') {
    if (zone === 'center') return { allowed: false };
    const direction: SplitDirection =
      zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical';
    if (!canSplitPaneAt(targetTab.root, targetPaneId, direction, 1)) {
      return { allowed: false, reason: '최대 2×2 분할 제한' };
    }
    return { allowed: true };
  }

  return { allowed: false };
}

export function getViewsInZone(
  viewZone: Record<DockViewId, DockZone>,
  zone: DockZone
): DockViewId[] {
  return ALL_DOCK_VIEWS.filter((v) => viewZone[v] === zone);
}

interface ConnectedPaneEntry {
  tabId: string;
  tabTitle: string;
  pane: PaneNode;
}

interface AppState {
  transport: AppTransport;
  tabs: TabItem[];
  activeTabId: string | null;
  activePaneId: string | null;
  bookmarkTree: BookmarkTree;
  settings: AppSettings;

  // VS Code-style Dock & ActivityBar layout state
  viewZone: Record<DockViewId, DockZone>;
  leftOpen: boolean;
  leftActiveView: DockViewId | null;
  leftWidth: number;
  rightOpen: boolean;
  rightActiveView: DockViewId | null;
  rightWidth: number;
  bottomOpen: boolean;
  bottomActiveView: DockViewId | null;
  bottomHeight: number;

  // Broadcast drawer state
  broadcastMode: BroadcastMode;

  // Modals, password prompt, close confirmation & search
  settingsOpen: boolean;
  manualOpen: boolean;
  manualSectionId: string;
  quickConnectOpen: boolean;
  editingBookmark: Bookmark | null;
  quickConnectDefaultFolderId: string | null;
  saveFromPaneDraft: SaveFromPaneDraft | null;
  quickSshModal: QuickSshModalState | null;
  rememberedSshPasswords: Record<string, string>;
  pendingClose: PendingCloseState | null;
  pendingDelete: PendingDeleteState | null;
  bookmarkTransferModal: 'export' | 'import' | null;
  searchPaneId: string | null;

  // Drag state
  draggingItem: DragPayload | null;

  initialize: () => Promise<void>;
  openSessionTab: (title: string, config: SessionConfig) => void;
  openLocalTab: () => void;
  setActiveTab: (tabId: string) => void;
  cycleTab: (direction: 1 | -1) => void;
  setActivePane: (paneId: string) => void;
  closeTab: (tabId: string) => void;
  closePane: (tabId: string, paneId: string) => void;
  requestCloseTab: (tabId: string) => void;
  requestClosePane: (tabId: string, paneId: string) => void;
  confirmPendingClose: () => void;
  cancelPendingClose: () => void;
  setSplitRatio: (tabId: string, splitId: string, ratio: number) => void;
  setPaneSession: (
    paneId: string,
    sessionId: SessionId | null,
    status: PaneNode['status'],
    errorMessage?: string
  ) => void;
  setPaneDetectedHostname: (paneId: string, hostname: string) => void;

  setDraggingItem: (item: DragPayload | null) => void;
  dropOnPane: (
    targetTabId: string,
    targetPaneId: string,
    zone: DropZone,
    payload: DragPayload
  ) => Promise<void>;
  detachPaneToNewTab: (sourceTabId: string, paneId: string) => void;

  // VS Code Dock & Activity Bar actions
  toggleZoneOpen: (zone: DockZone) => void;
  toggleView: (viewId: DockViewId) => void;
  moveViewToZone: (viewId: DockViewId, targetZone: DockZone) => void;
  setZoneSize: (zone: DockZone, size: number) => void;

  // Broadcast controls
  setBroadcastMode: (mode: BroadcastMode) => void;
  getAllConnectedPanes: () => ConnectedPaneEntry[];
  getVisibleConnectedPanes: () => PaneNode[];
  getBroadcastTargetIds: () => SessionId[];
  sendBroadcastInput: (text: string, appendCr?: boolean) => Promise<number>;
  sendBroadcastCtrlC: () => Promise<number>;

  // Modals & SSH Quick Password Prompt
  setSettingsOpen: (open: boolean) => void;
  openManual: (sectionId?: string) => void;
  setManualOpen: (open: boolean) => void;
  setManualSection: (sectionId: string) => void;
  openQuickConnect: (
    bookmark?: Bookmark | null,
    defaultFolderId?: string | null
  ) => void;
  openSaveBookmarkFromPane: (pane: PaneNode) => void;
  closeQuickConnect: () => void;
  openQuickSshModal: () => void;
  proceedQuickSshToPassword: (target: QuickSshPromptState) => void;
  closeQuickSshModal: () => void;
  submitSshPassword: (password: string, remember: boolean) => void;
  toggleSearchPane: (paneId: string | null) => void;

  // Storage & Delete Confirmation / Import-Export
  refreshBookmarks: () => Promise<void>;
  saveFolder: (folder: Folder) => Promise<void>;
  removeFolder: (id: string) => Promise<void>;
  saveBookmark: (bookmark: Bookmark, secret?: string) => Promise<void>;
  removeBookmark: (id: string) => Promise<void>;
  reorderBookmarkTree: (req: TreeReorderRequest) => Promise<void>;
  requestDeleteBookmark: (bm: Bookmark) => void;
  requestDeleteFolder: (folder: Folder) => void;
  requestDeleteSftpEntry: (params: {
    sessionId: SessionId;
    path: string;
    name: string;
    isDir: boolean;
    onDone: () => void;
  }) => void;
  confirmPendingDelete: () => Promise<void>;
  cancelPendingDelete: () => void;
  openBookmarkTransfer: (tab: 'export' | 'import') => void;
  closeBookmarkTransfer: () => void;
  exportBookmarksBundle: (includeSecrets: boolean) => Promise<BookmarkExportBundle>;
  importBookmarksBundle: (
    bundle: BookmarkExportBundle,
    mode: ImportMode
  ) => Promise<BookmarkImportResult>;
  connectBookmark: (bookmark: Bookmark) => Promise<void>;
  updateSettings: (settings: AppSettings) => Promise<void>;
  getActivePane: () => PaneNode | null;
}

const initialPane = makePane('Local Shell', createLocalPtyConfig());
const initialTab: TabItem = {
  id: `tab-${uid()}`,
  title: 'Local Shell',
  root: initialPane,
};

export const useAppStore = create<AppState>((set, get) => ({
  transport: getTransport(),
  tabs: [initialTab],
  activeTabId: initialTab.id,
  activePaneId: initialPane.id,
  bookmarkTree: { folders: [], bookmarks: [] },
  settings: DEFAULT_SETTINGS,

  viewZone: {
    bookmarks: 'left',
    broadcast: 'bottom',
    sftp: 'bottom',
  },
  leftOpen: true,
  leftActiveView: 'bookmarks',
  leftWidth: 260,
  rightOpen: false,
  rightActiveView: null,
  rightWidth: 260,
  bottomOpen: false,
  bottomActiveView: 'broadcast',
  bottomHeight: 195,

  broadcastMode: 'visible',

  settingsOpen: false,
  manualOpen: false,
  manualSectionId: 'getting-started',
  quickConnectOpen: false,
  editingBookmark: null,
  quickConnectDefaultFolderId: null,
  saveFromPaneDraft: null,
  quickSshModal: null,
  rememberedSshPasswords: {},
  pendingClose: null,
  pendingDelete: null,
  bookmarkTransferModal: null,
  searchPaneId: null,
  draggingItem: null,

  initialize: async () => {
    const { transport } = get();
    try {
      const [tree, loadedSettings] = await Promise.all([
        transport.listBookmarkTree(),
        transport.getSettings(),
      ]);
      const normalized: AppSettings = {
        ...DEFAULT_SETTINGS,
        ...loadedSettings,
        confirm_on_close: loadedSettings.confirm_on_close ?? true,
      };
      set({ bookmarkTree: tree, settings: normalized });
      applySettingsToAllTerminals(normalized);
    } catch (err) {
      console.warn('Initial load deferred:', err);
    }
  },

  openSessionTab: (title, config) => {
    const pane = makePane(title, config);
    const tab: TabItem = {
      id: `tab-${uid()}`,
      title,
      root: pane,
    };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      activePaneId: pane.id,
    }));
  },

  openLocalTab: () => {
    get().openSessionTab('Local Shell', createLocalPtyConfig());
  },

  setActiveTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const currentPane = get().activePaneId;
    const existsInTab = currentPane ? findPane(tab.root, currentPane) : null;
    set({
      activeTabId: tabId,
      activePaneId: existsInTab ? existsInTab.id : firstPane(tab.root).id,
    });
  },

  cycleTab: (direction) => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) return;
    const curIdx = tabs.findIndex((t) => t.id === activeTabId);
    const startIdx = curIdx === -1 ? 0 : curIdx;
    const nextIdx = (startIdx + direction + tabs.length) % tabs.length;
    const nextTab = tabs[nextIdx];
    if (!nextTab) return;
    const targetPane = firstPane(nextTab.root);
    set({
      activeTabId: nextTab.id,
      activePaneId: targetPane.id,
    });
    window.setTimeout(() => focusTerminal(targetPane.id), 0);
  },

  setActivePane: (paneId) => set({ activePaneId: paneId }),

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    const target = tabs.find((t) => t.id === tabId);
    if (target) {
      collectPanes(target.root).forEach((p) => disposeTerminal(p.id));
    }

    const remaining = tabs.filter((t) => t.id !== tabId);
    if (remaining.length === 0) {
      set({ tabs: [], activeTabId: null, activePaneId: null });
      return;
    }
    const nextActiveTab =
      activeTabId === tabId
        ? remaining[remaining.length - 1]
        : remaining.find((t) => t.id === activeTabId) ?? remaining[0];
    set({
      tabs: remaining,
      activeTabId: nextActiveTab.id,
      activePaneId: firstPane(nextActiveTab.root).id,
    });
  },

  closePane: (tabId, paneId) => {
    const { tabs } = get();
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const targetPane = findPane(tab.root, paneId);
    if (targetPane) {
      disposeTerminal(targetPane.id);
    }

    const nextRoot = removePaneFromTree(tab.root, paneId);
    if (!nextRoot) {
      const remaining = tabs.filter((t) => t.id !== tabId);
      if (remaining.length === 0) {
        set({ tabs: [], activeTabId: null, activePaneId: null });
        return;
      }
      const nextActiveTab =
        get().activeTabId === tabId
          ? remaining[remaining.length - 1]
          : remaining.find((t) => t.id === get().activeTabId) ?? remaining[0];
      set({
        tabs: remaining,
        activeTabId: nextActiveTab.id,
        activePaneId: firstPane(nextActiveTab.root).id,
      });
      return;
    }

    const nextActive = firstPane(nextRoot).id;
    set({
      tabs: tabs.map((t) => (t.id === tabId ? { ...t, root: nextRoot } : t)),
      activePaneId: nextActive,
    });
  },

  requestCloseTab: (tabId) => {
    const { tabs, settings } = get();
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const panes = collectPanes(tab.root);
    const hasActive = panes.some(
      (p) => p.status === 'connected' || p.status === 'connecting'
    );
    if (settings.confirm_on_close && hasActive) {
      set({
        pendingClose: {
          kind: 'tab',
          tabId,
          title: tab.title,
          paneCount: panes.length,
        },
      });
      return;
    }
    get().closeTab(tabId);
  },

  requestClosePane: (tabId, paneId) => {
    const { tabs, settings } = get();
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const pane = findPane(tab.root, paneId);
    if (!pane) return;
    const isActive = pane.status === 'connected' || pane.status === 'connecting';
    if (settings.confirm_on_close && isActive) {
      set({
        pendingClose: {
          kind: 'pane',
          tabId,
          paneId,
          title: pane.title,
        },
      });
      return;
    }
    get().closePane(tabId, paneId);
  },

  confirmPendingClose: () => {
    const pending = get().pendingClose;
    if (!pending) return;
    set({ pendingClose: null });
    if (pending.kind === 'tab') {
      get().closeTab(pending.tabId);
    } else {
      get().closePane(pending.tabId, pending.paneId);
    }
  },

  cancelPendingClose: () => set({ pendingClose: null }),

  setSplitRatio: (tabId, splitId, ratio) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? { ...t, root: updateSplitRatioInTree(t.root, splitId, ratio) }
          : t
      ),
    }));
  },

  setPaneSession: (paneId, sessionId, status, errorMessage) => {
    set((s) => ({
      tabs: s.tabs.map((t) => ({
        ...t,
        root: mapPane(t.root, paneId, (p) => ({
          ...p,
          sessionId,
          status,
          errorMessage,
        })),
      })),
    }));
  },

  setPaneDetectedHostname: (paneId, hostname) => {
    set((s) => ({
      tabs: s.tabs.map((t) => ({
        ...t,
        root: mapPane(t.root, paneId, (p) => ({
          ...p,
          detectedHostname: hostname,
        })),
      })),
    }));
  },

  setDraggingItem: (item) => set({ draggingItem: item }),

  dropOnPane: async (targetTabId, targetPaneId, zone, payload) => {
    const { tabs, transport } = get();
    const check = canDropOnPane(tabs, targetTabId, targetPaneId, zone, payload);
    if (!check.allowed) return;

    const targetTab = tabs.find((t) => t.id === targetTabId);
    if (!targetTab) return;

    const direction: SplitDirection =
      zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical';
    const placeFirst = zone === 'left' || zone === 'top';

    if (payload.kind === 'pane') {
      const sourceTab = tabs.find((t) => t.id === payload.tabId);
      if (!sourceTab) return;
      const sourcePane = findPane(sourceTab.root, payload.paneId);
      if (!sourcePane) return;

      if (payload.tabId === targetTabId) {
        if (zone === 'center') {
          set({
            tabs: tabs.map((t) =>
              t.id === targetTabId
                ? {
                    ...t,
                    root: swapPanesInTree(t.root, payload.paneId, targetPaneId),
                  }
                : t
            ),
            activePaneId: payload.paneId,
          });
          return;
        }
        const reduced = removePaneFromTree(targetTab.root, payload.paneId);
        if (!reduced) return;
        const nextRoot = insertSplitAtPane(
          reduced,
          targetPaneId,
          direction,
          sourcePane,
          placeFirst
        );
        set({
          tabs: tabs.map((t) =>
            t.id === targetTabId ? { ...t, root: nextRoot } : t
          ),
          activePaneId: sourcePane.id,
        });
        return;
      }

      if (zone === 'center') {
        const targetPane = findPane(targetTab.root, targetPaneId);
        if (!targetPane) return;
        const nextSourceRoot = mapPane(
          sourceTab.root,
          sourcePane.id,
          () => targetPane
        );
        const nextTargetRoot = mapPane(
          targetTab.root,
          targetPaneId,
          () => sourcePane
        );
        set({
          tabs: tabs.map((t) => {
            if (t.id === sourceTab.id) return { ...t, root: nextSourceRoot };
            if (t.id === targetTab.id) return { ...t, root: nextTargetRoot };
            return t;
          }),
          activeTabId: targetTabId,
          activePaneId: sourcePane.id,
        });
        return;
      }

      const reducedSource = removePaneFromTree(sourceTab.root, payload.paneId);
      const nextTargetRoot = insertSplitAtPane(
        targetTab.root,
        targetPaneId,
        direction,
        sourcePane,
        placeFirst
      );
      const nextTabs = tabs
        .map((t) => {
          if (t.id === targetTabId) return { ...t, root: nextTargetRoot };
          if (t.id === payload.tabId) {
            return reducedSource ? { ...t, root: reducedSource } : null;
          }
          return t;
        })
        .filter((t): t is TabItem => t !== null);

      set({
        tabs: nextTabs,
        activeTabId: targetTabId,
        activePaneId: sourcePane.id,
      });
      return;
    }

    if (payload.kind === 'tab') {
      const sourceTab = tabs.find((t) => t.id === payload.tabId);
      if (!sourceTab) return;
      const nextTargetRoot = insertSplitAtPane(
        targetTab.root,
        targetPaneId,
        direction,
        sourceTab.root,
        placeFirst
      );
      const nextTabs = tabs
        .filter((t) => t.id !== payload.tabId)
        .map((t) => (t.id === targetTabId ? { ...t, root: nextTargetRoot } : t));
      set({
        tabs: nextTabs,
        activeTabId: targetTabId,
        activePaneId: firstPane(sourceTab.root).id,
      });
      return;
    }

    if (payload.kind === 'bookmark') {
      try {
        const cfg = await transport.buildConfigFromBookmark(
          payload.bookmark.id,
          { cols: 100, rows: 30 }
        );
        const newPane = makePane(payload.bookmark.name, cfg);
        const currentTabs = get().tabs;
        const latestTarget = currentTabs.find((t) => t.id === targetTabId);
        if (!latestTarget) return;
        if (!canSplitPaneAt(latestTarget.root, targetPaneId, direction, 1)) return;
        const nextRoot = insertSplitAtPane(
          latestTarget.root,
          targetPaneId,
          direction,
          newPane,
          placeFirst
        );
        set({
          tabs: currentTabs.map((t) =>
            t.id === targetTabId ? { ...t, root: nextRoot } : t
          ),
          activeTabId: targetTabId,
          activePaneId: newPane.id,
        });
      } catch (err) {
        console.error('Failed to drop bookmark:', err);
      }
    }
  },

  detachPaneToNewTab: (sourceTabId, paneId) => {
    const { tabs } = get();
    const sourceTab = tabs.find((t) => t.id === sourceTabId);
    if (!sourceTab || sourceTab.root.type === 'pane') return;
    const pane = findPane(sourceTab.root, paneId);
    if (!pane) return;
    const reduced = removePaneFromTree(sourceTab.root, paneId);
    if (!reduced) return;

    const newTab: TabItem = {
      id: `tab-${uid()}`,
      title: pane.title,
      root: pane,
    };

    set({
      tabs: [
        ...tabs.map((t) => (t.id === sourceTabId ? { ...t, root: reduced } : t)),
        newTab,
      ],
      activeTabId: newTab.id,
      activePaneId: pane.id,
    });
  },

  toggleZoneOpen: (zone) => {
    const s = get();
    const views = getViewsInZone(s.viewZone, zone);
    if (zone === 'left') {
      if (s.leftOpen) set({ leftOpen: false });
      else if (views.length > 0) {
        set({
          leftOpen: true,
          leftActiveView:
            s.leftActiveView && views.includes(s.leftActiveView)
              ? s.leftActiveView
              : views[0],
        });
      }
    } else if (zone === 'right') {
      if (s.rightOpen) set({ rightOpen: false });
      else if (views.length > 0) {
        set({
          rightOpen: true,
          rightActiveView:
            s.rightActiveView && views.includes(s.rightActiveView)
              ? s.rightActiveView
              : views[0],
        });
      }
    } else {
      if (s.bottomOpen) set({ bottomOpen: false });
      else if (views.length > 0) {
        set({
          bottomOpen: true,
          bottomActiveView:
            s.bottomActiveView && views.includes(s.bottomActiveView)
              ? s.bottomActiveView
              : views[0],
        });
      }
    }
  },

  toggleView: (viewId) => {
    const s = get();
    const zone = s.viewZone[viewId];
    if (zone === 'left') {
      if (s.leftOpen && s.leftActiveView === viewId) {
        set({ leftOpen: false });
      } else {
        set({ leftOpen: true, leftActiveView: viewId });
      }
    } else if (zone === 'right') {
      if (s.rightOpen && s.rightActiveView === viewId) {
        set({ rightOpen: false });
      } else {
        set({ rightOpen: true, rightActiveView: viewId });
      }
    } else {
      if (s.bottomOpen && s.bottomActiveView === viewId) {
        set({ bottomOpen: false });
      } else {
        set({ bottomOpen: true, bottomActiveView: viewId });
      }
    }
  },

  moveViewToZone: (viewId, targetZone) => {
    const s = get();
    const sourceZone = s.viewZone[viewId];
    if (sourceZone === targetZone) {
      // Just ensure it is open and active
      if (targetZone === 'left') set({ leftOpen: true, leftActiveView: viewId });
      if (targetZone === 'right') set({ rightOpen: true, rightActiveView: viewId });
      if (targetZone === 'bottom') set({ bottomOpen: true, bottomActiveView: viewId });
      return;
    }

    const nextViewZone = { ...s.viewZone, [viewId]: targetZone };
    const nextState: Partial<AppState> = { viewZone: nextViewZone };

    // Clean up source zone
    const remainingInSource = getViewsInZone(nextViewZone, sourceZone);
    if (sourceZone === 'left') {
      nextState.leftActiveView = remainingInSource[0] ?? null;
      if (remainingInSource.length === 0) nextState.leftOpen = false;
    } else if (sourceZone === 'right') {
      nextState.rightActiveView = remainingInSource[0] ?? null;
      if (remainingInSource.length === 0) nextState.rightOpen = false;
    } else {
      nextState.bottomActiveView = remainingInSource[0] ?? null;
      if (remainingInSource.length === 0) nextState.bottomOpen = false;
    }

    // Activate in target zone
    if (targetZone === 'left') {
      nextState.leftOpen = true;
      nextState.leftActiveView = viewId;
    } else if (targetZone === 'right') {
      nextState.rightOpen = true;
      nextState.rightActiveView = viewId;
    } else {
      nextState.bottomOpen = true;
      nextState.bottomActiveView = viewId;
    }

    set(nextState);
  },

  setZoneSize: (zone, size) => {
    if (zone === 'left') {
      set({ leftWidth: Math.min(520, Math.max(180, size)) });
    } else if (zone === 'right') {
      set({ rightWidth: Math.min(520, Math.max(180, size)) });
    } else {
      set({ bottomHeight: Math.min(520, Math.max(110, size)) });
    }
  },

  setBroadcastMode: (mode) => set({ broadcastMode: mode }),

  getAllConnectedPanes: () => {
    const { tabs } = get();
    const result: ConnectedPaneEntry[] = [];
    for (const tab of tabs) {
      for (const pane of collectPanes(tab.root)) {
        if (pane.sessionId !== null) {
          result.push({ tabId: tab.id, tabTitle: tab.title, pane });
        }
      }
    }
    return result;
  },

  getVisibleConnectedPanes: () => {
    const { tabs, activeTabId } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return [];
    return collectPanes(tab.root).filter((p) => p.sessionId !== null);
  },

  getBroadcastTargetIds: () => {
    const { broadcastMode } = get();
    if (broadcastMode === 'all') {
      return get()
        .getAllConnectedPanes()
        .map((e) => e.pane.sessionId!)
        .filter((id, i, arr) => arr.indexOf(id) === i);
    }
    if (broadcastMode === 'visible') {
      return get()
        .getVisibleConnectedPanes()
        .map((p) => p.sessionId!)
        .filter((id, i, arr) => arr.indexOf(id) === i);
    }
    // 'selected' = currently focused active pane only (same target as direct terminal input)
    const activePane = get().getActivePane();
    return activePane?.sessionId !== null && activePane?.sessionId !== undefined
      ? [activePane.sessionId]
      : [];
  },

  sendBroadcastInput: async (text, appendCr = true) => {
    const targets = get().getBroadcastTargetIds();
    if (targets.length === 0) return 0;
    const payloadText = appendCr ? `${text}\r` : text;
    const bytes = new TextEncoder().encode(payloadText);
    await get().transport.broadcast(targets, bytes);
    return targets.length;
  },

  sendBroadcastCtrlC: async () => {
    const targets = get().getBroadcastTargetIds();
    if (targets.length === 0) return 0;
    await get().transport.broadcast(targets, new Uint8Array([0x03]));
    return targets.length;
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),
  openManual: (sectionId) =>
    set((s) => ({
      manualOpen: true,
      manualSectionId: sectionId ?? s.manualSectionId,
    })),
  setManualOpen: (open) => set({ manualOpen: open }),
  setManualSection: (sectionId) => set({ manualSectionId: sectionId }),

  openQuickConnect: (bookmark = null, defaultFolderId = null) =>
    set({
      quickConnectOpen: true,
      editingBookmark: bookmark,
      quickConnectDefaultFolderId: defaultFolderId,
      saveFromPaneDraft: null,
    }),

  openSaveBookmarkFromPane: (pane) => {
    let draft: SaveFromPaneDraft;
    if (pane.config.protocol === 'ssh') {
      const hostname = pane.detectedHostname?.trim();
      draft = {
        protocol: 'ssh',
        name: hostname || pane.config.host,
        host: pane.config.host,
        port: pane.config.port,
        username: pane.config.username,
      };
    } else if (pane.config.protocol === 'telnet') {
      draft = {
        protocol: 'telnet',
        name: pane.detectedHostname?.trim() || pane.config.host,
        host: pane.config.host,
        port: pane.config.port,
      };
    } else if (pane.config.protocol === 'serial') {
      draft = {
        protocol: 'serial',
        name: pane.config.port_name,
        serial_port: pane.config.port_name,
        baud_rate: pane.config.baud_rate,
      };
    } else {
      draft = {
        protocol: 'local_pty',
        name: pane.title,
        shell: pane.config.shell,
        cwd: pane.config.cwd,
      };
    }
    set({
      quickConnectOpen: true,
      editingBookmark: null,
      quickConnectDefaultFolderId: null,
      saveFromPaneDraft: draft,
    });
  },

  closeQuickConnect: () =>
    set({
      quickConnectOpen: false,
      editingBookmark: null,
      quickConnectDefaultFolderId: null,
      saveFromPaneDraft: null,
    }),

  openQuickSshModal: () => set({ quickSshModal: { step: 'address' } }),
  proceedQuickSshToPassword: (target) =>
    set({ quickSshModal: { step: 'password', target } }),
  closeQuickSshModal: () => set({ quickSshModal: null }),

  submitSshPassword: (password, remember) => {
    const modal = get().quickSshModal;
    if (!modal || modal.step !== 'password') return;
    const prompt = modal.target;
    const key = `${prompt.username}@${prompt.host}:${prompt.port}`;
    set((s) => {
      const next = { ...s.rememberedSshPasswords };
      if (remember) next[key] = password;
      else delete next[key];
      return {
        quickSshModal: null,
        rememberedSshPasswords: next,
      };
    });

    const label =
      prompt.port === 22
        ? `${prompt.username}@${prompt.host}`
        : `${prompt.username}@${prompt.host}:${prompt.port}`;

    get().openSessionTab(label, {
      protocol: 'ssh',
      host: prompt.host,
      port: prompt.port,
      username: prompt.username,
      auth: { auth_type: 'password', password },
      size: { cols: 100, rows: 30 },
    });
  },

  toggleSearchPane: (paneId) =>
    set((s) => ({
      searchPaneId: s.searchPaneId === paneId ? null : paneId,
    })),

  refreshBookmarks: async () => {
    const tree = await get().transport.listBookmarkTree();
    set({ bookmarkTree: tree });
  },

  saveFolder: async (folder) => {
    await get().transport.upsertFolder(folder);
    await get().refreshBookmarks();
  },

  removeFolder: async (id) => {
    await get().transport.deleteFolder(id);
    await get().refreshBookmarks();
  },

  saveBookmark: async (bookmark, secret) => {
    await get().transport.upsertBookmark(bookmark, secret);
    await get().refreshBookmarks();
  },

  removeBookmark: async (id) => {
    await get().transport.deleteBookmark(id);
    await get().refreshBookmarks();
  },

  reorderBookmarkTree: async (req) => {
    await get().transport.reorderBookmarkTree(req);
    await get().refreshBookmarks();
  },

  requestDeleteBookmark: (bm) =>
    set({
      pendingDelete: { kind: 'bookmark', id: bm.id, name: bm.name },
    }),

  requestDeleteFolder: (folder) => {
    const tree = get().bookmarkTree;
    const childCount =
      tree.folders.filter((f) => f.parent_id === folder.id).length +
      tree.bookmarks.filter((b) => b.folder_id === folder.id).length;
    set({
      pendingDelete: {
        kind: 'folder',
        id: folder.id,
        name: folder.name,
        childCount,
      },
    });
  },

  requestDeleteSftpEntry: (params) =>
    set({
      pendingDelete: {
        kind: 'sftp',
        ...params,
      },
    }),

  confirmPendingDelete: async () => {
    const pending = get().pendingDelete;
    if (!pending) return;
    set({ pendingDelete: null });
    if (pending.kind === 'bookmark') {
      await get().removeBookmark(pending.id);
    } else if (pending.kind === 'folder') {
      await get().removeFolder(pending.id);
    } else {
      await get().transport.sftpRemove(
        pending.sessionId,
        pending.path,
        pending.isDir
      );
      pending.onDone();
    }
  },

  cancelPendingDelete: () => set({ pendingDelete: null }),

  openBookmarkTransfer: (tab) => set({ bookmarkTransferModal: tab }),
  closeBookmarkTransfer: () => set({ bookmarkTransferModal: null }),

  exportBookmarksBundle: (includeSecrets) =>
    get().transport.exportBookmarks(includeSecrets),

  importBookmarksBundle: async (bundle, mode) => {
    const res = await get().transport.importBookmarks(bundle, mode);
    await get().refreshBookmarks();
    return res;
  },

  connectBookmark: async (bookmark) => {
    const cfg = await get().transport.buildConfigFromBookmark(bookmark.id, {
      cols: 100,
      rows: 30,
    });
    get().openSessionTab(bookmark.name, cfg);
  },

  updateSettings: async (settings) => {
    set({ settings });
    applySettingsToAllTerminals(settings);
    try {
      await get().transport.saveSettings(settings);
    } catch (err) {
      console.warn('Settings save failed:', err);
    }
  },

  getActivePane: () => {
    const { tabs, activeTabId, activePaneId } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return null;
    if (activePaneId) {
      const found = findPane(tab.root, activePaneId);
      if (found) return found;
    }
    return firstPane(tab.root);
  },
}));

export function getProtocolBadge(protocol: ProtocolType): string {
  switch (protocol) {
    case 'local_pty':
      return 'PTY';
    case 'ssh':
      return 'SSH';
    case 'serial':
      return 'SERIAL';
    case 'telnet':
      return 'TELNET';
  }
}
