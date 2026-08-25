/**
 * Cross-component UI signals.
 *
 * The shell is assembled from server components, so a sidebar button cannot
 * hold state that the COO drawer owns. Instead of threading a provider through
 * every layout, these are tiny typed window events — enough for "open the COO",
 * never enough for real data flow (which stays in fetch + RSC).
 */

export const COO_OPEN_EVENT = 'ai-core:coo-open';

export type CooOpenDetail = { prefill?: string; source?: string };

export function openCoo(detail: CooOpenDetail = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<CooOpenDetail>(COO_OPEN_EVENT, { detail }));
}
