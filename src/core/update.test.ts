import { describe, expect, it } from "vitest";
import { fetchLatestRelease, isNewer } from "./update";

describe("update", () => {
  it("isNewer", () => {
    expect(isNewer("v0.2.0", "0.1.0")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.9", "0.1.10")).toBe(false);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
  });

  it("latest release", async () => {
    const ok = async () => new Response(JSON.stringify({ tag_name: "v0.2.0", html_url: "https://x/r" }));
    expect(await fetchLatestRelease(ok, "a/b")).toEqual({ version: "0.2.0", url: "https://x/r" });
    expect(await fetchLatestRelease(async () => new Response("", { status: 404 }), "a/b")).toBeNull();
    expect(await fetchLatestRelease(async () => { throw new Error("offline"); }, "a/b")).toBeNull();
  });
});
