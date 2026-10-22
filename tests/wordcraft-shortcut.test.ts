import { describe, expect, it } from "vitest";
import {
  addShortcutToUiJson,
  getDefaultBindingConflict,
  processListHasWordCraft,
  removeShortcutFromUiJson,
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

describe("running WordCraft detection", () => {
  it("reads tasklist CSV and ps output", () => {
    expect(processListHasWordCraft("\"wordcraft.exe\",\"41212\",\"Console\",\"1\",\"210,000 K\"")).toBe(true);
    expect(processListHasWordCraft("\"wordcraft-cli.exe\",\"1\",\"Console\",\"1\",\"1 K\"")).toBe(true);
    expect(processListHasWordCraft("\"zotero.exe\",\"1\",\"Console\",\"1\",\"1 K\"")).toBe(false);
    expect(processListHasWordCraft("/usr/bin/zsh\n/Applications/WordCraft.app/Contents/MacOS/WordCraft")).toBe(true);
    expect(processListHasWordCraft("/usr/bin/zsh\nsoffice")).toBe(false);
  });
});
