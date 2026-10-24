/**
 * Keyboard shortcut for WordCraft's Zotero Add/Edit Citation (Windows).
 *
 * WordCraft 0.10.0 offers no keyboard binding for its Zotero commands: they
 * are ribbon buttons only, absent from Customize Keyboard and unknown to its
 * command catalog. A small helper program (helper/WordCraftCite.cs, shipped
 * as chrome/content/helper/WordCraftCite.exe) fills the gap: while a
 * WordCraft window is in the foreground it holds a global hotkey, and on that
 * key it presses Zotero > Add/Edit Citation through UI Automation. Zotero
 * starts it with its own process id and the helper exits when Zotero does.
 */

import { getDefaultWordCraftShortcut, getPref } from "./preferences";
import { detectPlatform } from "./platform";

const HELPER_URL = "chrome://instantcitewc/content/helper/WordCraftCite.exe";
const HELPER_DIR = "instantcitewc";

let helper: any = null;

function log(message: string) {
  try { Zotero.debug(`[InstantCite WordCraft] ${message}`); } catch { /* ignore */ }
}

export function isWordCraftHotkeySupported(): boolean {
  return detectPlatform() === "windows";
}

export function getHelperLogPath(): string {
  return PathUtils.join(PathUtils.profileDir, HELPER_DIR, "wordcraft-helper.log");
}

/** FNV-1a hash of the helper, so each build gets its own file name. */
export function helperFileName(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 0x01000193);
  return `WordCraftCite-${(hash >>> 0).toString(16).padStart(8, "0")}.exe`;
}

/**
 * Copy the helper out of the add-on package, which Windows cannot run from.
 * The file name follows the content, so an update never has to overwrite an
 * executable that an older helper may still hold open.
 */
async function extractHelper(): Promise<string> {
  const dir = PathUtils.join(PathUtils.profileDir, HELPER_DIR);
  const win: any = Zotero.getMainWindow() ?? (Services as any).appShell.hiddenDOMWindow;
  const bytes = new Uint8Array(await (await win.fetch(HELPER_URL)).arrayBuffer());
  const target = PathUtils.join(dir, helperFileName(bytes));
  if (await IOUtils.exists(target)) return target;
  await IOUtils.makeDirectory(dir, { ignoreExisting: true });
  await IOUtils.write(target, bytes);
  for (const child of await IOUtils.getChildren(dir)) {
    if (child !== target && /WordCraftCite-.*\.exe$/i.test(child)) {
      try { await IOUtils.remove(child); } catch { /* still running */ }
    }
  }
  return target;
}

/** Start (or restart) the helper when the shortcut is enabled. Resolves true when it runs. */
export async function startWordCraftHotkey(): Promise<boolean> {
  stopWordCraftHotkey();
  if (!isWordCraftHotkeySupported() || !getPref<boolean>("wordcraftShortcutKeep")) return false;
  const shortcut = getPref<string>("wordcraftShortcut") || getDefaultWordCraftShortcut();
  try {
    const exe = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
    exe.initWithPath(await extractHelper());
    const proc = Components.classes["@mozilla.org/process/util;1"].createInstance(Components.interfaces.nsIProcess);
    proc.init(exe);
    proc.startHidden = true;
    const args = ["--key", shortcut, "--parent", String(Services.appinfo.processID), "--log", getHelperLogPath()];
    proc.runwAsync(args, args.length, {
      observe: (_subject: unknown, topic: string) => {
        log(`WordCraft shortcut helper ended (${topic}, exit ${proc.exitValue})`);
        if (helper === proc) helper = null;
      },
    } as any);
    helper = proc;
    log(`WordCraft shortcut helper started for ${shortcut}`);
    return true;
  } catch (err) {
    try { Zotero.logError(`InstantCite for WordCraft: cannot start the WordCraft shortcut helper: ${err}`); } catch { /* ignore */ }
    return false;
  }
}

export function stopWordCraftHotkey(): void {
  const proc = helper;
  helper = null;
  try {
    if (proc?.isRunning) proc.kill();
  } catch { /* already gone */ }
}
