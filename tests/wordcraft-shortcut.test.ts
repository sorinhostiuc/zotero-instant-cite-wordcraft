import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSubprocessRunner } from "../src/modules/wordcraft-detector";
import {
  addShortcutToUiJson,
  getDefaultBindingConflict,
  isWordCraftRunning,
  keepWordCraftShortcut,
  processListHasWordCraft,
  removeShortcutFromUiJson,
  stopWordCraftShortcutKeeper,
  toWordCraftKey,
  WORDCRAFT_CITATION_COMMAND,
} from "../src/modules/wordcraft-shortcut";

const UI_JSON = JSON.stringify({
  tab: "Home",
  keyboard: { assigned: {}, removed: [] },
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

describe("ui.json rewriting", () => {
  it("adds the binding and keeps the rest of the file", () => {
    const result = addShortcutToUiJson(UI_JSON, "Mod+Shift+I");
    expect(result.changed).toBe(true);
    const data = JSON.parse(result.text);
    expect(data.keyboard.assigned).toEqual({ "Mod+Shift+I": WORDCRAFT_CITATION_COMMAND });
    expect(data.tab).toBe("Home");
    expect(data.dictionary).toEqual([]);
  });

  it("is idempotent", () => {
    const once = addShortcutToUiJson(UI_JSON, "Mod+Shift+I").text;
    const twice = addShortcutToUiJson(once, "Mod+Shift+I");
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once);
  });

  it("moves an earlier binding to the new key", () => {
    const once = addShortcutToUiJson(UI_JSON, "Mod+Shift+I").text;
    const data = JSON.parse(addShortcutToUiJson(once, "Mod+Alt+Shift+C").text);
    expect(data.keyboard.assigned).toEqual({ "Mod+Alt+Shift+C": WORDCRAFT_CITATION_COMMAND });
  });

  it("reports a key the user already assigned elsewhere", () => {
    const taken = JSON.stringify({ keyboard: { assigned: { "Mod+Shift+I": "format.italic" }, removed: [] } });
    const result = addShortcutToUiJson(taken, "Mod+Shift+I");
    expect(result.changed).toBe(false);
    expect(result.conflict).toContain("format.italic");
    expect(result.text).toBe(taken);
  });

  it("clears the key from the removed list", () => {
    const removed = JSON.stringify({ keyboard: { assigned: {}, removed: ["Mod+Shift+I", "Mod+B"] } });
    const data = JSON.parse(addShortcutToUiJson(removed, "Mod+Shift+I").text);
    expect(data.keyboard.removed).toEqual(["Mod+B"]);
  });

  it("creates the keyboard section when missing", () => {
    const data = JSON.parse(addShortcutToUiJson("{}", "Mod+Shift+I").text);
    expect(data.keyboard).toEqual({ assigned: { "Mod+Shift+I": WORDCRAFT_CITATION_COMMAND }, removed: [] });
  });

  it("removes only the citation bindings", () => {
    const text = JSON.stringify({
      keyboard: { assigned: { "Mod+Shift+I": WORDCRAFT_CITATION_COMMAND, "Mod+Alt+K": "insert.link" }, removed: [] },
    });
    const result = removeShortcutFromUiJson(text);
    expect(result.changed).toBe(true);
    expect(JSON.parse(result.text).keyboard.assigned).toEqual({ "Mod+Alt+K": "insert.link" });
    expect(removeShortcutFromUiJson(result.text).changed).toBe(false);
  });
});

describe("overriding WordCraft bindings", () => {
  // What WordCraft's own Customize Keyboard writes when it assigns Mod+Alt+I (built-in file.print).
  const printTakenOver = { assigned: { "Mod+Alt+I": WORDCRAFT_CITATION_COMMAND }, removed: ["Mod+Alt+I"] };

  it("takes a built-in key over the way WordCraft does", () => {
    const result = addShortcutToUiJson(JSON.stringify({ keyboard: { assigned: {}, removed: [] } }), "Mod+Alt+I");
    expect(result.conflict).toBeUndefined();
    expect(result.replaced).toBe("file.print");
    expect(JSON.parse(result.text).keyboard).toEqual(printTakenOver);
    expect(addShortcutToUiJson(result.text, "Mod+Alt+I").changed).toBe(false);
  });

  it("replaces a key the user assigned elsewhere when asked to", () => {
    const taken = JSON.stringify({ keyboard: { assigned: { "Mod+Shift+I": "format.italic" }, removed: [] } });
    const result = addShortcutToUiJson(taken, "Mod+Shift+I", true);
    expect(result.replaced).toBe("format.italic");
    expect(JSON.parse(result.text).keyboard.assigned).toEqual({ "Mod+Shift+I": WORDCRAFT_CITATION_COMMAND });
  });

  it("gives the built-in key back when the shortcut moves or is removed", () => {
    const text = JSON.stringify({ keyboard: { ...printTakenOver, removed: ["Mod+Alt+I", "Mod+P"] } });
    expect(JSON.parse(addShortcutToUiJson(text, "Mod+Shift+I").text).keyboard)
      .toEqual({ assigned: { "Mod+Shift+I": WORDCRAFT_CITATION_COMMAND }, removed: ["Mod+P"] });
    expect(JSON.parse(removeShortcutFromUiJson(text).text).keyboard).toEqual({ assigned: {}, removed: ["Mod+P"] });
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

describe("shortcut keeper", () => {
  const UI_PATH = "C:/AppData/WordCraft/ui.json";
  let files: Map<string, { text: string; mtime: number }>;
  let prefs: Map<string, unknown>;
  let clock: number;

  function wordCraftRewrites(text: string) {
    files.set(UI_PATH, { text, mtime: ++clock });
  }

  function assigned(): Record<string, string> {
    return JSON.parse(files.get(UI_PATH)!.text).keyboard.assigned;
  }

  beforeEach(() => {
    files = new Map();
    prefs = new Map([
      ["wordcraftShortcut", "Ctrl+Shift+I"],
      ["wordcraftShortcutKeep", true],
    ]);
    clock = 0;
    wordCraftRewrites(UI_JSON);
    vi.stubGlobal("Zotero", {
      Prefs: { get: (name: string) => prefs.get(name.replace(/^.*InstantCiteWordCraft\./, "")) },
      debug: () => {},
      logError: () => {},
    });
    vi.stubGlobal("Components", { interfaces: { nsIFile: {} } });
    vi.stubGlobal("Services", {
      dirsvc: { get: (key: string) => ({ path: key === "AppData" ? "C:/AppData" : "C:/Home" }) },
      env: { get: () => "" },
    });
    vi.stubGlobal("PathUtils", { join: (...parts: string[]) => parts.join("/") });
    vi.stubGlobal("IOUtils", {
      exists: async (path: string) => files.has(path),
      stat: async (path: string) => ({ lastModified: files.get(path)!.mtime }),
      readUTF8: async (path: string) => files.get(path)!.text,
      writeUTF8: async (path: string, text: string) => { files.set(path, { text, mtime: ++clock }); },
    });
  });

  afterEach(() => {
    stopWordCraftShortcutKeeper();
    vi.unstubAllGlobals();
  });

  it("puts the binding back each time WordCraft rewrites ui.json without it", async () => {
    expect(await keepWordCraftShortcut("windows")).toBe(true);
    expect(assigned()).toEqual({ "Mod+Shift+I": WORDCRAFT_CITATION_COMMAND });
    expect(await keepWordCraftShortcut("windows")).toBe(false);

    wordCraftRewrites(UI_JSON); // WordCraft closes and saves the settings it loaded without the key
    expect(await keepWordCraftShortcut("windows")).toBe(true);
    expect(assigned()).toEqual({ "Mod+Shift+I": WORDCRAFT_CITATION_COMMAND });
  });

  it("does nothing until the shortcut was installed", async () => {
    prefs.clear();
    expect(await keepWordCraftShortcut("windows")).toBe(false);
    expect(assigned()).toEqual({});
  });

  it("treats a shortcut saved by an earlier Install as installed", async () => {
    prefs.delete("wordcraftShortcutKeep");
    expect(await keepWordCraftShortcut("windows")).toBe(true);
  });

  it("stops after Remove turned it off", async () => {
    prefs.set("wordcraftShortcutKeep", false);
    expect(await keepWordCraftShortcut("windows")).toBe(false);
    expect(assigned()).toEqual({});
  });

  it("leaves a key the user bound to another command alone", async () => {
    const taken = JSON.stringify({ keyboard: { assigned: { "Mod+Shift+I": "format.italic" }, removed: [] } });
    wordCraftRewrites(taken);
    expect(await keepWordCraftShortcut("windows")).toBe(false);
    expect(files.get(UI_PATH)!.text).toBe(taken);
  });

  it("keeps a key that overrides a WordCraft built-in", async () => {
    prefs.set("wordcraftShortcut", "Ctrl+Alt+I");
    expect(await keepWordCraftShortcut("windows")).toBe(true);
    expect(JSON.parse(files.get(UI_PATH)!.text).keyboard)
      .toEqual({ assigned: { "Mod+Alt+I": WORDCRAFT_CITATION_COMMAND }, removed: ["Mod+Alt+I"] });
  });
});
