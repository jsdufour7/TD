'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * A preference store backed by `localStorage`.
 *
 * Implemented on `useSyncExternalStore` rather than "useState + sync it in an
 * effect": the server snapshot is the fallback, so the first client render
 * agrees with the server render and there is no second paint — and tabs stay in
 * sync through the `storage` event.
 */

const listeners = new Map<string, Set<() => void>>();

function emit(key: string): void {
  listeners.get(key)?.forEach((listener) => listener());
}

function readStored(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode: the preference simply won't persist */
  }
  emit(key);
}

export function useStoredString(key: string, fallback: string): [string, (value: string) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(onChange);
      window.addEventListener('storage', onChange);
      return () => {
        listeners.get(key)?.delete(onChange);
        window.removeEventListener('storage', onChange);
      };
    },
    [key],
  );

  const getSnapshot = useCallback(() => readStored(key) ?? fallback, [key, fallback]);
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const set = useCallback((next: string) => writeStored(key, next), [key]);
  return [value, set];
}
