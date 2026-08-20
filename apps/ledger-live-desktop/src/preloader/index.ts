/*
  This file is bundled in to the preload bundle. It get loaded and executed before the renderer bundle.
  Everything set in the window scope will be available for the code that live in the renderer bundle.
  Node API can be reached by the renderer bundle through a proxy define here, even if its nodeIntegration flag is off.

  /!\ Everything done in this file must be safe, it can not afford to crash. /!\
*/

import { ipcRenderer } from "electron";
import logo from "./logo.svg";
import { palettes } from "@ledgerhq/react-ui/styles/index";

let appLoadedFlag = false;

const appLoaded = () => {
  if (appLoadedFlag) return;
  appLoadedFlag = true;
  const rendererNode = document.getElementById("react-root");
  const loaderContainer = document.getElementById("loader-container");

  if (rendererNode && loaderContainer) {
    rendererNode.style.visibility = "visible";
    loaderContainer.classList.add("fade-out");
    setTimeout(() => {
      loaderContainer.remove();
    }, 500);
  }
};

const reloadRenderer = () => ipcRenderer.invoke("reloadRenderer");

const params = new URLSearchParams(window.location.search);

const openWindow = (id: number, domains?: string[]) =>
  ipcRenderer.send("webview-dom-ready", id, domains);

window.api = {
  appDirname: params.get("appDirname") || "",
  appLoaded,
  reloadRenderer,
  openWindow,
};

const theme = params.get("theme") as "dark" | "light" | "null";
const osTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
const palette = palettes[theme && theme !== "null" ? theme : osTheme] || palettes.dark;
ipcRenderer.send("set-background-color", palette.background.default);

window.addEventListener("DOMContentLoaded", () => {
  const imgNode = document.getElementById("loading-logo") as unknown as HTMLImageElement;
  const loaderContainer = document.getElementById("loader-container");
  if (imgNode && loaderContainer) {
    imgNode.src = logo;
    loaderContainer.style.backgroundColor = "#000000";
    loaderContainer.classList.add("fade-out");
  }

  // Safety fallback: if renderer never calls appLoaded() (crash during init),
  // force-hide preloader after 30 seconds so window becomes usable
  setTimeout(() => {
    if (!appLoadedFlag) {
      appLoaded();
    }
  }, 30000);

  setTimeout(() => {
    ipcRenderer.send("ready-to-show", {});
  }, 200);
});
