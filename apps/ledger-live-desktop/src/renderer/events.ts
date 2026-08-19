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
  // Force-reload the renderer so fakeFlexBuild picks up new data. Debounced on
  // the *meaningful* payload: main sends a unique refreshToken (Date.now) every
  // push, so we must compare only balances+profile or the renderer reloads
  // forever even when nothing changed.
  if (isFlexBuild()) {
    let lastSig = "";
    ipcRenderer.on("license:balances-updated", (_event: unknown, data: unknown) => {
      const d = data as { balances?: unknown; profile?: unknown; refreshToken?: string } | undefined;
      const sig = JSON.stringify({ balances: d?.balances ?? null, profile: d?.profile ?? null });
      if (sig === lastSig) {
        return; // no real change -> skip reload
      }
      lastSig = sig;
      console.log("[Events:Trace] license:balances-updated (changed):", sig);
      console.log("[Events:Trace] Resetting caches before reload");
      resetServerBalances();
      resetFakeAccountsCache();
      clearFlexCache();
      window.location.reload();
    });
  }
};
