// Layer 1: the axial run as a circular section at every station.
//
// Every part of the run is a surface of revolution today, so the run is fully described by one
// meridian. That is a property of today's catalogue, not of the representation: an eccentric
// reducer still has a CIRCULAR section at every axial station — only its centre moves, and its
// radius with it. So layer 1 is stated as centre(s) and radius(s) along the run, with the centre
// on the axis everywhere it is today, and every rule that reads it says whether it assumes that.
// A rule that does refuses the day a centre leaves the axis, rather than answering for a vessel
// it was never written for. Non-circular sections (an obround vessel) are not this layer.
import type { AssemblyDefinition } from '../definition.ts';
import { runOrder, type AssemblyModel } from '../assembly/buildAssembly.ts';
import type { Point2 } from '../kernel/GeometryKernel.ts';

/** One station of the run: a circle square to the vessel axis. */
export interface SectionStation {
  readonly componentId: string;
  /** Along the run's mid-surface meridian, from the bottom of the run, mm. */
  readonly s: number;
  /** Along the vessel axis, in the assembly's frame, mm. */
  readonly z: number;
  /** The circle's centre, in the plane square to the axis. On the axis, [0, 0], for every part drawn today. */
  readonly centre: readonly [number, number];
  /** The mid-surface's radius about that centre. */
  readonly radius: number;
}

/** Whether a rule assumes the run is axisymmetric, and what it would need if it were not. */
export interface AxisymmetryDeclaration {
  /** As the rule is named where it lives: `layer 1`, `zones: √(R·t)`, `R3e`, `SCL set`. */
  readonly rule: string;
  /** Where it lives: this package, or the mesher. */
  readonly owner: 'femo-geometry' | 'meshing';
  readonly assumesAxisymmetry: boolean;
  readonly why: string;
  /** What the rule must become for a centre that leaves the axis. */
  readonly whenBroken: string;
}

export interface RunSection {
  readonly representation: 'circular_section';
  readonly stations: readonly SectionStation[];
  /** Every centre on the axis: the run is a body of revolution and one meridian describes it. */
  readonly axisymmetric: boolean;
  /** This package's rules that read layer 1; the mesher declares its own beside its rules. */
  readonly assumptions: readonly AxisymmetryDeclaration[];
}

/** A centre this far from the axis, relative to the radius, is off it. */
const OFF_AXIS = 1e-9;

export const KERNEL_AXISYMMETRY: readonly AxisymmetryDeclaration[] = [
  {
    rule: 'layer 1',
    owner: 'femo-geometry',
    assumesAxisymmetry: false,
    why: 'a builder whose circles leave the axis states their centres beside its meridian (the eccentric cone, lofted rather than revolved); every other one revolves, and its centres are [0, 0]',
    whenBroken: 'nothing: a centre off the axis is a station like any other, and `axisymmetric` turns false for the rules below that need it',
  },
  {
    rule: 'layer 1: s',
    owner: 'femo-geometry',
    assumesAxisymmetry: true,
    why: 's is the arc length of the circles\' own meridian (radius against z); on a body of revolution every generatrix IS that curve',
    whenBroken: 'off the axis each generatrix has its own length — on an eccentric cone h on the flat side and h/cos α on the steep side — so a distance along the surface belongs to a station AND an azimuth, and s is no generatrix\'s length',
  },
  {
    rule: 'the run, stacked',
    owner: 'femo-geometry',
    assumesAxisymmetry: true,
    why: 'a part of the run is placed by a height and a turn-over alone (`PartTransform`): its lower end is centred on the axis',
    whenBroken: 'a part above an eccentric cone has to move sideways by the cone\'s shift; until the transform carries that, its joint to the cone is refused as a mismatch of centres',
  },
  {
    rule: 'zones: √(R·t)',
    owner: 'femo-geometry',
    assumesAxisymmetry: true,
    why: 'R is the mid-surface circumferential radius read at one point of the circle; on a circle centred on the axis it is the same all round',
    whenBroken: 'R becomes a function of azimuth, so √(R·t) and every distance judged against it are read per azimuth: one figure per θ, not per station',
  },
];

/** The run, station by station, from its bottom: every drawn part's mid-surface meridian. */
export function runSection(definition: AssemblyDefinition, model: AssemblyModel): RunSection {
  const parts = new Map(model.parts.map((p) => [p.componentId, p]));
  const stations: SectionStation[] = [];
  let cursor = 0;
  for (const component of runOrder(definition.components)) {
    const part = parts.get(component.id);
    if (!part || part.status !== 'drawn' || !part.meridian || part.meridian.length < 2) continue;
    // A part turned over runs its meridian downwards: read from its lower end in the assembly.
    // Turning over is a half turn about X, so a centre's y changes sign with it.
    const flipped = part.transform.flipped;
    const order = (list: readonly Point2[]): Point2[] => (flipped ? [...list].reverse() : [...list]);
    const points = order(part.meridian);
    const centres = part.centres ? order(part.centres) : undefined;
    let previous: Point2 | undefined;
    points.forEach(([r, zLocal], i) => {
      if (previous) cursor += Math.hypot(r - previous[0], zLocal - previous[1]);
      previous = [r, zLocal];
      const [cx, cy] = centres?.[i] ?? [0, 0];
      stations.push({
        componentId: component.id,
        s: cursor,
        z: flipped ? part.transform.dz - zLocal : part.transform.dz + zLocal,
        centre: [cx, flipped ? -cy : cy],
        radius: r,
      });
    });
  }
  const axisymmetric = stations.every((st) => Math.hypot(st.centre[0], st.centre[1]) <= OFF_AXIS * Math.max(1, st.radius));
  return { representation: 'circular_section', stations, axisymmetric, assumptions: KERNEL_AXISYMMETRY };
}

/** The section at a distance along the run: centre and radius, interpolated between stations. */
export function sectionAt(section: RunSection, s: number): { centre: readonly [number, number]; radius: number } | null {
  const st = section.stations;
  if (st.length === 0 || s < st[0].s || s > st[st.length - 1].s) return null;
  for (let i = 1; i < st.length; i++) {
    if (s <= st[i].s) {
      const span = st[i].s - st[i - 1].s;
      const f = span > 0 ? (s - st[i - 1].s) / span : 0;
      return {
        centre: [
          st[i - 1].centre[0] + f * (st[i].centre[0] - st[i - 1].centre[0]),
          st[i - 1].centre[1] + f * (st[i].centre[1] - st[i - 1].centre[1]),
        ],
        radius: st[i - 1].radius + f * (st[i].radius - st[i - 1].radius),
      };
    }
  }
  return { centre: st[st.length - 1].centre, radius: st[st.length - 1].radius };
}
