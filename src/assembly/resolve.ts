// The resolved geometry of an assembly: what the rules, the mesher and the screen all read, so
// that nobody recomputes an elevation on their own side.
//
// It is derived, never edited — a cache of the definition. Two modes read the same build:
//
// - `display` is the drawing. An assumption it had to make is a note, and the part is drawn.
// - `analysis` is what may be meshed. Every assumption is a refusal naming the symbol that would
//   have spared it, because a mesh of an assumed length is an invented number; and a STEP file is
//   only written when nothing is refused.
import type { AssemblyDefinition, Note, Placement } from '../definition.ts';
import type { Frame, GeometryKernel, Solid, Vec3 } from '../kernel/GeometryKernel.ts';
import { derivePorts, type Joint, type Port } from '../ports/ports.ts';
import { describeGeometry, type EdgeDescriptor, type FaceDescriptor } from '../topology/descriptors.ts';
import {
  assemblyBounds,
  solidToAssembly,
  tessellationTolerance,
  toAssembly,
  toAssemblyVector,
  type AssemblyModel,
  type PartStatus,
} from './buildAssembly.ts';

export type GeometryMode = 'display' | 'analysis';

export const GEOMETRY_FORMAT_VERSION = 1;

/** Why a part cannot go to analysis as it is. */
export interface Refusal {
  readonly componentId: string;
  readonly name: string;
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
  for (const part of model.parts) {
    const who = { componentId: part.componentId, name: part.name };
    if (part.status === 'analysis') continue;
    if (part.status !== 'drawn') {
      refusals.push({ ...who, message: part.message ?? `${part.name} is not drawn` });
      continue;
    }
    for (const n of part.notes) {
      refusals.push({ ...who, ...(n.symbol ? { symbol: n.symbol } : {}), message: n.message });
    }
  }
  const names = new Map(model.parts.map((p) => [p.componentId, p.name]));
  for (const joint of derivePorts(definition, model).joints) {
    const componentId = joint.ports[1].split('@').slice(1).join('@');
    for (const issue of joint.issues) {
      refusals.push({ componentId, name: names.get(componentId) ?? componentId, message: `${joint.id}: ${issue}` });
    }
  }
  return refusals;
}

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
