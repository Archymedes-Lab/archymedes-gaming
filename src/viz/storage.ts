import type { StorageAdapter } from '../core/persistence';
import { InMemoryStorage } from '../core/persistence';

/** localStorage-backed save slot; falls back to memory if storage is blocked. */
export function browserStorage(): StorageAdapter {
  try {
    const probe = '__archymedes_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
  } catch {
    return new InMemoryStorage();
  }
  return {
    getItem: (k) => {
      try {
        return window.localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        /* quota or privacy mode: keep playing */
      }
    },
    removeItem: (k) => {
      try {
        window.localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    },
  };
}
