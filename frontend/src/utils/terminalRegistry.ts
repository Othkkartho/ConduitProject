import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { getThemePreset } from '../themes/presets';
import type { AppTransport } from '../transport';
import type { AppSettings, SessionConfig, SessionId } from '../types';

const LOW_WATERMARK_ACK = 128 * 1024;

interface RegistryEntry {
  term: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  hostEl: HTMLDivElement;
  sessionId: SessionId | null;
  transport: AppTransport;
  disposed: boolean;
  disposeDataSub: () => void;
  disposeTitleSub: () => void;
}

export interface AttachCallbacks {
  onSessionReady: (sessionId: SessionId) => void;
  onSessionClosed: (sessionId: SessionId | null) => void;
  onSessionError: (message: string) => void;
  onTitleChange?: (hostname: string) => void;
}

const registry = new Map<string, RegistryEntry>();

function extractHostnameFromTitle(rawTitle: string): string | null {
  const t = rawTitle.trim();
  if (!t) return null;
  // Common SSH/shell OSC title formats: "user@hostname: ~/dir", "user@hostname:~", "hostname"
  const atIdx = t.indexOf('@');
  if (atIdx !== -1) {
    const afterAt = t.slice(atIdx + 1).trim();
    const hostPart = afterAt.split(/[:\s/]/)[0]?.trim();
    if (hostPart) return hostPart;
  }
  const firstToken = t.split(/[:\s]/)[0]?.trim();
  if (firstToken && !firstToken.includes('\\') && !firstToken.includes('/')) {
    return firstToken;
  }
  return null;
}

export function ensureAndAttachTerminal(
  paneId: string,
  config: SessionConfig,
  container: HTMLDivElement,
  transport: AppTransport,
  settings: AppSettings,
  callbacks: AttachCallbacks
): void {
  const existing = registry.get(paneId);
  if (existing && !existing.disposed) {
    if (existing.hostEl.parentElement !== container) {
      container.innerHTML = '';
      container.appendChild(existing.hostEl);
    }
    fitAndResizeTerminal(paneId);
    return;
  }

  const hostEl = document.createElement('div');
  hostEl.style.width = '100%';
  hostEl.style.height = '100%';
  container.innerHTML = '';
  container.appendChild(hostEl);

  const preset = getThemePreset(settings.theme);
  const term = new Terminal({
    theme: preset.xterm,
    fontFamily: settings.font_family,
    fontSize: settings.font_size,
    cursorStyle: settings.cursor_style,
    cursorBlink: settings.cursor_blink,
    scrollback: settings.scrollback,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const webLinksAddon = new WebLinksAddon();

  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
  term.loadAddon(webLinksAddon);
  term.open(hostEl);
  term.attachCustomKeyEventHandler((e) => {
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'Tab') {
      return false;
    }
    return true;
  });
  fitAddon.fit();

  try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon.dispose();
    });
    term.loadAddon(webglAddon);
  } catch {
    // Fallback to default canvas/DOM renderer when WebGL context limit is hit
  }

  const encoder = new TextEncoder();
  let ackPendingBytes = 0;

  const entry: RegistryEntry = {
    term,
    fitAddon,
    searchAddon,
    hostEl,
    sessionId: null,
    transport,
    disposed: false,
    disposeDataSub: () => {},
    disposeTitleSub: () => {},
  };

  const dataSub = term.onData((text) => {
    if (entry.disposed || entry.sessionId === null) return;
    void transport.write(entry.sessionId, encoder.encode(text));
  });
  entry.disposeDataSub = () => dataSub.dispose();

  const titleSub = term.onTitleChange((rawTitle) => {
    if (entry.disposed) return;
    const host = extractHostnameFromTitle(rawTitle);
    if (host) {
      callbacks.onTitleChange?.(host);
    }
  });
  entry.disposeTitleSub = () => titleSub.dispose();

  registry.set(paneId, entry);

  const initialSize = {
    cols: Math.max(2, term.cols),
    rows: Math.max(2, term.rows),
  };
  const effectiveConfig: SessionConfig =
    config.protocol === 'serial' ? config : { ...config, size: initialSize };

  transport
    .createSession(
      effectiveConfig,
      (chunk: Uint8Array) => {
        if (entry.disposed) return;
        const chunkLen = chunk.byteLength;
        term.write(chunk, () => {
          ackPendingBytes += chunkLen;
          if (entry.sessionId !== null && ackPendingBytes >= LOW_WATERMARK_ACK) {
            transport.ack(entry.sessionId, ackPendingBytes);
            ackPendingBytes = 0;
          }
        });
      },
      () => {
        if (!entry.disposed) {
          term.writeln('\r\n\x1b[90m[Ptyloom] Session closed.\x1b[0m');
          callbacks.onSessionClosed(entry.sessionId);
        }
      }
    )
    .then((sid) => {
      if (entry.disposed) {
        void transport.close(sid);
        return;
      }
      entry.sessionId = sid;
      callbacks.onSessionReady(sid);
    })
    .catch((err: unknown) => {
      if (entry.disposed) return;
      const message = err instanceof Error ? err.message : String(err);
      term.writeln(`\r\n\x1b[31m[Ptyloom Error] ${message}\x1b[0m`);
      callbacks.onSessionError(message);
    });
}

export function detachTerminal(paneId: string): void {
  const entry = registry.get(paneId);
  if (!entry) return;
  if (entry.hostEl.parentElement) {
    entry.hostEl.parentElement.removeChild(entry.hostEl);
  }
}

export function fitAndResizeTerminal(paneId: string): void {
  const entry = registry.get(paneId);
  if (!entry || entry.disposed) return;
  if (!entry.hostEl.isConnected) return;
  entry.fitAddon.fit();
  if (entry.sessionId !== null) {
    void entry.transport.resize(entry.sessionId, {
      cols: Math.max(2, entry.term.cols),
      rows: Math.max(2, entry.term.rows),
    });
  }
}

export function focusTerminal(paneId: string): void {
  const entry = registry.get(paneId);
  if (!entry || entry.disposed) return;
  entry.term.focus();
}

export function searchTerminal(
  paneId: string,
  query: string,
  direction: 'next' | 'prev'
): void {
  const entry = registry.get(paneId);
  if (!entry || entry.disposed || !query) return;
  if (direction === 'prev') {
    entry.searchAddon.findPrevious(query);
  } else {
    entry.searchAddon.findNext(query);
  }
}

export function applySettingsToAllTerminals(settings: AppSettings): void {
  const theme = getThemePreset(settings.theme);
  registry.forEach((entry) => {
    if (entry.disposed) return;
    entry.term.options.theme = theme.xterm;
    entry.term.options.fontFamily = settings.font_family;
    entry.term.options.fontSize = settings.font_size;
    entry.term.options.cursorStyle = settings.cursor_style;
    entry.term.options.cursorBlink = settings.cursor_blink;
    entry.term.options.scrollback = settings.scrollback;
  });
}

export function disposeTerminal(paneId: string): void {
  const entry = registry.get(paneId);
  if (!entry) return;
  entry.disposed = true;
  entry.disposeDataSub();
  entry.disposeTitleSub();
  if (entry.hostEl.parentElement) {
    entry.hostEl.parentElement.removeChild(entry.hostEl);
  }
  entry.term.dispose();
  if (entry.sessionId !== null) {
    void entry.transport.close(entry.sessionId);
    entry.sessionId = null;
  }
  registry.delete(paneId);
}
