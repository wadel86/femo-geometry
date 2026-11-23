// A forged transition ring: the Y-shaped forging a skirt stands on when it is not welded to the
// lower head. Its upper leg continues the course above; below the crotch it splits into an inner
// leg, which the lower head butts on, and an outer leg, flush with the upper leg's outside, which
// the skirt butts on. The slot between the two legs is rounded at its top by the crotch radius.
//
// Frame: the run's lower junction is the inner leg's end, so it sits at z = 0 and the head below
// stacks there; the outer leg runs `head_joint_height` further down, to the ring's bottom face.
// Heights as stated run up from that bottom face.
//
// Or, stated with `tangent_line_height` and `head_seam_distance`, the ring carries the head's
// straight flange and the first part of its knuckle to an inclined seam: see `carryingRing`.
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
import type { CourseShape, HostFrame, HostSurface, Landmark, RunBuilder, RunContext, RunPart } from './types.ts';
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

/**
 * What the ring offers what is mounted on it: its upper leg's side, for a nozzle or a lug, and
 * its outer leg's end, for a skirt butt-welded on.
 */
function ringHost(
  context: RunContext,
  a: number,
  R: number,
  upperLeg: number,
  skirtLeg: number,
  bottom: number,
  apex: number,
  top: number
): HostSurface {
  const upperSurface = cylinderSurface(a + upperLeg / 2);
  const course: CourseShape = {
    halfApexAngle: 0,
    thickness: upperLeg,
    insideRadiusAt: () => a,
    outsideRadiusAt: () => R,
  };
  let cavity: ReturnType<RunContext['kernel']['revolve']> | undefined;
  return {
    anchor: 'shell_side',
    offsetRange: [apex, top],
    defaultOffset: (apex + top) / 2,
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
        wall: upperLeg,
      };
    },
    cavity() {
      cavity ??= context.kernel.revolve({
        start: [0, bottom - a],
        steps: [line(a, bottom - a), line(a, top + a), line(0, top + a)],
      });
      return cavity;
    },
    wallAt: () => ({ surface: upperSurface, thickness: upperLeg, meridian: UP }),
    seat: {
      z: bottom,
      insideRadius: R - skirtLeg,
      outsideRadius: R,
      wall: { surface: cylinderSurface(R - skirtLeg / 2), thickness: skirtLeg, meridian: DOWN },
    },
  };
}

export const forgedTransitionRing: RunBuilder = (component, context: RunContext) => {
  const tangent = signedDimension(component, Sym.TANGENT_LINE_HEIGHT);
  const seam = signedDimension(component, Sym.HEAD_SEAM_DISTANCE);
  if (tangent !== undefined || seam !== undefined) {
    if (tangent === undefined || seam === undefined) {
      const missing = tangent === undefined ? Sym.TANGENT_LINE_HEIGHT : Sym.HEAD_SEAM_DISTANCE;
      throw new BuildError(
        component,
        `states one of the two dimensions of a ring that carries its head's knuckle, not ${missing}`,
        scope('out_of_scope', missing, `stated with ${missing === Sym.TANGENT_LINE_HEIGHT ? Sym.HEAD_SEAM_DISTANCE : Sym.TANGENT_LINE_HEIGHT}`, 'not stated')
      );
    }
    return carryingRing(component, context, tangent, seam);
  }

  const notes: Note[] = [];
  const s = transitionRingShape(component, notes);
  const a = s.insideRadius;
  const R = s.outsideRadius;
  const headMid = a + s.headLeg / 2;
  const upperMid = a + s.upperLeg / 2;

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
      wall: { surface: cylinderSurface(upperMid), thickness: s.upperLeg, meridian: UP },
    },
    landmarks: ringLandmarks(s),
    host: ringHost(context, a, R, s.upperLeg, s.skirtLeg, s.bottom, s.apex, s.top),
    // The head leg's mid-surface up to the crotch, then the upper leg's; the skirt leg branches off.
    meridian: [
      [headMid, 0],
      [headMid, s.apex],
      [upperMid, s.apex],
      [upperMid, s.top],
    ],
    crotch: {
      radius: s.crotchRadius,
      apexZ: s.apex,
      meridianPoint: [headMid, s.apex],
      below: { radius: headMid, thickness: s.headLeg },
      above: { radius: upperMid, thickness: s.upperLeg },
    },
    notes,
  };
};

/**
 * A ring that carries its head's straight flange and the first part of its knuckle (ENSA's
 * general arrangement): the bore runs down to the head's tangent line inside the ring, the inner
 * face then follows the head's inner surface to a seam drawn normal to the wall at `s` along the
 * head's mid-surface, and the slot is bounded by the skirt leg's inner face and the head's OUTER
 * surface — the flange's above the tangent line, the knuckle's below it — closing at the tip
 * with a flat top and two corner radii where the crotch height is stated, and with a full round
 * tangent to both sides where it is not.
 *
 * The head's radii and thickness are the head's own, read from the head below in the run; the
 * ring states only where its tangent line and its seam are. Frame: z = 0 at the tangent line,
 * which is where the head below, drawn from its seam, keeps its own z = 0.
 */
function carryingRing(component: ComponentDefinition, context: RunContext, tangentHeight: number, seamDistance: number): RunPart {
  const notes: Note[] = [];
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const upperLeg = requireDimension(component, Sym.THICKNESS);
  const height = requireDimension(component, Sym.TRANSITION_RING_HEIGHT);
  const headLeg = requireDimension(component, Sym.HEAD_LEG_THICKNESS);
  const skirtLeg = requireDimension(component, Sym.SKIRT_LEG_THICKNESS);
  const rc = requireDimension(component, Sym.CROTCH_RADIUS);
  if (signedDimension(component, Sym.HEAD_JOINT_HEIGHT) !== undefined) {
    throw new BuildError(
      component,
      'carries its head to an inclined seam, so it has no flat head joint to put a height on',
      scope('out_of_scope', Sym.HEAD_JOINT_HEIGHT, `not stated with ${Sym.HEAD_SEAM_DISTANCE}`, `${component.dimensions[Sym.HEAD_JOINT_HEIGHT]}`)
    );
  }
  const head = context.headBelow;
  if (!head) {
    throw new BuildError(
      component,
      "carries a head's flange and knuckle, and no torispherical head closes the run below it",
      scope('out_of_scope', 'head below', 'a torispherical head closing the bottom of the run', 'none')
    );
  }
  if (Math.abs(head.insideDiameter - diameter) > 1e-6 * diameter) {
    throw new BuildError(
      component,
      `carries a ${mm(head.insideDiameter)} head on a ${mm(diameter)} bore`,
      scope('mismatch', Sym.INSIDE_DIAMETER, `${mm(head.insideDiameter)}, the head's`, mm(diameter))
    );
  }
  if (!(tangentHeight > 0 && tangentHeight < height)) {
    throw new BuildError(
      component,
      `has the head's tangent line ${mm(tangentHeight)} above its bottom face, outside its ${mm(height)} height`,
      scope('out_of_scope', Sym.TANGENT_LINE_HEIGHT, `> 0 and < ${mm(height)}`, mm(tangentHeight))
    );
  }

  const a = diameter / 2;
  const R = a + upperLeg;
  const rk = head.knuckleRadius;
  const xc = a - rk;
  const rko = rk + headLeg;
  const xs = R - skirtLeg;

  // No crotch height: the root is a FULL ROUND, one radius tangent to the skirt leg's inner face
  // and to the knuckle's outer surface with no flat between — which only exists where the slot
  // at the tangent line is narrower than the round, so the round reaches down onto the knuckle.
  let crotchHeight = signedDimension(component, Sym.CROTCH_HEIGHT);
  if (crotchHeight === undefined) {
    const slotAtTangent = xs - (a + headLeg);
    if (!(slotAtTangent <= 2 * rc + 1e-9)) {
      throw new BuildError(
        component,
        `states no crotch height, and a ${mm(rc)} full round cannot touch both sides of a slot ${mm(slotAtTangent)} wide at the tangent line`,
        scope('out_of_scope', Sym.CROTCH_RADIUS, `≥ ${mm(slotAtTangent / 2)}, half the slot at the tangent line, for a full round`, mm(rc))
      );
    }
    const z = -Math.sqrt(Math.max(0, (rko + rc) ** 2 - (xs - rc - xc) ** 2));
    crotchHeight = tangentHeight + z + rc;
  }
  if (!(crotchHeight >= rc && crotchHeight < height)) {
    throw new BuildError(
      component,
      `has its crotch ${mm(crotchHeight)} above its bottom face, outside ${mm(rc)} to ${mm(height)}`,
      scope('out_of_scope', Sym.CROTCH_HEIGHT, `≥ ${mm(rc)}, the crotch radius, and < ${mm(height)}, the top`, mm(crotchHeight))
    );
  }

  const zcCrown = -Math.sqrt((head.crownRadius - rk) ** 2 - xc ** 2);
  const beta = Math.atan2(-zcCrown, xc);
  // The seam angle is the head's own: s along ITS mid-surface, whatever the ring's leg.
  const meanHead = rk + head.thickness / 2;
  const phiS = seamDistance / meanHead;
  if (!(seamDistance > 0) || !(phiS < beta)) {
    throw new BuildError(
      component,
      `puts the seam ${mm(seamDistance)} along a knuckle ${mm(meanHead * beta)} long at mid-wall`,
      scope('out_of_scope', Sym.HEAD_SEAM_DISTANCE, `> 0 and < ${mm(meanHead * beta)}, on the knuckle`, mm(seamDistance))
    );
  }

  // In the ring's frame the knuckle runs DOWN from the tangent line at z = 0.
  const on = (r: number, phi: number): Point2 => [xc + r * Math.cos(phi), -r * Math.sin(phi)];
  const bottom = -tangentHeight;
  const top = height - tangentHeight;
  const tip = crotchHeight - tangentHeight;
  const z0 = tip - rc;

  // The root's corner on the head side: against the flange's outer face above the tangent
  // line, against the knuckle's outer surface below it.
  let cx: number;
  let contact: Point2;
  let phiContact = 0;
  if (z0 >= 0) {
    cx = a + headLeg + rc;
    contact = [a + headLeg, z0];
  } else {
    const reach = rko + rc;
    if (-z0 >= reach) {
      throw new BuildError(
        component,
        `has its crotch ${mm(-tip)} below the tangent line, past the head's knuckle`,
        scope('out_of_scope', Sym.CROTCH_HEIGHT, `> ${mm(tangentHeight - reach + rc)}`, mm(crotchHeight))
      );
    }
    cx = xc + Math.sqrt(reach ** 2 - z0 ** 2);
    contact = [xc + (rko * (cx - xc)) / reach, (rko * z0) / reach];
    phiContact = Math.atan2(-z0, cx - xc);
    if (!(phiContact < phiS)) {
      throw new BuildError(
        component,
        "has its crotch's root below the seam: the slot would cut into the head",
        scope('out_of_scope', Sym.CROTCH_HEIGHT, 'its root above the seam', mm(crotchHeight))
      );
    }
  }
  if (cx > xs - rc + 1e-9) {
    const width = xs - (cx - rc);
    throw new BuildError(
      component,
      `has a ${mm(width)} slot top at its crotch, too narrow for a ${mm(rc)} crotch radius`,
      scope('out_of_scope', Sym.CROTCH_RADIUS, `≤ ${mm(width / 2)}, half the slot's top`, mm(rc))
    );
  }

  const seamInside = on(rk, phiS);
  const seamOutside = on(rko, phiS);
  const h = Math.SQRT1_2 * rc;
  let theta = Math.atan2(contact[1] - z0, contact[0] - cx);
  if (theta < 0) theta += 2 * Math.PI;
  const rootMid = (theta + Math.PI / 2) / 2;
  const steps: ProfileStep[] = [line(seamOutside[0], seamOutside[1])];
  if (z0 >= 0) {
    steps.push({ kind: 'arc', to: [a + headLeg, 0], through: on(rko, phiS / 2) }, line(a + headLeg, z0));
  } else {
    steps.push({ kind: 'arc', to: contact, through: on(rko, (phiS + phiContact) / 2) });
  }
  // A full round leaves no flat: its two arcs meet at the apex, which stays an edge to start from.
  steps.push({ kind: 'arc', to: [cx, tip], through: [cx + rc * Math.cos(rootMid), z0 + rc * Math.sin(rootMid)] });
  if (xs - rc - cx > 1e-9) steps.push(line(xs - rc, tip));
  steps.push(
    { kind: 'arc', to: [xs, z0], through: [xs - rc + h, z0 + h] },
    line(xs, bottom),
    line(R, bottom),
    line(R, top),
    line(a, top),
    line(a, 0),
    { kind: 'arc', to: seamInside, through: on(rk, phiS / 2) }
  );

  const headMid = a + headLeg / 2;
  const upperMid = a + upperLeg / 2;
  const apex = Math.max(tip, 0);
  const meanRing = rk + headLeg / 2;
  const meanSeam = xc + meanRing * Math.cos(phiS);
  const landmarks: Landmark[] = [
    { key: 'lower-inside', z: seamInside[1], diameter: 2 * seamInside[0], role: 'Seam to the head (inside)', junction: 'lower' },
    { key: 'lower-outside', z: seamOutside[1], diameter: 2 * seamOutside[0], role: 'Seam to the head (outside)', junction: 'lower' },
    { key: 'upper-inside', z: top, diameter: 2 * a, role: 'Course joint (inside)', junction: 'upper' },
    { key: 'upper-outside', z: top, diameter: 2 * R, role: 'Course joint (outside)', junction: 'upper' },
    { key: 'tangent-inside', z: 0, diameter: 2 * a, role: "Head's tangent line (inside)" },
    { key: 'skirt-leg-inside', z: bottom, diameter: 2 * xs, role: 'Skirt joint (inside)' },
    { key: 'skirt-leg-outside', z: bottom, diameter: 2 * R, role: 'Skirt joint (outside)' },
  ];
  if (z0 > 1e-9) landmarks.push({ key: 'tangent-outside', z: 0, diameter: 2 * (a + headLeg), role: "Head's tangent line (outside)" });
  if (z0 > 1e-9 || z0 < -1e-9) {
    landmarks.push({ key: 'crotch-head-leg', z: contact[1], diameter: 2 * contact[0], role: 'Crotch tangent line (head side)' });
  }
  if (z0 - bottom > 1e-9) landmarks.push({ key: 'crotch-skirt-leg', z: z0, diameter: 2 * xs, role: 'Crotch tangent line (skirt leg)' });
  if (xs - rc - cx > 1e-9) {
    landmarks.push(
      { key: 'crotch-apex-inner', z: tip, diameter: 2 * cx, role: 'Crotch apex, head side' },
      { key: 'crotch-apex-outer', z: tip, diameter: 2 * (xs - rc), role: 'Crotch apex, skirt side' }
    );
  } else {
    landmarks.push({ key: 'crotch-apex', z: tip, diameter: 2 * cx, role: 'Crotch apex' });
  }

  return {
    solid: context.kernel.revolve(section(seamInside, steps)),
    height: top,
    lower: {
      insideDiameter: 2 * seamInside[0],
      outsideDiameter: 2 * seamOutside[0],
      straightLength: 0,
      wall: {
        surface: { kind: 'torus' as const, principalRadii: [meanRing, meanSeam / Math.cos(phiS)] as const },
        thickness: headLeg,
        // Away from the ring: on along the knuckle, down and in.
        meridian: [-Math.sin(phiS), -Math.cos(phiS)] as Point2,
      },
    },
    upper: {
      insideDiameter: 2 * a,
      outsideDiameter: 2 * R,
      straightLength: top - apex,
      wall: { surface: cylinderSurface(upperMid), thickness: upperLeg, meridian: UP },
    },
    landmarks,
    host: ringHost(context, a, R, upperLeg, skirtLeg, bottom, apex, top),
    // From the seam back up the knuckle's mid-surface to the tangent line, up the flange to the
    // crotch, then the upper leg's; the skirt leg branches off at the crotch.
    meridian: [
      ...Array.from({ length: 17 }, (_, i) => on(meanRing, phiS * (1 - i / 16))),
      [headMid, apex] as Point2,
      [upperMid, apex] as Point2,
      [upperMid, top] as Point2,
    ].filter((p, i, all) => i === 0 || Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) > 1e-9),
    crotch: {
      radius: rc,
      apexZ: tip,
      meridianPoint: [headMid, apex] as Point2,
      below: { radius: headMid, thickness: headLeg },
      above: { radius: upperMid, thickness: upperLeg },
    },
    carriedTangentLine: { z: 0, meridianPoint: [headMid, 0] as Point2, radius: headMid, thickness: headLeg },
    notes,
  };
}
