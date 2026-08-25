'use client';

import { useSyncExternalStore } from 'react';

/**
 * True only once the component is rendering in the browser.
 *
 * Used to keep time-dependent strings out of the server-rendered HTML. Anything
 * derived from `Date.now()` or formatted in the viewer's locale/timezone differs
 * between the server (UTC) and the browser (e.g. America/Toronto), which is one
 * of the documented causes of "Hydration failed because the server rendered HTML
 * didn't match the client".
 *
 * Implemented with `useSyncExternalStore` rather than `useState` + `useEffect`:
 * it is the API designed for values that legitimately differ between server and
 * client, and it avoids the `react-hooks/set-state-in-effect` problem that a
 * mount-flag effect runs into. The subscribe function never notifies, so React
 * reads the server snapshot during SSR and the client snapshot after hydration.
 */

const emptySubscribe = (): (() => void) => () => {};

export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true, // client
    () => false, // server / hydration snapshot
  );
}
