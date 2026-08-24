import { useEffect, useState } from "react";
import { AppState } from "react-native";

// On iOS cold start AppState.currentState can still be "startup"/inactive at
// first mount even though the app IS visible — initializing to "in background"
// from that value froze the Welcome video on a grey first frame. Only a real
// background/inactive EVENT after launch should count as background.
export default function useIsAppInBackground() {
  const [isInBackground, setIsInBackground] = useState(false);

  useEffect(() => {
    // Sync once on mount in case the app really IS backgrounded (returned
    // from a deep link while backgrounded, etc.)
    if (AppState.currentState === "background") {
      setIsInBackground(true);
    }
    const listener = AppState.addEventListener("change", evt => {
      if (evt === "active") setIsInBackground(false);
      else setIsInBackground(true);
    });
    return () => {
      listener.remove();
    };
  }, []);

  return isInBackground;
}
