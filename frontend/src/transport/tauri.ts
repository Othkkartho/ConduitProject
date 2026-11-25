import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  AppSettings,
  Bookmark,
  BookmarkExportBundle,
  BookmarkImportResult,
  BookmarkTree,
  Folder,
  HostMenuEvent,
  ImportMode,
  SessionConfig,
  SessionId,
  SftpEntry,
  TerminalSize,
  TreeReorderRequest,
} from '../types';
import type { AppTransport } from './index';

export class TauriTransport implements AppTransport {
  readonly mode = 'desktop' as const;

  async createSession(
    config: SessionConfig,
    onData: (chunk: Uint8Array) => void,
    onExit?: () => void
  ): Promise<SessionId> {
    const channel = new Channel<ArrayBuffer | number[]>();
    channel.onmessage = (payload) => {
      const bytes =
        payload instanceof ArrayBuffer
          ? new Uint8Array(payload)
          : new Uint8Array(payload);
      if (bytes.byteLength === 0) {
        onExit?.();
      } else {
        onData(bytes);
      }
    };
    return invoke<SessionId>('create_session', { config, onData: channel });
  }

  async write(sessionId: SessionId, data: Uint8Array): Promise<void> {
    await invoke('write_session', { sessionId, data: Array.from(data) });
  }

  async broadcast(sessionIds: SessionId[], data: Uint8Array): Promise<void> {
    await invoke('broadcast_sessions', {
      sessionIds,
      data: Array.from(data),
    });
  }

  async resize(sessionId: SessionId, size: TerminalSize): Promise<void> {
    await invoke('resize_session', { sessionId, size });
  }

  ack(sessionId: SessionId, bytes: number): void {
    void invoke('ack_session', { sessionId, bytes });
  }

  async close(sessionId: SessionId): Promise<void> {
    await invoke('close_session', { sessionId });
  }

  async listBookmarkTree(): Promise<BookmarkTree> {
    return invoke<BookmarkTree>('list_bookmark_tree');
  }

  async upsertFolder(folder: Folder): Promise<void> {
    await invoke('upsert_folder', { folder });
  }

  async deleteFolder(id: string): Promise<void> {
    await invoke('delete_folder', { id });
  }

  async upsertBookmark(bookmark: Bookmark, secret?: string): Promise<void> {
    await invoke('upsert_bookmark', {
      req: { bookmark, secret: secret ?? null },
    });
  }

  async deleteBookmark(id: string): Promise<void> {
    await invoke('delete_bookmark', { id });
  }

  async reorderBookmarkTree(req: TreeReorderRequest): Promise<void> {
    await invoke('reorder_bookmark_tree', { req });
  }

  async exportBookmarks(includeSecrets: boolean): Promise<BookmarkExportBundle> {
    return invoke<BookmarkExportBundle>('export_bookmarks', { includeSecrets });
  }

  async importBookmarks(
    bundle: BookmarkExportBundle,
    mode: ImportMode
  ): Promise<BookmarkImportResult> {
    return invoke<BookmarkImportResult>('import_bookmarks', {
      req: { bundle, mode },
    });
  }

  async buildConfigFromBookmark(
    bookmarkId: string,
    size: TerminalSize
  ): Promise<SessionConfig> {
    return invoke<SessionConfig>('build_config_from_bookmark', {
      bookmarkId,
      size,
    });
  }

  async getSettings(): Promise<AppSettings> {
    return invoke<AppSettings>('get_settings');
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await invoke('save_settings', { settings });
  }

  async listSerialPorts(): Promise<string[]> {
    return invoke<string[]>('list_serial_ports');
  }

  async sftpListDir(sessionId: SessionId, path: string): Promise<SftpEntry[]> {
    return invoke<SftpEntry[]>('sftp_list_dir', { sessionId, path });
  }

  async sftpDownload(sessionId: SessionId, path: string): Promise<Uint8Array> {
    const bytes = await invoke<number[]>('sftp_download', { sessionId, path });
    return new Uint8Array(bytes);
  }

  async sftpUpload(
    sessionId: SessionId,
    path: string,
    data: Uint8Array
  ): Promise<void> {
    await invoke('sftp_upload', {
      sessionId,
      path,
      data: Array.from(data),
    });
  }

  async sftpMkdir(sessionId: SessionId, path: string): Promise<void> {
    await invoke('sftp_mkdir', { sessionId, path });
  }

  async sftpRemove(
    sessionId: SessionId,
    path: string,
    isDir: boolean
  ): Promise<void> {
    await invoke('sftp_remove', { sessionId, path, isDir });
  }

  async onHostMenuEvent(
    handler: (event: HostMenuEvent) => void
  ): Promise<() => void> {
    const events: HostMenuEvent[] = [
      'open-user-manual',
      'open-settings',
      'open-quick-ssh',
      'save-bookmark-from-pane',
      'toggle-left-sidebar',
      'toggle-right-sidebar',
      'toggle-bottom-panel',
      'toggle-view-bookmarks',
      'toggle-view-broadcast',
      'toggle-view-sftp',
    ];
    const unlisteners = await Promise.all(
      events.map((ev) => listen(ev, () => handler(ev)))
    );
    return () => {
      unlisteners.forEach((u) => u());
    };
  }
}
