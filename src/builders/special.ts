// Parts of the run that are not surfaces of revolution: §4.12's noncircular vessels, and the
// stay plates that divide a vessel — noncircular or not — into chambers.
import {
  BuildError,
  Sym,
  assumedNote,
  notBuiltNote,
  note,
  optionalDimension,
  representedNote,
  requireDimension,
  scope,
  type ComponentDefinition,
  type Note,
} from '../definition.ts';
import type { GeometryKernel, Profile, ProfileStep, Solid } from '../kernel/GeometryKernel.ts';
import { mm } from './placing.ts';
import type { RunBuilder } from './types.ts';

const line = (x: number, y: number): ProfileStep => ({ kind: 'line', to: [x, y] });

const rectangle = (halfX: number, halfY: number): Profile => ({
  start: [-halfX, -halfY],
  steps: [line(halfX, -halfY), line(halfX, halfY), line(-halfX, halfY)],
});

/**
 * The stay plates across a section — `n_st` of them, `t_3` thick, square to the X axis and
 * evenly spaced over `±span`, each reaching `±reach` across. §4.12 Types 3, 11 and 12 read only
 * their thickness and their number; where they stand is the one arrangement those tables assume.
 */
function stayPlates(
  component: ComponentDefinition,
  kernel: GeometryKernel,
  span: number,
  reach: number,
  length: number
): { plates: Solid[]; note?: Note } {
  const thickness = optionalDimension(component, Sym.STAY_PLATE_THICKNESS);
  if (thickness === undefined) {
    // Stays as rods — a pitch and a diameter — are read by the rules and not drawn.
    const pitch = optionalDimension(component, Sym.STAY_PITCH);
    return pitch === undefined
      ? { plates: [] }
      : {
          plates: [],
          note: notBuiltNote(
            `Stays at a ${mm(pitch)} pitch are stated and not drawn`,
            Sym.STAY_PITCH,
            `stays at ${mm(pitch)}`,
            `${component.kind}: stay plates only`
          ),
        };
  }
  const planes = Math.max(1, Math.round(optionalDimension(component, Sym.STAY_PLANES) ?? 1));
  const plates = Array.from({ length: planes }, (_, k) => {
    const x = -span + ((k + 1) * 2 * span) / (planes + 1);
    return kernel.extrude(
      { start: [x - thickness / 2, -reach], steps: [line(x + thickness / 2, -reach), line(x + thickness / 2, reach), line(x - thickness / 2, reach)] },
      0,
      length
    );
  });
  // Where they stand is assumed: the tables read only how many and how thick.
  return {
    plates,
    note: note(
      `${planes} stay plate${planes > 1 ? 's' : ''} of ${mm(thickness)}, evenly spaced`,
      Sym.STAY_PLANES,
      scope('assumed', 'stay plate positions', 'stated', `not stated — ${planes} evenly spaced`)
    ),
  };
}

/** Reinforcing members on a pitch: read by §4.12, not built here. */
function stiffenersNotDrawn(component: ComponentDefinition, message: string): Note {
  return notBuiltNote(message, Sym.STIFFENER_PITCH, `members at ${mm(component.dimensions[Sym.STIFFENER_PITCH])}`, component.kind);
}

function lengthOf(component: ComponentDefinition, fallback: number, notes: Note[]): number {
  const stated = optionalDimension(component, Sym.COURSE_LENGTH);
  if (stated !== undefined) return stated;
  notes.push(assumedNote(`Length not stated — drawn ${mm(fallback)} long`, Sym.COURSE_LENGTH, mm(fallback)));
  return fallback;
}

/**
 * §4.12 Types 1 to 4 — a rectangular vessel: inside `h` by `H`, the short sides (of length `H`)
 * in plate `t_1`, the long sides (of length `h`) in plate `t_2`, open at both ends like a
 * course. Its stiffeners, when it has them, are not drawn; its stay plates are.
 */
export const rectangularVessel: RunBuilder = (component, context) => {
  const short = requireDimension(component, Sym.SHORT_SIDE);
  const long = requireDimension(component, Sym.LONG_SIDE);
  const shortPlate = requireDimension(component, Sym.SHORT_SIDE_THICKNESS);
  const longPlate = requireDimension(component, Sym.LONG_SIDE_THICKNESS);
  if (short > long) {
    throw new BuildError(
      component,
      `has a short side (${mm(short)}) longer than its long side (${mm(long)})`,
      scope('out_of_scope', Sym.SHORT_SIDE, `≤ ${mm(long)}, the long side`, mm(short))
    );
  }
  const notes: Note[] = [];
  const length = lengthOf(component, long, notes);
  if (component.dimensions[Sym.STIFFENER_PITCH] !== undefined) {
    notes.push(stiffenersNotDrawn(component, 'Its stiffeners are not drawn'));
  }

  const { kernel } = context;
  const outer = kernel.extrude(rectangle(long / 2 + shortPlate, short / 2 + longPlate), 0, length);
  const inner = kernel.extrude(rectangle(long / 2, short / 2), -1, length + 1);
  const { plates, note: plateNote } = stayPlates(component, kernel, long / 2, short / 2, length);
  if (plateNote) notes.push(plateNote);

  return {
    solid: kernel.cut(outer, [inner]),
    extraSolids: plates,
    height: length,
    lower: null,
    upper: null,
    landmarks: [],
    // Not a surface of revolution: nothing is measured along it.
    meridian: [],
    notes,
  };
};

/**
 * The outline of a convex polygon grown outwards by its own wall on each side: each edge pushed
 * out along its normal by its thickness, each corner where two pushed edges meet.
 */
function grown(vertices: readonly [number, number][], thicknesses: readonly number[]): [number, number][] {
  const n = vertices.length;
  const shifted = vertices.map((v, i) => {
    const w = vertices[(i + 1) % n];
    const dx = w[0] - v[0];
    const dy = w[1] - v[1];
    const length = Math.hypot(dx, dy);
    // Anticlockwise, the outside is to the right of travel.
    const normal: [number, number] = [dy / length, -dx / length];
    const d = thicknesses[i];
    return { point: [v[0] + d * normal[0], v[1] + d * normal[1]] as [number, number], direction: [dx, dy] as [number, number] };
  });
  return shifted.map((edge, i) => {
    const previous = shifted[(i - 1 + n) % n];
    // Where the previous pushed edge meets this one.
    const [px, py] = previous.point;
    const [pdx, pdy] = previous.direction;
    const [qx, qy] = edge.point;
    const [qdx, qdy] = edge.direction;
    const denominator = pdx * qdy - pdy * qdx;
    const s = ((qx - px) * qdy - (qy - py) * qdx) / denominator;
    return [px + s * pdx, py + s * pdy];
  });
}

/**
 * §4.12 Table 4.12.7 — a reinforced octagonal vessel: the rectangle of `2·L_3` by `2·L_4` its
 * inside is cut from, the short sides running `L_1 + L_11` either side of centre on the flats
 * at `±L_4`, the long sides `L_2 + L_21` on the flats at `±L_3`, and a chamfer joining them.
 * The short sides are in plate `t_1`, the long ones in `t_2`, the chamfers in the thicker of
 * the two; its reinforcing members are not drawn.
 */
export const octagonalVessel: RunBuilder = (component, context) => {
  const halfWidth = requireDimension(component, Sym.OCTAGON_HALF_WIDTH);
  const halfHeight = requireDimension(component, Sym.OCTAGON_HALF_HEIGHT);
  const shortPlate = requireDimension(component, Sym.SHORT_SIDE_THICKNESS);
  const longPlate = requireDimension(component, Sym.LONG_SIDE_THICKNESS);
  const shortHalf =
    requireDimension(component, Sym.SHORT_STIFFENER_HALF_LENGTH) + requireDimension(component, Sym.SHORT_BARE_HALF_LENGTH);
  const longHalf =
    requireDimension(component, Sym.LONG_STIFFENER_HALF_LENGTH) + requireDimension(component, Sym.LONG_BARE_HALF_LENGTH);
  if (shortHalf > halfWidth || longHalf > halfHeight) {
    throw new BuildError(
      component,
      'has sides longer than the rectangle it is cut from',
      scope('out_of_scope', 'side lengths', 'within the rectangle they are cut from', `${mm(2 * shortHalf)} by ${mm(2 * longHalf)}`)
    );
  }
  const notes: Note[] = [];
  const length = lengthOf(component, 2 * halfHeight, notes);
  notes.push(
    representedNote(
      'Its reinforcing members are not drawn, and its chamfers are drawn in the thicker plate',
      'reinforcing members and chamfers',
      'reinforced, chamfers in their own plate',
      `unreinforced, chamfers in ${mm(Math.max(shortPlate, longPlate))} plate`
    )
  );

  // Anticlockwise from the bottom short side; a chamfer of zero length is not an edge.
  const chamfer = Math.max(shortPlate, longPlate);
  const corners: { v: [number, number]; t: number }[] = [
    { v: [-shortHalf, -halfHeight], t: shortPlate },
    { v: [shortHalf, -halfHeight], t: chamfer },
    { v: [halfWidth, -longHalf], t: longPlate },
    { v: [halfWidth, longHalf], t: chamfer },
    { v: [shortHalf, halfHeight], t: shortPlate },
    { v: [-shortHalf, halfHeight], t: chamfer },
    { v: [-halfWidth, longHalf], t: longPlate },
    { v: [-halfWidth, -longHalf], t: chamfer },
  ];
  const edges = corners.filter((c, i) => {
    const next = corners[(i + 1) % corners.length].v;
    return Math.hypot(next[0] - c.v[0], next[1] - c.v[1]) > 1e-9;
  });
  const inside = edges.map((e) => e.v);
  const outside = grown(inside, edges.map((e) => e.t));
  const outline = (points: [number, number][]): Profile => ({
    start: points[0],
    steps: points.slice(1).map((p) => line(p[0], p[1])),
  });

  const { kernel } = context;
  return {
    solid: kernel.cut(kernel.extrude(outline(outside), 0, length), [kernel.extrude(outline(inside), -1, length + 1)]),
    height: length,
    lower: null,
    upper: null,
    landmarks: [],
    meridian: [],
    notes,
  };
};

/**
 * §4.12 Types 9 to 11 — an obround vessel: two semi-cylinders of inside radius `R` and wall
 * `t_1`, joined by two flat sides `2·L_2` long in plate `t_2`. Where the two walls differ, the
 * outside steps at the junction, as the plates do.
 */
export const obroundVessel: RunBuilder = (component, context) => {
  const radius = requireDimension(component, Sym.OBROUND_RADIUS);
  const half = requireDimension(component, Sym.OBROUND_FLAT_HALF_LENGTH);
  const curved = requireDimension(component, Sym.CURVED_THICKNESS);
  const flat = requireDimension(component, Sym.FLAT_THICKNESS);
  const notes: Note[] = [];
  const length = lengthOf(component, 2 * (radius + half), notes);
  if (component.dimensions[Sym.STIFFENER_PITCH] !== undefined) {
    notes.push(stiffenersNotDrawn(component, 'Its reinforcing members are not drawn'));
  }

  const { kernel } = context;
  const inner: Profile = {
    start: [-half, -radius],
    steps: [
      line(half, -radius),
      { kind: 'arc', to: [half, radius], through: [half + radius, 0] },
      line(-half, radius),
      { kind: 'arc', to: [-half, -radius], through: [-half - radius, 0] },
    ],
  };

  const ro = radius + curved;
  const yf = radius + flat;
  const step = Math.abs(yf - ro) > 1e-6;
  const outer: Profile = {
    start: [-half, -yf],
    steps: [
      line(half, -yf),
      ...(step ? [line(half, -ro)] : []),
      { kind: 'arc', to: [half, ro], through: [half + ro, 0] },
      ...(step ? [line(half, yf)] : []),
      line(-half, yf),
      ...(step ? [line(-half, ro)] : []),
      { kind: 'arc', to: [-half, -ro], through: [-half - ro, 0] },
    ],
  };

  const body = kernel.cut(kernel.extrude(outer, 0, length), [kernel.extrude(inner, -1, length + 1)]);
  const { plates, note: plateNote } = stayPlates(component, kernel, half, radius, length);
  if (plateNote) notes.push(plateNote);

  return {
    solid: body,
    extraSolids: plates,
    height: length,
    lower: null,
    upper: null,
    landmarks: [],
    // Not a surface of revolution: nothing is measured along it.
    meridian: [],
    notes,
  };
};

/**
 * §4.12 Type 12 — the stay plate that divides a circular course into two chambers, drawn
 * across its diameter. Only called for a cylinder that states one.
 */
export function dividingPlates(
  component: ComponentDefinition,
  kernel: GeometryKernel,
  insideRadius: number,
  length: number
): { plates: Solid[]; note?: Note } {
  return stayPlates(component, kernel, 0, insideRadius, length);
}
