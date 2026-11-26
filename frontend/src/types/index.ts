export type SessionId = number;
export type ProtocolType = 'local_pty' | 'ssh' | 'serial' | 'telnet';

export interface TerminalSize {
  cols: number;
  rows: number;
}

export type SshAuth =
  | { auth_type: 'password'; password: string }
  | { auth_type: 'private_key'; key_path: string; passphrase?: string };

export type SessionConfig =
  | {
      protocol: 'local_pty';
      shell?: string;
      cwd?: string;
      size: TerminalSize;
      encoding?: string;
    }
  | {
      protocol: 'ssh';
      host: string;
      port: number;
      username: string;
      auth: SshAuth;
      size: TerminalSize;
      encoding?: string;
    }
  | {
      protocol: 'serial';
      port_name: string;
      baud_rate: number;
      data_bits?: number;
      parity?: 'none' | 'odd' | 'even';
      stop_bits?: number;
      encoding?: string;
    }
  | {
      protocol: 'telnet';
      host: string;
      port: number;
      size: TerminalSize;
      encoding?: string;
    };

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
}

export interface PortForwardRule {
  id: string;
  kind: 'local' | 'remote' | 'dynamic';
  bind_host: string;
  bind_port: number;
  target_host?: string;
  target_port?: number;
}

export interface Bookmark {
  id: string;
  folder_id: string | null;
  name: string;
  protocol: ProtocolType;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  shell?: string | null;
  cwd?: string | null;
  serial_port?: string | null;
  baud_rate?: number | null;
  auth_type?: 'password' | 'private_key' | null;
  key_path?: string | null;
  credential_id?: string | null;
  encoding?: string;
  sort_order?: number;
  port_forwards: PortForwardRule[];
  notes: string;
}

export interface FolderPosition {
  id: string;
  parent_id: string | null;
  sort_order: number;
}

export interface BookmarkPosition {
  id: string;
  folder_id: string | null;
  sort_order: number;
}

export interface TreeReorderRequest {
  folders: FolderPosition[];
  bookmarks: BookmarkPosition[];
}

export interface ExportedBookmark extends Bookmark {
  secret?: string;
}

export interface BookmarkExportBundle {
  version: number;
  exported_at: string;
  folders: Folder[];
  bookmarks: ExportedBookmark[];
}

export type ImportMode = 'merge' | 'replace';

export interface BookmarkImportResult {
  folders_imported: number;
  bookmarks_imported: number;
}

export interface BookmarkTree {
  folders: Folder[];
  bookmarks: Bookmark[];
}

export interface AppSettings {
  theme: string;
  font_family: string;
  font_size: number;
  ligatures: boolean;
  cursor_style: 'block' | 'underline' | 'bar';
  cursor_blink: boolean;
  scrollback: number;
  confirm_on_close?: boolean;
  master_password_enabled?: boolean;
  shortcuts: Record<string, string>;
}

export interface MasterPasswordStatus {
  enabled: boolean;
  configured: boolean;
  unlocked: boolean;
}

export interface SftpEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified?: number | null;
  permissions?: number | null;
}

export type SplitDirection = 'horizontal' | 'vertical';
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';
export type BroadcastMode = 'all' | 'visible' | 'selected';
export type DockZone = 'left' | 'right' | 'bottom';
export type DockViewId = 'bookmarks' | 'broadcast' | 'sftp';

export type DragPayload =
  | { kind: 'pane'; tabId: string; paneId: string }
  | { kind: 'tab'; tabId: string }
  | { kind: 'bookmark'; bookmark: Bookmark }
  | { kind: 'folder'; folder: Folder }
  | { kind: 'dock-view'; viewId: DockViewId };

export interface QuickSshPromptState {
  host: string;
  port: number;
  username: string;
}

export type QuickSshModalState =
  | { step: 'address' }
  | { step: 'password'; target: QuickSshPromptState };

export interface SaveFromPaneDraft {
  protocol: ProtocolType;
  name: string;
  host?: string;
  port?: number;
  username?: string;
  shell?: string;
  cwd?: string;
  serial_port?: string;
  baud_rate?: number;
  encoding?: string;
}

export type PendingCloseState =
  | { kind: 'pane'; tabId: string; paneId: string; title: string }
  | { kind: 'tab'; tabId: string; title: string; paneCount: number };

export type PendingDeleteState =
  | { kind: 'bookmark'; id: string; name: string }
  | { kind: 'folder'; id: string; name: string; childCount: number }
  | {
      kind: 'sftp';
      sessionId: SessionId;
      path: string;
      name: string;
      isDir: boolean;
      onDone: () => void;
    };

export type HostMenuEvent =
  | 'open-user-manual'
  | 'open-settings'
  | 'open-quick-ssh'
  | 'save-bookmark-from-pane'
  | 'toggle-left-sidebar'
  | 'toggle-right-sidebar'
  | 'toggle-bottom-panel'
  | 'toggle-view-bookmarks'
  | 'toggle-view-broadcast'
  | 'toggle-view-sftp';

export interface PaneNode {
  type: 'pane';
  id: string;
  title: string;
  protocol: ProtocolType;
  config: SessionConfig;
  sessionId: SessionId | null;
  status: 'connecting' | 'connected' | 'closed' | 'error';
  errorMessage?: string;
  detectedHostname?: string;
}

export interface SplitContainerNode {
  type: 'split';
  id: string;
  direction: SplitDirection;
  ratio: number;
  first: SplitNode;
  second: SplitNode;
}

export type SplitNode = PaneNode | SplitContainerNode;

export interface TabItem {
  id: string;
  title: string;
  root: SplitNode;
}
