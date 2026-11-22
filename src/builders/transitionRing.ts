// A forged transition ring: the Y-shaped forging a skirt stands on when it is not welded to the
// lower head. Its upper leg continues the course above; below the crotch it splits into an inner
// leg, which the lower head butts on, and an outer leg, flush with the upper leg's outside, which
// the skirt butts on. The slot between the two legs is rounded at its top by the crotch radius.
//
// Frame: the run's lower junction is the inner leg's end, so it sits at z = 0 and the head below
// stacks there; the outer leg runs `head_joint_height` further down, to the ring's bottom face.
// Heights as stated run up from that bottom face.
import {
  BuildError,
  Sym,
  analysisNote,
  requireDimension,
  scope,
  signedDimension,
  type ComponentDefinition,
  type Note,
} from '../definition.ts';
import type { Point2, ProfileStep } from '../kernel/GeometryKernel.ts';
import type { CourseShape, HostFrame, Landmark, RunBuilder, RunContext } from './types.ts';
import { cylinderSurface } from './walls.ts';

const DEG = Math.PI / 180;
const DOWN: Point2 = [0, -1];
const UP: Point2 = [0, 1];
const mm = (value: number): string => `${Number(value.toPrecision(5))} mm`;

/** The ring's section, in the part's frame (r, z), the numbers every consumer reads. */
export interface TransitionRingShape {
  /** Bore of the upper and inner legs. */
  readonly insideRadius: number;
  /** Outside of the upper and outer legs. */
  readonly outsideRadius: number;
  readonly upperLeg: number;
  readonly headLeg: number;
  readonly skirtLeg: number;
  readonly crotchRadius: number;
  /** The ring's bottom face, the outer leg's end: −`head_joint_height`. */
  readonly bottom: number;
  /** The crotch's apex, the top of the slot. */
  readonly apex: number;
  /** The top, where the course above butts on. */
  readonly top: number;
}

/** Reads the ring's dimensions and holds them to the shape they describe. */
export function transitionRingShape(component: ComponentDefinition, notes: Note[]): TransitionRingShape {
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const upperLeg = requireDimension(component, Sym.THICKNESS);
  const height = requireDimension(component, Sym.TRANSITION_RING_HEIGHT);
  const headLeg = requireDimension(component, Sym.HEAD_LEG_THICKNESS);
  const skirtLeg = requireDimension(component, Sym.SKIRT_LEG_THICKNESS);
  const crotchRadius = requireDimension(component, Sym.CROTCH_RADIUS);

  const headJoint = signedDimension(component, Sym.HEAD_JOINT_HEIGHT) ?? 0;
  if (headJoint < 0) {
    throw new BuildError(component, `has its head joint ${mm(-headJoint)} below its bottom face`, scope('out_of_scope', Sym.HEAD_JOINT_HEIGHT, '≥ 0', mm(headJoint)));
  }

  let crotch = signedDimension(component, Sym.CROTCH_HEIGHT);
  if (crotch === undefined) {
    crotch = height / 2;
    notes.push(
      analysisNote(
        `Crotch height not stated — the crotch drawn at mid-height, ${mm(crotch)} above the bottom face`,
        Sym.CROTCH_HEIGHT,
        scope('assumed', Sym.CROTCH_HEIGHT, 'stated', `not stated — drawn ${mm(crotch)}, half the ring's height`)
      )
    );
  }
  if (!(crotch > headJoint && crotch < height)) {
    throw new BuildError(
      component,
      `has its crotch ${mm(crotch)} above its bottom face, outside the ${mm(headJoint)} to ${mm(height)} between the head joint and the top`,
      scope('out_of_scope', Sym.CROTCH_HEIGHT, `> ${mm(headJoint)}, the head joint, and < ${mm(height)}, the top`, mm(crotch))
    );
  }

  const slot = upperLeg - headLeg - skirtLeg;
  if (!(slot > 0)) {
    throw new BuildError(
      component,
      `has legs of ${mm(headLeg)} and ${mm(skirtLeg)} that do not fit side by side under its ${mm(upperLeg)} upper leg`,
      scope('out_of_scope', 'slot width', `> 0: ${Sym.THICKNESS} − ${Sym.HEAD_LEG_THICKNESS} − ${Sym.SKIRT_LEG_THICKNESS}`, mm(slot))
    );
  }
  if (slot < 2 * crotchRadius - 1e-9) {
    throw new BuildError(
      component,
      `has a ${mm(slot)} slot between its legs, too narrow for a ${mm(crotchRadius)} crotch radius`,
      scope('out_of_scope', Sym.CROTCH_RADIUS, `≤ ${mm(slot / 2)}, half the slot`, mm(crotchRadius))
    );
  }
  // The rounding starts on each leg one radius below the apex; the inner leg must reach that far.
  if (crotch - headJoint < crotchRadius - 1e-9) {
    throw new BuildError(
      component,
      `has an inner leg ${mm(crotch - headJoint)} long, shorter than its ${mm(crotchRadius)} crotch radius`,
      scope('out_of_scope', Sym.CROTCH_RADIUS, `≤ ${mm(crotch - headJoint)}, the inner leg's length`, mm(crotchRadius))
    );
  }

  const insideRadius = diameter / 2;
  return {
    insideRadius,
    outsideRadius: insideRadius + upperLeg,
    upperLeg,
    headLeg,
    skirtLeg,
    crotchRadius,
    bottom: -headJoint,
    apex: crotch - headJoint,
    top: height - headJoint,
  };
}

/** A closed section from `start` through `points`, dropping the steps that go nowhere. */
function section(start: Point2, steps: readonly ProfileStep[]) {
  const kept: ProfileStep[] = [];
  let at = start;
  for (const step of steps) {
    if (Math.hypot(step.to[0] - at[0], step.to[1] - at[1]) < 1e-9) continue;
    kept.push(step);
    at = step.to;
  }
  return { start, steps: kept };
}

const line = (r: number, z: number): ProfileStep => ({ kind: 'line', to: [r, z] });

/** The ring's section: bore up the inner leg, round the crotch, down the outer leg, up the outside. */
export function transitionRingProfile(s: TransitionRingShape) {
  const headOut = s.insideRadius + s.headLeg;
  const skirtIn = s.outsideRadius - s.skirtLeg;
  const rc = s.crotchRadius;
  const foot = s.apex - rc;
  const h = Math.SQRT1_2 * rc;
  return section(
    [s.insideRadius, 0],
    [
      line(headOut, 0),
      line(headOut, foot),
      { kind: 'arc', to: [headOut + rc, s.apex], through: [headOut + rc - h, foot + h] },
      line(skirtIn - rc, s.apex),
      { kind: 'arc', to: [skirtIn, foot], through: [skirtIn - rc + h, foot + h] },
      line(skirtIn, s.bottom),
      line(s.outsideRadius, s.bottom),
      line(s.outsideRadius, s.top),
      line(s.insideRadius, s.top),
    ]
  );
}

/** The circles of the ring that name its joints, the crotch and the legs' ends. */
function ringLandmarks(s: TransitionRingShape): Landmark[] {
  const headOut = s.insideRadius + s.headLeg;
  const skirtIn = s.outsideRadius - s.skirtLeg;
  const rc = s.crotchRadius;
  const foot = s.apex - rc;
  const flat = skirtIn - headOut > 2 * rc + 1e-9;
  const landmarks: Landmark[] = [
    { key: 'lower-inside', z: 0, diameter: 2 * s.insideRadius, role: 'Head joint (inside)', junction: 'lower' },
    { key: 'lower-outside', z: 0, diameter: 2 * headOut, role: 'Head joint (outside)', junction: 'lower' },
    { key: 'upper-inside', z: s.top, diameter: 2 * s.insideRadius, role: 'Course joint (inside)', junction: 'upper' },
    { key: 'upper-outside', z: s.top, diameter: 2 * s.outsideRadius, role: 'Course joint (outside)', junction: 'upper' },
    { key: 'skirt-leg-inside', z: s.bottom, diameter: 2 * skirtIn, role: 'Skirt joint (inside)' },
    { key: 'skirt-leg-outside', z: s.bottom, diameter: 2 * s.outsideRadius, role: 'Skirt joint (outside)' },
  ];
  // Where the crotch's rounding leaves each leg: tangent lines, and the start of the crotch.
  if (foot > 1e-9) landmarks.push({ key: 'crotch-head-leg', z: foot, diameter: 2 * headOut, role: 'Crotch tangent line (head leg)' });
  if (foot - s.bottom > 1e-9) landmarks.push({ key: 'crotch-skirt-leg', z: foot, diameter: 2 * skirtIn, role: 'Crotch tangent line (skirt leg)' });
  if (flat) {
    landmarks.push(
      { key: 'crotch-apex-inner', z: s.apex, diameter: 2 * (headOut + rc), role: 'Crotch apex, head side' },
      { key: 'crotch-apex-outer', z: s.apex, diameter: 2 * (skirtIn - rc), role: 'Crotch apex, skirt side' }
    );
  } else {
    landmarks.push({ key: 'crotch-apex', z: s.apex, diameter: 2 * (headOut + rc), role: 'Crotch apex' });
  }
  return landmarks;
}

export const forgedTransitionRing: RunBuilder = (component, context: RunContext) => {
  const notes: Note[] = [];
  const s = transitionRingShape(component, notes);
  const a = s.insideRadius;
  const R = s.outsideRadius;
  const headMid = a + s.headLeg / 2;
  const upperMid = a + s.upperLeg / 2;
  const skirtMid = R - s.skirtLeg / 2;
  const upperSurface = cylinderSurface(upperMid);
  const course: CourseShape = {
    halfApexAngle: 0,
    thickness: s.upperLeg,
    insideRadiusAt: () => a,
    outsideRadiusAt: () => R,
  };
  let cavity: ReturnType<RunContext['kernel']['revolve']> | undefined;

  return {
    solid: context.kernel.revolve(transitionRingProfile(s)),
    height: s.top,
    lower: {
      insideDiameter: 2 * a,
      outsideDiameter: 2 * (a + s.headLeg),
      straightLength: s.apex - s.crotchRadius,
      wall: { surface: cylinderSurface(headMid), thickness: s.headLeg, meridian: DOWN },
    },
    upper: {
      insideDiameter: 2 * a,
      outsideDiameter: 2 * R,
      straightLength: s.top - s.apex,
      wall: { surface: upperSurface, thickness: s.upperLeg, meridian: UP },
    },
    landmarks: ringLandmarks(s),
    host: {
      anchor: 'shell_side',
      offsetRange: [s.apex, s.top],
      defaultOffset: (s.apex + s.top) / 2,
      outsideRadius: R,
      course,
      sideOf(point) {
        const rho = Math.hypot(point[0], point[1]);
        return Math.abs(rho - R) < Math.abs(rho - a) ? 'outside' : 'inside';
      },
      frameAt(offset: number, azimuth: number): HostFrame {
        const phi = azimuth * DEG;
        return {
          origin: [R * Math.cos(phi), R * Math.sin(phi), offset],
          axis: [Math.cos(phi), Math.sin(phi), 0],
          wall: s.upperLeg,
        };
      },
      cavity() {
        cavity ??= context.kernel.revolve({
          start: [0, s.bottom - a],
          steps: [line(a, s.bottom - a), line(a, s.top + a), line(0, s.top + a)],
        });
        return cavity;
      },
      wallAt: () => ({ surface: upperSurface, thickness: s.upperLeg, meridian: UP }),
      seat: {
        z: s.bottom,
        insideRadius: R - s.skirtLeg,
        outsideRadius: R,
        wall: { surface: cylinderSurface(skirtMid), thickness: s.skirtLeg, meridian: DOWN },
      },
    },
    // The head leg's mid-surface up to the crotch, then the upper leg's; the skirt leg branches off.
    meridian: [
      [headMid, 0],
      [headMid, s.apex],
      [upperMid, s.apex],
      [upperMid, s.top],
    ],
    notes,
  };
};
