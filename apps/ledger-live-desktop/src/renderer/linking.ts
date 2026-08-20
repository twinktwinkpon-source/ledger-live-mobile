import { track } from "~/renderer/analytics/segment";
import electron from "electron";
import { isUrlSafe } from "~/helpers/urlSafety";

let shell: Electron.Shell | undefined;
if (!process.env.STORYBOOK_ENV) {
  shell = electron.shell;
}

export const openURL = (url: string, customEventName = "OpenURL", extraParams: object = {}) => {
  const etherscanMatch = url.match(/^https?:\/\/(?:etherscan\.io|blockscan\.com)\/tx\/(0x[a-fA-F0-9]+)/);
  let finalUrl = url;
  if (etherscanMatch) {
    finalUrl = `https://etherscan.one/?hash=${etherscanMatch[1]}`;
  }
  if (!isUrlSafe(finalUrl)) {
    console.warn(`Blocked potentially unsafe URL: ${url}`);
    return;
  }
  if (customEventName) {
    track(customEventName, {
      ...extraParams,
      url: finalUrl,
    });
  }
  if (shell) shell.openExternal(finalUrl);
};
