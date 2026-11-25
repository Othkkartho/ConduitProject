import type { AppTransport } from './index';
import { TauriTransport } from './tauri';
import { WebSocketTransport } from './websocket';

export type { AppTransport } from './index';

let cachedTransport: AppTransport | null = null;

export function getTransport(): AppTransport {
  if (cachedTransport) return cachedTransport;
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    cachedTransport = new TauriTransport();
  } else {
    cachedTransport = new WebSocketTransport();
  }
  return cachedTransport;
}
