import { Menu, Tray, nativeImage, shell } from "electron";

import trayIconAsset from "../../assets/desktop/icon.png?asset";
import macOsTrayIconAsset from "../../assets/desktop/iconTemplate.png?asset";
import { version } from "../../package.json";

import { getActiveServer, getConfigPath, getServers } from "./config";
import { mainWindow, quitApp, switchToServer } from "./window";

// internal tray state
let tray: Tray = null;

// Create and resize tray icon for macOS
function createTrayIcon() {
  if (process.platform === "darwin") {
    const image = nativeImage.createFromDataURL(macOsTrayIconAsset);
    const resized = image.resize({ width: 20, height: 20 });
    resized.setTemplateImage(true);
    return resized;
  } else {
    return nativeImage.createFromDataURL(trayIconAsset);
  }
}

export function initTray() {
  const trayIcon = createTrayIcon();
  tray = new Tray(trayIcon);
  updateTrayMenu();
  tray.setToolTip("Stoat for Desktop");
  tray.setImage(trayIcon);
  tray.on("click", () => {
    if (mainWindow.isVisible()) {
     mainWindow.hide();
    } else {
     mainWindow.show();
     mainWindow.focus();
    }
  });
}

export function updateTrayMenu() {
  if (!tray) return;

  const servers = getServers();
  const activeId = getActiveServer().id;

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Stoat for Desktop", type: "normal", enabled: false },
      {
        label: "Version",
        type: "submenu",
        submenu: Menu.buildFromTemplate([
          {
            label: version,
            type: "normal",
            enabled: false,
          },
        ]),
      },
      {
        label: "Servers",
        type: "submenu",
        submenu: Menu.buildFromTemplate([
          ...servers.map((s) => ({
            label: s.label,
            type: "radio" as const,
            checked: s.id === activeId,
            click: () => switchToServer(s.id),
          })),
          { type: "separator" as const },
          {
            // Phase 1a.1: open the electron-store JSON in the user's
            // default editor so they can add/edit entries. Proper modal
            // UI is deferred to phase 1b.
            label: "Edit config.json…",
            type: "normal" as const,
            click: () => {
              shell.openPath(getConfigPath());
            },
          },
          {
            // Rebuild the tray menu after the user saves the config,
            // so new server entries appear without restarting the app.
            // Does not touch the main window — the user still has to
            // click the newly-added entry to load it.
            label: "Reload server list",
            type: "normal" as const,
            click: updateTrayMenu,
          },
        ]),
      },
      { type: "separator" },
      {
        label: mainWindow.isVisible() ? "Hide App" : "Show App",
        type: "normal",
        click() {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
          }
        },
      },
      {
        label: "Quit App",
        type: "normal",
        click: quitApp,
      },
    ]),
  );
}
