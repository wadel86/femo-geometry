// Names written onto a STEP file's shape representations and solids, where OpenCascade leaves them
// empty.
//
// A STEP reader can take a part's name from three places: the PRODUCT, the assembly occurrence
// (NEXT_ASSEMBLY_USAGE_OCCURRENCE) that places it, or the geometry itself — the shape
// representation and the solid bodies in it (MANIFOLD_SOLID_BREP …). OpenCascade's writer names
// the first two and writes '' on the third, and a reader that names a body from its solid —
// Onshape, on Parasolid — then numbers them Part 1, Part 2 … (TRESCA 3D, 2026-11-26). This
// follows each representation back to its product and writes that product's name on it and on
// each of its solids: as is for one solid, `<name>.<n>` from 1 for several.

/** The items a representation holds that are bodies, and so carry a part's name. */
const BODIES = new Set(['MANIFOLD_SOLID_BREP', 'BREP_WITH_VOIDS', 'FACETED_BREP', 'SHELL_BASED_SURFACE_MODEL']);

interface Entity {
  readonly type: string | undefined;
  readonly body: string;
  /** Offset of the body (what follows `#n =`) in the file. */
  readonly at: number;
}

/**
 * Writes each product's name on the shape representations that describe it and on their solids,
 * wherever the name there is empty. A name already written is left alone, and nothing else in the
 * file changes.
 */
export function nameRepresentationItems(step: string): string {
  const data = step.indexOf('\nDATA;');
  const end = step.lastIndexOf('ENDSEC;');
  if (data < 0 || end < data) return step;

  const entities = new Map<number, Entity>();
  const start = /^#(\d+)\s*=\s*/gm;
  start.lastIndex = data;
  const found: { id: number; at: number; from: number }[] = [];
  for (let m = start.exec(step); m && m.index < end; m = start.exec(step)) {
    found.push({ id: Number(m[1]), at: m.index + m[0].length, from: m.index });
  }
  found.forEach((f, i) => {
    const body = step.slice(f.at, i + 1 < found.length ? found[i + 1]!.from : end);
    entities.set(f.id, { type: /^([A-Z0-9_]+)\s*\(/.exec(body)?.[1], body, at: f.at });
  });

  const refs = (body: string): number[] => [...body.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  const first = (id: number | undefined, type: RegExp): number | undefined => {
    const entity = id === undefined ? undefined : entities.get(id);
    return entity?.type && type.test(entity.type) ? refs(entity.body)[0] : undefined;
  };
  // A product's name, as the literal the writer already encoded: '…' with any '' inside.
  const productName = (id: number | undefined): string | undefined => {
    const entity = id === undefined ? undefined : entities.get(id);
    return entity?.type === 'PRODUCT' ? /^PRODUCT\s*\(\s*('(?:[^']|'')*')/.exec(entity.body)?.[1] : undefined;
  };

  const edits: { at: number; name: string }[] = [];
  // An empty name opening the entity's argument list: `TYPE(''` and then a comma.
  const emptyName = (entity: Entity): number | undefined => {
    const open = entity.body.indexOf('(') + 1;
    return entity.body.startsWith("''", open) && /^\s*,/.test(entity.body.slice(open + 2)) ? entity.at + open : undefined;
  };

  for (const entity of entities.values()) {
    if (entity.type !== 'SHAPE_DEFINITION_REPRESENTATION') continue;
    const [shape, representation] = refs(entity.body);
    // representation → product definition shape → product definition → formation → product.
    const definition = first(shape, /^PRODUCT_DEFINITION_SHAPE$/);
    const formation = first(definition, /^PRODUCT_DEFINITION$/);
    const name = productName(first(formation, /^PRODUCT_DEFINITION_FORMATION/));
    const rep = representation === undefined ? undefined : entities.get(representation);
    if (!name || !rep?.type?.endsWith('SHAPE_REPRESENTATION') || rep.type.startsWith('CONTEXT_DEPENDENT')) continue;

    const at = emptyName(rep);
    if (at !== undefined) edits.push({ at, name });
    // The items are every reference but the last, which is the representation's context.
    const bodies = refs(rep.body)
      .slice(0, -1)
      .map((id) => entities.get(id))
      .filter((item): item is Entity => item?.type !== undefined && BODIES.has(item.type));
    bodies.forEach((item, index) => {
      const itemAt = emptyName(item);
      if (itemAt === undefined) return;
      edits.push({ at: itemAt, name: bodies.length === 1 ? name : `${name.slice(0, -1)}.${index + 1}'` });
    });
  }

  let named = step;
  for (const { at, name } of edits.sort((a, b) => b.at - a.at)) named = named.slice(0, at) + name + named.slice(at + 2);
  return named;
}
