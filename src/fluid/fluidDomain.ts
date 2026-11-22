// The fluid domain of a chamber: the wetted volume a CFD model meshes, derived from the drawn
// parts of ANY assembly, with no knowledge of what an exchanger is.
//
// The method is the solid model's own negative. Every part that bounds the fluid is a WALL, and
// a box round the vessel minus every wall leaves the outside and one piece per closed space —
// once each nozzle is capped at its outer end, or at a stated extension beyond it, so that an
// outlet condition sits away from the shell. Which piece is wanted is said by an opening that
// leads into it: "the chamber N1 opens into". A part that is too fine to mesh declares itself
// POROUS (a tube bundle) and contributes its envelope as a named zone instead of being cut out;
// a thin part the flow goes around declares itself a BAFFLE and contributes a zero-thickness
// face. Both are the part's declaration (`FluidIdealisation`), never a kind tested here.
//
// What the domain does not draw — a baffle's clearances — it carries as areas (`leakage.ts`).
import { solidToAssembly, toAssembly, toAssemblyVector, type AssemblyModel, type BuiltPart } from '../assembly/buildAssembly.ts';
import type { FluidIdealisation } from '../builders/types.ts';
import type { AssemblyDefinition } from '../definition.ts';
import type { Bounds, GeometryKernel, Sheet, Solid, Vec3 } from '../kernel/GeometryKernel.ts';
import { derivePorts } from '../ports/ports.ts';
import { leakageOf, type LeakageReport } from './leakage.ts';

export interface FluidZone {
  readonly name: string;
  readonly type: 'fluid' | 'porous';
  /** A porous zone's principal axis, in the assembly's frame; null for free fluid. */
  readonly axis: Vec3 | null;
  /** The part the zone stands for; null for the free fluid. */
  readonly source: string | null;
  readonly solids: readonly Solid[];
  readonly volume: number;
}

export interface FluidFace {
  readonly surface: string;
  readonly area: number;
  readonly bounds: Bounds;
}

export interface FluidBoundary {
  readonly name: string;
  readonly type: 'opening' | 'wall' | 'baffle' | 'interface';
  readonly area: number;
  /** The part, port or pair of zones it comes from. */
  readonly source: string;
  /** For an opening: the centre of its face and its outward normal. */
  readonly locator?: { readonly point: Vec3; readonly normal: Vec3 };
  /** The faces of the domain the group is made of, where it is made of the domain's own faces. */
  readonly faces?: readonly FluidFace[];
  /** The face itself, where it is not one of the domain's — a baffle inside the volume. */
  readonly sheet?: Sheet;
}

export interface FluidDomain {
  /** The opening the chamber was asked for by. */
  readonly chamber: string;
  readonly cavity: Solid;
  readonly volume: number;
  readonly zones: readonly FluidZone[];
  readonly boundaries: readonly FluidBoundary[];
  /** For a baffled bundle in the chamber: its leakage and bypass areas, book and drawn. */
  readonly leakage: LeakageReport | null;
  readonly notes: readonly string[];
}

export interface FluidDomainOptions {
  /** The id of an opening — a nozzle — that leads into the chamber wanted. */
  readonly chamber: string;
  /** How far beyond each nozzle's outer end the domain runs before it is capped; absent, 0. */
  readonly extension?: number;
}

/** A chamber that cannot be derived, and the input to change. */
export class FluidDomainError extends Error {
  readonly parameter: string;
  constructor(message: string, parameter: string) {
    super(message);
    this.parameter = parameter;
  }
}

/** Thickness of the disc a nozzle is capped with: only its inner face matters. */
const CAP = 5;

interface Opening {
  readonly id: string;
  readonly centre: Vec3;
  readonly axis: Vec3;
  readonly insideRadius: number;
  readonly outsideRadius: number;
}

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];

export function fluidDomain(definition: AssemblyDefinition, model: AssemblyModel, kernel: GeometryKernel, options: FluidDomainOptions): FluidDomain {
  const notes: string[] = [];
  const extension = options.extension ?? 0;
  const roleOf = (part: BuiltPart): FluidIdealisation => part.fluid ?? { role: 'wall' };

  // ------------------------------------------------------------- what is not drawn is not there
  const asked = model.parts.find((p) => p.componentId === options.chamber);
  if (!asked) {
    throw new FluidDomainError(`No part ${options.chamber} in the assembly`, 'chamber');
  }
  if (asked.status !== 'drawn') {
    throw new FluidDomainError(`${options.chamber} is not drawn, so the chamber it opens into has no opening: ${asked.message ?? asked.status}`, 'chamber');
  }
  for (const part of model.parts) {
    if (part.status !== 'drawn') notes.push(`${part.componentId} is not drawn and is not in the domain: ${part.message ?? part.status}`);
  }
  const drawn = model.parts.filter((p) => p.status === 'drawn');

  // ------------------------------------------------------------- walls, in the assembly's frame
  const world = (part: BuiltPart, solid: Solid) => solidToAssembly(kernel, solid, part.transform);
  const wallsOf = new Map<string, Solid[]>();
  for (const part of drawn) {
    const role = roleOf(part);
    if (role.role !== 'wall') continue;
    const skip = new Set(role.exclude ?? []);
    const solids: Solid[] = [];
    part.solids.forEach((solid, index) => {
      if (skip.has(index)) return;
      for (const offset of [[0, 0, 0] as Vec3, ...(part.copies?.[index] ?? [])]) {
        solids.push(world(part, offset.some((x) => x !== 0) ? kernel.translate(solid, offset) : solid));
      }
    });
    if (solids.length > 0) wallsOf.set(part.componentId, solids);
  }

  // ------------------------------------------------------------- every nozzle capped at its end
  const { ports } = derivePorts(definition, model);
  const openings: Opening[] = ports
    .filter((p) => p.key === 'neck:outer-end' && p.insideRadius !== undefined && p.outsideRadius !== undefined)
    .map((p) => ({
      id: p.componentId,
      centre: add(p.location, p.axis, extension),
      axis: p.axis,
      insideRadius: p.insideRadius!,
      outsideRadius: p.outsideRadius!,
    }));
  if (!openings.some((o) => o.id === options.chamber)) {
    throw new FluidDomainError(
      `${options.chamber} is not an opening: the chamber is asked for by a nozzle that leads into it (${openings.map((o) => o.id).join(', ') || 'none drawn'})`,
      'chamber'
    );
  }
  const caps: Solid[] = [];
  const extensions = new Map<string, Solid[]>();
  for (const o of openings) {
    const frame = { origin: add(o.centre, o.axis, -extension), axis: o.axis };
    if (extension > 0) {
      const pipe = kernel.tube(frame, o.insideRadius, o.outsideRadius, 0, extension);
      caps.push(pipe);
      extensions.set(`${o.id}:extension`, [pipe]);
    }
    caps.push(kernel.tube(frame, 0, o.outsideRadius, extension, extension + CAP));
  }

  // ------------------------------------------------------------- the box less every wall
  const walls = [...[...wallsOf.values()].flat(), ...caps];
  const around = union(walls.map((s) => kernel.bounds(s)));
  const pad = 0.05 * Math.max(...[0, 1, 2].map((i) => around.max[i]! - around.min[i]!)) + 10;
  const box = boxSolid(kernel, { min: add(around.min, [-pad, -pad, -pad]), max: add(around.max, [pad, pad, pad]) });
  const boxBounds = kernel.bounds(box);
  const pieces = kernel.solidsOf(kernel.cut(box, walls)).filter((piece) => !touches(kernel.bounds(piece), boxBounds));
  const inside = (o: Opening) => add(o.centre, o.axis, -0.5);
  const asking = openings.find((o) => o.id === options.chamber)!;
  const cavity = pieces.find((piece) => contains(kernel, piece, inside(asking)));
  if (!cavity) {
    throw new FluidDomainError(`${options.chamber}'s bore leads into no closed space: the walls do not close round it`, 'chamber');
  }
  const volume = kernel.volume(cavity);
  const mine = openings.filter((o) => contains(kernel, cavity, inside(o)));

  // ------------------------------------------------------------- zones
  const zones: FluidZone[] = [];
  let free: Solid = cavity;
  const named = new Set<string>();
  const zoneName = (name: string, source: string) => {
    const plain = `zone:${name}`;
    const unique = named.has(plain) ? `zone:${source}:${name}` : plain;
    named.add(unique);
    return unique;
  };
  for (const part of drawn) {
    const role = roleOf(part);
    if (role.role !== 'porous') continue;
    const envelope = world(part, role.envelope);
    const within = safeIntersect(kernel, cavity, envelope);
    if (!within || kernel.volume(within) <= 1e-6 * volume) continue;
    const axis = toAssemblyVector(role.axis, part.transform);
    const taken: Solid[] = [];
    for (const sub of role.subZones ?? []) {
      const raw = safeIntersect(kernel, within, world(part, sub.solid));
      const solid = raw && taken.length > 0 ? kernel.cut(raw, taken) : raw;
      if (!solid || kernel.volume(solid) <= 0) continue;
      zones.push(zone(kernel, zoneName(sub.name, part.componentId), 'porous', axis, part.componentId, solid));
      taken.push(world(part, sub.solid));
    }
    const core = taken.length > 0 ? kernel.cut(within, taken) : within;
    zones.push(zone(kernel, zoneName(role.name, part.componentId), 'porous', axis, part.componentId, core));
    const cutters = [envelope];
    if (role.bypass) {
      const region = world(part, role.bypass.solid);
      const raw = safeIntersect(kernel, cavity, region);
      const bypass = raw ? kernel.cut(raw, [envelope]) : null;
      if (bypass && kernel.volume(bypass) > 0) zones.push(zone(kernel, zoneName(role.bypass.name, part.componentId), 'fluid', null, part.componentId, bypass));
      cutters.push(region);
    }
    free = kernel.cut(free, cutters);
  }
  if (kernel.volume(free) > 1e-9 * volume) zones.unshift(zone(kernel, 'zone:fluid', 'fluid', null, null, free));

  // ------------------------------------------------------------- boundaries
  const boundaries: FluidBoundary[] = [];
  const faces = kernel.topology(cavity).faces;
  const used = new Set<number>();
  for (const o of mine) {
    const face = faces.find(
      (f) => f.surface === 'plane' && Math.hypot(...[0, 1, 2].map((i) => (f.bounds.min[i]! + f.bounds.max[i]!) / 2 - o.centre[i]!)) < 1 && Math.abs(f.area / (Math.PI * o.insideRadius ** 2) - 1) < 0.01
    );
    if (face) used.add(face.id);
    else notes.push(`opening:${o.id}: its face was not found among the domain's; area given from its bore`);
    boundaries.push({
      name: `opening:${o.id}`,
      type: 'opening',
      area: face?.area ?? Math.PI * o.insideRadius ** 2,
      source: o.id,
      locator: { point: o.centre, normal: o.axis },
      ...(face ? { faces: [{ surface: face.surface, area: face.area, bounds: face.bounds }] } : {}),
    });
  }
  // Each remaining face belongs to the wall that bounds it: the smallest part whose box holds it.
  const boxes = [...wallsOf.entries(), ...extensions.entries()].map(([id, solids]) => ({ id, bounds: union(solids.map((s) => kernel.bounds(s))) }));
  const byWall = new Map<string, FluidFace[]>();
  for (const f of faces) {
    if (used.has(f.id)) continue;
    const tolerance = 1e-4 * Math.hypot(...[0, 1, 2].map((i) => boxBounds.max[i]! - boxBounds.min[i]!)) + 1e-3;
    const holders = boxes.filter((b) => holds(b.bounds, f.bounds, tolerance)).sort((a, b) => size(a.bounds) - size(b.bounds));
    const id = holders[0]?.id ?? 'unassigned';
    if (!byWall.has(id)) byWall.set(id, []);
    byWall.get(id)!.push({ surface: f.surface, area: f.area, bounds: f.bounds });
  }
  for (const [id, list] of byWall) {
    if (id === 'unassigned') notes.push(`${list.length} face(s) of the domain lie in no single wall's box: grouped as wall:unassigned`);
    boundaries.push({ name: `wall:${id}`, type: 'wall', area: list.reduce((s, f) => s + f.area, 0), source: id, faces: list });
  }
  for (const part of drawn) {
    const role = roleOf(part);
    if (role.role !== 'baffle') continue;
    for (const spec of role.faces) {
      const origin = toAssembly(spec.origin, part.transform);
      const normal = toAssemblyVector(spec.normal, part.transform);
      let sheet: Sheet;
      try {
        sheet = kernel.clip(kernel.section(cavity, origin, normal), world(part, spec.region));
      } catch {
        continue;
      }
      const area = kernel.area(sheet);
      if (area <= 0) continue;
      boundaries.push({ name: spec.name, type: 'baffle', area, source: part.componentId, sheet });
    }
  }
  // Two zones meet where their union has less surface than the two of them apart.
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i]!;
      const b = zones[j]!;
      if (!overlaps(boundsOf(kernel, a.solids), boundsOf(kernel, b.solids), 1e-3)) continue;
      const fused = [...a.solids, ...b.solids].reduce((s, t) => kernel.fuse(s, t));
      const shared = (surface(kernel, a.solids) + surface(kernel, b.solids) - kernel.surfaceArea(fused)) / 2;
      if (shared > 1e-6 * kernel.surfaceArea(cavity)) {
        boundaries.push({ name: `interface:${a.name.slice(5)}~${b.name.slice(5)}`, type: 'interface', area: shared, source: `${a.name}~${b.name}` });
      }
    }
  }

  // ------------------------------------------------------------- what the clearances leak
  let leakage: LeakageReport | null = null;
  const baffled = drawn.find((p) => p.baffles && boundaries.some((b) => b.type === 'baffle' && b.source === p.componentId));
  if (baffled?.baffles) {
    const bundle = drawn.find((p) => p.bundle && p.hostId === baffled.hostId && zones.some((z) => z.source === p.componentId));
    if (bundle?.bundle) leakage = leakageOf(baffled.baffles, bundle.bundle);
    else notes.push(`${baffled.componentId}: no bundle in the same course, so no leakage areas`);
  }
  const accounted = zones.reduce((s, z) => s + z.volume, 0);
  if (Math.abs(accounted - volume) > 1e-6 * volume) notes.push(`The zones hold ${accounted.toFixed(0)} mm³ of the chamber's ${volume.toFixed(0)}`);
  return { chamber: options.chamber, cavity, volume, zones, boundaries, leakage, notes };
}

/** The manifest: everything of the domain but its shapes, millimetres. */
export function fluidManifest(domain: FluidDomain) {
  return {
    units: { length: 'mm', area: 'mm2', volume: 'mm3' },
    chamber: domain.chamber,
    volume: domain.volume,
    zones: domain.zones.map(({ name, type, axis, source, volume }) => ({ name, type, axis, source, volume })),
    boundaries: domain.boundaries.map(({ name, type, area, source, locator, faces }) => ({
      name,
      type,
      area,
      source,
      ...(locator ? { locator } : {}),
      ...(faces ? { faces } : {}),
    })),
    leakage: domain.leakage,
    notes: domain.notes,
  };
}

/** The domain as STEP: one product per zone, one per baffle face, one per opening face. */
export function fluidStep(domain: FluidDomain, kernel: GeometryKernel): string {
  const openings = domain.boundaries
    .filter((b) => b.type === 'opening' && b.locator)
    .map((b) => {
      const { point, normal } = b.locator!;
      const radius = Math.sqrt(b.area / Math.PI);
      const disc = kernel.tube({ origin: add(point, normal, -1), axis: normal }, 0, radius * 1.01, 0, 2);
      return { name: b.name, solids: [], sheets: [kernel.clip(kernel.section(domain.cavity, point, normal), disc)] };
    });
  return kernel.exportStep([
    ...domain.zones.map((z) => ({ name: z.name, solids: z.solids })),
    ...domain.boundaries.filter((b) => b.sheet).map((b) => ({ name: b.name, solids: [], sheets: [b.sheet!] })),
    ...openings,
  ]);
}

// ---------------------------------------------------------------- helpers

function zone(kernel: GeometryKernel, name: string, type: 'fluid' | 'porous', axis: Vec3 | null, source: string | null, solid: Solid): FluidZone {
  const solids = kernel.solidsOf(solid);
  const parts = solids.length > 0 ? solids : [solid];
  return { name, type, axis, source, solids: parts, volume: parts.reduce((s, p) => s + kernel.volume(p), 0) };
}

function safeIntersect(kernel: GeometryKernel, a: Solid, b: Solid): Solid | null {
  try {
    const result = kernel.intersect(a, b);
    return kernel.volume(result) > 0 ? result : null;
  } catch {
    return null;
  }
}

/** Whether a point is inside a solid: a millimetre cube round it shares volume with it. */
function contains(kernel: GeometryKernel, solid: Solid, point: Vec3): boolean {
  const cube = boxSolid(kernel, { min: add(point, [-0.25, -0.25, -0.25]), max: add(point, [0.25, 0.25, 0.25]) });
  const common = safeIntersect(kernel, solid, cube);
  return common !== null && kernel.volume(common) > 1e-6;
}

function boxSolid(kernel: GeometryKernel, b: Bounds): Solid {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  return kernel.extrude({ start: [x0, y0], steps: [{ kind: 'line', to: [x1, y0] }, { kind: 'line', to: [x1, y1] }, { kind: 'line', to: [x0, y1] }] }, z0, z1);
}

function union(list: readonly Bounds[]): Bounds {
  return {
    min: [0, 1, 2].map((i) => Math.min(...list.map((b) => b.min[i]!))) as unknown as Vec3,
    max: [0, 1, 2].map((i) => Math.max(...list.map((b) => b.max[i]!))) as unknown as Vec3,
  };
}

function boundsOf(kernel: GeometryKernel, solids: readonly Solid[]): Bounds {
  return union(solids.map((s) => kernel.bounds(s)));
}

function surface(kernel: GeometryKernel, solids: readonly Solid[]): number {
  return solids.reduce((s, p) => s + kernel.surfaceArea(p), 0);
}

function touches(a: Bounds, box: Bounds): boolean {
  return [0, 1, 2].some((i) => Math.abs(a.min[i]! - box.min[i]!) < 1e-6 || Math.abs(a.max[i]! - box.max[i]!) < 1e-6);
}

function holds(outer: Bounds, inner: Bounds, tolerance: number): boolean {
  return [0, 1, 2].every((i) => inner.min[i]! >= outer.min[i]! - tolerance && inner.max[i]! <= outer.max[i]! + tolerance);
}

function overlaps(a: Bounds, b: Bounds, tolerance: number): boolean {
  return [0, 1, 2].every((i) => a.min[i]! <= b.max[i]! + tolerance && b.min[i]! <= a.max[i]! + tolerance);
}

function size(b: Bounds): number {
  return [0, 1, 2].reduce((v, i) => v * Math.max(b.max[i]! - b.min[i]!, 1e-3), 1);
}
