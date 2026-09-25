import { describe, expect, it } from "vitest";
import { fetchHomeIp } from "./homeip";

const respond = (body: string, status = 200) => async () => new Response(body, { status });

describe("fetchHomeIp", () => {
  it("liefert eine gültige IPv4", async () => {
    expect(await fetchHomeIp(respond("203.0.113.7\n"))).toBe("203.0.113.7");
  });
  it.each(["2001:db8::1", "999.1.1.1", "<html>", "", "01.2.3.4"])("lehnt %j ab", async (body) => {
    await expect(fetchHomeIp(respond(body))).rejects.toMatchObject({ code: "invalid" });
  });
  it("meldet HTTP-Fehler", async () => {
    await expect(fetchHomeIp(respond("x", 503))).rejects.toMatchObject({ code: "http" });
  });
  it("meldet Netzwerkfehler", async () => {
    await expect(
      fetchHomeIp(async () => {
        throw new TypeError("offline");
      }),
    ).rejects.toMatchObject({ code: "network" });
  });
});
