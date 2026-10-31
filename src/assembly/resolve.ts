// The resolved geometry of an assembly: what the rules, the mesher and the screen all read, so
// that nobody recomputes an elevation on their own side.
//
// It is derived, never edited — a cache of the definition. Two modes read the same build:
//
// - `display` is the drawing. An assumption it had to make is a note, and the part is drawn.
// - `analysis` is what may be meshed. Every assumption is a refusal naming the symbol that would
//   have spared it, because a mesh of an assumed length is an invented number; and a STEP file is
//   only written when nothing is refused.
import type { AssemblyDefinition, Note, Placement, RefusalReason, Scope } from '../definition.ts';
import type { Idealisation } from '../builders/types.ts';
import type { Frame, GeometryKernel, Solid, Vec3 } from '../kernel/GeometryKernel.ts';
import { derivePorts, type Joint, type Port } from '../ports/ports.ts';
import {
  deriveZones,
  type Discontinuity,
  type Measured,
  type MeasurementIssue,
  type Proximity,
} from '../ports/zones.ts';
import { describeGeometry, type EdgeDescriptor, type FaceDescriptor } from '../topology/descriptors.ts';
import {
  assemblyBounds,
  runOrder,
  solidToAssembly,
  tessellationTolerance,
  toAssembly,
  toAssemblyVector,
  type AssemblyModel,
  type BuiltPart,
  type PartStatus,
} from './buildAssembly.ts';

export type GeometryMode = 'display' | 'analysis';

/** 2: discontinuities, proximities, measured symbols and their issues. */
export const GEOMETRY_FORMAT_VERSION = 2;

/** Why a part cannot go to analysis as it is. */
/**
 * A declared outcome, not an exception (Build Directives, §Scope and refusal): it names the
 * entry, the parameter that fell outside, the limit and the value seen.
 */
export interface Refusal {
  readonly componentId: string;
  readonly name: string;
  /** The catalogue entry refusing: the part's `ComponentType` wire value. */
  readonly entry: string;
  readonly reason: RefusalReason;
  readonly parameter: string;
  readonly limit: string;
  readonly value: string;
  /** The `CodeSymbol` that would answer it, when one would. */
  readonly symbol?: string;
  readonly message: string;
}

export interface ResolvedPart {
  readonly componentId: string;
  readonly name: string;
  readonly kind: string;
  readonly hostId: string | null;
  readonly status: PartStatus;
  readonly message?: string;
  /**
   * The frame the part was built in — its own for a part of the run, its host's for a mounted
   * one: turned over when `flipped` (a half turn about X), then raised to `z0`.
   */
  readonly z0: number;
  readonly flipped: boolean;
  /** For a mounted part: where it stands, and the direction it leaves its host in. */
  readonly frame?: Frame;
  readonly placement?: Placement;
  /** The assumptions of the drawing — in analysis mode, those that are refusals too. */
  readonly notes: readonly Note[];
  /**
   * Where the part is drawn as an idealisation of itself — a solid plate for a drilled one —
   * and, as data in its own frame, what was left out: which idealisation to mesh is the
   * analysis plan's choice.
   */
  readonly idealisations: readonly Idealisation[];
  readonly ports: readonly Port[];
  readonly faces: readonly FaceDescriptor[];
  readonly edges: readonly EdgeDescriptor[];
}

export interface ResolvedGeometry {
  readonly formatVersion: number;
  readonly mode: GeometryMode;
  readonly units: 'mm';
  /** The vessel axis. */
  readonly axis: Vec3;
  /** In analysis mode, whether it may be meshed: nothing refused and every anchor resolved. */
  readonly ready: boolean;
  readonly refusals: readonly Refusal[];
  /** Anchors that did not resolve to exactly one set of edges. */
  readonly errors: readonly string[];
  readonly parts: readonly ResolvedPart[];
  readonly joints: readonly Joint[];
  /** The multiple of √(R·t) the proximities' overlap flag uses. */
  readonly zoneFactor: number;
  readonly discontinuities: readonly Discontinuity[];
  readonly proximities: readonly Proximity[];
  /** Distances a rule reads, measured off the layout: by component id, then by symbol. */
  readonly measured: Readonly<Record<string, Readonly<Record<string, Measured>>>>;
  /** Stated symbols the layout contradicts — refusals too, under analysis. */
  readonly issues: readonly MeasurementIssue[];
}

export interface ResolveOptions {
  readonly mode?: GeometryMode;
  /** Tolerance of the naming predicates; by default the one the viewer derives from the model's size. */
  readonly epsilon?: number;
}

/** Refused by analysis mode: the STEP file of an assembly that is not ready to be meshed. */
export class RefusedError extends Error {
  readonly refusals: readonly Refusal[];

  constructor(refusals: readonly Refusal[]) {
    super(
      `The assembly is not ready for analysis: ${refusals.length} refusal${refusals.length === 1 ? '' : 's'} — ` +
        refusals
          .slice(0, 3)
          .map((r) => `${r.name}: ${r.message}`)
          .join('; ')
    );
    this.name = 'RefusedError';
    this.refusals = refusals;
  }
}

/** The tolerance the viewer names entities with, for a model of this size. */
export function namingTolerance(model: AssemblyModel, kernel: GeometryKernel): number {
  return Math.max(0.05, tessellationTolerance(assemblyBounds(model, kernel)) * 5);
}

/** What analysis mode refuses, without measuring a face: cheap enough to gate an export. */
export function refusalsOf(definition: AssemblyDefinition, model: AssemblyModel, mode: GeometryMode): Refusal[] {
  if (mode !== 'analysis') return [];
  const refusals: Refusal[] = [];
  const built = new Map(model.parts.map((p) => [p.componentId, p]));
  const who = (componentId: string) => {
    const part = built.get(componentId);
    return { componentId, name: part?.name ?? componentId, entry: part?.kind ?? 'unknown' };
  };
  for (const part of model.parts) {
    if (part.status === 'analysis') continue;
    if (part.status !== 'drawn') {
      refusals.push({
        ...who(part.componentId),
        ...(part.scope ?? UNSTATED),
        message: part.message ?? `${part.name} is not drawn`,
      });
      continue;
    }
    for (const n of part.notes) {
      refusals.push({
        ...who(part.componentId),
        ...(n.scope ?? UNSTATED),
        ...(n.symbol ? { symbol: n.symbol } : {}),
        message: n.message,
      });
    }
  }
  // Two neighbours in the run with no circular end between them are drawn one above the
  // other and joined by nothing: a non-circular body has no end the kernel can weld a head to.
  const run = runOrder(definition.components)
    .map((c) => built.get(c.id))
    .filter((p): p is BuiltPart => p?.status === 'drawn');
  for (let i = 0; i + 1 < run.length; i++) {
    const [below, above] = [run[i], run[i + 1]];
    const up = below.junctions?.[below.transform.flipped ? 'lower' : 'upper'];
    const down = above.junctions?.[above.transform.flipped ? 'upper' : 'lower'];
    if (up && down) continue;
    const without = [!up ? below : null, !down ? above : null].filter((p): p is BuiltPart => p !== null);
    refusals.push({
      ...who(above.componentId),
      reason: 'mismatch',
      parameter: `end facing ${below.name}`,
      limit: 'a circular end on both sides of the joint',
      value: `none on ${without.map((p) => `${p.name} (${p.kind})`).join(' and ')}`,
      message: `${above.name} is not joined to ${below.name}: ${without.map((p) => p.name).join(' and ')} offers no circular end to weld to, so the two are only drawn one against the other`,
    });
  }
  const { ports, joints } = derivePorts(definition, model);
  const portsById = new Map(ports.map((p) => [p.id, p]));
  for (const joint of joints) {
    const [a, b] = joint.ports.map((id) => portsById.get(id));
    if (!a || !b) continue;
    const between = `${who(a.componentId).name} / ${who(b.componentId).name}`;
    joint.issues.forEach((issue, index) => {
      refusals.push({
        ...who(b.componentId),
        ...(joint.findings[index] ?? UNSTATED),
        message: `${between}: ${issue}`,
      });
    });
  }
  // A dimension the layout contradicts is two models of one vessel: neither may be meshed.
  for (const issue of deriveZones(definition, model, ports, joints).issues) {
    refusals.push({
      ...who(issue.componentId),
      reason: 'mismatch',
      parameter: issue.symbol,
      limit: `the layout's ${Number(issue.measured.toPrecision(5))} mm`,
      value: `stated ${Number(issue.stated.toPrecision(5))} mm`,
      symbol: issue.symbol,
      message: issue.message,
    });
  }
  return refusals;
}

/**
 * What a refusal from a source that names nothing carries. Every source in the kernel names its
 * parameter; a test holds that, and this is only what a new one would show until it does.
 */
const UNSTATED: Scope = { reason: 'out_of_scope', parameter: 'unstated', limit: 'unstated', value: 'unstated' };

/** Resolves a built assembly: frames, ports, joints, descriptors and, in analysis, refusals. */
export function resolveGeometry(
  definition: AssemblyDefinition,
  model: AssemblyModel,
  kernel: GeometryKernel,
  options: ResolveOptions = {}
): ResolvedGeometry {
  const mode = options.mode ?? 'display';
  const epsilon = options.epsilon ?? namingTolerance(model, kernel);
  const { ports, joints } = derivePorts(definition, model);
  const zones = deriveZones(definition, model, ports, joints);
  const refusals = refusalsOf(definition, model, mode);
  const errors: string[] = [];

  const parts = model.parts.map((part): ResolvedPart => {
    const described =
      part.status === 'drawn' || part.status === 'failed'
        ? describeGeometry(part, kernel, epsilon)
        : { faces: [], edges: [], errors: [] };
    errors.push(...described.errors);
    return {
      componentId: part.componentId,
      name: part.name,
      kind: part.kind,
      hostId: part.hostId,
      status: part.status,
      ...(part.message ? { message: part.message } : {}),
      z0: part.transform.dz,
      flipped: part.transform.flipped,
      ...(part.mount
        ? {
            frame: {
              origin: toAssembly(part.mount.origin, part.transform),
              axis: toAssemblyVector(part.mount.axis, part.transform),
            },
          }
        : {}),
      ...(part.placement ? { placement: part.placement } : {}),
      notes: mode === 'analysis' ? part.notes : part.notes.filter((n) => !n.analysisOnly),
      idealisations: part.idealisations ?? [],
      ports: ports.filter((p) => p.componentId === part.componentId),
      faces: described.faces,
      edges: described.edges,
    };
  });

  return {
    formatVersion: GEOMETRY_FORMAT_VERSION,
    mode,
    units: 'mm',
    axis: [0, 0, 1],
    ready: refusals.length === 0 && errors.length === 0,
    refusals,
    errors,
    parts,
    joints,
    zoneFactor: zones.zoneFactor,
    discontinuities: zones.discontinuities,
    proximities: zones.proximities,
    measured: zones.measured,
    issues: zones.issues,
  };
}

/**
 * The STEP file of an assembly, millimetres, in the assembly's frame: one product per drawn
 * component, named by its id, its solids — repeats included — kept apart and unfused. In
 * analysis mode an assembly with anything refused is refused whole.
 */
export function stepOf(
  definition: AssemblyDefinition,
  model: AssemblyModel,
  kernel: GeometryKernel,
  mode: GeometryMode = 'display'
): string {
  const refusals = refusalsOf(definition, model, mode);
  if (refusals.length > 0) throw new RefusedError(refusals);

  const products = model.parts
    .filter((part) => part.status === 'drawn' && part.solids.length > 0)
    .map((part) => {
      const solids: Solid[] = [];
      part.solids.forEach((solid, index) => {
        const offsets: readonly Vec3[] = [[0, 0, 0], ...(part.copies?.[index] ?? [])];
        for (const offset of offsets) {
          const moved = offset.some((x) => x !== 0) ? kernel.translate(solid, offset) : solid;
          solids.push(solidToAssembly(kernel, moved, part.transform));
        }
      });
      return { name: part.componentId, solids };
    });
  return kernel.exportStep(products);
}
