import type { AppTransport } from './index';
import { TauriTransport } from './tauri';

export type { AppTransport } from './index';

let cachedTransport: AppTransport | null = null;

export function getTransport(): AppTransport {
  if (cachedTransport) return cachedTransport;
  cachedTransport = new TauriTransport();
  return cachedTransport;
}
