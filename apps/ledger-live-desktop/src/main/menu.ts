import { app, Menu, MenuItemConstructorOptions, OpenDevToolsOptions, ipcMain } from "electron";
import { getMainWindow } from "./window-lifecycle";
const { DEV_TOOLS, DEV_TOOLS_MODE } = process.env;

// Compile-time mode: "client" builds have no operator tooling.
const IS_CLIENT_BUILD = (process.env.FLEX_MODE || "operator") === "client";

// Only macOS gets an application menu. On Windows/Linux the app ships NO
// application menu at all (index.ts calls Menu.setApplicationMenu(null)):
// building the default template there surfaces a stock
// "Electron / License / Edit / Window" bar on every window, contradicting the
// FLEX branding. The ipcMain.handle registrations above MUST stay
// unconditional — license activation is opened from the renderer via
// license:open-activation on every platform.

// Open the license activation window from anywhere in the app (menu / UI button).
ipcMain.handle("license:open-activation", async () => {
  const { showLicenseWindow } = await import("./license");
  await showLicenseWindow();
  return true;
});

if (!IS_CLIENT_BUILD) {
  // Open the admin panel (operator only) from the menu / UI.
  ipcMain.handle("license:open-admin", async () => {
    const { showAdminPanel } = await import("./license");
    showAdminPanel();
    return true;
  });
}

const template: MenuItemConstructorOptions[] = [
  {
    label: app.name,
    submenu: [
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  },
  {
    label: "License",
    submenu: [
      {
        label: "Activate / Manage License…",
        click() {
          const { showLicenseWindow } = require("./license");
          showLicenseWindow();
        },
      },
      // Operator-only entries — stripped from client builds.
      ...(IS_CLIENT_BUILD
        ? []
        : [
            {
              label: "Admin Panel (Operator)…",
              click() {
                const { showAdminPanel } = require("./license");
                showAdminPanel();
              },
            },
            {
              label: "Key Generator (Operator)…",
              click() {
                const { showKeygenWindow } = require("./license");
                showKeygenWindow();
              },
            },
          ]),
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
  {
    role: "window",
    submenu: [
      ...(__DEV__ || DEV_TOOLS
        ? [
            {
              label: "Main Window Dev Tools",
              click() {
                const mainWindow = getMainWindow();
                let mode: OpenDevToolsOptions["mode"] = "bottom";
                if (
                  DEV_TOOLS_MODE &&
                  (DEV_TOOLS_MODE === "detach" ||
                    DEV_TOOLS_MODE === "right" ||
                    DEV_TOOLS_MODE === "left" ||
                    DEV_TOOLS_MODE === "bottom" ||
                    DEV_TOOLS_MODE === "undocked")
                ) {
                  mode = DEV_TOOLS_MODE;
                }
                mainWindow?.webContents.openDevTools({
                  mode,
                });
              },
            },
            {
              type: "separator",
            },
          ]
        : []),
      { role: "close" },
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { role: "front" },
    ] as MenuItemConstructorOptions[],
  },
];

export default Menu.buildFromTemplate(template);
