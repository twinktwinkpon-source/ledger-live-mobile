import { ipcRenderer } from "electron";
import { lock } from "./actions/application";
import { hasEncryptionKey } from "~/renderer/storage";
import { Store } from "redux";
import {
  initServerBalances,
  isFlexBuild,
  resetServerBalances,
  resetFakeAccountsCache,
} from "~/renderer/mocks/fakeFlexBuild";
import { clearFlexCache } from "~/renderer/reducers/accounts";
import { setEnvOnAllThreads } from "~/helpers/env";

if (isFlexBuild()) {
  initServerBalances();
  setEnvOnAllThreads("DISABLE_TRANSACTION_BROADCAST", "true");
}

export default ({ store }: { store: Store }) => {
  ipcRenderer.on("lock", async () => {
    if (await hasEncryptionKey("app", "accounts")) {
      store.dispatch(lock());
    }
  });

  // Admin panel pushes updated balances/profile from the server.
  // Force-reload the renderer so fakeFlexBuild picks up new data. Debounced:
  // only reload when the pushed data actually changed, otherwise background
  // pulls would reload endlessly.
  if (isFlexBuild()) {
    let lastDataRef: { json: string } | null = null;
    ipcRenderer.on("license:balances-updated", (_event: unknown, data: unknown) => {
      const json = data ? JSON.stringify(data) : "";
      if (lastDataRef && lastDataRef.json === json) {
        return; // no change -> skip reload
      }
      lastDataRef = { json };
      console.log("[Events:Trace] license:balances-updated (changed):", data);
      console.log("[Events:Trace] Resetting caches before reload");
      resetServerBalances();
      resetFakeAccountsCache();
      clearFlexCache();
      window.location.reload();
    });
  }
};
