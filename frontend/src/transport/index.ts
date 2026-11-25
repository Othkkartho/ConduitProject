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

export interface AppTransport {
  readonly mode: 'desktop' | 'web';

  // Terminal Session Lifecycle
  createSession(
    config: SessionConfig,
    onData: (chunk: Uint8Array) => void,
    onExit?: () => void
  ): Promise<SessionId>;
  write(sessionId: SessionId, data: Uint8Array): Promise<void>;
  broadcast(sessionIds: SessionId[], data: Uint8Array): Promise<void>;
  resize(sessionId: SessionId, size: TerminalSize): Promise<void>;
  ack(sessionId: SessionId, bytes: number): void;
  close(sessionId: SessionId): Promise<void>;

  // Bookmarks, Folders & Settings
  listBookmarkTree(): Promise<BookmarkTree>;
  upsertFolder(folder: Folder): Promise<void>;
  deleteFolder(id: string): Promise<void>;
  upsertBookmark(bookmark: Bookmark, secret?: string): Promise<void>;
  deleteBookmark(id: string): Promise<void>;
  reorderBookmarkTree(req: TreeReorderRequest): Promise<void>;
  exportBookmarks(includeSecrets: boolean): Promise<BookmarkExportBundle>;
  importBookmarks(
    bundle: BookmarkExportBundle,
    mode: ImportMode
  ): Promise<BookmarkImportResult>;
  buildConfigFromBookmark(bookmarkId: string, size: TerminalSize): Promise<SessionConfig>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;

  // Serial & SFTP
  listSerialPorts(): Promise<string[]>;
  sftpListDir(sessionId: SessionId, path: string): Promise<SftpEntry[]>;
  sftpDownload(sessionId: SessionId, path: string): Promise<Uint8Array>;
  sftpUpload(sessionId: SessionId, path: string, data: Uint8Array): Promise<void>;
  sftpMkdir(sessionId: SessionId, path: string): Promise<void>;
  sftpRemove(sessionId: SessionId, path: string, isDir: boolean): Promise<void>;

  // Native desktop menu integration (optional in web mode)
  onHostMenuEvent?(handler: (event: HostMenuEvent) => void): Promise<() => void>;
}
