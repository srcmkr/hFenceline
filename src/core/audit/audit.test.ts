import { describe, expect, it } from "vitest";
import { MemoryFiles } from "../testing/memory";
import { AuditLog, type AuditEntry } from "./audit";

const entry = (n: number): AuditEntry => ({
  time: `2026-09-24T10:0${n}:00Z`,
  action: "set_rules",
  trigger: "home-ip",
  customer: "privat",
  project: "web",
  firewall_id: n,
  firewall_name: `fw-${n}`,
  result: "ok",
});

describe("AuditLog", () => {
  it("hängt an und liest neueste zuerst", async () => {
    const files = new MemoryFiles();
    const log = new AuditLog(files);
    await log.append(entry(1));
    await log.append(entry(2));
    expect((await log.readAll()).map((e) => e.firewall_id)).toEqual([2, 1]);
    expect(files.files.get("audit.jsonl")!.split("\n")).toHaveLength(3);
  });

  it("überspringt beschädigte Zeilen", async () => {
    const files = new MemoryFiles();
    files.files.set("audit.jsonl", `${JSON.stringify(entry(1))}\n{"time": "abgebroch`);
    expect(await new AuditLog(files).readAll()).toHaveLength(1);
  });
});
