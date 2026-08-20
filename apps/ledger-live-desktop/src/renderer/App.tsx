import React, { useEffect, useState } from "react";
import { Provider } from "react-redux";
import { useSelector } from "LLD/hooks/redux";
import { Store } from "redux";
import { HashRouter as Router } from "react-router";
import { getFeature } from "@ledgerhq/live-common/featureFlags/index";
import { DeviceManagementKitProvider } from "@ledgerhq/live-dmk-desktop";
import "./global.css";
import "tippy.js/dist/tippy.css";
import "tippy.js/animations/shift-away.css";
import "tippy.js/animations/shift-toward.css";
import "tippy.js/dist/svg-arrow.css";
import { State } from "~/renderer/reducers";
import StyleProvider from "~/renderer/styles/StyleProvider";
import { UpdaterProvider } from "./components/Updater/UpdaterContext";
import ThrowBlock from "~/renderer/components/ThrowBlock";
import LiveStyleSheetManager from "~/renderer/styles/LiveStyleSheetManager";
import { FirebaseRemoteConfigProvider } from "~/renderer/components/FirebaseRemoteConfig";
import { FirebaseFeatureFlagsProvider } from "~/renderer/components/FirebaseFeatureFlags";
import { CountervaluesBridgedProvider } from "~/renderer/components/CountervaluesProvider";
import DrawerProvider from "~/renderer/drawers/Provider";
import Default from "./Default";
import { ServiceStatusProviderWrapper } from "~/renderer/components/ServiceStatusProviderWrapper";
import { PlatformAppProviderWrapper } from "~/renderer/components/PlatformAppProviderWrapper";
import { ToastProvider } from "@ledgerhq/live-common/notifications/ToastProvider/index";
import { themeSelector } from "./actions/general";
import { ConnectEnvsToSentry } from "~/renderer/components/ConnectEnvsToSentry";
import { ConnectEnvsToDatadog } from "~/renderer/components/ConnectEnvsToDatadog";
import PostOnboardingProviderWrapped from "~/renderer/components/PostOnboardingHub/logic/PostOnboardingProviderWrapped";
import { useBraze } from "./hooks/useBraze";
import { CounterValuesStateRaw } from "@ledgerhq/live-countervalues/types";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { AppDataStorageProvider } from "~/renderer/hooks/storage-provider/useAppDataStorage";
import { allowDebugReactQuerySelector } from "./reducers/settings";
import { ThemeProvider } from "@ledgerhq/lumen-ui-react";

// In FLEX distribution builds there is no real auto-update server so we skip
// the whole updater machinery entirely — otherwise the banner keeps showing an
// update-available status that ultimately fails with "connection failed".
const DISABLE_UPDATER = process.env.FLEX_DISABLE === "true" || true;

const reloadApp = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "r") {
    window.api?.reloadRenderer();
  }
};

type Props = {
  store: Store<State>;
  initialCountervalues: CounterValuesStateRaw;
};

const queryClient = new QueryClient();

const InnerApp = ({ initialCountervalues }: { initialCountervalues: CounterValuesStateRaw }) => {
  const [reloadEnabled, setReloadEnabled] = useState(true);

  useBraze();

  useEffect(() => {
    const reload = (e: KeyboardEvent) => {
      if (reloadEnabled) {
        reloadApp(e);
      }
    };
    window.addEventListener("keydown", reload);
    return () => window.removeEventListener("keydown", reload);
  }, [reloadEnabled]);

  const selectedPalette = useSelector(themeSelector) || "light";

  return (
    <StyleProvider selectedPalette={selectedPalette}>
      <ThemeProvider colorScheme={selectedPalette}>
        <ThrowBlock
          onError={() => {
            if (!__DEV__) {
              setReloadEnabled(false);
            }
          }}
        >
          <FirebaseRemoteConfigProvider>
            <FirebaseFeatureFlagsProvider getFeature={getFeature}>
              <ConnectEnvsToSentry />
              <ConnectEnvsToDatadog />
              {!DISABLE_UPDATER && <UpdaterProvider />}
              <AppDataStorageProvider>
                <DeviceManagementKitProvider>
                  <CountervaluesBridgedProvider initialState={initialCountervalues}>
                    <ToastProvider>
                      <ServiceStatusProviderWrapper>
                        <Router>
                          <PostOnboardingProviderWrapped>
                            <PlatformAppProviderWrapper>
                              <DrawerProvider>
                                <QueryClientProvider client={queryClient}>
                                  <Default />
                                  <ReactQueryDevtoolsProvider />
                                </QueryClientProvider>
                              </DrawerProvider>
                            </PlatformAppProviderWrapper>
                          </PostOnboardingProviderWrapped>
                        </Router>
                      </ServiceStatusProviderWrapper>
                    </ToastProvider>
                  </CountervaluesBridgedProvider>
                </DeviceManagementKitProvider>
              </AppDataStorageProvider>
            </FirebaseFeatureFlagsProvider>
          </FirebaseRemoteConfigProvider>
        </ThrowBlock>
      </ThemeProvider>
    </StyleProvider>
  );
};

const App = ({ store, initialCountervalues }: Props) => {
  return (
    <LiveStyleSheetManager>
      <Provider store={store}>
        <InnerApp initialCountervalues={initialCountervalues} />
      </Provider>
    </LiveStyleSheetManager>
  );
};

const ReactQueryDevtoolsProvider = () => {
  const allowDebugReactQuery = useSelector(allowDebugReactQuerySelector);
  if (!allowDebugReactQuery) return null;
  return <ReactQueryDevtools initialIsOpen={false} />;
};

export default App;
