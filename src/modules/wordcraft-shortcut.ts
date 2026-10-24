/**
 * The WordCraft shortcut for Zotero's Add/Edit Citation, which InstantCite
 * intercepts.
 *
 * WordCraft 0.10.0 cannot bind a key to its Zotero commands, so the shortcut
 * is held by a helper program (see wordcraft-hotkey.ts). Earlier versions
 * wrote a binding into WordCraft's UI settings file
 * (Windows: %APPDATA%\WordCraft\ui.json):
 *
 *   "keyboard": { "assigned": { "Mod+Shift+I": "ui.zotero.addEditCitation" }, "removed": [] }
 *
 * WordCraft loads that entry but never fires it. It is removed again while
 * WordCraft is closed (WordCraft writes the settings it loaded back on exit).
 */

import { getDefaultWordCraftShortcut, setPref } from "./preferences";
import { isWordCraftHotkeySupported, startWordCraftHotkey, stopWordCraftHotkey } from "./wordcraft-hotkey";
import { detectPlatform, type InstantCitePlatform } from "./platform";
import { runSubprocess } from "./wordcraft-detector";

export const WORDCRAFT_CITATION_COMMAND = "ui.zotero.addEditCitation";
const BACKUP_SUFFIX = ".instantcitewc.bak";

/** WordCraft's built-in bindings (from `wordcraft-cli commands`, v0.9.0). */
const WORDCRAFT_DEFAULT_BINDINGS: Record<string, string> = {
  "Shift+Enter": "text.lineBreak",
  "Mod+Enter": "text.pageBreak",
  "Mod+Shift+Enter": "text.columnBreak",
  "Shift+Tab": "text.backTab",
  "Mod+Backspace": "text.deleteWordBack",
  "Alt+Backspace": "text.deleteWordBack",
  "Mod+Delete": "text.deleteWordForward",
  "Alt+Delete": "text.deleteWordForward",
  "Mod+Shift+Space": "text.nbsp",
  "Mod+Shift+-": "text.nbHyphen",
  "Mod+-": "text.optionalHyphen",
  "Alt+X": "text.toggleUnicode",
  "Mod+Alt+-": "text.emDash",
  "Mod+Alt+C": "text.copyright",
  "Mod+Alt+R": "text.registered",
  "Mod+Alt+T": "text.trademark",
  "Mod+Alt+.": "text.ellipsis",
  "Mod+Left": "caret.wordLeft",
  "Alt+Left": "caret.wordLeft",
  "Mod+Right": "caret.wordRight",
  "Alt+Right": "caret.wordRight",
  "Mod+Up": "caret.paraUp",
  "Alt+Up": "caret.paraUp",
  "Mod+Down": "caret.paraDown",
  "Alt+Down": "caret.paraDown",
  "Mod+Home": "caret.docStart",
  "Mod+End": "caret.docEnd",
  "Mod+A": "select.all",
  "Mod+Shift+F8": "select.column",
  "Mod+Z": "edit.undo",
  "Mod+Y": "edit.redo",
  "Mod+Shift+Z": "edit.redo",
  "Mod+X": "edit.cut",
  "Mod+C": "edit.copy",
  "Mod+Insert": "edit.copy",
  "Mod+F3": "edit.spike",
  "Mod+Shift+F3": "edit.insertSpike",
  "Mod+V": "edit.paste",
  "Shift+Insert": "edit.paste",
  "Mod+Shift+Alt+V": "edit.pasteText",
  "Mod+F": "edit.find",
  "Mod+G": "edit.findNext",
  "Shift+F4": "edit.findNext",
  "Mod+PageDown": "edit.findNext",
  "Mod+PageUp": "edit.findPrevious",
  "Mod+H": "edit.findReplace",
  "Mod+Alt+G": "edit.goto",
  "Shift+F5": "edit.goBack",
  "Mod+Alt+Z": "edit.goBack",
  "Mod+Shift+C": "edit.copyFormat",
  "Mod+Shift+V": "edit.pasteFormat",
  "Mod+Alt+V": "edit.pasteSpecial",
  "Mod+B": "format.bold",
  "Mod+I": "format.italic",
  "Mod+U": "format.underline",
  "Mod+Shift+D": "format.doubleUnderline",
  "Mod+Shift+W": "format.wordUnderline",
  "Mod+Shift+X": "format.strikethrough",
  "Mod+=": "format.subscript",
  "Mod+Shift+=": "format.superscript",
  "Mod+Shift+A": "format.allCaps",
  "Mod+Shift+K": "format.smallCaps",
  "Mod+Shift+H": "format.hidden",
  "Mod+Shift+F": "format.font",
  "Mod+Shift+P": "format.size",
  "Mod+Shift+.": "format.growFont",
  "Mod+Shift+>": "format.growFont",
  "Mod+Shift+,": "format.shrinkFont",
  "Mod+Shift+<": "format.shrinkFont",
  "Mod+]": "format.growFont1",
  "Mod+[": "format.shrinkFont1",
  "Mod+Alt+H": "format.highlight",
  "Shift+F3": "format.changeCase",
  "Mod+Space": "format.resetChar",
  "Mod+D": "format.fontDialog",
  "Mod+L": "para.alignLeft",
  "Mod+E": "para.alignCenter",
  "Mod+R": "para.alignRight",
  "Mod+J": "para.justify",
  "Mod+Shift+J": "para.distribute",
  "Mod+M": "para.indent",
  "Mod+Shift+M": "para.outdent",
  "Mod+T": "para.hangingIndent",
  "Mod+Shift+T": "para.removeHanging",
  "Mod+1": "para.single",
  "Mod+2": "para.double",
  "Mod+5": "para.oneAndHalf",
  "Mod+0": "para.addSpaceBefore",
  "Mod+Q": "para.reset",
  "Mod+Shift+N": "para.normal",
  "Mod+Alt+1": "para.heading1",
  "Mod+Alt+2": "para.heading2",
  "Mod+Alt+3": "para.heading3",
  "Mod+Shift+L": "para.bullets",
  "Alt+Shift+Up": "para.moveUp",
  "Alt+Shift+Down": "para.moveDown",
  "Alt+Shift+Left": "para.promote",
  "Alt+Shift+Right": "para.demote",
  "Mod+Alt+Shift+S": "styles.pane",
  "Mod+Shift+S": "styles.apply",
  "Shift+F1": "styles.inspector",
  "Mod+Shift+8": "view.marks",
  "Mod+8": "view.marks",
  "Mod+Alt+P": "view.printLayout",
  "Mod+Alt+N": "view.draft",
  "Mod+Alt+O": "view.outline",
  "Mod+Alt+S": "view.split",
  "Alt+Shift+=": "outline.expand",
  "Alt+Shift+-": "outline.collapse",
  "Alt+Shift+1": "outline.showLevel1",
  "Alt+Shift+2": "outline.showLevel2",
  "Alt+Shift+3": "outline.showLevel3",
  "Alt+Shift+4": "outline.showLevel4",
  "Alt+Shift+5": "outline.showLevel5",
  "Alt+Shift+6": "outline.showLevel6",
  "Alt+Shift+7": "outline.showLevel7",
  "Alt+Shift+8": "outline.showLevel8",
  "Alt+Shift+9": "outline.showLevel9",
  "Alt+Shift+A": "outline.showAll",
  "Alt+Shift+L": "outline.firstLineOnly",
  "Mod+K": "insert.link",
  "Mod+Shift+F5": "insert.bookmark",
  "Mod+F9": "insert.field",
  "Alt+Shift+D": "insert.dateField",
  "Alt+Shift+T": "insert.timeField",
  "Alt+Shift+P": "insert.pageField",
  "Alt+=": "insert.equation",
  "Mod+Alt+M": "review.newComment",
  "Mod+Shift+E": "review.trackChanges",
  "Mod+Shift+G": "review.wordCount",
  "Alt+F7": "review.spelling",
  "Shift+F7": "review.thesaurus",
  "Mod+N": "file.new",
  "Mod+O": "file.open",
  "Mod+F12": "file.open",
  "Mod+Alt+F2": "file.open",
  "Mod+S": "file.save",
  "Shift+F12": "file.save",
  "Alt+Shift+F2": "file.save",
  "Alt+F2": "file.saveAs",
  "Mod+P": "file.print",
  "Mod+Shift+F12": "file.print",
  "Mod+F2": "file.print",
  "Mod+Alt+I": "file.print",
  "Mod+W": "file.close",
  "Mod+F4": "file.close",
  "Mod+Alt+F": "references.footnote",
  "Mod+Alt+D": "references.endnote",
  "Alt+Shift+>": "references.nextFootnote",
  "Alt+Shift+.": "references.nextFootnote",
  "Alt+F9": "view.fieldCodes",
  "Shift+F9": "fields.toggleCode",
  "Mod+Shift+F9": "fields.unlink",
  "Mod+F11": "fields.lock",
  "Mod+Shift+F11": "fields.unlock",
  "Alt+F1": "fields.next",
  "Shift+F11": "fields.previous",
  "Alt+Shift+F1": "fields.previous",
  "Alt+Shift+E": "mailings.editRecipients",
  "Alt+Shift+F": "mailings.insertField",
  "Alt+Shift+K": "mailings.preview",
  "Alt+Shift+N": "mailings.finish",
  "Alt+Shift+I": "references.markCitation",
  "Alt+Shift+X": "references.markEntry",
  "Alt+F8": "tools.macros",
  "Alt+Q": "tools.search",
  "Alt+F3": "insert.autoText",
  "Alt+Shift+R": "layout.linkToPrevious",
  "Mod+Alt+Space": "review.readAloud",
};

export interface ShortcutResult {
  success: boolean;
  message: string;
  showManual?: boolean;
}

// --- Pure helpers (unit tested) ---

const MODIFIER_ORDER = ["Mod", "Ctrl", "Alt", "Shift"];

/**
 * Convert a user-facing shortcut ("Ctrl+Shift+I", "Cmd+Option+K") into
 * WordCraft's notation ("Mod+Shift+I", "Mod+Alt+K"). Returns null when the
 * shortcut has no key or no modifier.
 */
export function toWordCraftKey(shortcut: string, platform: InstantCitePlatform = detectPlatform()): string | null {
  const parts = shortcut.split("+").map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const keyPart = parts.pop()!;
  const mods = new Set<string>();
  for (const raw of parts) {
    const m = raw.toLowerCase();
    if (m === "mod" || m === "cmd" || m === "command" || m === "meta" || m === "accel") mods.add("Mod");
    else if (m === "ctrl" || m === "control") mods.add(platform === "macos" ? "Ctrl" : "Mod");
    else if (m === "alt" || m === "option" || m === "opt") mods.add("Alt");
    else if (m === "shift") mods.add("Shift");
    else return null;
  }
  if (mods.size === 0) return null;
  const key = keyPart.length === 1 ? keyPart.toUpperCase() : keyPart[0].toUpperCase() + keyPart.slice(1);
  return [...MODIFIER_ORDER.filter(m => mods.has(m)), key].join("+");
}

/** Order-insensitive comparison key for a WordCraft shortcut. */
function canonicalKey(key: string): string {
  const parts = key.split("+");
  const last = parts.pop()!.toUpperCase();
  return [...parts.map(p => p.toLowerCase()).sort(), last].join("+");
}

function findBinding(map: Record<string, unknown>, key: string): [string, unknown] | null {
  const wanted = canonicalKey(key);
  for (const [k, v] of Object.entries(map)) {
    if (canonicalKey(k) === wanted) return [k, v];
  }
  return null;
}

/** Built-in WordCraft command that already uses this key, if any. */
export function getDefaultBindingConflict(key: string): string | null {
  const hit = findBinding(WORDCRAFT_DEFAULT_BINDINGS, key);
  return hit ? String(hit[1]) : null;
}

function isRemovedEntryForKey(entry: unknown, key: string): boolean {
  if (typeof entry === "string") return canonicalKey(entry) === canonicalKey(key);
  if (entry && typeof entry === "object" && typeof (entry as any).key === "string") {
    return canonicalKey((entry as any).key) === canonicalKey(key);
  }
  return false;
}

export interface UiJsonRewrite {
  text: string;
  changed: boolean;
}

interface KeyboardSection {
  data: any;
  keyboard: any;
  assigned: Record<string, unknown>;
  removed: unknown[];
}

function readKeyboard(text: string): KeyboardSection {
  const data = text.trim() ? JSON.parse(text) : {};
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("ui.json is not a JSON object");
  const keyboard = (data.keyboard && typeof data.keyboard === "object") ? data.keyboard : {};
  const assigned: Record<string, unknown> =
    (keyboard.assigned && typeof keyboard.assigned === "object") ? keyboard.assigned : {};
  const removed: unknown[] = Array.isArray(keyboard.removed) ? keyboard.removed : [];
  return { data, keyboard, assigned, removed };
}

/**
 * Unbind every citation key except `keep`. A built-in key we had taken over
 * is dropped from `removed` as well, so its built-in command works again.
 */
function dropCitationKeys(section: KeyboardSection, keep: string | null): boolean {
  let changed = false;
  for (const [k, v] of Object.entries(section.assigned)) {
    if (v !== WORDCRAFT_CITATION_COMMAND || (keep && canonicalKey(k) === canonicalKey(keep))) continue;
    delete section.assigned[k];
    if (getDefaultBindingConflict(k)) {
      section.removed = section.removed.filter(entry => !isRemovedEntryForKey(entry, k));
    }
    changed = true;
  }
  return changed;
}

/** Remove every key bound to the Zotero citation command and give built-in keys back. */
export function removeShortcutFromUiJson(text: string): UiJsonRewrite {
  if (!text.trim()) return { text, changed: false };
  const section = readKeyboard(text);
  if (!dropCitationKeys(section, null)) return { text, changed: false };
  section.data.keyboard = { ...section.keyboard, assigned: section.assigned, removed: section.removed };
  return { text: JSON.stringify(section.data, null, 2), changed: true };
}

/** Is a WordCraft process listed in this `tasklist /FO CSV /NH` or `ps -A -o comm=` output? */
export function processListHasWordCraft(output: string): boolean {
  return output.split(/\r?\n/).some(line => {
    const csv = line.match(/^"([^"]*)"/);
    const name = csv ? csv[1] : line.trim().split("/").pop() || "";
    return /^wordcraft/i.test(name);
  });
}

// --- File system and process checks ---

function getDir(key: string): string {
  try {
    return Services.dirsvc.get(key, Components.interfaces.nsIFile).path;
  } catch {
    return "";
  }
}

/** Candidate WordCraft settings directories, most likely first. */
export function getWordCraftConfigDirCandidates(platform: InstantCitePlatform = detectPlatform()): string[] {
  const home = getDir("Home");
  const dirs: string[] = [];
  if (platform === "windows") {
    const appData = getDir("AppData") || (home ? PathUtils.join(home, "AppData", "Roaming") : "");
    if (appData) dirs.push(PathUtils.join(appData, "WordCraft"));
  } else if (platform === "macos") {
    if (home) {
      dirs.push(PathUtils.join(home, "Library", "Application Support", "WordCraft"));
      dirs.push(PathUtils.join(home, "Library", "Application Support", "wordcraft"));
    }
  } else if (platform === "linux") {
    let xdg = "";
    try { xdg = Services.env.get("XDG_CONFIG_HOME"); } catch { /* unset */ }
    const configHome = xdg || (home ? PathUtils.join(home, ".config") : "");
    if (configHome) {
      dirs.push(PathUtils.join(configHome, "WordCraft"));
      dirs.push(PathUtils.join(configHome, "wordcraft"));
    }
  }
  return dirs;
}

async function findUiJson(platform: InstantCitePlatform): Promise<{ path: string; exists: boolean } | null> {
  const dirs = getWordCraftConfigDirCandidates(platform);
  for (const dir of dirs) {
    const file = PathUtils.join(dir, "ui.json");
    if (await IOUtils.exists(file)) return { path: file, exists: true };
  }
  for (const dir of dirs) {
    if (await IOUtils.exists(dir)) return { path: PathUtils.join(dir, "ui.json"), exists: false };
  }
  return null;
}

/** Is a WordCraft process running? null when this cannot be determined. */
export async function isWordCraftRunning(platform: InstantCitePlatform = detectPlatform()): Promise<boolean | null> {
  try {
    if (platform === "windows") {
      const out = await runSubprocess(getSystem32Exe("tasklist.exe"), ["/FO", "CSV", "/NH"]);
      return processListHasWordCraft(out);
    }
    return processListHasWordCraft(await runSubprocess("/bin/ps", ["-A", "-o", "comm="]));
  } catch (err) {
    logError("process list failed", err);
  }
  if (platform !== "windows") return null;
  try {
    // Fallback without stdout pipes: findstr's exit code says whether the name was listed.
    if (await runHiddenCmd(["tasklist", "/NH", "|", "findstr", "/I", "wordcraft"]) === 0) return true;
    // "System" is always listed, so a miss here means tasklist itself did not work.
    return await runHiddenCmd(["tasklist", "/NH", "|", "findstr", "/I", "/B", "System"]) === 0 ? false : null;
  } catch (err) {
    logError("cmd.exe fallback failed", err);
    return null;
  }
}

function getSystem32Exe(name: string): string {
  let root = "";
  try { root = Services.env.get("SystemRoot"); } catch { /* default below */ }
  return `${root || "C:\\Windows"}\\System32\\${name}`;
}

function logError(what: string, err: unknown) {
  try { Zotero.logError(`InstantCite for WordCraft: WordCraft check, ${what}: ${err}`); } catch { /* ignore */ }
}

/** Run `cmd.exe /d /c <args>` without a console window and resolve with its exit code. */
function runHiddenCmd(args: string[]): Promise<number> {
  const exe = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
  exe.initWithPath(getSystem32Exe("cmd.exe"));
  const proc = Components.classes["@mozilla.org/process/util;1"].createInstance(Components.interfaces.nsIProcess);
  proc.init(exe);
  proc.startHidden = true;
  return new Promise((resolve, reject) => {
    const cmdArgs = ["/d", "/c", ...args];
    proc.runwAsync(cmdArgs, cmdArgs.length, {
      observe: (_subject: unknown, topic: string) => {
        if (topic === "process-finished") resolve(proc.exitValue);
        else reject(new Error(topic));
      },
    } as any);
  });
}

async function writeWithBackup(path: string, original: string | null, text: string): Promise<void> {
  if (original !== null) await IOUtils.writeUTF8(path + BACKUP_SUFFIX, original);
  await IOUtils.writeUTF8(path, text, { tmpPath: path + ".tmp" });
}

export function getWordCraftManualInstructions(): string {
  return [
    "WordCraft has no keyboard setting for its Zotero commands.",
    "",
    "Without the shortcut, click Add/Edit Citation on WordCraft's Zotero ribbon tab:",
    "InstantCite opens in its place.",
  ].join("\n");
}

/** Turn the shortcut on (or move it to another key) and start the helper that holds it. */
export async function installWordCraftShortcut(
  shortcut = getDefaultWordCraftShortcut(),
): Promise<ShortcutResult> {
  if (!isWordCraftHotkeySupported()) {
    return { success: false, message: "The WordCraft shortcut is available on Windows only.", showManual: true };
  }
  if (!toWordCraftKey(shortcut, "windows")) {
    return { success: false, message: `"${shortcut}" is not a valid shortcut. Use something like Ctrl+Shift+I.` };
  }
  setPref("wordcraftShortcut", shortcut);
  setPref("wordcraftShortcutKeep", true);
  if (!await startWordCraftHotkey()) {
    return {
      success: false,
      message: "The shortcut helper could not be started; see Help > Debug Output Logging and the Error Console.",
      showManual: true,
    };
  }
  void removeLegacyBinding();
  return {
    success: true,
    message: `${shortcut} now opens InstantCite in WordCraft, whenever Zotero is running. ` +
      "It presses Add/Edit Citation on WordCraft's Zotero ribbon tab, so no WordCraft restart is needed. " +
      "In other programs the key keeps its usual meaning.",
  };
}

export async function uninstallWordCraftShortcut(): Promise<ShortcutResult> {
  setPref("wordcraftShortcutKeep", false);
  stopWordCraftHotkey();
  void removeLegacyBinding();
  return { success: true, message: "WordCraft shortcut turned off." };
}

/** Start the shortcut helper at Zotero startup when the shortcut is on. */
export async function startWordCraftShortcut(): Promise<void> {
  if (await startWordCraftHotkey()) void removeLegacyBinding();
}

export function stopWordCraftShortcut(): void {
  stopWordCraftHotkey();
}

/**
 * Drop the ui.json binding written by earlier versions. Only while WordCraft
 * is closed: it would write the binding it loaded back on exit.
 */
export async function removeLegacyBinding(platform: InstantCitePlatform = detectPlatform()): Promise<boolean> {
  try {
    const target = await findUiJson(platform);
    if (!target?.exists || await isWordCraftRunning(platform) !== false) return false;
    const original = await IOUtils.readUTF8(target.path);
    const rewrite = removeShortcutFromUiJson(original);
    if (!rewrite.changed) return false;
    await writeWithBackup(target.path, original, rewrite.text);
    try { Zotero.debug(`[InstantCite WordCraft] Removed the old shortcut entry from ${target.path}`); } catch { /* ignore */ }
    return true;
  } catch (err) {
    logError("removing the old ui.json shortcut", err);
    return false;
  }
}
