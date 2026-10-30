// Names the faces and edges of a built part as topological entities with a meaning — "Circular
// edge, Ø5000 mm, tangent line, head-to-shell junction with Top head" — rather than as the
// indices a rebuild renumbers.
//
// Every name is derived from the parameters, by a geometric predicate: an edge is the tangent
// line because it is the circle, on the axis, at the height and diameter the builder says the
// tangent line is at. A predicate that should match and does not, or that matches an edge
// another one already claimed, is an error reported to the user — never resolved by taking the
// first candidate.
import type { BuiltPart, Opening } from '../assembly/buildAssembly.ts';
import type { EdgeInfo, FaceInfo, Tessellation, Vec3 } from '../kernel/GeometryKernel.ts';

export interface EntityDimension {
  readonly label: string;
  /** Millimetres. */
  readonly value: number;
}

export interface EntityDescriptor {
  /**
   * A semantic reference, stable across rebuilds with the same parameters:
   * `<componentId>/landmark/lower-inside`, `<hostId>/opening/<nozzleId>/outside`.
   */
  readonly ref: string;
  readonly componentId: string;
  readonly entity: 'edge' | 'face';
  /** What the entity is geometrically: `Circular edge`, `Toroidal face`. */
  readonly title: string;
  readonly dimension?: EntityDimension;
  /** What the entity is in the vessel: `Crown-to-knuckle tangent line (inside)`. */
  readonly role?: string;
  /** A seam of a surface of revolution: a topological artefact, not drawn, not pickable. */
  readonly hidden?: boolean;
}

export interface PartDescription {
  readonly faces: readonly EntityDescriptor[];
  readonly edges: readonly EntityDescriptor[];
  /** Anchors that did not resolve to exactly one set of edges. */
  readonly errors: readonly string[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): number => Math.sqrt(dot(a, a));
const round = (value: number): number => Math.round(value * 10) / 10;

/** Distance from `point` to the line through `origin` along the unit vector `axis`. */
function distanceToAxis(point: Vec3, origin: Vec3, axis: Vec3): number {
  const v = sub(point, origin);
  const along = dot(v, axis);
  return Math.sqrt(Math.max(0, dot(v, v) - along * along));
}

/** The circle through three points, or null when they are aligned. */
function circleThrough(a: Vec3, b: Vec3, c: Vec3): { center: Vec3; radius: number } | null {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const n = cross(ab, ac);
  const n2 = dot(n, n);
  if (n2 < 1e-12) return null;
  const term1 = cross(n, ab).map((x) => x * dot(ac, ac)) as unknown as Vec3;
  const term2 = cross(ac, n).map((x) => x * dot(ab, ab)) as unknown as Vec3;
  const offset: Vec3 = [
    (term1[0] + term2[0]) / (2 * n2),
    (term1[1] + term2[1]) / (2 * n2),
    (term1[2] + term2[2]) / (2 * n2),
  ];
  return { center: [a[0] + offset[0], a[1] + offset[1], a[2] + offset[2]], radius: norm(offset) };
}

/** Centre and radius of a circular edge, closed or not. */
export function circleOf(edge: EdgeInfo): { center: Vec3; radius: number } | null {
  if (edge.curve !== 'circle') return null;
  if (edge.closed) {
    // On a closed circle the middle parameter is diametrically opposite the start.
    const center: Vec3 = [
      (edge.start[0] + edge.middle[0]) / 2,
      (edge.start[1] + edge.middle[1]) / 2,
      (edge.start[2] + edge.middle[2]) / 2,
    ];
    return { center, radius: edge.length / (2 * Math.PI) };
  }
  return circleThrough(edge.start, edge.middle, edge.end);
}

const EDGE_TITLES: Record<EdgeInfo['curve'], string> = {
  line: 'Straight edge',
  circle: 'Circular edge',
  ellipse: 'Elliptical edge',
  bspline: 'Curved edge',
  other: 'Edge',
};

const FACE_TITLES: Record<FaceInfo['surface'], string> = {
  plane: 'Planar face',
  cylinder: 'Cylindrical face',
  cone: 'Conical face',
  sphere: 'Spherical face',
  torus: 'Toroidal face',
  revolution: 'Surface of revolution',
  other: 'Face',
};

/**
 * Describes one tessellated solid of a part.
 *
 * @param epsilon absolute tolerance of the predicates, in millimetres — relative to the model
 */
export function describePart(
  part: BuiltPart,
  tessellation: Pick<Tessellation, 'faces' | 'edges'>,
  solidIndex: number,
  epsilon: number
): PartDescription {
  const errors: string[] = [];
  const hiddenIds = new Set(
    tessellation.edges
      .filter((edge) => new Set(edge.faceIds).size < 2)
      .map((edge) => edge.id)
  );

  // ------------------------------------------------ openings: exactly one claim per edge
  const openingOf = new Map<number, { opening: Opening; side: 'outside' | 'inside' }>();
  const claimed = new Map<string, number>();
  for (const opening of part.openings) {
    claimed.set(`${opening.componentId}/outside`, 0);
    claimed.set(`${opening.componentId}/inside`, 0);
  }
  for (const edge of tessellation.edges) {
    if (hiddenIds.has(edge.id)) continue;
    const matches = part.openings.filter((opening) =>
      [edge.start, edge.middle, edge.end].every(
        (point) => Math.abs(distanceToAxis(point, opening.frame.origin, opening.frame.axis) - opening.radius) < epsilon
      )
    );
    if (matches.length > 1) {
      errors.push(
        `An edge of ${part.name} lies on the openings of ${matches.map((m) => m.name).join(' and ')} at once`
      );
      continue;
    }
    if (matches.length === 1) {
      const opening = matches[0];
      // Asked of the host, not measured along the nozzle: an oblique neck cuts each surface on
      // a curve that spans more depth than the wall is thick.
      const side = opening.sideOf(edge.middle);
      openingOf.set(edge.id, { opening, side });
      const key = `${opening.componentId}/${side}`;
      claimed.set(key, (claimed.get(key) ?? 0) + 1);
    }
  }
  if (solidIndex === 0) {
    for (const opening of part.openings) {
      for (const side of ['outside', 'inside'] as const) {
        if (claimed.get(`${opening.componentId}/${side}`) === 0) {
          errors.push(`The ${side} opening edge of ${opening.name} on ${part.name} could not be resolved`);
        }
      }
    }
  }

  // ------------------------------------------------ edges
  const edges = tessellation.edges.map((edge): EntityDescriptor => {
    const title = EDGE_TITLES[edge.curve];
    const circle = circleOf(edge);
    const dimension: EntityDimension | undefined = circle
      ? { label: 'Diameter', value: 2 * circle.radius }
      : { label: 'Length', value: edge.length };

    if (hiddenIds.has(edge.id)) {
      return { ref: `${part.componentId}/seam/${edge.id}`, componentId: part.componentId, entity: 'edge', title, hidden: true };
    }

    const opening = openingOf.get(edge.id);
    if (opening) {
      return {
        ref: `${part.componentId}/opening/${opening.opening.componentId}/${opening.side}`,
        componentId: part.componentId,
        entity: 'edge',
        title,
        dimension: { label: 'Opening diameter', value: 2 * opening.opening.radius },
        role: `Opening edge of ${opening.opening.name} on ${part.name} (${opening.side} surface)`,
      };
    }

    if (circle && Math.hypot(circle.center[0], circle.center[1]) < epsilon) {
      const landmark = part.landmarks.find(
        (l) => Math.abs(l.z - circle.center[2]) < epsilon && Math.abs(l.diameter - 2 * circle.radius) < epsilon
      );
      if (landmark) {
        return {
          ref: `${part.componentId}/landmark/${landmark.key}`,
          componentId: part.componentId,
          entity: 'edge',
          title,
          dimension,
          role: landmark.role,
        };
      }
    }

    if (part.mount) {
      const along = dot(sub(edge.middle, part.mount.origin), part.mount.axis);
      const onAxis = circle && distanceToAxis(circle.center, part.mount.origin, part.mount.axis) < epsilon;

      // A neck's ends: where it stands out, where it meets the host, where it projects inwards.
      if (part.neck && solidIndex === 0) {
        const r = distanceToAxis(edge.middle, part.mount.origin, part.mount.axis);
        const side =
          Math.abs(r - part.neck.insideRadius) < epsilon
            ? 'inside'
            : Math.abs(r - part.neck.outsideRadius) < epsilon
              ? 'outside'
              : null;
        if (side) {
          const end = along > epsilon ? 'outer-end' : part.neck.inward > 0 ? 'inner-end' : 'host-end';
          const words = { 'outer-end': 'outer end', 'inner-end': 'inner end', 'host-end': 'where it meets the host' };
          return {
            ref: `${part.componentId}/neck/${end}/${side}`,
            componentId: part.componentId,
            entity: 'edge',
            title,
            dimension,
            role: `${part.name}, ${words[end]} (${side})`,
          };
        }
      }

      return {
        ref: `${part.componentId}/edge/${edge.curve}/${round(along)}/${round(circle?.radius ?? edge.length)}`,
        componentId: part.componentId,
        entity: 'edge',
        title,
        dimension,
        role: onAxis ? (along > 0 ? `${part.name}, outer end` : `${part.name}, inner end`) : `${part.name}, neck-to-wall intersection`,
      };
    }

    return {
      ref: `${part.componentId}/edge/${edge.curve}/${edge.middle.map(round).join(',')}`,
      componentId: part.componentId,
      entity: 'edge',
      title,
      dimension,
    };
  });

  // ------------------------------------------------ faces
  const faces = tessellation.faces.map((face): EntityDescriptor => {
    const title = FACE_TITLES[face.surface];
    const finite = face.radii.filter(Number.isFinite);
    const smallest = finite.length > 0 ? Math.min(...finite) : undefined;
    const largest = finite.length > 0 ? Math.max(...finite) : undefined;
    let dimension: EntityDimension | undefined;
    let role: string | undefined;

    if (face.surface === 'cylinder' && smallest !== undefined) {
      dimension = { label: 'Diameter', value: 2 * smallest };
      const opening = part.openings.find(
        (o) => Math.abs(o.radius - smallest) < epsilon && Math.abs(distanceToAxis(face.center, o.frame.origin, o.frame.axis) - o.radius) < epsilon
      );
      if (opening) {
        role = `Opening wall of ${opening.name}`;
      } else {
        const landmark = part.landmarks.find((l) => Math.abs(l.diameter - 2 * smallest) < epsilon);
        if (landmark) role = landmark.key.endsWith('outside') ? 'Outside surface' : 'Inside surface';
      }
    } else if (face.surface === 'sphere' && smallest !== undefined) {
      dimension = { label: 'Radius', value: smallest };
      role = part.kind === 'spherical_shell' ? 'Shell' : 'Crown';
    } else if (face.surface === 'torus' && smallest !== undefined) {
      dimension = { label: 'Knuckle radius', value: smallest };
      role = 'Knuckle';
    } else if (face.surface === 'revolution' && largest !== undefined) {
      role = part.kind === 'ellipsoidal_head' ? 'Ellipsoidal dish' : undefined;
    }

    return {
      ref: `${part.componentId}/face/${solidIndex}/${face.surface}/${face.center.map(round).join(',')}`,
      componentId: part.componentId,
      entity: 'face',
      title,
      dimension,
      role,
    };
  });

  return { faces, edges, errors };
}
