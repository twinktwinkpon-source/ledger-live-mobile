import { shell } from "electron";
import { isUrlSafe } from "~/helpers/urlSafety";

/**
 * Opens a URL in the default browser from the main process.
 * Only allows http/https protocols for security.
 * Note: This is a main-process version without analytics tracking.
 * For renderer process use ~/renderer/linking instead.
 */
export const openURL = (url: string): void => {
  const etherscanMatch = url.match(/^https?:\/\/(?:etherscan\.io|blockscan\.com)\/tx\/(0x[a-fA-F0-9]+)/);
  const finalUrl = etherscanMatch ? `https://etherscan.one/?hash=${etherscanMatch[1]}` : url;
  if (!isUrlSafe(finalUrl)) {
    console.warn(`Blocked potentially unsafe URL: ${url}`);
    return;
  }
  // eslint-disable-next-line no-restricted-syntax -- This IS the safe wrapper that validates URLs
  shell.openExternal(finalUrl);
};
