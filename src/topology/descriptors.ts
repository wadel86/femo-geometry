// Geometric descriptors: what a semantic reference is, measured, so that it can be found again
// somewhere the kernel is not — in a mesher that imports the STEP file and renumbers it.
//
// A name carries no topology across that boundary: STEP entity indices are renumbered on import
// and a fuse renames whatever it touches. What survives is geometry, so each named face and edge
// is described by the predicates it can be re-evaluated with — the kind of surface or curve, its
// axis, centre, radii, length, area and box — in the assembly's frame.
import { toAssembly, toAssemblyVector, type BuiltPart, type PartTransform } from '../assembly/buildAssembly.ts';
import type {
  Bounds,
  CurveKind,
  Frame,
  GeometryKernel,
  SurfaceKind,
  Vec3,
} from '../kernel/GeometryKernel.ts';
import { circleOf, describePart } from './describe.ts';

export interface FaceDescriptor {
  readonly ref: string;
  /** Which of the part's solids it belongs to. */
  readonly solid: number;
  readonly role?: string;
  readonly surface: SurfaceKind;
  /** Square millimetres. */
  readonly area: number;
  readonly center: Vec3;
  readonly bounds: Bounds;
  readonly axis: Frame | null;
  /** Principal radii at the middle of the face, null where it is flat that way. */
  readonly radii: readonly [number | null, number | null];
  /** Where the same face is repeated: translations, in the assembly's frame. */
  readonly copies?: readonly Vec3[];
}

export interface EdgeDescriptor {
  readonly ref: string;
  readonly solid: number;
  readonly role?: string;
  readonly curve: CurveKind;
  readonly length: number;
  readonly closed: boolean;
  readonly start: Vec3;
  readonly middle: Vec3;
  readonly end: Vec3;
  /** For a circle or an arc of one. */
  readonly center: Vec3 | null;
  readonly radius: number | null;
  readonly bounds: Bounds;
  readonly copies?: readonly Vec3[];
}

export interface PartDescriptors {
  readonly faces: readonly FaceDescriptor[];
  readonly edges: readonly EdgeDescriptor[];
  /** Anchors that did not resolve — reported, never guessed. */
  readonly errors: readonly string[];
}

/**
 * Describes every named face and edge of a part, in the assembly's frame. Seams are left out:
 * they are where a surface of revolution meets itself, not edges of the form.
 *
 * @param epsilon tolerance of the naming predicates, in millimetres — the one the viewer uses,
 *     so that a reference means the same entity in both
 */
export function describeGeometry(part: BuiltPart, kernel: GeometryKernel, epsilon: number): PartDescriptors {
  const faces: FaceDescriptor[] = [];
  const edges: EdgeDescriptor[] = [];
  const errors: string[] = [];
  const point = (p: Vec3) => toAssembly(p, part.transform);
  const vector = (v: Vec3) => toAssemblyVector(v, part.transform);

  part.solids.forEach((solid, index) => {
    const topology = kernel.topology(solid);
    const description = describePart(part, topology, index, epsilon);
    errors.push(...description.errors);
    const copies = part.copies?.[index]?.map(vector);
    const repeated = copies && copies.length > 0 ? { copies } : {};

    topology.faces.forEach((face, i) => {
      const descriptor = description.faces[i];
      faces.push({
        ref: descriptor.ref,
        solid: index,
        ...(descriptor.role ? { role: descriptor.role } : {}),
        surface: face.surface,
        area: face.area,
        center: point(face.center),
        bounds: boundsTo(face.bounds, part.transform),
        axis: face.axis ? { origin: point(face.axis.origin), axis: vector(face.axis.axis) } : null,
        radii: [finite(face.radii[0]), finite(face.radii[1])],
        ...repeated,
      });
    });

    topology.edges.forEach((edge, i) => {
      const descriptor = description.edges[i];
      if (descriptor.hidden) return;
      const circle = circleOf(edge);
      edges.push({
        ref: descriptor.ref,
        solid: index,
        ...(descriptor.role ? { role: descriptor.role } : {}),
        curve: edge.curve,
        length: edge.length,
        closed: edge.closed,
        start: point(edge.start),
        middle: point(edge.middle),
        end: point(edge.end),
        center: circle ? point(circle.center) : null,
        radius: circle ? circle.radius : null,
        bounds: boundsTo(edge.bounds, part.transform),
        ...repeated,
      });
    });
  });

  return { faces, edges, errors };
}

const finite = (value: number): number | null => (Number.isFinite(value) ? value : null);

function boundsTo(bounds: Bounds, transform: PartTransform): Bounds {
  const a = toAssembly(bounds.min, transform);
  const b = toAssembly(bounds.max, transform);
  return {
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  };
}
