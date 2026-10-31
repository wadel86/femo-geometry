// Walls that fold: §4.19's bellows and §4.18.12's flanged-and-flued expansion joint.
//
// Each is a wall of constant thickness laid along a centreline of straight runs and circular
// arcs, every one tangent to the next. So the centreline is described once, in the meridian
// half-plane, and the wall is its two offsets by half the thickness — exact for a line and for
// an arc, whose offset is the concentric arc — joined across at the ends and revolved. The
// plies of a bellows are drawn as one wall of their combined thickness.
import {
  BuildError,
  Kind,
  Sym,
  analysisNote,
  note,
  optionalDimension,
  requireDimension,
  type ComponentDefinition,
  type Note,
} from '../definition.ts';
import type { Point2, ProfileStep, Solid, Vec3 } from '../kernel/GeometryKernel.ts';
import { mm } from './placing.ts';
import type { Idealisation, RunBuilder, RunContext, RunPart } from './types.ts';
import { cylinderSurface } from './walls.ts';

/** A piece of centreline: a straight run, or an arc swept from one angle to another about a centre. */
type Segment =
  | { readonly kind: 'line'; readonly from: Point2; readonly to: Point2 }
  | { readonly kind: 'arc'; readonly centre: Point2; readonly radius: number; readonly from: number; readonly to: number };

/** A centreline drawn like a pen: each piece starts where the last one ended. */
class Centreline {
  readonly segments: Segment[] = [];
  private at: Point2;

  constructor(start: Point2) {
    this.at = start;
  }

  get point(): Point2 {
    return this.at;
  }

  lineTo(to: Point2): this {
    if (Math.hypot(to[0] - this.at[0], to[1] - this.at[1]) > 1e-9) {
      this.segments.push({ kind: 'line', from: this.at, to });
      this.at = to;
    }
    return this;
  }

  /** An arc about `centre` from the current point, through `sweep` radians (positive anticlockwise). */
  arc(centre: Point2, sweep: number): this {
    const radius = Math.hypot(this.at[0] - centre[0], this.at[1] - centre[1]);
    const from = Math.atan2(this.at[1] - centre[1], this.at[0] - centre[0]);
    const to = from + sweep;
    this.segments.push({ kind: 'arc', centre, radius, from, to });
    this.at = [centre[0] + radius * Math.cos(to), centre[1] + radius * Math.sin(to)];
    return this;
  }
}

/** A piece of one offset: where it starts and ends, and a point between for an arc. */
interface OffsetPiece {
  readonly start: Point2;
  readonly end: Point2;
  readonly through?: Point2;
}

/**
 * A segment offset by `d` to the right of its direction of travel — for a centreline that rises
 * along the axis, the right is outwards.
 */
function offset(segment: Segment, d: number): OffsetPiece {
  if (segment.kind === 'line') {
    const dr = segment.to[0] - segment.from[0];
    const dz = segment.to[1] - segment.from[1];
    const length = Math.hypot(dr, dz);
    const n: Point2 = [dz / length, -dr / length];
    return {
      start: [segment.from[0] + d * n[0], segment.from[1] + d * n[1]],
      end: [segment.to[0] + d * n[0], segment.to[1] + d * n[1]],
    };
  }
  // Swept anticlockwise, the right is away from the centre; clockwise, towards it.
  const sense = segment.to > segment.from ? 1 : -1;
  const radius = segment.radius + sense * d;
  if (radius <= 0) throw new Error(`a fold of radius ${mm(segment.radius)} cannot carry a wall ${mm(2 * Math.abs(d))} thick`);
  const at = (angle: number): Point2 => [
    segment.centre[0] + radius * Math.cos(angle),
    segment.centre[1] + radius * Math.sin(angle),
  ];
  return { start: at(segment.from), end: at(segment.to), through: at((segment.from + segment.to) / 2) };
}

/** The closed outline of a wall `thickness` thick along a centreline. */
function wallProfile(segments: readonly Segment[], thickness: number): { start: Point2; steps: ProfileStep[] } {
  const outside = segments.map((s) => offset(s, thickness / 2));
  const inside = segments.map((s) => offset(s, -thickness / 2));
  const steps: ProfileStep[] = [];
  for (const piece of outside) {
    steps.push(piece.through ? { kind: 'arc', to: piece.end, through: piece.through } : { kind: 'line', to: piece.end });
  }
  steps.push({ kind: 'line', to: inside[inside.length - 1].end });
  for (const piece of [...inside].reverse()) {
    steps.push(piece.through ? { kind: 'arc', to: piece.start, through: piece.through } : { kind: 'line', to: piece.start });
  }
  return { start: outside[0].start, steps };
}

/** Points along a centreline, for the part's meridian. */
function sample(segments: readonly Segment[]): Point2[] {
  const points: Point2[] = [];
  for (const segment of segments) {
    if (segment.kind === 'line') {
      if (points.length === 0) points.push(segment.from);
      points.push(segment.to);
    } else {
      const count = Math.max(4, Math.ceil((Math.abs(segment.to - segment.from) / Math.PI) * 16));
      for (let i = points.length === 0 ? 0 : 1; i <= count; i++) {
        const angle = segment.from + ((segment.to - segment.from) * i) / count;
        points.push([segment.centre[0] + segment.radius * Math.cos(angle), segment.centre[1] + segment.radius * Math.sin(angle)]);
      }
    }
  }
  return points;
}

const HALF = Math.PI / 2;

/**
 * The run part of a wall that starts and ends on a cylinder of mean radius `meanRadius`, its
 * ends being where it meets its neighbours.
 */
function foldedPart(
  context: RunContext,
  line: Centreline,
  meanRadius: number,
  thickness: number,
  extras: {
    solids?: Solid[];
    copies?: (readonly Vec3[] | undefined)[];
    notes: Note[];
    idealisations?: Idealisation[];
    role: string;
  }
): RunPart {
  const outline = wallProfile(line.segments, thickness);
  const height = line.point[1];
  const surface = cylinderSurface(meanRadius);
  const inside = 2 * (meanRadius - thickness / 2);
  const outsideDiameter = 2 * (meanRadius + thickness / 2);
  return {
    solid: context.kernel.revolve(outline),
    extraSolids: extras.solids,
    copies: extras.copies ? [undefined, ...extras.copies] : undefined,
    height,
    lower: { insideDiameter: inside, outsideDiameter, wall: { surface, thickness, meridian: [0, -1] } },
    upper: { insideDiameter: inside, outsideDiameter, wall: { surface, thickness, meridian: [0, 1] } },
    landmarks: [
      { key: 'lower-inside', z: 0, diameter: inside, role: `${extras.role} end (inside)`, junction: 'lower' },
      { key: 'lower-outside', z: 0, diameter: outsideDiameter, role: `${extras.role} end (outside)`, junction: 'lower' },
      { key: 'upper-inside', z: height, diameter: inside, role: `${extras.role} end (inside)`, junction: 'upper' },
      { key: 'upper-outside', z: height, diameter: outsideDiameter, role: `${extras.role} end (outside)`, junction: 'upper' },
    ],
    meridian: sample(line.segments),
    idealisations: extras.idealisations,
    notes: extras.notes,
  };
}

/**
 * The centreline of `count` convolutions on a tangent of `tangent` at each end: a quarter fold
 * off the tangent, then for each convolution a sidewall out, a crest of radius `crest`, a
 * sidewall back and a root of radius `root`, and a quarter fold back onto the far tangent. The
 * pitch is `2·crest + 2·root`, the sidewalls lying square to the axis between them.
 */
function convolutions(meanRoot: number, tangent: number, count: number, root: number, crest: number, sidewall: number) {
  const line = new Centreline([meanRoot, 0]).lineTo([meanRoot, tangent]);
  line.arc([meanRoot + root, tangent], -HALF);
  const rootCentres: number[] = [];
  for (let i = 0; i < count; i++) {
    const base = line.point;
    line.lineTo([base[0] + sidewall, base[1]]);
    line.arc([base[0] + sidewall, base[1] + crest], Math.PI);
    line.lineTo([meanRoot + root, line.point[1]]);
    if (i < count - 1) {
      rootCentres.push(line.point[1] + root);
      line.arc([meanRoot + root, line.point[1] + root], -Math.PI);
    }
  }
  line.arc([meanRoot + root, line.point[1] + root], -HALF);
  line.lineTo([meanRoot, line.point[1] + tangent]);
  return { line, rootCentres };
}

/**
 * The plies of a bellows, drawn as one wall — an idealisation, and not a mild one: nested plies
 * slide on one another, so §4.19's bending stiffness is linear in their number, where a solid
 * wall of `n·t` is about `n²` times too stiff. Refused under analysis, its plies carried as data.
 */
function bellowsWall(component: ComponentDefinition): { thickness: number; notes: Note[]; idealisations: Idealisation[] } {
  const ply = requireDimension(component, Sym.THICKNESS);
  const plies = Math.max(1, Math.round(requireDimension(component, Sym.PLY_COUNT)));
  if (plies === 1) return { thickness: ply, notes: [], idealisations: [] };
  return {
    thickness: ply * plies,
    notes: [
      analysisNote(
        `Idealised as one wall of ${mm(ply * plies)} for ${plies} plies of ${mm(ply)}: plies slide, so it is about ${plies * plies} times too stiff in bending`,
        Sym.PLY_COUNT
      ),
    ],
    idealisations: [
      {
        kind: 'plies_as_one_wall',
        message: `The ${plies} plies are drawn as one wall; each lies over the one inside it, the innermost on the bore`,
        data: { plies, plyThickness: ply },
      },
    ],
  };
}

/** The collars round a bellows' end tangents, when stated. */
function collars(component: ComponentDefinition, context: RunContext, outside: number, height: number): Solid[] {
  const thickness = optionalDimension(component, Sym.COLLAR_THICKNESS);
  const length = optionalDimension(component, Sym.COLLAR_LENGTH);
  if (thickness === undefined || length === undefined) return [];
  const ring = (z0: number, z1: number) =>
    context.kernel.revolve({
      start: [outside, z0],
      steps: [
        { kind: 'line', to: [outside + thickness, z0] },
        { kind: 'line', to: [outside + thickness, z1] },
        { kind: 'line', to: [outside, z1] },
      ],
    });
  return [ring(0, Math.min(length, height / 2)), ring(Math.max(height - length, height / 2), height)];
}

/**
 * §4.19.5 and §4.19.6 — a U-shaped bellows, reinforced or not: `N` convolutions of height `w`
 * at pitch `q` on a bore `D_b`, between end tangents of `L_t`. Its tori are drawn of radius
 * `q/4`, which lays the sidewalls square to the axis; a reinforced one carries a ring of area
 * `A_r` in every root between two convolutions.
 */
function uShapedBellows(reinforced: boolean): RunBuilder {
  return (component, context) => {
    const bore = requireDimension(component, Sym.BELLOWS_INSIDE_DIAMETER);
    const height = requireDimension(component, Sym.CONVOLUTION_HEIGHT);
    const pitch = requireDimension(component, Sym.CONVOLUTION_PITCH);
    const count = Math.max(1, Math.round(requireDimension(component, Sym.CONVOLUTION_COUNT)));
    const tangent = requireDimension(component, Sym.END_TANGENT_LENGTH);
    const { thickness, notes, idealisations } = bellowsWall(component);

    const torus = pitch / 4;
    const stated = optionalDimension(component, Sym.TORUS_RADIUS);
    if (stated !== undefined && Math.abs(stated - torus) > 0.5) {
      notes.push(note(`Torus radius of ${mm(stated)} stated; drawn as q/4 = ${mm(torus)}, its sidewalls square to the axis`, Sym.TORUS_RADIUS));
    }
    const sidewall = height - thickness - 2 * torus;
    if (sidewall < 0) {
      throw new BuildError(component, `is ${mm(height)} high on a ${mm(pitch)} pitch: too shallow for a U-shaped convolution`);
    }
    if (thickness / 2 >= torus) {
      throw new BuildError(component, `has a wall of ${mm(thickness)}, too thick to fold on a ${mm(pitch)} pitch`);
    }

    const meanRoot = bore / 2 + thickness / 2;
    const { line, rootCentres } = convolutions(meanRoot, tangent, count, torus, torus, sidewall);
    const total = line.point[1];

    const solids = collars(component, context, bore / 2 + thickness, total);
    let copies: (readonly Vec3[] | undefined)[] = solids.map(() => undefined);
    if (reinforced) {
      const area = requireDimension(component, Sym.REINFORCING_RING_AREA);
      // A rectangle filling the root's valley between the two sidewalls, as deep as its area asks.
      const width = 2 * torus - thickness;
      const depth = Math.min(area / width, sidewall + torus);
      if (rootCentres.length > 0 && width > 0) {
        const r0 = meanRoot + torus;
        const z = rootCentres[0];
        solids.push(
          context.kernel.revolve({
            start: [r0, z - width / 2],
            steps: [
              { kind: 'line', to: [r0 + depth, z - width / 2] },
              { kind: 'line', to: [r0 + depth, z + width / 2] },
              { kind: 'line', to: [r0, z + width / 2] },
            ],
          })
        );
        copies = [...copies, rootCentres.slice(1).map((c): Vec3 => [0, 0, c - z])];
        notes.push(note(`Reinforcing rings drawn as rectangles of ${mm(width)} by ${mm(depth)} in the ${rootCentres.length} roots between convolutions`));
      }
    }
    return foldedPart(context, line, meanRoot, thickness, { solids, copies, notes, idealisations, role: 'Bellows tangent' });
  };
}

/**
 * §4.19.7 — a toroidal bellows: `N` convolutions each a torus of mean radius `r`, at pitch `q`.
 * The torus stands on a sidewall of one radius, and the roots between take what the pitch
 * leaves; the tangents share out the weld spacing `L_w` the convolutions do not take.
 */
export const toroidalBellows: RunBuilder = (component, context) => {
  const bore = requireDimension(component, Sym.BELLOWS_INSIDE_DIAMETER);
  const radius = requireDimension(component, Sym.TOROIDAL_RADIUS);
  const pitch = requireDimension(component, Sym.CONVOLUTION_PITCH);
  const count = Math.max(1, Math.round(requireDimension(component, Sym.CONVOLUTION_COUNT)));
  const { thickness, notes, idealisations } = bellowsWall(component);
  if (thickness / 2 >= radius) {
    throw new BuildError(component, `has a wall of ${mm(thickness)}, too thick for a torus of ${mm(radius)}`);
  }

  let root = pitch / 2 - radius;
  if (root < thickness) {
    root = thickness;
    notes.push(note(`A pitch of ${mm(pitch)} leaves no root between tori of ${mm(radius)}; drawn at ${mm(2 * (radius + root))}`, Sym.CONVOLUTION_PITCH));
  }
  const spacing = optionalDimension(component, Sym.TOROIDAL_WELD_SPACING);
  const drawnPitch = 2 * (radius + root);
  let tangent = spacing !== undefined ? (spacing - count * drawnPitch) / 2 : pitch / 2;
  if (spacing === undefined || tangent <= 0) {
    tangent = Math.max(tangent, pitch / 2);
    notes.push(note(`End tangents drawn ${mm(tangent)} long`, Sym.TOROIDAL_WELD_SPACING));
  }
  notes.push(note(`Each torus drawn on a sidewall of ${mm(radius)}: §4.19.7 does not state how far it stands out`));

  const meanRoot = bore / 2 + thickness / 2;
  const { line } = convolutions(meanRoot, tangent, count, root, radius, radius);
  return foldedPart(context, line, meanRoot, thickness, { notes, idealisations, role: 'Bellows tangent' });
};

export const uShapedBellows_ = uShapedBellows(false);
export const uShapedReinforcedBellows = uShapedBellows(true);

/**
 * §4.18.12 — a flanged-and-flued expansion joint: from the shell, an inner torus (the flue), an
 * annular plate out to an outer torus, a short outer cylinder, and the same back down. §4.18.12
 * sends it to Part 5 and the catalogue carries only `D` and `t`, so its proportions are drawn
 * and said: a torus of `max[4t, 0.04·D]`, a plate standing `max[0.1·D, 4·torus]` out.
 */
export const flangedAndFluedJoint: RunBuilder = (component, context) => {
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const mean = diameter / 2 + thickness / 2;
  const torus = Math.max(4 * thickness, 0.04 * diameter);
  const reach = Math.max(0.1 * diameter, 4 * torus);
  const outer = 2 * torus;

  const line = new Centreline([mean, 0]).lineTo([mean, torus]);
  line.arc([mean + torus, torus], -HALF);
  line.lineTo([mean + reach - torus, line.point[1]]);
  line.arc([mean + reach - torus, line.point[1] + torus], HALF);
  line.lineTo([mean + reach, line.point[1] + outer]);
  line.arc([mean + reach - torus, line.point[1]], HALF);
  line.lineTo([mean + torus, line.point[1]]);
  line.arc([mean + torus, line.point[1] + torus], -HALF);
  line.lineTo([mean, line.point[1] + torus]);

  return foldedPart(context, line, mean, thickness, {
    notes: [
      note(
        `Drawn to assumed proportions — tori of ${mm(torus)}, flanges standing ${mm(reach)} out, an outer cylinder of ${mm(outer)}: the catalogue carries D and t alone`
      ),
    ],
    role: 'Joint',
  });
};

/** By `ComponentType` wire value. */
export const CONVOLUTED_BUILDERS: Readonly<Record<string, RunBuilder>> = {
  [Kind.U_SHAPED_BELLOWS_AS_FORMED]: uShapedBellows_,
  [Kind.U_SHAPED_BELLOWS_ANNEALED]: uShapedBellows_,
  [Kind.U_SHAPED_REINFORCED_BELLOWS_AS_FORMED]: uShapedReinforcedBellows,
  [Kind.U_SHAPED_REINFORCED_BELLOWS_ANNEALED]: uShapedReinforcedBellows,
  [Kind.TOROIDAL_BELLOWS]: toroidalBellows,
  [Kind.FLANGED_AND_FLUED_EXPANSION_JOINT]: flangedAndFluedJoint,
};
