import { describe, expect, it } from "vitest";
import { standardTemplate } from "./defaults";
import { finalizeBlockIds } from "./template-edit";

describe("finalizeBlockIds", () => {
  const original = standardTemplate("de");

  it("id aus name", () => {
    const draft = { ...original, blocks: [...original.blocks, { id: "neuer-baustein", name: "Mail-Server", rules: [] }] };
    expect(finalizeBlockIds(draft, original).blocks.map((b) => b.id)).toEqual(["web", "admin", "static", "ping", "mail-server"]);
  });

  it("id bleibt beim umbenennen", () => {
    const draft = { ...original, blocks: original.blocks.map((b) => (b.id === "web" ? { ...b, name: "Webserver" } : b)) };
    expect(finalizeBlockIds(draft, original).blocks[0]!.id).toBe("web");
  });

  it("vermeidet doppelte Kennungen", () => {
    const draft = {
      ...original,
      blocks: [...original.blocks, { id: "neuer-baustein", name: "Web", rules: [] }, { id: "neuer-baustein-2", name: "Web", rules: [] }],
    };
    expect(finalizeBlockIds(draft, original).blocks.slice(4).map((b) => b.id)).toEqual(["web-2", "web-3"]);
  });
});
