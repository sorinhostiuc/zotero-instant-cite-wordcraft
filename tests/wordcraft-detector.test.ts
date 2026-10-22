import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyProcessNames,
  isLibreOfficeProtocolSession,
  isWordCraftSession,
  lookupIntegrationPeer,
  parseLsofClientCommands,
  parseNetstatClientPids,
  parseTasklistCsv,
  setSubprocessRunner,
} from "../src/modules/wordcraft-detector";

const NETSTAT = [
  "",
  "Active Connections",
  "",
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    127.0.0.1:23116        0.0.0.0:0              LISTENING       30900",
  "  TCP    127.0.0.1:23116        127.0.0.1:53110        ESTABLISHED     30900",
  "  TCP    127.0.0.1:53110        127.0.0.1:23116        ESTABLISHED     41212",
  "  TCP    127.0.0.1:53000        127.0.0.1:23116        TIME_WAIT       0",
  "  TCP    192.168.1.5:50000      140.82.112.4:443       ESTABLISHED     5000",
  "  TCP    127.0.0.1:53111        127.0.0.1:23119        ESTABLISHED     7777",
].join("\r\n");

const TASKLIST = [
  "\"System Idle Process\",\"0\",\"Services\",\"0\",\"8 K\"",
  "\"zotero.exe\",\"30900\",\"Console\",\"1\",\"512,000 K\"",
  "\"wordcraft.exe\",\"41212\",\"Console\",\"1\",\"210,000 K\"",
  "\"soffice.bin\",\"5000\",\"Console\",\"1\",\"300,000 K\"",
].join("\r\n");

describe("wordcraft detector parsers", () => {
  it("finds only the client side of connections to the integration port", () => {
    expect(parseNetstatClientPids(NETSTAT)).toEqual([41212]);
  });

  it("maps PIDs to image names from tasklist CSV", () => {
    const map = parseTasklistCsv(TASKLIST);
    expect(map.get(41212)).toBe("wordcraft.exe");
    expect(map.get(30900)).toBe("zotero.exe");
  });

  it("reads client command names from lsof output", () => {
    const lsof = [
      "COMMAND     PID  USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "zotero     1200 sorin   80u  IPv4 0x1234      0t0  TCP 127.0.0.1:23116->127.0.0.1:61000 (ESTABLISHED)",
      "wordcraft  1300 sorin   21u  IPv4 0x5678      0t0  TCP 127.0.0.1:61000->127.0.0.1:23116 (ESTABLISHED)",
    ].join("\n");
    expect(parseLsofClientCommands(lsof)).toEqual(["wordcraft"]);
  });

  it("classifies peers by process name", () => {
    expect(classifyProcessNames(["wordcraft.exe"])).toBe("wordcraft");
    expect(classifyProcessNames(["WordCraft"])).toBe("wordcraft");
    expect(classifyProcessNames(["soffice.bin"])).toBe("other");
    expect(classifyProcessNames([])).toBe("unknown");
  });

  it("recognizes LibreOffice-protocol sessions by agent", () => {
    expect(isLibreOfficeProtocolSession({ agent: "LibreOffice" })).toBe(true);
    expect(isLibreOfficeProtocolSession({ agent: "WinWord" })).toBe(false);
    expect(isLibreOfficeProtocolSession(null)).toBe(false);
  });
});

describe("wordcraft session detection", () => {
  beforeEach(() => {
    (globalThis as any).Zotero = { log: vi.fn() };
    (globalThis as any).Services = {
      appinfo: { OS: "WINNT" },
      env: { get: () => "C:\\Windows" },
    };
  });

  afterEach(() => {
    setSubprocessRunner(null);
    delete (globalThis as any).Zotero;
    delete (globalThis as any).Services;
  });

  function runnerFor(netstat: string, tasklist: string) {
    return vi.fn(async (command: string) => (/netstat/i.test(command) ? netstat : tasklist));
  }

  it("detects WordCraft as the peer on Windows", async () => {
    const runner = runnerFor(NETSTAT, TASKLIST);
    setSubprocessRunner(runner);
    expect(await lookupIntegrationPeer("windows")).toBe("wordcraft");
    expect(runner).toHaveBeenCalledWith("C:\\Windows\\System32\\NETSTAT.EXE", ["-ano", "-p", "TCP"]);
  });

  it("caches the lookup result briefly", async () => {
    const runner = runnerFor(NETSTAT, TASKLIST);
    setSubprocessRunner(runner);
    await lookupIntegrationPeer("windows");
    await lookupIntegrationPeer("windows");
    expect(runner).toHaveBeenCalledTimes(2); // netstat + tasklist, once
  });

  it("rejects a LibreOffice peer", async () => {
    setSubprocessRunner(runnerFor(NETSTAT, TASKLIST.replace("wordcraft.exe", "soffice.bin")));
    expect(await isWordCraftSession({ agent: "LibreOffice" })).toBe(false);
  });

  it("falls back to WordCraft when the peer cannot be determined", async () => {
    setSubprocessRunner(vi.fn(async () => { throw new Error("no netstat"); }));
    expect(await isWordCraftSession({ agent: "LibreOffice" })).toBe(true);
  });

  it("never treats Word sessions as WordCraft", async () => {
    const runner = runnerFor(NETSTAT, TASKLIST);
    setSubprocessRunner(runner);
    expect(await isWordCraftSession({ agent: "WinWord" })).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });
});
