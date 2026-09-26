// Turns a built assembly into plain buffers and descriptors — what a renderer needs, and nothing
// that refers back to the kernel, so it can cross a worker boundary or a network.
import type { Placement, PlacementAnchor } from '../definition.ts';
import type { GeometryKernel, Vec3 } from '../kernel/GeometryKernel.ts';
import { describePart, type EntityDescriptor } from '../topology/describe.ts';
import type { AssemblyModel, PartStatus, PartTransform } from './buildAssembly.ts';

export interface EntityRange {
  /** First index (faces: into `indices`; edges: vertex into `lines`) and how many. */
  readonly start: number;
  readonly count: number;
  readonly descriptor: EntityDescriptor;
}

export interface SolidMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly lines: Float32Array;
  readonly faces: readonly EntityRange[];
  readonly edges: readonly EntityRange[];
  /** Where the same mesh is drawn again, as translations in the part's frame. */
  readonly copies?: readonly Vec3[];
}

export interface PartMesh {
  readonly componentId: string;
  readonly name: string;
  readonly kind: string;
  readonly hostId: string | null;
  readonly status: PartStatus;
  readonly message?: string;
  readonly notes: readonly string[];
  readonly transform: PartTransform;
  /** For a mounted part: the placement it was drawn at, stated or defaulted. */
  readonly placement?: Placement;
  readonly footprint?: number;
  readonly hostOffsetRange?: readonly [number, number];
  readonly hostAnchor?: PlacementAnchor;
  readonly solids: readonly SolidMesh[];
  /** Anchors that did not resolve — reported, never guessed. */
  readonly errors: readonly string[];
}

/**
 * @param tolerance chordal deviation in millimetres, from `tessellationTolerance`
 * @param epsilon tolerance of the naming predicates, in millimetres
 */
export function tessellateModel(
  model: AssemblyModel,
  kernel: GeometryKernel,
  tolerance: number,
  epsilon: number
): PartMesh[] {
  return model.parts.map((part) => {
    const errors: string[] = [];
    const solids = part.solids.map((solid, index): SolidMesh => {
      const tessellation = kernel.tessellate(solid, tolerance);
      const description = describePart(part, tessellation, index, epsilon);
      errors.push(...description.errors);
      return {
        positions: tessellation.positions,
        normals: tessellation.normals,
        indices: tessellation.indices,
        lines: tessellation.lines,
        faces: tessellation.faces.map((face, i) => ({
          start: face.start,
          count: face.count,
          descriptor: description.faces[i],
        })),
        edges: tessellation.edges.map((edge, i) => ({
          start: edge.start3,
          count: edge.count3,
          descriptor: description.edges[i],
        })),
        copies: part.copies?.[index],
      };
    });

    return {
      componentId: part.componentId,
      name: part.name,
      kind: part.kind,
      hostId: part.hostId,
      status: part.status,
      message: part.message,
      notes: part.notes,
      transform: part.transform,
      placement: part.placement,
      footprint: part.footprint,
      hostOffsetRange: part.hostOffsetRange,
      hostAnchor: part.hostAnchor,
      solids,
      errors,
    };
  });
}
