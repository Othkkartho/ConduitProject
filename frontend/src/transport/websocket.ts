import type {
  AppSettings,
  Bookmark,
  BookmarkExportBundle,
  BookmarkImportResult,
  BookmarkTree,
  Folder,
  ImportMode,
  SessionConfig,
  SessionId,
  SftpEntry,
  TerminalSize,
  TreeReorderRequest,
} from '../types';
import type { AppTransport } from './index';

interface PendingCreate {
  resolve: (id: SessionId) => void;
  reject: (err: Error) => void;
}

export class WebSocketTransport implements AppTransport {
  readonly mode = 'web' as const;
  private ws: WebSocket | null = null;
  private connectPromise: Promise<WebSocket> | null = null;
  private nextReqId = 1;
  private pendingCreates = new Map<number, PendingCreate>();
  private listeners = new Map<
    SessionId,
    { onData: (chunk: Uint8Array) => void; onExit?: () => void }
  >();

  private ensureSocket(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.ws);
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/terminal`;

    this.connectPromise = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';

      socket.onopen = () => {
        this.ws = socket;
        resolve(socket);
      };

      socket.onerror = () => {
        this.connectPromise = null;
        reject(new Error('WebSocket connection failed'));
      };

      socket.onclose = () => {
        this.ws = null;
        this.connectPromise = null;
        this.listeners.forEach((l) => l.onExit?.());
      };

      socket.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          const msg = JSON.parse(ev.data) as {
            type: string;
            requestId?: number;
            sessionId?: number;
            error?: string;
          };
          if (msg.requestId !== undefined) {
            const pending = this.pendingCreates.get(msg.requestId);
            if (!pending) return;
            this.pendingCreates.delete(msg.requestId);
            if (msg.type === 'created' && msg.sessionId !== undefined) {
              pending.resolve(msg.sessionId);
            } else {
              pending.reject(new Error(msg.error ?? 'Failed to create session'));
            }
          }
          return;
        }

        const buf = ev.data as ArrayBuffer;
        if (buf.byteLength < 5) return;
        const view = new DataView(buf);
        const sessionId = view.getUint32(0, false);
        const opcode = view.getUint8(4);
        const listener = this.listeners.get(sessionId);
        if (!listener) return;

        if (opcode === 0x01) {
          listener.onData(new Uint8Array(buf, 5));
        } else if (opcode === 0x04) {
          listener.onExit?.();
          this.listeners.delete(sessionId);
        }
      };
    });

    return this.connectPromise;
  }

  async createSession(
    config: SessionConfig,
    onData: (chunk: Uint8Array) => void,
    onExit?: () => void
  ): Promise<SessionId> {
    const socket = await this.ensureSocket();
    const requestId = this.nextReqId++;

    const sessionId = await new Promise<SessionId>((resolve, reject) => {
      this.pendingCreates.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ type: 'create', requestId, config }));
    });

    this.listeners.set(sessionId, { onData, onExit });
    return sessionId;
  }

  async write(sessionId: SessionId, data: Uint8Array): Promise<void> {
    const socket = await this.ensureSocket();
    const frame = new Uint8Array(5 + data.byteLength);
    new DataView(frame.buffer).setUint32(0, sessionId, false);
    frame[4] = 0x01;
    frame.set(data, 5);
    socket.send(frame);
  }

  async broadcast(sessionIds: SessionId[], data: Uint8Array): Promise<void> {
    const socket = await this.ensureSocket();
    socket.send(
      JSON.stringify({
        type: 'broadcast',
        sessionIds,
        data: Array.from(data),
      })
    );
  }

  async resize(sessionId: SessionId, size: TerminalSize): Promise<void> {
    const socket = await this.ensureSocket();
    const buf = new ArrayBuffer(9);
    const view = new DataView(buf);
    view.setUint32(0, sessionId, false);
    view.setUint8(4, 0x02);
    view.setUint16(5, size.cols, false);
    view.setUint16(7, size.rows, false);
    socket.send(buf);
  }

  ack(sessionId: SessionId, bytes: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const buf = new ArrayBuffer(9);
    const view = new DataView(buf);
    view.setUint32(0, sessionId, false);
    view.setUint8(4, 0x03);
    view.setUint32(5, bytes, false);
    this.ws.send(buf);
  }

  async close(sessionId: SessionId): Promise<void> {
    this.listeners.delete(sessionId);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const buf = new ArrayBuffer(5);
    const view = new DataView(buf);
    view.setUint32(0, sessionId, false);
    view.setUint8(4, 0x04);
    this.ws.send(buf);
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  listBookmarkTree(): Promise<BookmarkTree> {
    return this.api('/api/bookmarks');
  }

  upsertFolder(folder: Folder): Promise<void> {
    return this.api('/api/folders', {
      method: 'POST',
      body: JSON.stringify(folder),
    });
  }

  deleteFolder(id: string): Promise<void> {
    return this.api(`/api/folders/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  upsertBookmark(bookmark: Bookmark, secret?: string): Promise<void> {
    return this.api('/api/bookmarks', {
      method: 'POST',
      body: JSON.stringify({ bookmark, secret: secret ?? null }),
    });
  }

  deleteBookmark(id: string): Promise<void> {
    return this.api(`/api/bookmarks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  reorderBookmarkTree(req: TreeReorderRequest): Promise<void> {
    return this.api('/api/bookmarks/reorder', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  exportBookmarks(includeSecrets: boolean): Promise<BookmarkExportBundle> {
    return this.api(
      `/api/bookmarks/export?include_secrets=${includeSecrets ? 'true' : 'false'}`
    );
  }

  importBookmarks(
    bundle: BookmarkExportBundle,
    mode: ImportMode
  ): Promise<BookmarkImportResult> {
    return this.api('/api/bookmarks/import', {
      method: 'POST',
      body: JSON.stringify({ bundle, mode }),
    });
  }

  buildConfigFromBookmark(
    bookmarkId: string,
    size: TerminalSize
  ): Promise<SessionConfig> {
    return this.api(`/api/bookmarks/${encodeURIComponent(bookmarkId)}/connect`, {
      method: 'POST',
      body: JSON.stringify(size),
    });
  }

  getSettings(): Promise<AppSettings> {
    return this.api('/api/settings');
  }

  saveSettings(settings: AppSettings): Promise<void> {
    return this.api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  listSerialPorts(): Promise<string[]> {
    return this.api('/api/serial/ports');
  }

  sftpListDir(sessionId: SessionId, path: string): Promise<SftpEntry[]> {
    return this.api(`/api/sftp/${sessionId}/list`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  }

  async sftpDownload(sessionId: SessionId, path: string): Promise<Uint8Array> {
    const res = await fetch(`/api/sftp/${sessionId}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw new Error(await res.text());
    return new Uint8Array(await res.arrayBuffer());
  }

  async sftpUpload(
    sessionId: SessionId,
    path: string,
    data: Uint8Array
  ): Promise<void> {
    const res = await fetch(
      `/api/sftp/${sessionId}/upload?path=${encodeURIComponent(path)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data.slice().buffer,
      }
    );
    if (!res.ok) throw new Error(await res.text());
  }

  sftpMkdir(sessionId: SessionId, path: string): Promise<void> {
    return this.api(`/api/sftp/${sessionId}/mkdir`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  }

  sftpRemove(
    sessionId: SessionId,
    path: string,
    isDir: boolean
  ): Promise<void> {
    return this.api(`/api/sftp/${sessionId}/remove`, {
      method: 'POST',
      body: JSON.stringify({ path, is_dir: isDir }),
    });
  }
}
