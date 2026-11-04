// Builders for the parts of the axial run: courses, heads, flat ends, flanges.
//
// Every one works in the part's own frame: the vessel axis is Z, the part's lower junction sits
// at z = 0 and it extends upwards. A head is built crown up, tangent line at z = 0; the assembly
// turns it over when it closes the bottom of the run.
import {
  BuildError,
  Sym,
  analysisNote,
  assumedNote,
  notBuiltNote,
  note,
  optionalDimension,
  representedNote,
  requireDimension,
  scope,
  signedDimension,
  type ComponentDefinition,
  type Note,
} from '../definition.ts';
import type { Point2, Profile, ProfileStep } from '../kernel/GeometryKernel.ts';
import {
  dishedCoverTypeB,
  dishedCoverTypeC,
  dishedCoverTypeD,
  quickActuatingClosure,
  sphericallyDishedCover,
  stayedSurface,
} from './covers.ts';
import { clampedConnection } from './clamps.ts';
import { CONVOLUTED_BUILDERS } from './convoluted.ts';
import { TUBESHEET_BUILDERS } from './exchangers.ts';
import { dividingPlates, obroundVessel, octagonalVessel, rectangularVessel } from './special.ts';
import type {
  CourseShape,
  HostFrame,
  HostSurface,
  Junction,
  Landmark,
  RunBuilder,
  RunContext,
  WallAt,
  WallSurface,
} from './types.ts';
import { PLANE, cylinderSurface, sphereSurface } from './walls.ts';
import { ellipseOffset, fitBezier } from './bezierFit.ts';

const DEG = Math.PI / 180;

const line = (r: number, z: number): ProfileStep => ({ kind: 'line', to: [r, z] });

const arc = (to: Point2, through: Point2): ProfileStep => ({ kind: 'arc', to, through });

const mm = (value: number): string => `${Number(value.toPrecision(5))} mm`;

const DOWN: Point2 = [0, -1];
const UP: Point2 = [0, 1];

/** The two circles where a part meets a neighbour, inside and outside. */
function junctionLandmarks(
  side: 'lower' | 'upper',
  z: number,
  insideDiameter: number,
  outsideDiameter: number,
  role: string
): Landmark[] {
  return [
    { key: `${side}-inside`, z, diameter: insideDiameter, role: `${role} (inside)`, junction: side },
    { key: `${side}-outside`, z, diameter: outsideDiameter, role: `${role} (outside)`, junction: side },
  ];
}

/** A cavity: the volume the part encloses, from `-margin` up to its inside surface. */
function cavityProfile(insideRadius: number, margin: number, steps: ProfileStep[]): Profile {
  return {
    start: [0, -margin],
    steps: [line(insideRadius, -margin), line(insideRadius, 0), ...steps],
  };
}

/** A profile step raised by `dz`: a head drawn above its straight flange. */
function lift(step: ProfileStep, dz: number): ProfileStep {
  if (dz === 0) return step;
  const up = (p: Point2): Point2 => [p[0], p[1] + dz];
  switch (step.kind) {
    case 'line':
      return { kind: 'line', to: up(step.to) };
    case 'arc':
      return { kind: 'arc', to: up(step.to), through: up(step.through) };
    case 'ellipse':
      return { ...step, to: up(step.to) };
    case 'bezier':
      return { kind: 'bezier', to: up(step.to), controls: step.controls.map(up) };
  }
}

/** Points of a circular arc in the meridian half-plane, for a mid-surface meridian. */
function arcPoints(centre: Point2, radius: number, from: number, to: number, count = 32): Point2[] {
  return Array.from({ length: count + 1 }, (_, i): Point2 => {
    const angle = from + ((to - from) * i) / count;
    return [centre[0] + radius * Math.cos(angle), centre[1] + radius * Math.sin(angle)];
  });
}

/** The shape of a formed head with no straight flange, tangent line at z = 0, crown up. */
interface HeadShape {
  /** From the outside of the tangent line, `[a + t, 0]`, up to the axis. */
  readonly outside: readonly ProfileStep[];
  /** The inside surface's height on the axis. */
  readonly insideTop: number;
  /** From the inside on the axis down to the inside of the tangent line, `[a, 0]`. */
  readonly inside: readonly ProfileStep[];
  /** The same inside surface the other way round, from `[a, 0]` up to the axis: the cavity. */
  readonly insideUp: readonly ProfileStep[];
  readonly zInside: (rho: number) => number;
  readonly zOutside: (rho: number) => number;
  readonly surfaceAt: (rho: number) => WallSurface;
  /** The mid-surface at the tangent line, where the head meets its shell when it has no flange. */
  readonly tangentSurface: WallSurface;
  /** The mid-surface meridian from the tangent line to the pole. */
  readonly meridian: readonly Point2[];
  readonly height: number;
  readonly landmarks: readonly Landmark[];
  readonly notes: readonly Note[];
}

/**
 * A formed head on its straight flange: the cylinder of length `SF` between the head-to-shell
 * weld and the tangent line, which moves that weld off the discontinuity. Zero is an answer — a
 * head welded straight on — and absence is the question unasked, refused under analysis.
 */
function formedHead(component: ComponentDefinition, context: RunContext, a: number, t: number, shape: HeadShape) {
  const flange = signedDimension(component, Sym.STRAIGHT_FLANGE_LENGTH);
  if (flange !== undefined && flange < 0) {
    throw new BuildError(
      component,
      `has a straight flange of ${mm(flange)}`,
      scope('out_of_scope', Sym.STRAIGHT_FLANGE_LENGTH, '≥ 0', mm(flange))
    );
  }
  const sf = flange ?? 0;
  const notes: Note[] = [...shape.notes];
  if (flange === undefined) {
    notes.push(
      analysisNote(
        'Straight flange length not stated — drawn without one, so the head-to-shell weld sits on the tangent line',
        Sym.STRAIGHT_FLANGE_LENGTH,
        scope('assumed', Sym.STRAIGHT_FLANGE_LENGTH, 'stated', 'not stated — drawn 0 mm, the weld on the tangent line')
      )
    );
  }

  const diameter = 2 * a;
  const tangent: Landmark[] =
    sf > 0
      ? [
          { key: 'tangent-inside', z: sf, diameter, role: 'Tangent line (inside)' },
          { key: 'tangent-outside', z: sf, diameter: diameter + 2 * t, role: 'Tangent line (outside)' },
        ]
      : [];

  return {
    solid: context.kernel.revolve({
      start: [a, 0],
      steps: [
        line(a + t, 0),
        ...(sf > 0 ? [line(a + t, sf)] : []),
        ...shape.outside.map((s) => lift(s, sf)),
        line(0, shape.insideTop + sf),
        ...shape.inside.map((s) => lift(s, sf)),
      ],
    }),
    height: shape.height + sf,
    lower: {
      insideDiameter: diameter,
      outsideDiameter: diameter + 2 * t,
      wall: { surface: sf > 0 ? cylinderSurface(a + t / 2) : shape.tangentSurface, thickness: t, meridian: DOWN },
    },
    upper: null,
    landmarks: [
      ...junctionLandmarks('lower', 0, diameter, diameter + 2 * t, sf > 0 ? 'Straight flange end' : 'Tangent line'),
      ...tangent,
      ...shape.landmarks.map((l) => ({ ...l, z: l.z + sf })),
    ],
    host: headCrownHost(
      context,
      a,
      t,
      (rho) => shape.zInside(rho) + sf,
      (rho) => shape.zOutside(rho) + sf,
      () => cavityProfile(a, a / 4, [...(sf > 0 ? [line(a, sf)] : []), ...shape.insideUp.map((s) => lift(s, sf))]),
      shape.surfaceAt
    ),
    meridian: [[a + t / 2, 0] as Point2, ...shape.meridian.map((p): Point2 => [p[0], p[1] + sf])].filter(
      (p, i, all) => i === 0 || Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) > 1e-9
    ),
    tangentLine: sf,
    notes,
  };
}

function headCrownHost(
  context: RunContext,
  insideRadius: number,
  thickness: number,
  zInside: (rho: number) => number,
  zOutside: (rho: number) => number,
  cavity: () => Profile,
  surfaceAt: (rho: number) => WallSurface
): HostSurface {
  let cached: ReturnType<RunContext['kernel']['revolve']> | undefined;
  const middle = (rho: number) => (zInside(rho) + zOutside(rho)) / 2;
  return {
    anchor: 'head_crown',
    offsetRange: [0, insideRadius],
    defaultOffset: 0,
    frameAt(rho: number, azimuth: number): HostFrame {
      const phi = azimuth * DEG;
      const outside = zOutside(rho);
      return {
        origin: [rho * Math.cos(phi), rho * Math.sin(phi), outside],
        axis: [0, 0, 1],
        wall: outside - zInside(rho),
      };
    },
    cavity() {
      cached ??= context.kernel.revolve(cavity());
      return cached;
    },
    sideOf(point) {
      const rho = Math.hypot(point[0], point[1]);
      return Math.abs(point[2] - zOutside(rho)) < Math.abs(point[2] - zInside(rho)) ? 'outside' : 'inside';
    },
    wallAt(rho: number): WallAt {
      // The slope of the mid-surface, by a central difference kept inside the crown. Every head
      // is drawn as a true offset of its inside, so the wall is t thick normal to it everywhere.
      const h = Math.max(1e-6, 1e-4 * insideRadius);
      const low = Math.max(0, rho - h);
      const high = Math.min(insideRadius, rho + h);
      const slope = high > low ? (middle(high) - middle(low)) / (high - low) : 0;
      const length = Math.hypot(1, slope);
      return { surface: surfaceAt(rho), thickness, meridian: [1 / length, slope / length] };
    },
  };
}

/** The side of a course a point lies on: the nearer of its two radii at that height. */
function courseSide(course: CourseShape) {
  return (point: readonly [number, number, number]): 'inside' | 'outside' => {
    const rho = Math.hypot(point[0], point[1]);
    return Math.abs(rho - course.outsideRadiusAt(point[2])) < Math.abs(rho - course.insideRadiusAt(point[2]))
      ? 'outside'
      : 'inside';
  };
}

export const cylindricalShell: RunBuilder = (component, context) => {
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const notes: Note[] = [];

  let length = optionalDimension(component, Sym.COURSE_LENGTH);
  if (length === undefined) {
    length = diameter;
    notes.push(assumedNote(`Course length not stated — drawn ${mm(length)} long`, Sym.COURSE_LENGTH, mm(length)));
  }

  const a = diameter / 2;
  const outside = a + thickness;
  const surface = cylinderSurface(a + thickness / 2);
  let cavity: ReturnType<RunContext['kernel']['revolve']> | undefined;
  const course: CourseShape = {
    halfApexAngle: 0,
    thickness,
    insideRadiusAt: () => a,
    outsideRadiusAt: () => outside,
  };
  // §4.12 Type 12: a circular course divided into two chambers by a stay plate.
  const { plates, note: plateNote } = dividingPlates(component, context.kernel, a, length);
  if (plateNote) notes.push(plateNote);

  return {
    solid: context.kernel.revolve({
      start: [a, 0],
      steps: [line(outside, 0), line(outside, length), line(a, length)],
    }),
    extraSolids: plates,
    height: length,
    lower: { insideDiameter: diameter, outsideDiameter: 2 * outside, wall: { surface, thickness, meridian: DOWN } },
    upper: { insideDiameter: diameter, outsideDiameter: 2 * outside, wall: { surface, thickness, meridian: UP } },
    landmarks: [
      ...junctionLandmarks('lower', 0, diameter, 2 * outside, 'Course end'),
      ...junctionLandmarks('upper', length, diameter, 2 * outside, 'Course end'),
    ],
    host: {
      anchor: 'shell_side',
      offsetRange: [0, length],
      defaultOffset: length / 2,
      outsideRadius: outside,
      course,
      sideOf: courseSide(course),
      frameAt(offset: number, azimuth: number): HostFrame {
        const phi = azimuth * DEG;
        return {
          origin: [outside * Math.cos(phi), outside * Math.sin(phi), offset],
          axis: [Math.cos(phi), Math.sin(phi), 0],
          wall: thickness,
        };
      },
      cavity() {
        cavity ??= context.kernel.revolve({
          start: [0, -a],
          steps: [line(a, -a), line(a, length + a), line(0, length + a)],
        });
        return cavity;
      },
      wallAt: () => ({ surface, thickness, meridian: UP }),
    },
    meridian: [
      [a + thickness / 2, 0],
      [a + thickness / 2, length],
    ],
    notes,
  };
};

/**
 * A cone, large end down. `D` and α are required; the length comes from `Lc`, or failing that
 * from the small end diameter `D_S`.
 */
export const conicalShell: RunBuilder = (component, context) => {
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const alpha = requireDimension(component, Sym.HALF_APEX_ANGLE);
  if (alpha >= 90) {
    throw new BuildError(
      component,
      `has a half-apex angle of ${alpha}°, a cone needs less than 90°`,
      scope('out_of_scope', Sym.HALF_APEX_ANGLE, '< 90°', `${alpha}°`)
    );
  }
  const tan = Math.tan(alpha * DEG);
  const notes: Note[] = [];

  const statedLength = optionalDimension(component, Sym.COURSE_LENGTH);
  const statedSmallEnd = optionalDimension(component, Sym.SMALL_END_DIAMETER);
  let length: number;
  if (statedLength !== undefined) {
    length = statedLength;
    const derived = diameter - 2 * length * tan;
    if (statedSmallEnd !== undefined && Math.abs(derived - statedSmallEnd) > 0.5) {
      notes.push(
        note(
          `Small end stated as ${mm(statedSmallEnd)} but D, α and Lc give ${mm(derived)} — drawn from Lc`,
          Sym.SMALL_END_DIAMETER,
          scope('mismatch', Sym.SMALL_END_DIAMETER, `${mm(derived)}, from D, α and Lc within 0.5 mm`, `stated ${mm(statedSmallEnd)}`)
        )
      );
    }
  } else if (statedSmallEnd !== undefined && tan > 0) {
    length = (diameter - statedSmallEnd) / (2 * tan);
  } else {
    length = diameter / 2;
    notes.push(
      assumedNote(`Neither course length nor small end diameter stated — drawn ${mm(length)} long`, Sym.COURSE_LENGTH, mm(length))
    );
  }

  const smallEnd = diameter - 2 * length * tan;
  if (smallEnd <= 0) {
    throw new BuildError(
      component,
      `closes to a point before its ${mm(length)} length`,
      scope('out_of_scope', Sym.COURSE_LENGTH, `< ${mm(diameter / (2 * tan))}, where it closes`, mm(length))
    );
  }
  const a0 = diameter / 2;
  const a1 = smallEnd / 2;
  const cosA = Math.cos(alpha * DEG);
  const sinA = Math.sin(alpha * DEG);
  // Thickness is normal to the wall; across a horizontal section it reads t / cos α.
  const across = thickness / cosA;

  // §4.3.12: a knuckle at the large end and a flare at the small end, each tangent to the cone
  // and to the cylinder it meets, so that end of the part is a cylinder of D or D_S. Both are
  // inside radii: the knuckle's centre lies inside the vessel, the flare's outside it. Unstated,
  // the end is §4.3.11's sharp corner, at the cone's own section.
  const knuckle = optionalDimension(component, Sym.KNUCKLE_RADIUS);
  const flare = optionalDimension(component, Sym.FLARE_RADIUS);
  const halfTurn = Math.tan((alpha * DEG) / 2);
  const slant = length / cosA;
  for (const [symbol, radius, limit, what] of [
    [Sym.KNUCKLE_RADIUS, knuckle, a0, `${mm(a0)}, the large end's inside radius`],
    [Sym.FLARE_RADIUS, flare, thickness, `> ${mm(thickness)}, the wall, so the flare's outside has a radius`],
  ] as const) {
    if (radius === undefined) continue;
    if (symbol === Sym.KNUCKLE_RADIUS ? !(radius > 0 && radius < limit) : !(radius > limit)) {
      throw new BuildError(component, `cannot have a ${symbol.replace(/_/g, ' ')} of ${mm(radius)}`, scope('out_of_scope', symbol, symbol === Sym.KNUCKLE_RADIUS ? `> 0 and < ${what}` : what, mm(radius)));
    }
  }
  if (((knuckle ?? 0) + (flare ?? 0)) * halfTurn > slant) {
    throw new BuildError(
      component,
      `has a knuckle and a flare that meet before the cone does: ${mm(((knuckle ?? 0) + (flare ?? 0)) * halfTurn)} of its ${mm(slant)} slant`,
      scope('out_of_scope', 'knuckle and flare along the cone', `≤ ${mm(slant)}, the cone's slant length`, mm(((knuckle ?? 0) + (flare ?? 0)) * halfTurn))
    );
  }

  // In the part's frame z = 0 is its lower end. The cone's inside line runs between its two
  // virtual corners, where it would meet the cylinders were the ends sharp.
  const below = knuckle !== undefined ? knuckle * halfTurn : 0;
  const above = flare !== undefined ? flare * halfTurn : 0;
  const z0 = below;
  const z1 = below + length;
  const height = z1 + above;
  const insideAt = (z: number) => a0 - (z - z0) * tan;
  // The knuckle about (a0 − r_k, 0), the flare about (a1 + r_f, height); both turn through α.
  const kc: Point2 = [a0 - (knuckle ?? 0), 0];
  const fc: Point2 = [a1 + (flare ?? 0), height];
  const onKnuckle = (radius: number, angle: number): Point2 => [kc[0] + radius * Math.cos(angle), radius * Math.sin(angle)];
  const onFlare = (radius: number, angle: number): Point2 => [fc[0] - radius * Math.cos(angle), height - radius * Math.sin(angle)];
  const a = alpha * DEG;
  // Where the straight cone begins and ends, inside and outside.
  const coneLow = knuckle !== undefined ? onKnuckle(knuckle, a)[1] : 0;
  const coneHigh = flare !== undefined ? onFlare(flare, a)[1] : height;

  const outsideSteps: ProfileStep[] = [
    ...(knuckle !== undefined
      ? [line(a0 + thickness, 0), arc(onKnuckle(knuckle + thickness, a), onKnuckle(knuckle + thickness, a / 2))]
      : [line(a0 + across, 0)]),
    ...(flare !== undefined
      ? [line(...onFlare(flare - thickness, a)), arc([a1 + thickness, height], onFlare(flare - thickness, a / 2))]
      : [line(a1 + across, height)]),
  ];
  const insideDown: ProfileStep[] = [
    ...(flare !== undefined
      ? [line(a1, height), arc(onFlare(flare, a), onFlare(flare, a / 2))]
      : [line(a1, height)]),
    ...(knuckle !== undefined ? [line(...onKnuckle(knuckle, a)), arc([a0, 0], onKnuckle(knuckle, a / 2))] : []),
  ];
  const insideUp: ProfileStep[] = [
    ...(knuckle !== undefined ? [arc(onKnuckle(knuckle, a), onKnuckle(knuckle, a / 2))] : []),
    ...(flare !== undefined
      ? [line(...onFlare(flare, a)), arc([a1, height], onFlare(flare, a / 2))]
      : [line(a1, height)]),
  ];

  const margin = Math.min(height, a1) / 4;
  let cavity: ReturnType<RunContext['kernel']['revolve']> | undefined;
  const course: CourseShape = {
    halfApexAngle: alpha,
    thickness,
    insideRadiusAt: insideAt,
    outsideRadiusAt: (offset: number) => insideAt(offset) + across,
  };
  // The mid-surface's circumferential radius of curvature is its distance to the axis along
  // the normal: r / cos α.
  const surfaceAt = (offset: number): WallSurface => ({
    kind: 'cone',
    principalRadii: [null, (insideAt(offset) + across / 2) / cosA],
  });
  const upward: Point2 = [-sinA, cosA];

  // A knuckled or flared end is a cylinder's end: it meets its neighbour square, on D or D_S.
  const end = (side: 'lower' | 'upper'): Junction => {
    const curved = side === 'lower' ? knuckle !== undefined : flare !== undefined;
    const inside = side === 'lower' ? a0 : a1;
    const z = side === 'lower' ? 0 : height;
    if (curved) {
      return {
        insideDiameter: 2 * inside,
        outsideDiameter: 2 * (inside + thickness),
        wall: { surface: cylinderSurface(inside + thickness / 2), thickness, meridian: side === 'lower' ? DOWN : UP },
        straightLength: 0,
      };
    }
    return {
      insideDiameter: 2 * inside,
      outsideDiameter: 2 * (inside + across),
      wall: { surface: surfaceAt(z), thickness, meridian: side === 'lower' ? [sinA, -cosA] : upward },
    };
  };
  const lower = end('lower');
  const upper = end('upper');
  const tangent = (key: string, centreSide: 'knuckle' | 'flare', role: string): Landmark[] => {
    const at = (radius: number) => (centreSide === 'knuckle' ? onKnuckle(radius, a) : onFlare(radius, a));
    const inner = at(centreSide === 'knuckle' ? knuckle! : flare!);
    const outer = at(centreSide === 'knuckle' ? knuckle! + thickness : flare! - thickness);
    return [
      { key: `${key}-inside`, z: inner[1], diameter: 2 * inner[0], role: `${role} (inside)` },
      { key: `${key}-outside`, z: outer[1], diameter: 2 * outer[0], role: `${role} (outside)` },
    ];
  };

  return {
    solid: context.kernel.revolve({ start: [a0, 0], steps: [...outsideSteps, ...insideDown] }),
    height,
    lower,
    upper,
    landmarks: [
      ...junctionLandmarks('lower', 0, lower.insideDiameter, lower.outsideDiameter, knuckle !== undefined ? 'Large end, knuckle to cylinder' : 'Large end'),
      ...junctionLandmarks('upper', height, upper.insideDiameter, upper.outsideDiameter, flare !== undefined ? 'Small end, flare to cylinder' : 'Small end'),
      ...(knuckle !== undefined ? tangent('knuckle-cone', 'knuckle', 'Knuckle-to-cone tangent line') : []),
      ...(flare !== undefined ? tangent('flare-cone', 'flare', 'Flare-to-cone tangent line') : []),
    ],
    host: {
      anchor: 'shell_side',
      // A nozzle or a ring sits on the straight cone, never on the knuckle or the flare.
      offsetRange: [coneLow, coneHigh],
      defaultOffset: (coneLow + coneHigh) / 2,
      course,
      sideOf: courseSide(course),
      frameAt(offset: number, azimuth: number): HostFrame {
        const phi = azimuth * DEG;
        const r = insideAt(offset) + across;
        return {
          origin: [r * Math.cos(phi), r * Math.sin(phi), offset],
          axis: [cosA * Math.cos(phi), cosA * Math.sin(phi), sinA],
          wall: thickness,
        };
      },
      cavity() {
        cavity ??= context.kernel.revolve({
          start: [0, -margin],
          steps: [line(a0, -margin), line(a0, 0), ...insideUp, line(a1, height + margin), line(0, height + margin)],
        });
        return cavity;
      },
      wallAt: (offset) => ({ surface: surfaceAt(offset), thickness, meridian: upward }),
    },
    meridian: [
      ...(knuckle !== undefined ? arcPoints(kc, knuckle + thickness / 2, 0, a, 16) : [[a0 + across / 2, 0] as Point2]),
      ...(flare !== undefined
        ? arcPoints(fc, flare - thickness / 2, Math.PI + a, Math.PI, 16)
        : [[a1 + across / 2, height] as Point2]),
    ],
    notes,
  };
};

/**
 * A spherical course: a whole sphere on its own, and cut to meet its neighbours where it has
 * them — at the plane where its inside surface reaches the neighbour's opening, so the metal is
 * what is built and nothing more. The two walls then meet at an angle: a real discontinuity, not
 * a tangent one, which the ports report.
 */
export const sphericalShell: RunBuilder = (component, context) => {
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const a = diameter / 2;
  const outside = a + thickness;
  const mean = a + thickness / 2;

  const opening = (stated: number | undefined, where: string): number | undefined => {
    if (stated === undefined) return undefined;
    if (stated / 2 >= a) {
      throw new BuildError(
        component,
        `cannot meet the ${mm(stated)} opening ${where} it: a sphere of ${mm(diameter)} inside is no wider`,
        scope('out_of_scope', `inside diameter of the part ${where}`, `< ${mm(diameter)}, the sphere's`, mm(stated))
      );
    }
    return stated / 2;
  };
  const rb = opening(context.belowInsideDiameter, 'below');
  const ru = opening(context.aboveInsideDiameter, 'above');

  // The centre sits so that the lower cut — or the lower pole — is at z = 0.
  const c = rb !== undefined ? Math.sqrt(a * a - rb * rb) : outside;
  const zu = ru !== undefined ? c + Math.sqrt(a * a - ru * ru) : c + outside;
  const outsideAt = (z: number) => Math.sqrt(Math.max(0, outside * outside - (z - c) ** 2));
  const meanAt = (z: number) => Math.sqrt(Math.max(0, mean * mean - (z - c) ** 2));

  const bottomOutside: Point2 = rb !== undefined ? [outsideAt(0), 0] : [0, 0];
  const topOutside: Point2 = ru !== undefined ? [outsideAt(zu), zu] : [0, c + outside];
  const bottomInside: Point2 = rb !== undefined ? [rb, 0] : [0, c - a];
  const steps: ProfileStep[] = [
    ...(rb !== undefined ? [line(bottomOutside[0], 0)] : []),
    arc(topOutside, [outside, c]),
    ru !== undefined ? line(ru, zu) : line(0, c + a),
    arc(bottomInside, [a, c]),
  ];

  const surface = sphereSurface(mean);
  const end = (z: number, r: number, side: 'lower' | 'upper') => {
    const rel = z - c;
    const away: Point2 = side === 'lower' ? [rel / mean, -meanAt(z) / mean] : [-rel / mean, meanAt(z) / mean];
    return {
      insideDiameter: 2 * r,
      outsideDiameter: 2 * outsideAt(z),
      wall: { surface, thickness, meridian: away },
    };
  };
  const lower = rb !== undefined ? end(0, rb, 'lower') : null;
  const upper = ru !== undefined ? end(zu, ru, 'upper') : null;

  // The mid-surface meridian, from the lower cut or pole to the upper one.
  const angleOf = (z: number) => Math.asin(Math.max(-1, Math.min(1, (z - c) / mean)));
  const from = rb !== undefined ? angleOf(0) : -Math.PI / 2;
  const to = ru !== undefined ? angleOf(zu) : Math.PI / 2;

  return {
    solid: context.kernel.revolve({ start: rb !== undefined ? [rb, 0] : [0, 0], steps }),
    height: ru !== undefined ? zu : c + outside,
    lower,
    upper,
    landmarks: [
      { key: 'equator-inside', z: c, diameter, role: 'Equator (inside)' },
      { key: 'equator-outside', z: c, diameter: 2 * outside, role: 'Equator (outside)' },
      ...(lower ? junctionLandmarks('lower', 0, lower.insideDiameter, lower.outsideDiameter, 'Sphere opening') : []),
      ...(upper ? junctionLandmarks('upper', zu, upper.insideDiameter, upper.outsideDiameter, 'Sphere opening') : []),
    ],
    host: sphereHost(context, a, outside, c, ru ?? 0),
    meridian: arcPoints([0, c], mean, from, to, 48),
    notes: [],
  };
};

/**
 * The upper half of a sphere, as a host. Like a head's crown, the offset is the distance from
 * the vessel axis; unlike it, what stands there is normal to the surface — §4.5.10's radial
 * nozzle in a sphere.
 */
function sphereHost(
  context: RunContext,
  inside: number,
  outside: number,
  centre: number,
  topOpening: number
): HostSurface {
  let cavity: ReturnType<RunContext['kernel']['revolve']> | undefined;
  const mean = (inside + outside) / 2;
  return {
    anchor: 'head_crown',
    // Cut to meet a neighbour above, its upper half keeps only the ring outside that opening.
    offsetRange: [topOpening, inside],
    defaultOffset: topOpening > 0 ? (topOpening + inside) / 2 : 0,
    frameAt(rho: number, azimuth: number): HostFrame {
      const phi = azimuth * DEG;
      const up = Math.sqrt(Math.max(0, outside * outside - rho * rho));
      return {
        origin: [rho * Math.cos(phi), rho * Math.sin(phi), centre + up],
        axis: [(rho / outside) * Math.cos(phi), (rho / outside) * Math.sin(phi), up / outside],
        wall: outside - inside,
      };
    },
    cavity() {
      cavity ??= context.kernel.revolve({
        start: [0, centre - inside],
        steps: [arc([0, centre + inside], [inside, centre])],
      });
      return cavity;
    },
    sideOf(point) {
      const distance = Math.hypot(point[0], point[1], point[2] - centre);
      return Math.abs(distance - outside) < Math.abs(distance - inside) ? 'outside' : 'inside';
    },
    wallAt(rho: number): WallAt {
      const up = Math.sqrt(Math.max(0, outside * outside - rho * rho));
      return { surface: sphereSurface(mean), thickness: outside - inside, meridian: [up / outside, -rho / outside] };
    },
  };
}

export const hemisphericalHead: RunBuilder = (component, context) => {
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const a = diameter / 2;
  const outside = a + thickness;
  const s = Math.SQRT1_2;
  const surface = sphereSurface(a + thickness / 2);

  return formedHead(component, context, a, thickness, {
    outside: [arc([0, outside], [outside * s, outside * s])],
    insideTop: a,
    inside: [arc([a, 0], [a * s, a * s])],
    insideUp: [arc([0, a], [a * s, a * s])],
    zInside: (rho) => (rho < a ? Math.sqrt(a * a - rho * rho) : 0),
    zOutside: (rho) => Math.sqrt(Math.max(0, outside * outside - rho * rho)),
    surfaceAt: () => surface,
    tangentSurface: surface,
    meridian: arcPoints([0, 0], a + thickness / 2, 0, Math.PI / 2),
    height: outside,
    landmarks: [],
    notes: [],
  });
};

/**
 * A torispherical head: a crown of radius `L` joined to the tangent line by a knuckle of
 * radius `r`, both measured inside. The outside surface is their offset by `t`.
 */
export const torisphericalHead: RunBuilder = (component, context) => {
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const crown = requireDimension(component, Sym.CROWN_RADIUS);
  const knuckle = requireDimension(component, Sym.KNUCKLE_RADIUS);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const a = diameter / 2;

  if (knuckle >= a) {
    throw new BuildError(
      component,
      `has a knuckle radius (${mm(knuckle)}) as large as its radius`,
      scope('out_of_scope', Sym.KNUCKLE_RADIUS, `< ${mm(a)}, the inside radius`, mm(knuckle))
    );
  }
  if (crown <= a) {
    throw new BuildError(
      component,
      `has a crown radius (${mm(crown)}) no larger than its radius (${mm(a)}) — no crown meets the knuckle`,
      scope('out_of_scope', Sym.CROWN_RADIUS, `> ${mm(a)}, the inside radius`, mm(crown))
    );
  }

  // Knuckle centre on the tangent line, crown centre on the axis below it.
  const xc = a - knuckle;
  const zc = -Math.sqrt((crown - knuckle) ** 2 - xc ** 2);
  const beta = Math.atan2(-zc, xc);

  const onKnuckle = (radius: number, angle: number): Point2 => [
    xc + radius * Math.cos(angle),
    radius * Math.sin(angle),
  ];
  const onCrown = (radius: number, angle: number): Point2 => [
    radius * Math.cos(angle),
    zc + radius * Math.sin(angle),
  ];
  const crownMiddle = (beta + Math.PI / 2) / 2;
  const outsideKnuckle = knuckle + thickness;
  const outsideCrown = crown + thickness;

  const insideTangent = onKnuckle(knuckle, beta);
  const outsideTangent = onKnuckle(outsideKnuckle, beta);

  const zOf = (rho: number, crownRadius: number, knuckleRadius: number): number =>
    rho <= xc + knuckleRadius * Math.cos(beta)
      ? zc + Math.sqrt(crownRadius ** 2 - rho ** 2)
      : Math.sqrt(Math.max(0, knuckleRadius ** 2 - (rho - xc) ** 2));

  // The mid-surface: a sphere over the crown, a torus over the knuckle, whose circumferential
  // radius is the distance to the axis along the normal.
  const meanKnuckle = knuckle + thickness / 2;
  const meanCrown = crown + thickness / 2;
  const surfaceAt = (rho: number): WallSurface => {
    if (rho <= xc + meanKnuckle * Math.cos(beta)) return sphereSurface(meanCrown);
    const cos = Math.min(1, Math.max(1e-9, (rho - xc) / meanKnuckle));
    return { kind: 'torus', principalRadii: [meanKnuckle, rho / cos] };
  };

  return formedHead(component, context, a, thickness, {
    outside: [
      arc(outsideTangent, onKnuckle(outsideKnuckle, beta / 2)),
      arc([0, zc + outsideCrown], onCrown(outsideCrown, crownMiddle)),
    ],
    insideTop: zc + crown,
    inside: [arc(insideTangent, onCrown(crown, crownMiddle)), arc([a, 0], onKnuckle(knuckle, beta / 2))],
    insideUp: [arc(insideTangent, onKnuckle(knuckle, beta / 2)), arc([0, zc + crown], onCrown(crown, crownMiddle))],
    zInside: (rho) => zOf(rho, crown, knuckle),
    zOutside: (rho) => zOf(rho, outsideCrown, outsideKnuckle),
    surfaceAt,
    tangentSurface: { kind: 'torus', principalRadii: [meanKnuckle, a + thickness / 2] },
    // The knuckle's mid-surface up to where the crown takes over, then the crown's.
    meridian: [
      ...arcPoints([xc, 0], meanKnuckle, 0, beta, 16),
      ...arcPoints([0, zc], meanCrown, beta, Math.PI / 2, 32).slice(1),
    ],
    height: zc + outsideCrown,
    landmarks: [
      {
        key: 'crown-knuckle-inside',
        z: insideTangent[1],
        diameter: 2 * insideTangent[0],
        role: 'Crown-to-knuckle tangent line (inside)',
      },
      {
        key: 'crown-knuckle-outside',
        z: outsideTangent[1],
        diameter: 2 * outsideTangent[0],
        role: 'Crown-to-knuckle tangent line (outside)',
      },
    ],
    notes: [],
  });
};

/**
 * An ellipsoidal head of inside height `h`, whose outside is the true offset of its inside by
 * `t`. That offset is not an ellipse — the ellipse of semi-axes `a + t` and `h + t` leaves the
 * wall thinner than `t` over the knuckle — so it is drawn as one Bézier fitted to the exact
 * offset curve, the fit's error being measured and held to a millionth of the head's size.
 */
export const ellipsoidalHead: RunBuilder = (component, context) => {
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const height = requireDimension(component, Sym.HEAD_HEIGHT);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const a = diameter / 2;

  const outside = ellipseOffset(a, height, thickness);
  const tolerance = Math.max(1e-4, 1e-6 * (a + height));
  let fit = fitBezier(outside.curve, 0, Math.PI / 2, 9);
  for (let degree = 11; fit.error > tolerance && degree <= 21; degree += 2) {
    fit = fitBezier(outside.curve, 0, Math.PI / 2, degree);
  }
  const notes: Note[] =
    fit.error > tolerance
      ? [
          representedNote(
            `Outside surface drawn within ${mm(fit.error)} of the true offset of the inside`,
            'outside surface',
            `the true offset of the inside, within ${mm(tolerance)}`,
            `a Bézier fit within ${mm(fit.error)}`
          ),
        ]
      : [];

  // On the inside ellipse x = a·cos u, z = h·sin u the principal radii are
  // R1 = (a²sin²u + h²cos²u)^1.5 / (a·h) and R2 = a·sqrt(h²cos²u + a²sin²u) / h. An offset
  // surface shares its centres of curvature, so the mid-surface's are both larger by t/2.
  const radiiAt = (u: number): WallSurface => {
    const q = a * a * Math.sin(u) ** 2 + height * height * Math.cos(u) ** 2;
    return {
      kind: 'ellipsoid',
      principalRadii: [q ** 1.5 / (a * height) + thickness / 2, (a * Math.sqrt(q)) / height + thickness / 2],
    };
  };
  const middle = ellipseOffset(a, height, thickness / 2);

  return formedHead(component, context, a, thickness, {
    outside: [{ kind: 'bezier', to: [0, height + thickness], controls: fit.controls.slice(1, -1) }],
    insideTop: height,
    inside: [{ kind: 'ellipse', to: [a, 0], radiusR: a, radiusZ: height, counterClockwise: false }],
    insideUp: [{ kind: 'ellipse', to: [0, height], radiusR: a, radiusZ: height, counterClockwise: true }],
    zInside: (rho) => (rho < a ? height * Math.sqrt(1 - (rho / a) ** 2) : 0),
    zOutside: (rho) => (rho < a + thickness ? outside.curve.point(outside.parameterAt(rho))[1] : 0),
    surfaceAt: (rho) => radiiAt(outside.parameterAt(rho)),
    tangentSurface: radiiAt(0),
    meridian: Array.from({ length: 49 }, (_, i) => middle.curve.point((Math.PI / 2) * (i / 48))),
    height: height + thickness,
    landmarks: [],
    notes,
  });
};

/** A flat end: a plate of thickness `t`, drawn to the outside diameter of what it closes. */
export const flatHead: RunBuilder = (component, context) => {
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const a = diameter / 2;
  const rim = Math.max(a, context.neighbourOutsideRadius ?? a);

  return {
    solid: context.kernel.revolve({
      start: [0, 0],
      steps: [line(rim, 0), line(rim, thickness), line(0, thickness)],
    }),
    height: thickness,
    // The plate's mid-surface runs out to its rim.
    lower: { insideDiameter: diameter, outsideDiameter: 2 * rim, wall: { surface: PLANE, thickness, meridian: [1, 0] } },
    upper: null,
    landmarks: [
      { key: 'lower-rim', z: 0, diameter: 2 * rim, role: 'Plate rim (inner face)', junction: 'lower' },
      { key: 'upper-rim', z: thickness, diameter: 2 * rim, role: 'Plate rim (outer face)' },
    ],
    host: headCrownHost(
      context,
      a,
      thickness,
      () => 0,
      () => thickness,
      () => cavityProfile(a, a / 4, [line(0, 0)]),
      () => PLANE
    ),
    // The plate's mid-plane, from over the wall it closes in to the axis.
    meridian: [
      [(a + rim) / 2, thickness / 2],
      [0, thickness / 2],
    ],
    notes: [],
  };
};

/**
 * A bolted flange: a ring of bore `B`, outside diameter `A` and thickness `t`, with its hub
 * when `g1` and `h` are stated. The hub faces the course the flange is welded to.
 */
export const flange: RunBuilder = (component, context) => {
  const bore = requireDimension(component, Sym.FLANGE_BORE);
  const outsideDiameter = requireDimension(component, Sym.FLANGE_OUTSIDE_DIAMETER);
  const thickness = requireDimension(component, Sym.THICKNESS);
  if (outsideDiameter <= bore) {
    throw new BuildError(
      component,
      `has an outside diameter no larger than its bore`,
      scope('out_of_scope', Sym.FLANGE_OUTSIDE_DIAMETER, `> ${mm(bore)}, the bore`, mm(outsideDiameter))
    );
  }
  const hubLarge = optionalDimension(component, Sym.HUB_LARGE_END_THICKNESS);
  const hubLength = optionalDimension(component, Sym.HUB_LENGTH);
  const hubSmall = optionalDimension(component, Sym.HUB_SMALL_END_THICKNESS) ?? hubLarge;

  const b = bore / 2;
  const A = outsideDiameter / 2;
  const hasHub = hubLarge !== undefined && hubLength !== undefined && hubSmall !== undefined;
  const height = thickness + (hasHub ? hubLength : 0);

  const steps: ProfileStep[] = [line(A, 0), line(A, thickness)];
  if (hasHub) {
    steps.push(line(b + hubLarge, thickness), line(b + hubSmall, height));
  }
  steps.push(line(b, height));

  let solid = context.kernel.revolve({ start: [b, 0], steps });
  const hubDown = hasHub && context.hubDown === true;
  if (hubDown) {
    solid = context.kernel.translate(context.kernel.flip(solid), [0, 0, height]);
  }

  // The ring's face is bolted; the hub's small end is welded to its course.
  const ringEnd = (meridian: Point2) => ({
    insideDiameter: bore,
    outsideDiameter,
    face: true,
    wall: { surface: PLANE, thickness: A - b, meridian },
  });
  const hubEnd = (meridian: Point2) =>
    hasHub
      ? {
          insideDiameter: bore,
          outsideDiameter: bore + 2 * hubSmall,
          wall: { surface: cylinderSurface(b + hubSmall / 2), thickness: hubSmall, meridian },
        }
      : ringEnd(meridian);
  const lower = hubDown ? hubEnd(DOWN) : ringEnd(DOWN);
  const upper = hubDown ? ringEnd(UP) : hubEnd(UP);

  const notes: Note[] = [];
  if (!hasHub && component.kind === 'integral_flange') {
    notes.push(assumedNote('No hub stated — drawn as a plain ring', Sym.HUB_LARGE_END_THICKNESS, 'no hub, a plain ring'));
  }
  if (component.dimensions[Sym.BOLT_COUNT] !== undefined) {
    notes.push(
      notBuiltNote('Its bolt holes are not drawn', Sym.BOLT_COUNT, `${component.dimensions[Sym.BOLT_COUNT]} bolts`, component.kind, true)
    );
  }

  return {
    solid,
    height,
    lower,
    upper,
    landmarks: [
      ...junctionLandmarks('lower', 0, bore, lower.outsideDiameter, 'Flange face'),
      ...junctionLandmarks('upper', height, bore, upper.outsideDiameter, 'Flange face'),
    ],
    meridian: [
      [(bore + lower.outsideDiameter) / 4, 0],
      [(bore + upper.outsideDiameter) / 4, height],
    ],
    notes,
  };
};

/** The run builders, by `ComponentType` wire value. A kind absent here is not drawn yet. */
export const RUN_BUILDERS: Readonly<Record<string, RunBuilder>> = {
  cylindrical_shell: cylindricalShell,
  conical_shell: conicalShell,
  spherical_shell: sphericalShell,
  hemispherical_head: hemisphericalHead,
  torispherical_head: torisphericalHead,
  ellipsoidal_head: ellipsoidalHead,
  flat_head: flatHead,
  integral_flange: flange,
  loose_flange: flange,
  spherically_dished_cover: sphericallyDishedCover,
  dished_cover_type_b: dishedCoverTypeB,
  dished_cover_type_c: dishedCoverTypeC,
  quick_actuating_closure: quickActuatingClosure,
  stayed_surface: stayedSurface,
  rectangular_vessel: rectangularVessel,
  obround_vessel: obroundVessel,
  octagonal_vessel: octagonalVessel,
  dished_cover_type_d: dishedCoverTypeD,
  clamped_connection: clampedConnection,
  ...CONVOLUTED_BUILDERS,
  ...TUBESHEET_BUILDERS,
};

export function isRunKindDrawn(component: ComponentDefinition): boolean {
  return component.kind in RUN_BUILDERS;
}
