/**
 * FLEX persistence — keeps the flex slice in sync with the app's storage layer
 * so the bound key and cached balances survive app restarts.
 */
import { Store } from "redux";
import { State } from "~/reducers/types";
import { persistFlexState } from "~/reducers/flex";

let subscribed = false;

export function setupFlexPersistence(store: Store<State>): void {
  if (subscribed) return;
  subscribed = true;

  let last = JSON.stringify(store.getState().flex);
  store.subscribe(() => {
    const next = JSON.stringify(store.getState().flex);
    if (next !== last) {
      last = next;
      void persistFlexState(store.getState().flex);
    }
  });
}
