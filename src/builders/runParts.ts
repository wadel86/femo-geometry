// Builders for the parts of the axial run: courses, heads, flat ends, flanges.
//
// Every one works in the part's own frame: the vessel axis is Z, the part's lower junction sits
// at z = 0 and it extends upwards. A head is built crown up, tangent line at z = 0; the assembly
// turns it over when it closes the bottom of the run.
import {
  BuildError,
  Sym,
  analysisNote,
  note,
  optionalDimension,
  requireDimension,
  signedDimension,
  type ComponentDefinition,
  type Note,
} from '../definition.ts';
import type { Point2, Profile, ProfileStep } from '../kernel/GeometryKernel.ts';
import {
  dishedCoverTypeB,
  dishedCoverTypeC,
  quickActuatingClosure,
  sphericallyDishedCover,
  stayedSurface,
} from './covers.ts';
import { dividingPlates, obroundVessel, rectangularVessel } from './special.ts';
import type {
  CourseShape,
  HostFrame,
  HostSurface,
  Landmark,
  RunBuilder,
  RunContext,
  WallAt,
  WallSurface,
} from './types.ts';
import { PLANE, cylinderSurface, sphereSurface } from './walls.ts';

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

/**
 * A formed head says nothing of a straight flange until `SF` is stated, and a weld drawn on the
 * tangent line sits on the discontinuity rather than clear of it: harmless on screen, wrong
 * under a mesh. Zero is an answer — a head welded straight on.
 */
function straightFlangeNotes(component: ComponentDefinition): Note[] {
  const length = signedDimension(component, Sym.STRAIGHT_FLANGE_LENGTH);
  if (length === undefined) {
    return [
      analysisNote(
        'Straight flange length not stated — drawn without one, so the head-to-shell weld sits on the tangent line',
        Sym.STRAIGHT_FLANGE_LENGTH
      ),
    ];
  }
  if (length > 0) {
    return [
      note(
        `A straight flange of ${mm(length)} is stated but not drawn yet — the head-to-shell weld is drawn on the tangent line`,
        Sym.STRAIGHT_FLANGE_LENGTH
      ),
    ];
  }
  return [];
}

function headCrownHost(
  context: RunContext,
  insideRadius: number,
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
      // The slope of the mid-surface, by a central difference kept inside the crown.
      const h = Math.max(1e-6, 1e-4 * insideRadius);
      const low = Math.max(0, rho - h);
      const high = Math.min(insideRadius, rho + h);
      const slope = high > low ? (middle(high) - middle(low)) / (high - low) : 0;
      const length = Math.hypot(1, slope);
      return {
        surface: surfaceAt(rho),
        thickness: (zOutside(rho) - zInside(rho)) / length,
        meridian: [1 / length, slope / length],
      };
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
    notes.push(note(`Course length not stated — drawn ${mm(length)} long`, Sym.COURSE_LENGTH));
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
    throw new BuildError(component, `has a half-apex angle of ${alpha}°, a cone needs less than 90°`);
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
          Sym.SMALL_END_DIAMETER
        )
      );
    }
  } else if (statedSmallEnd !== undefined && tan > 0) {
    length = (diameter - statedSmallEnd) / (2 * tan);
  } else {
    length = diameter / 2;
    notes.push(note(`Neither course length nor small end diameter stated — drawn ${mm(length)} long`, Sym.COURSE_LENGTH));
  }

  const smallEnd = diameter - 2 * length * tan;
  if (smallEnd <= 0) {
    throw new BuildError(component, `closes to a point before its ${mm(length)} length`);
  }

  const a0 = diameter / 2;
  const a1 = smallEnd / 2;
  const cosA = Math.cos(alpha * DEG);
  const sinA = Math.sin(alpha * DEG);
  // Thickness is normal to the wall; across a horizontal section it reads t / cos α.
  const across = thickness / cosA;
  const margin = Math.min(length, a1) / 4;
  let cavity: ReturnType<RunContext['kernel']['revolve']> | undefined;
  const course: CourseShape = {
    halfApexAngle: alpha,
    thickness,
    insideRadiusAt: (offset: number) => a0 - offset * tan,
    outsideRadiusAt: (offset: number) => a0 - offset * tan + across,
  };
  // The mid-surface's circumferential radius of curvature is its distance to the axis along
  // the normal: r / cos α.
  const surfaceAt = (offset: number): WallSurface => ({
    kind: 'cone',
    principalRadii: [null, (a0 - offset * tan + across / 2) / cosA],
  });
  const upward: Point2 = [-sinA, cosA];

  return {
    solid: context.kernel.revolve({
      start: [a0, 0],
      steps: [line(a0 + across, 0), line(a1 + across, length), line(a1, length)],
    }),
    height: length,
    lower: {
      insideDiameter: diameter,
      outsideDiameter: 2 * (a0 + across),
      wall: { surface: surfaceAt(0), thickness, meridian: [sinA, -cosA] },
    },
    upper: {
      insideDiameter: smallEnd,
      outsideDiameter: 2 * (a1 + across),
      wall: { surface: surfaceAt(length), thickness, meridian: upward },
    },
    landmarks: [
      ...junctionLandmarks('lower', 0, diameter, 2 * (a0 + across), 'Large end'),
      ...junctionLandmarks('upper', length, smallEnd, 2 * (a1 + across), 'Small end'),
    ],
    host: {
      anchor: 'shell_side',
      offsetRange: [0, length],
      defaultOffset: length / 2,
      course,
      sideOf: courseSide(course),
      frameAt(offset: number, azimuth: number): HostFrame {
        const phi = azimuth * DEG;
        const r = a0 - offset * tan + across;
        return {
          origin: [r * Math.cos(phi), r * Math.sin(phi), offset],
          axis: [cosA * Math.cos(phi), cosA * Math.sin(phi), sinA],
          wall: thickness,
        };
      },
      cavity() {
        cavity ??= context.kernel.revolve({
          start: [0, -margin],
          steps: [
            line(a0, -margin),
            line(a0, 0),
            line(a1, length),
            line(a1, length + margin),
            line(0, length + margin),
          ],
        });
        return cavity;
      },
      wallAt: (offset) => ({ surface: surfaceAt(offset), thickness, meridian: upward }),
    },
    notes,
  };
};

/** A whole sphere: a spherical course has no open end for a neighbour to meet. */
export const sphericalShell: RunBuilder = (component, context) => {
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const a = diameter / 2;
  const outside = a + thickness;
  const c = outside;
  const between = context.neighbourOutsideRadius !== undefined || context.neighbourInsideDiameter !== undefined;

  return {
    solid: context.kernel.revolve({
      start: [0, 0],
      steps: [
        arc([0, 2 * c], [outside, c]),
        line(0, c + a),
        arc([0, c - a], [a, c]),
      ],
    }),
    height: 2 * outside,
    lower: null,
    upper: null,
    landmarks: [
      { key: 'equator-inside', z: c, diameter, role: 'Equator (inside)' },
      { key: 'equator-outside', z: c, diameter: 2 * outside, role: 'Equator (outside)' },
    ],
    host: sphereHost(context, a, outside, c),
    notes: between
      ? [analysisNote('Drawn as a whole sphere, not joined to its neighbours — the metal where they meet is invented')]
      : [],
  };
};

/**
 * The upper half of a sphere, as a host. Like a head's crown, the offset is the distance from
 * the vessel axis; unlike it, what stands there is normal to the surface — §4.5.10's radial
 * nozzle in a sphere.
 */
function sphereHost(context: RunContext, inside: number, outside: number, centre: number): HostSurface {
  let cavity: ReturnType<RunContext['kernel']['revolve']> | undefined;
  const mean = (inside + outside) / 2;
  return {
    anchor: 'head_crown',
    offsetRange: [0, inside],
    defaultOffset: 0,
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

  return {
    solid: context.kernel.revolve({
      start: [a, 0],
      steps: [
        line(outside, 0),
        arc([0, outside], [outside * s, outside * s]),
        line(0, a),
        arc([a, 0], [a * s, a * s]),
      ],
    }),
    height: outside,
    lower: { insideDiameter: diameter, outsideDiameter: 2 * outside, wall: { surface, thickness, meridian: DOWN } },
    upper: null,
    landmarks: junctionLandmarks('lower', 0, diameter, 2 * outside, 'Tangent line'),
    host: headCrownHost(
      context,
      a,
      (rho) => (rho < a ? Math.sqrt(a * a - rho * rho) : 0),
      (rho) => Math.sqrt(outside * outside - rho * rho),
      () => cavityProfile(a, a / 4, [arc([0, a], [a * s, a * s])]),
      () => surface
    ),
    notes: straightFlangeNotes(component),
  };
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
    throw new BuildError(component, `has a knuckle radius (${mm(knuckle)}) as large as its radius`);
  }
  if (crown <= a) {
    throw new BuildError(
      component,
      `has a crown radius (${mm(crown)}) no larger than its radius (${mm(a)}) — no crown meets the knuckle`
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

  return {
    solid: context.kernel.revolve({
      start: [a, 0],
      steps: [
        line(a + thickness, 0),
        arc(outsideTangent, onKnuckle(outsideKnuckle, beta / 2)),
        arc([0, zc + outsideCrown], onCrown(outsideCrown, crownMiddle)),
        line(0, zc + crown),
        arc(insideTangent, onCrown(crown, crownMiddle)),
        arc([a, 0], onKnuckle(knuckle, beta / 2)),
      ],
    }),
    height: zc + outsideCrown,
    lower: {
      insideDiameter: diameter,
      outsideDiameter: diameter + 2 * thickness,
      wall: {
        surface: { kind: 'torus', principalRadii: [meanKnuckle, a + thickness / 2] },
        thickness,
        meridian: DOWN,
      },
    },
    upper: null,
    landmarks: [
      ...junctionLandmarks('lower', 0, diameter, diameter + 2 * thickness, 'Tangent line'),
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
    host: headCrownHost(
      context,
      a,
      (rho) => zOf(rho, crown, knuckle),
      (rho) => zOf(rho, outsideCrown, outsideKnuckle),
      () =>
        cavityProfile(a, a / 4, [
          arc(insideTangent, onKnuckle(knuckle, beta / 2)),
          arc([0, zc + crown], onCrown(crown, crownMiddle)),
        ]),
      surfaceAt
    ),
    notes: straightFlangeNotes(component),
  };
};

/**
 * An ellipsoidal head of inside height `h`. The outside is drawn as the ellipse of semi-axes
 * `a + t` and `h + t`: the true offset of an ellipse is not an ellipse, and at the proportions
 * of a pressure head the two differ by far less than the plate.
 */
export const ellipsoidalHead: RunBuilder = (component, context) => {
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const height = requireDimension(component, Sym.HEAD_HEIGHT);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const a = diameter / 2;
  const ao = a + thickness;
  const ho = height + thickness;

  // The mid-surface, x = A·cos u, z = B·sin u: R1 = (A²sin²u + B²cos²u)^1.5 / (A·B) along the
  // meridian, R2 = A·sqrt(B²cos²u + A²sin²u) / B round it.
  const A = a + thickness / 2;
  const B = height + thickness / 2;
  const surfaceAt = (rho: number): WallSurface => {
    const cos = Math.min(1, rho / A);
    const sin2 = 1 - cos * cos;
    const q = A * A * sin2 + B * B * cos * cos;
    return { kind: 'ellipsoid', principalRadii: [q ** 1.5 / (A * B), (A * Math.sqrt(q)) / B] };
  };

  const insideArc: ProfileStep = {
    kind: 'ellipse',
    to: [a, 0],
    radiusR: a,
    radiusZ: height,
    counterClockwise: false,
  };

  return {
    solid: context.kernel.revolve({
      start: [a, 0],
      steps: [
        line(ao, 0),
        { kind: 'ellipse', to: [0, ho], radiusR: ao, radiusZ: ho, counterClockwise: true },
        line(0, height),
        insideArc,
      ],
    }),
    height: ho,
    lower: { insideDiameter: diameter, outsideDiameter: 2 * ao, wall: { surface: surfaceAt(A), thickness, meridian: DOWN } },
    upper: null,
    landmarks: junctionLandmarks('lower', 0, diameter, 2 * ao, 'Tangent line'),
    host: headCrownHost(
      context,
      a,
      (rho) => (rho < a ? height * Math.sqrt(1 - (rho / a) ** 2) : 0),
      (rho) => ho * Math.sqrt(Math.max(0, 1 - (rho / ao) ** 2)),
      () =>
        cavityProfile(a, a / 4, [
          { kind: 'ellipse', to: [0, height], radiusR: a, radiusZ: height, counterClockwise: true },
        ]),
      surfaceAt
    ),
    notes: [
      note('Outside surface drawn as the ellipse of semi-axes a + t and h + t, so the wall is not t thick all over'),
      ...straightFlangeNotes(component),
    ],
  };
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
      () => 0,
      () => thickness,
      () => cavityProfile(a, a / 4, [line(0, 0)]),
      () => PLANE
    ),
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
    throw new BuildError(component, `has an outside diameter no larger than its bore`);
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
    notes.push(note('No hub stated — drawn as a plain ring', Sym.HUB_LARGE_END_THICKNESS));
  }
  if (component.dimensions[Sym.BOLT_COUNT] !== undefined) {
    notes.push(analysisNote('Its bolt holes are not drawn', Sym.BOLT_COUNT));
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
};

export function isRunKindDrawn(component: ComponentDefinition): boolean {
  return component.kind in RUN_BUILDERS;
}
