import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSubprocessRunner } from "../src/modules/wordcraft-detector";
import { helperFileName } from "../src/modules/wordcraft-hotkey";
import {
  getDefaultBindingConflict,
  isWordCraftRunning,
  processListHasWordCraft,
  removeLegacyBinding,
  removeShortcutFromUiJson,
  toWordCraftKey,
  WORDCRAFT_CITATION_COMMAND,
} from "../src/modules/wordcraft-shortcut";

const UI_JSON = JSON.stringify({
  tab: "Home",
  keyboard: { assigned: { "Mod+Shift+I": "ui.zotero.addEditCitation" }, removed: [] },
  dictionary: [],
}, null, 2);

describe("WordCraft shortcut notation", () => {
  it("maps Ctrl to Mod on Windows and Linux", () => {
    expect(toWordCraftKey("Ctrl+Shift+I", "windows")).toBe("Mod+Shift+I");
    expect(toWordCraftKey("ctrl+shift+i", "linux")).toBe("Mod+Shift+I");
  });

  it("maps Cmd to Mod and keeps Ctrl distinct on macOS", () => {
    expect(toWordCraftKey("Cmd+Shift+I", "macos")).toBe("Mod+Shift+I");
    expect(toWordCraftKey("Ctrl+Option+K", "macos")).toBe("Ctrl+Alt+K");
  });

  it("orders modifiers like WordCraft", () => {
    expect(toWordCraftKey("Shift+Alt+Ctrl+K", "windows")).toBe("Mod+Alt+Shift+K");
  });

  it("rejects shortcuts without a modifier or with unknown parts", () => {
    expect(toWordCraftKey("I", "windows")).toBeNull();
    expect(toWordCraftKey("Hyper+I", "windows")).toBeNull();
  });

  it("knows WordCraft's built-in bindings regardless of modifier order", () => {
    expect(getDefaultBindingConflict("Mod+Shift+Z")).toBe("edit.redo");
    expect(getDefaultBindingConflict("Shift+Alt+I")).toBe("references.markCitation");
    expect(getDefaultBindingConflict("Mod+Shift+I")).toBeNull();
  });
});

describe("removing the old ui.json binding", () => {
  it("removes only the citation bindings and keeps the rest of the file", () => {
    const text = JSON.stringify({
      tab: "Home",
      keyboard: { assigned: { "Mod+Shift+I": WORDCRAFT_CITATION_COMMAND, "Mod+Alt+K": "insert.link" }, removed: [] },
    });
    const result = removeShortcutFromUiJson(text);
    expect(result.changed).toBe(true);
    const data = JSON.parse(result.text);
    expect(data.keyboard.assigned).toEqual({ "Mod+Alt+K": "insert.link" });
    expect(data.tab).toBe("Home");
    expect(removeShortcutFromUiJson(result.text).changed).toBe(false);
  });

  it("gives a built-in key back", () => {
    // What earlier versions wrote when they took over Mod+Alt+I (built-in file.print).
    const text = JSON.stringify({
      keyboard: { assigned: { "Mod+Alt+I": WORDCRAFT_CITATION_COMMAND }, removed: ["Mod+Alt+I", "Mod+P"] },
    });
    expect(JSON.parse(removeShortcutFromUiJson(text).text).keyboard).toEqual({ assigned: {}, removed: ["Mod+P"] });
  });

  it("leaves an empty file alone", () => {
    expect(removeShortcutFromUiJson("").changed).toBe(false);
  });
});

describe("running WordCraft detection", () => {
  it("reads tasklist CSV and ps output", () => {
    expect(processListHasWordCraft("\"wordcraft.exe\",\"41212\",\"Console\",\"1\",\"210,000 K\"")).toBe(true);
    expect(processListHasWordCraft("\"wordcraft-cli.exe\",\"1\",\"Console\",\"1\",\"1 K\"")).toBe(true);
    expect(processListHasWordCraft("\"zotero.exe\",\"1\",\"Console\",\"1\",\"1 K\"")).toBe(false);
    expect(processListHasWordCraft("/usr/bin/zsh\n/Applications/WordCraft.app/Contents/MacOS/WordCraft")).toBe(true);
    expect(processListHasWordCraft("/usr/bin/zsh\nsoffice")).toBe(false);
  });

  afterEach(() => setSubprocessRunner(null));

  it("finds WordCraft in the process list", async () => {
    setSubprocessRunner(vi.fn(async () => "\"System\",\"4\"\r\n\"wordcraft.exe\",\"30336\"\r\n"));
    expect(await isWordCraftRunning("windows")).toBe(true);
    setSubprocessRunner(vi.fn(async () => "/usr/bin/zsh\n"));
    expect(await isWordCraftRunning("linux")).toBe(false);
  });

  it("reports an unknown state instead of 'not running' when the check fails", async () => {
    setSubprocessRunner(vi.fn(async () => { throw new Error("spawn failed"); }));
    expect(await isWordCraftRunning("linux")).toBeNull();
    // On Windows the cmd.exe fallback needs XPCOM, which is missing here, so the state stays unknown.
    expect(await isWordCraftRunning("windows")).toBeNull();
  });
});

describe("legacy binding cleanup", () => {
  const UI_PATH = "C:/AppData/WordCraft/ui.json";
  let files: Map<string, string>;

  beforeEach(() => {
    files = new Map([[UI_PATH, UI_JSON]]);
    vi.stubGlobal("Zotero", { debug: () => {}, logError: () => {} });
    vi.stubGlobal("Components", { interfaces: { nsIFile: {} } });
    vi.stubGlobal("Services", {
      dirsvc: { get: (key: string) => ({ path: key === "AppData" ? "C:/AppData" : "C:/Home" }) },
      env: { get: () => "" },
    });
    vi.stubGlobal("PathUtils", { join: (...parts: string[]) => parts.join("/") });
    vi.stubGlobal("IOUtils", {
      exists: async (path: string) => files.has(path) || path === "C:/AppData/WordCraft",
      readUTF8: async (path: string) => files.get(path)!,
      writeUTF8: async (path: string, text: string) => { files.set(path, text); },
    });
  });

  afterEach(() => {
    setSubprocessRunner(null);
    vi.unstubAllGlobals();
  });

  it("removes the binding while WordCraft is closed and keeps a backup", async () => {
    setSubprocessRunner(vi.fn(async () => "\"System\",\"4\"\r\n"));
    expect(await removeLegacyBinding("windows")).toBe(true);
    expect(JSON.parse(files.get(UI_PATH)!).keyboard.assigned).toEqual({});
    expect(files.get(UI_PATH + ".instantcitewc.bak")).toBe(UI_JSON);
    expect(await removeLegacyBinding("windows")).toBe(false);
  });

  it("waits while WordCraft runs, since it writes its settings back on exit", async () => {
    setSubprocessRunner(vi.fn(async () => "\"wordcraft.exe\",\"30336\"\r\n"));
    expect(await removeLegacyBinding("windows")).toBe(false);
    expect(files.get(UI_PATH)).toBe(UI_JSON);
  });
});

describe("shortcut helper file name", () => {
  it("follows the helper's content", () => {
    const a = helperFileName(new Uint8Array([1, 2, 3]));
    expect(a).toMatch(/^WordCraftCite-[0-9a-f]{8}\.exe$/);
    expect(helperFileName(new Uint8Array([1, 2, 3]))).toBe(a);
    expect(helperFileName(new Uint8Array([1, 2, 4]))).not.toBe(a);
  });
});
