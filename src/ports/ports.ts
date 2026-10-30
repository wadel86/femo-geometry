// Ports and joints: where the parts of an assembly meet, derived from what already says it.
//
// Nobody authors a port. The run's order and each part's host are the only statements of which
// part is where; a port is what a builder already knows about the end of its wall or the patch
// it is welded to, put in the assembly's frame and given a stable key. A joint exists because
// two ports face each other — neighbours in the run, or a part and its host — so the same
// assembly always yields the same joints, under the same ids.
//
// Everything is in millimetres, in the assembly's frame, Z being the vessel axis.
import {
  Sym,
  type AssemblyDefinition,
  type ComponentDefinition,
} from '../definition.ts';
import {
  runOrder,
  toAssembly,
  toAssemblyVector,
  type AssemblyModel,
  type BuiltPart,
} from '../assembly/buildAssembly.ts';
import type { Junction, WallAt, WallSurface } from '../builders/types.ts';
import { cylinderSurface } from '../builders/walls.ts';
import type { Vec3 } from '../kernel/GeometryKernel.ts';

/**
 * - `axial_edge` — the end of a wall of the run, welded to its neighbour.
 * - `flange_face` — a bolted or gasketed face of the run.
 * - `opening` — the hole a nozzle cuts in its host, on the host.
 * - `shell_wall` — the patch of a host a part is welded to without opening it.
 * - `neck_end` — an end of a nozzle's neck: where it meets its host, where it stands out.
 * - `support_face` — the side of a ring, support, jacket or pad that bears on its host.
 */
export type PortKind = 'axial_edge' | 'flange_face' | 'opening' | 'shell_wall' | 'neck_end' | 'support_face';

export interface Port {
  /** `<key>@<componentId>`. */
  readonly id: string;
  readonly componentId: string;
  /** Stable within the part: `lower`, `upper`, `opening:<nozzleId>`, `neck:outer-end`, `wall:<partId>`. */
  readonly key: string;
  readonly kind: PortKind;
  /** The centre of the circle, or of the patch. */
  readonly location: Vec3;
  /** Unit, pointing out of the part: two ports that meet have opposite axes. */
  readonly axis: Vec3;
  /**
   * Unit tangent of the wall's meridian. At an edge or a face it points away from the part, and
   * a port all round the axis gives it in the half-plane of azimuth 0. On a host's wall it
   * points towards increasing offset.
   */
  readonly meridian: Vec3;
  /** The wall's mid-surface — the host's, for an opening or a patch of wall. */
  readonly surface: WallSurface;
  /** Normal to the wall; the host's, for an opening or a patch of wall; across a face. */
  readonly thickness: number;
  /** Of the wall at the port; of the neck, for an opening and a neck end. */
  readonly meanRadius?: number;
  readonly insideRadius?: number;
  /** For an opening, the radius of the hole. */
  readonly outsideRadius?: number;
  /** For a patch of wall and what bears on it: along the host's offset, and round it. */
  readonly extent?: { readonly axial: number; readonly circumferentialDeg: number };
  /** The references `describePart` gives the B-Rep edges of the port, when it has any. */
  readonly semanticRefs: readonly string[];
}

/**
 * - `butt_weld` — two parts of the run, end to end.
 * - `set_in_nozzle` — a neck through its host's wall.
 * - `fillet_attachment` — a ring, support, jacket or pad on a wall.
 * - `bolted` — two faces of the run.
 * - `clamped`, `tube_to_tubesheet` — reserved for the parts that make them.
 */
export type JointKind = 'butt_weld' | 'set_in_nozzle' | 'fillet_attachment' | 'bolted' | 'clamped' | 'tube_to_tubesheet';

export interface Joint {
  /** `<componentA>:<portA>~<componentB>:<portB>` — the lower part first in the run, the host first otherwise. */
  readonly id: string;
  readonly kind: JointKind;
  /** Port ids, in the order of the joint's id. */
  readonly ports: readonly [string, string];
  /** Why the joint exists. */
  readonly sourceRule: 'run adjacency' | 'host';
  /**
   * The weld, as the component states it, keyed on `CodeSymbol` wire values. Absent when
   * nothing is stated: the kernel invents no weld.
   */
  readonly weld?: Readonly<Record<string, number>>;
  /** Where the two ports do not agree: a step in the mean radius, in the thickness. */
  readonly issues: readonly string[];
}

export interface PortsAndJoints {
  readonly ports: readonly Port[];
  readonly joints: readonly Joint[];
}

const DEG = Math.PI / 180;

const negate = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
const along = (origin: Vec3, axis: Vec3, distance: number): Vec3 => [
  origin[0] + distance * axis[0],
  origin[1] + distance * axis[1],
  origin[2] + distance * axis[2],
];
const mm = (value: number): string => `${Number(value.toPrecision(5))} mm`;

/** Derives every port and joint of a built assembly. */
export function derivePorts(definition: AssemblyDefinition, model: AssemblyModel): PortsAndJoints {
  const parts = new Map(model.parts.map((p) => [p.componentId, p]));
  const components = new Map(definition.components.map((c) => [c.id, c]));
  const ports: Port[] = [];
  const joints: Joint[] = [];

  // ---------------------------------------------------------------- the run, end to end
  const run = runOrder(definition.components).map((c) => parts.get(c.id));
  const runPorts = new Map<string, Port[]>();
  for (const part of run) {
    if (!part || part.status !== 'drawn' || !part.junctions) continue;
    const own: Port[] = [];
    for (const side of ['lower', 'upper'] as const) {
      const junction = part.junctions[side];
      if (junction) own.push(junctionPort(part, side, junction));
    }
    runPorts.set(part.componentId, own);
    ports.push(...own);
  }

  for (let i = 0; i + 1 < run.length; i++) {
    const below = run[i];
    const above = run[i + 1];
    if (!below || !above) continue;
    const up = runPorts.get(below.componentId)?.find((p) => p.axis[2] > 0.5);
    const down = runPorts.get(above.componentId)?.find((p) => p.axis[2] < -0.5);
    if (!up || !down || Math.abs(up.location[2] - down.location[2]) > 1e-6) continue;
    joints.push({
      id: jointId(up, down),
      kind: up.kind === 'flange_face' && down.kind === 'flange_face' ? 'bolted' : 'butt_weld',
      ports: [up.id, down.id],
      sourceRule: 'run adjacency',
      issues: mismatches(up, down),
    });
  }

  // ---------------------------------------------------------------- what is mounted, on its host
  for (const part of model.parts) {
    if (part.status !== 'drawn' || !part.hostId || !part.mount || !part.localPlacement) continue;
    const host = parts.get(part.hostId);
    const component = components.get(part.componentId);
    if (!host?.hostSurface || !component) continue;

    const local = part.localPlacement;
    const wall = host.hostSurface.wallAt(local.axialOffset);
    const world = (point: Vec3) => toAssembly(point, part.transform);
    const direction = (vector: Vec3) => toAssemblyVector(vector, part.transform);
    const phi = local.azimuth * DEG;
    const meridian = direction([wall.meridian[0] * Math.cos(phi), wall.meridian[0] * Math.sin(phi), wall.meridian[1]]);
    const origin = part.mount.origin;
    const axis = part.mount.axis;
    const onHost = { surface: wall.surface, thickness: wall.thickness, meridian };

    if (part.neck) {
      const neck = part.neck;
      const mean = (neck.insideRadius + neck.outsideRadius) / 2;
      const radii = { meanRadius: mean, insideRadius: neck.insideRadius, outsideRadius: neck.outsideRadius };
      const neckWall = { surface: cylinderSurface(mean), thickness: neck.outsideRadius - neck.insideRadius };
      const refs = (end: string) => [`${part.componentId}/neck/${end}/inside`, `${part.componentId}/neck/${end}/outside`];

      const opening = port(host.componentId, `opening:${part.componentId}`, 'opening', {
        location: world(origin),
        axis: direction(axis),
        ...onHost,
        ...radii,
        semanticRefs: [
          `${host.componentId}/opening/${part.componentId}/outside`,
          `${host.componentId}/opening/${part.componentId}/inside`,
        ],
      });
      const hostEnd = port(part.componentId, 'neck:host-end', 'neck_end', {
        location: world(origin),
        axis: direction(negate(axis)),
        meridian: direction(negate(axis)),
        ...neckWall,
        ...radii,
        semanticRefs: neck.inward > 0 ? [] : refs('host-end'),
      });
      const outerEnd = port(part.componentId, 'neck:outer-end', 'neck_end', {
        location: world(along(origin, axis, neck.outward)),
        axis: direction(axis),
        meridian: direction(axis),
        ...neckWall,
        ...radii,
        semanticRefs: refs('outer-end'),
      });
      ports.push(opening, hostEnd, outerEnd);
      if (neck.inward > 0) {
        ports.push(
          port(part.componentId, 'neck:inner-end', 'neck_end', {
            location: world(along(origin, axis, -(part.mount.wall + neck.inward))),
            axis: direction(negate(axis)),
            meridian: direction(negate(axis)),
            ...neckWall,
            ...radii,
            semanticRefs: refs('inner-end'),
          })
        );
      }
      joints.push({
        id: jointId(opening, hostEnd),
        kind: 'set_in_nozzle',
        ports: [opening.id, hostEnd.id],
        sourceRule: 'host',
        ...weldOf(component, [Sym.OUTER_FILLET_WELD_LEG, Sym.INNER_FILLET_WELD_LEG]),
        issues: [],
      });

      if (neck.pad) {
        const extent = patch(2 * neck.pad.reach, 2 * neck.pad.reach, host, local.axialOffset);
        const patchOnHost = port(host.componentId, `pad:${part.componentId}`, 'shell_wall', {
          location: world(origin),
          axis: direction(axis),
          ...onHost,
          extent,
          semanticRefs: [],
        });
        const pad = port(part.componentId, 'pad', 'support_face', {
          location: world(origin),
          axis: direction(negate(axis)),
          ...onHost,
          thickness: neck.pad.thickness,
          extent,
          semanticRefs: [],
        });
        ports.push(patchOnHost, pad);
        joints.push({
          id: jointId(patchOnHost, pad),
          kind: 'fillet_attachment',
          ports: [patchOnHost.id, pad.id],
          sourceRule: 'host',
          ...weldOf(component, [Sym.PAD_FILLET_WELD_LEG]),
          issues: [],
        });
      }
      continue;
    }

    if (part.attachment) {
      const extent = { axial: part.attachment.axial, circumferentialDeg: part.attachment.circumferentialDeg };
      const patchOnHost = port(host.componentId, `wall:${part.componentId}`, 'shell_wall', {
        location: world(origin),
        axis: direction(axis),
        ...onHost,
        extent,
        semanticRefs: [],
      });
      const bearing = port(part.componentId, 'attach', 'support_face', {
        location: world(origin),
        axis: direction(negate(axis)),
        ...onHost,
        thickness: part.attachment.thickness,
        extent,
        semanticRefs: [],
      });
      ports.push(patchOnHost, bearing);
      joints.push({
        id: jointId(patchOnHost, bearing),
        kind: 'fillet_attachment',
        ports: [patchOnHost.id, bearing.id],
        sourceRule: 'host',
        issues: [],
      });
    }
  }

  return { ports, joints };
}

type PortBody = Omit<Port, 'id' | 'componentId' | 'key' | 'kind'>;

function port(componentId: string, key: string, kind: PortKind, body: PortBody): Port {
  return { id: `${key}@${componentId}`, componentId, key, kind, ...body };
}

function jointId(a: Port, b: Port): string {
  return `${a.componentId}:${a.key}~${b.componentId}:${b.key}`;
}

/** A run part's end, in the assembly's frame. */
function junctionPort(part: BuiltPart, side: 'lower' | 'upper', junction: Junction): Port {
  const landmarks = part.landmarks.filter((l) => l.junction === side);
  const z = landmarks[0]?.z ?? 0;
  const wall: WallAt = junction.wall;
  return port(part.componentId, side, junction.face ? 'flange_face' : 'axial_edge', {
    location: toAssembly([0, 0, z], part.transform),
    axis: toAssemblyVector([0, 0, side === 'lower' ? -1 : 1], part.transform),
    meridian: toAssemblyVector([wall.meridian[0], 0, wall.meridian[1]], part.transform),
    surface: wall.surface,
    thickness: wall.thickness,
    meanRadius: (junction.insideDiameter + junction.outsideDiameter) / 4,
    insideRadius: junction.insideDiameter / 2,
    outsideRadius: junction.outsideDiameter / 2,
    semanticRefs: landmarks.map((l) => `${part.componentId}/landmark/${l.key}`),
  });
}

/**
 * What two ends of the run that meet do not agree on. A step in mean radius is a misfit; a step
 * in thickness between two walls is a taper someone has to draw. A plate meeting a wall has a
 * thickness of its own and no step.
 */
function mismatches(a: Port, b: Port): string[] {
  const issues: string[] = [];
  const ra = a.meanRadius ?? 0;
  const rb = b.meanRadius ?? 0;
  if (Math.abs(ra - rb) > Math.max(1e-3 * Math.max(ra, rb), 1e-6)) {
    issues.push(`Mean radii differ: ${mm(ra)} against ${mm(rb)}`);
  }
  const walls = a.kind === 'axial_edge' && b.kind === 'axial_edge' && a.surface.kind !== 'plane' && b.surface.kind !== 'plane';
  if (walls && Math.abs(a.thickness - b.thickness) > 1e-6) {
    issues.push(`Thickness steps from ${mm(a.thickness)} to ${mm(b.thickness)} — a taper is not drawn`);
  }
  return issues;
}

/** The patch a pad covers: its width along the offset, and the angle it subtends round a course. */
function patch(axial: number, width: number, host: BuiltPart, offset: number) {
  const radius = host.hostSurface?.course?.outsideRadiusAt(offset);
  return {
    axial,
    circumferentialDeg: radius ? Math.min(360, (width / radius) * (180 / Math.PI)) : 0,
  };
}

function weldOf(component: ComponentDefinition, symbols: readonly string[]): { weld?: Record<string, number> } {
  const stated = symbols.filter((s) => Number.isFinite(component.dimensions[s]) && component.dimensions[s] > 0);
  return stated.length > 0 ? { weld: Object.fromEntries(stated.map((s) => [s, component.dimensions[s]])) } : {};
}
