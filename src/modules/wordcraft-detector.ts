/**
 * WordCraft session detection.
 *
 * WordCraft talks to Zotero through the LibreOffice integration protocol:
 * it opens a TCP connection to Zotero on 127.0.0.1:23116 and Zotero runs the
 * command with the agent "LibreOffice". At the protocol level a WordCraft
 * session is indistinguishable from a real LibreOffice session, so we look at
 * the operating system instead: which process owns the client end of the
 * connection to port 23116?
 *
 * - Windows: `netstat -ano -p TCP` gives the PID, `tasklist` maps it to an image name.
 * - macOS / Linux: `lsof -nP -iTCP:23116 -sTCP:ESTABLISHED` gives the command name directly.
 *
 * When the lookup itself fails (tool missing, unexpected output) we fall back
 * to treating every LibreOffice-protocol session as WordCraft, which is the
 * same behaviour as the original InstantCite.
 */

import { detectPlatform, type InstantCitePlatform } from "./platform";

export const LIBREOFFICE_INTEGRATION_PORT = 23116;
export const LIBREOFFICE_AGENT = "LibreOffice";

const CACHE_TTL_MS = 5000;
const WORDCRAFT_NAME_RE = /^wordcraf/i;

type PeerLookupResult = "wordcraft" | "other" | "unknown";

let cache: { at: number; result: PeerLookupResult } | null = null;

/** Run a process and return its stdout (wrapped so tests can replace it). */
export type SubprocessRunner = (command: string, args: string[]) => Promise<string>;

function defaultRunner(command: string, args: string[]): Promise<string> {
  return Zotero.Utilities.Internal.subprocess(command, args);
}

let runner: SubprocessRunner = defaultRunner;

export function runSubprocess(command: string, args: string[]): Promise<string> {
  return runner(command, args);
}

export function setSubprocessRunner(fn: SubprocessRunner | null): void {
  runner = fn ?? defaultRunner;
  cache = null;
}

export function resetWordCraftDetectionCache(): void {
  cache = null;
}

/** True when the integration session comes in over the LibreOffice protocol. */
export function isLibreOfficeProtocolSession(session: any = getCurrentSession()): boolean {
  return session?.agent === LIBREOFFICE_AGENT;
}

function getCurrentSession(): any {
  try {
    return Zotero.Integration.currentSession;
  } catch {
    return null;
  }
}

// --- Output parsers (pure, unit tested) ---

/**
 * PIDs owning the client end of a TCP connection to the integration port,
 * parsed from `netstat -ano -p TCP`. Column order is stable across Windows
 * locales: Proto, Local Address, Foreign Address, State, PID.
 */
export function parseNetstatClientPids(output: string, port = LIBREOFFICE_INTEGRATION_PORT): number[] {
  const pids = new Set<number>();
  const portSuffix = `:${port}`;
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0].toUpperCase() !== "TCP") continue;
    const local = cols[1];
    const remote = cols[2];
    const pid = Number(cols[cols.length - 1]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (!remote.endsWith(portSuffix) || local.endsWith(portSuffix)) continue;
    if (!/^(127\.0\.0\.1|\[::1\]|localhost)/i.test(remote)) continue;
    pids.add(pid);
  }
  return [...pids];
}

/** Map PID → image name from `tasklist /FO CSV /NH`. */
export function parseTasklistCsv(output: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^"([^"]*)","(\d+)"/);
    if (m) map.set(Number(m[2]), m[1]);
  }
  return map;
}

/**
 * Command names owning the client end of a connection to the integration port,
 * parsed from `lsof -nP -iTCP:<port> -sTCP:ESTABLISHED`.
 */
export function parseLsofClientCommands(output: string, port = LIBREOFFICE_INTEGRATION_PORT): string[] {
  const names = new Set<string>();
  const arrow = new RegExp(`->(127\\.0\\.0\\.1|\\[::1\\]|localhost):${port}\\b`, "i");
  for (const line of output.split(/\r?\n/)) {
    if (!arrow.test(line)) continue;
    const command = line.trim().split(/\s+/)[0];
    if (command) names.add(command.replace(/\\x20/g, " "));
  }
  return [...names];
}

export function classifyProcessNames(names: string[]): PeerLookupResult {
  if (names.length === 0) return "unknown";
  return names.some(n => WORDCRAFT_NAME_RE.test(n)) ? "wordcraft" : "other";
}

// --- OS lookups ---

function getWindowsSystem32(): string {
  let root = "";
  try { root = Services.env.get("SystemRoot"); } catch { /* fall through */ }
  return (root || "C:\\Windows") + "\\System32";
}

async function lookupWindows(): Promise<PeerLookupResult> {
  const sys32 = getWindowsSystem32();
  const netstat = await runner(`${sys32}\\NETSTAT.EXE`, ["-ano", "-p", "TCP"]);
  const pids = parseNetstatClientPids(netstat);
  if (pids.length === 0) return "unknown";
  const tasklist = await runner(`${sys32}\\tasklist.exe`, ["/FO", "CSV", "/NH"]);
  const names = parseTasklistCsv(tasklist);
  return classifyProcessNames(pids.map(pid => names.get(pid) ?? "").filter(Boolean));
}

async function findLsof(): Promise<string> {
  for (const candidate of ["/usr/sbin/lsof", "/usr/bin/lsof", "/bin/lsof"]) {
    try {
      if (await IOUtils.exists(candidate)) return candidate;
    } catch { /* keep looking */ }
  }
  return "lsof";
}

async function lookupUnix(): Promise<PeerLookupResult> {
  const lsof = await findLsof();
  const output = await runner(lsof, [
    "-nP",
    `-iTCP:${LIBREOFFICE_INTEGRATION_PORT}`,
    "-sTCP:ESTABLISHED",
  ]);
  return classifyProcessNames(parseLsofClientCommands(output));
}

export async function lookupIntegrationPeer(
  platform: InstantCitePlatform = detectPlatform(),
): Promise<PeerLookupResult> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.result;
  let result: PeerLookupResult = "unknown";
  try {
    if (platform === "windows") result = await lookupWindows();
    else if (platform === "macos" || platform === "linux") result = await lookupUnix();
  } catch (e) {
    Zotero.log("[InstantCite WordCraft] Peer process lookup failed: " + e);
    result = "unknown";
  }
  cache = { at: Date.now(), result };
  return result;
}

/**
 * Decide whether the current integration session belongs to WordCraft.
 * Non-LibreOffice agents (Word, Google Docs) are never WordCraft. For
 * LibreOffice-protocol sessions the peer process decides; an inconclusive
 * lookup counts as WordCraft so the dialog keeps working.
 */
export async function isWordCraftSession(session: any = getCurrentSession()): Promise<boolean> {
  if (!isLibreOfficeProtocolSession(session)) return false;
  const peer = await lookupIntegrationPeer();
  if (peer === "other") {
    Zotero.log("[InstantCite WordCraft] LibreOffice-protocol session is not WordCraft; leaving it to Zotero");
    return false;
  }
  return true;
}
