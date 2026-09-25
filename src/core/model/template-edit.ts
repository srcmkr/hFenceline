import type { Template } from "./config";
import { slugify } from "./config";

export function finalizeBlockIds(draft: Template, original?: Template): Template {
  const existing = new Set((original?.blocks ?? []).map((b) => b.id));
  const taken = new Set(draft.blocks.filter((b) => existing.has(b.id)).map((b) => b.id));
  const blocks = draft.blocks.map((b) => {
    if (existing.has(b.id)) return b;
    const id = slugify(b.name, taken);
    taken.add(id);
    return { ...b, id };
  });
  return { ...draft, blocks };
}
