import { randomUUID } from "node:crypto";

import { type JSONSchema } from "json-schema-typed";

import { ipcMain } from "electron";
import Store from "electron-store";

import { destroyDiscordRpc, initDiscordRpc } from "./discordRpc";
import { mainWindow } from "./window";

// Default seed used on first launch and when the servers list is empty.
const DEFAULT_SERVER: DesktopServer = {
  id: "default",
  label: "Stoat",
  url: "https://stoat.chat/app",
};

const schema = {
  firstLaunch: {
    type: "boolean",
  } as JSONSchema.Boolean,
  customFrame: {
    type: "boolean",
  } as JSONSchema.Boolean,
  minimiseToTray: {
    type: "boolean",
  } as JSONSchema.Boolean,
  startMinimisedToTray: {
    type: "boolean",
  } as JSONSchema.Boolean,
  spellchecker: {
    type: "boolean",
  } as JSONSchema.Boolean,
  hardwareAcceleration: {
    type: "boolean",
  } as JSONSchema.Boolean,
  discordRpc: {
    type: "boolean",
  } as JSONSchema.Boolean,
  windowState: {
    type: "object",
    properties: {
      x: {
        type: "number",
      } as JSONSchema.Number,
      y: {
        type: "number",
      } as JSONSchema.Number,
      width: {
        type: "number",
      } as JSONSchema.Number,
      height: {
        type: "number",
      } as JSONSchema.Number,
      isMaximised: {
        type: "boolean",
      } as JSONSchema.Boolean,
    },
  } as JSONSchema.Object,
  servers: {
    type: "array",
    items: {
      type: "object",
      properties: {
        id: { type: "string" } as JSONSchema.String,
        label: { type: "string" } as JSONSchema.String,
        url: { type: "string" } as JSONSchema.String,
      },
      required: ["id", "label", "url"],
    },
  } as JSONSchema.Array,
  activeServerId: {
    type: "string",
  } as JSONSchema.String,
};

const store = new Store({
  schema,
  defaults: {
    firstLaunch: true,
    customFrame: true,
    minimiseToTray: true,
    startMinimisedToTray: false,
    spellchecker: true,
    hardwareAcceleration: true,
    discordRpc: true,
    windowState: {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      isMaximised: false,
    },
    servers: [DEFAULT_SERVER],
    activeServerId: DEFAULT_SERVER.id,
  } as DesktopConfig,
});

/**
 * Absolute path to the electron-store JSON file. Exposed so the tray can
 * offer "Edit config.json" via shell.openPath — the file is always
 * trusted (it's our own storage under app.getPath('userData')).
 */
export function getConfigPath(): string {
  return (store as never as { path: string }).path;
}

/**
 * Return the list of configured servers. Reseeds with the default entry if the
 * config was corrupted or predates the switcher (backward-compat for users
 * upgrading from a version without `servers`).
 */
export function getServers(): DesktopServer[] {
  const list = (
    store as never as { get(k: string): DesktopServer[] | undefined }
  ).get("servers");
  if (!Array.isArray(list) || list.length === 0) {
    (store as never as { set(k: string, v: DesktopServer[]): void }).set(
      "servers",
      [DEFAULT_SERVER],
    );
    (store as never as { set(k: string, v: string): void }).set(
      "activeServerId",
      DEFAULT_SERVER.id,
    );
    return [DEFAULT_SERVER];
  }
  return list;
}

/**
 * Return the currently-active server. Falls back to the first server if the
 * stored `activeServerId` no longer exists (e.g., after manual config edits).
 */
export function getActiveServer(): DesktopServer {
  const servers = getServers();
  const id = (store as never as { get(k: string): string | undefined }).get(
    "activeServerId",
  );
  const found = servers.find((s) => s.id === id);
  if (found) return found;
  // stale / missing id -> reset to first entry and persist
  (store as never as { set(k: string, v: string): void }).set(
    "activeServerId",
    servers[0].id,
  );
  return servers[0];
}

/**
 * Mark a server as the active one. Throws if the id is not in the list.
 * Does NOT reload the window — call `switchToServer` in `window.ts` for that.
 */
export function setActiveServer(id: string): void {
  const servers = getServers();
  if (!servers.some((s) => s.id === id)) {
    throw new Error(`Unknown server id: ${id}`);
  }
  (store as never as { set(k: string, v: string): void }).set(
    "activeServerId",
    id,
  );
}

/**
 * Append a server to the list. Returns the newly-created entry (with a fresh
 * random id). Caller is responsible for URL validation at the UI layer.
 */
export function addServer(input: { label: string; url: string }): DesktopServer {
  const entry: DesktopServer = {
    id: randomUUID(),
    label: input.label,
    url: input.url,
  };
  const servers = [...getServers(), entry];
  (store as never as { set(k: string, v: DesktopServer[]): void }).set(
    "servers",
    servers,
  );
  return entry;
}

/**
 * Remove a server by id. Refuses to remove the active server or the last
 * remaining entry — the UI should disable the action in those cases.
 */
export function removeServer(id: string): void {
  const servers = getServers();
  if (servers.length <= 1) {
    throw new Error("Cannot remove the last server");
  }
  if (getActiveServer().id === id) {
    throw new Error("Cannot remove the active server; switch first");
  }
  const next = servers.filter((s) => s.id !== id);
  (store as never as { set(k: string, v: DesktopServer[]): void }).set(
    "servers",
    next,
  );
}

/**
 * Shim for `electron-store` because typings are broken
 */
class Config {
  sync() {
    mainWindow.webContents.send("config", {
      firstLaunch: this.firstLaunch,
      customFrame: this.customFrame,
      minimiseToTray: this.minimiseToTray,
      startMinimisedToTray: this.startMinimisedToTray,
      spellchecker: this.spellchecker,
      hardwareAcceleration: this.hardwareAcceleration,
      discordRpc: this.discordRpc,
      windowState: this.windowState,
    });
  }

  get firstLaunch() {
    return (store as never as { get(k: string): boolean }).get("firstLaunch");
  }

  set firstLaunch(value: boolean) {
    (store as never as { set(k: string, value: boolean): void }).set(
      "firstLaunch",
      value,
    );

    this.sync();
  }

  get customFrame() {
    return (store as never as { get(k: string): boolean }).get("customFrame");
  }

  set customFrame(value: boolean) {
    (store as never as { set(k: string, value: boolean): void }).set(
      "customFrame",
      value,
    );

    this.sync();
  }

  get minimiseToTray() {
    return (store as never as { get(k: string): boolean }).get(
      "minimiseToTray",
    );
  }

  set minimiseToTray(value: boolean) {
    (store as never as { set(k: string, value: boolean): void }).set(
      "minimiseToTray",
      value,
    );

    this.sync();
  }

  get startMinimisedToTray() {
    return (store as never as { get(k: string): boolean }).get(
      "startMinimisedToTray",
    );
  }

  set startMinimisedToTray(value: boolean) {
    (store as never as { set(k: string, value: boolean): void }).set(
      "startMinimisedToTray",
      value,
    );

    this.sync();
  }

  get spellchecker() {
    return (store as never as { get(k: string): boolean }).get("spellchecker");
  }

  set spellchecker(value: boolean) {
    mainWindow.webContents.session.setSpellCheckerEnabled(value);

    (store as never as { set(k: string, value: boolean): void }).set(
      "spellchecker",
      value,
    );

    this.sync();
  }

  get hardwareAcceleration() {
    return (store as never as { get(k: string): boolean }).get(
      "hardwareAcceleration",
    );
  }

  set hardwareAcceleration(value: boolean) {
    (store as never as { set(k: string, value: boolean): void }).set(
      "hardwareAcceleration",
      value,
    );

    this.sync();
  }

  get discordRpc() {
    return (store as never as { get(k: string): boolean }).get("discordRpc");
  }

  set discordRpc(value: boolean) {
    if (value) {
      initDiscordRpc();
    } else {
      destroyDiscordRpc();
    }

    (store as never as { set(k: string, value: boolean): void }).set(
      "discordRpc",
      value,
    );

    this.sync();
  }

  get windowState() {
    return (
      store as never as { get(k: string): DesktopConfig["windowState"] }
    ).get("windowState");
  }

  set windowState(value: DesktopConfig["windowState"]) {
    (
      store as never as {
        set(k: string, value: DesktopConfig["windowState"]): void;
      }
    ).set("windowState", value);

    this.sync();
  }
}

export const config = new Config();

ipcMain.on("config", (_, newConfig: Partial<DesktopConfig>) => {
  console.info("Received new configuration", newConfig);
  Object.entries(newConfig).forEach(
    ([key, value]) => (config[key as keyof DesktopConfig] = value as never),
  );
});
