// Builders for the parts of the axial run: courses, heads, flat ends, flanges.
//
// Every one works in the part's own frame: the vessel axis is Z, the part's lower junction sits
// at z = 0 and it extends upwards. A head is built crown up, tangent line at z = 0; the assembly
// turns it over when it closes the bottom of the run.
import {
  BuildError,
  Sym,
  optionalDimension,
  requireDimension,
  type ComponentDefinition,
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
import type { CourseShape, HostFrame, HostSurface, Landmark, RunBuilder, RunContext } from './types.ts';

const DEG = Math.PI / 180;

const line = (r: number, z: number): ProfileStep => ({ kind: 'line', to: [r, z] });

const arc = (to: Point2, through: Point2): ProfileStep => ({ kind: 'arc', to, through });

const mm = (value: number): string => `${Number(value.toPrecision(5))} mm`;

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

function headCrownHost(
  context: RunContext,
  insideRadius: number,
  zInside: (rho: number) => number,
  zOutside: (rho: number) => number,
  cavity: () => Profile
): HostSurface {
  let cached: ReturnType<RunContext['kernel']['revolve']> | undefined;
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
  const notes: string[] = [];

  let length = optionalDimension(component, Sym.COURSE_LENGTH);
  if (length === undefined) {
    length = diameter;
    notes.push(`Course length not stated — drawn ${mm(length)} long`);
  }

  const a = diameter / 2;
  const outside = a + thickness;
  let cavity: ReturnType<RunContext['kernel']['revolve']> | undefined;
  const course: CourseShape = {
    halfApexAngle: 0,
    thickness,
    insideRadiusAt: () => a,
    outsideRadiusAt: () => outside,
  };
  // §4.12 Type 12: a circular course divided into two chambers by a stay plate.
  const { plates, note } = dividingPlates(component, context.kernel, a, length);
  if (note) notes.push(note);

  return {
    solid: context.kernel.revolve({
      start: [a, 0],
      steps: [line(outside, 0), line(outside, length), line(a, length)],
    }),
    extraSolids: plates,
    height: length,
    lower: { insideDiameter: diameter, outsideDiameter: 2 * outside },
    upper: { insideDiameter: diameter, outsideDiameter: 2 * outside },
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
  const notes: string[] = [];

  const statedLength = optionalDimension(component, Sym.COURSE_LENGTH);
  const statedSmallEnd = optionalDimension(component, Sym.SMALL_END_DIAMETER);
  let length: number;
  if (statedLength !== undefined) {
    length = statedLength;
    const derived = diameter - 2 * length * tan;
    if (statedSmallEnd !== undefined && Math.abs(derived - statedSmallEnd) > 0.5) {
      notes.push(
        `Small end stated as ${mm(statedSmallEnd)} but D, α and Lc give ${mm(derived)} — drawn from Lc`
      );
    }
  } else if (statedSmallEnd !== undefined && tan > 0) {
    length = (diameter - statedSmallEnd) / (2 * tan);
  } else {
    length = diameter / 2;
    notes.push(`Neither course length nor small end diameter stated — drawn ${mm(length)} long`);
  }

  const smallEnd = diameter - 2 * length * tan;
  if (smallEnd <= 0) {
    throw new BuildError(component, `closes to a point before its ${mm(length)} length`);
  }

  const a0 = diameter / 2;
  const a1 = smallEnd / 2;
  // Thickness is normal to the wall; across a horizontal section it reads t / cos α.
  const across = thickness / Math.cos(alpha * DEG);
  const margin = Math.min(length, a1) / 4;
  let cavity: ReturnType<RunContext['kernel']['revolve']> | undefined;
  const course: CourseShape = {
    halfApexAngle: alpha,
    thickness,
    insideRadiusAt: (offset: number) => a0 - offset * tan,
    outsideRadiusAt: (offset: number) => a0 - offset * tan + across,
  };

  return {
    solid: context.kernel.revolve({
      start: [a0, 0],
      steps: [line(a0 + across, 0), line(a1 + across, length), line(a1, length)],
    }),
    height: length,
    lower: { insideDiameter: diameter, outsideDiameter: 2 * (a0 + across) },
    upper: { insideDiameter: smallEnd, outsideDiameter: 2 * (a1 + across) },
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
        const cosA = Math.cos(alpha * DEG);
        const sinA = Math.sin(alpha * DEG);
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
    notes: [],
  };
};

/**
 * The upper half of a sphere, as a host. Like a head's crown, the offset is the distance from
 * the vessel axis; unlike it, what stands there is normal to the surface — §4.5.10's radial
 * nozzle in a sphere.
 */
function sphereHost(context: RunContext, inside: number, outside: number, centre: number): HostSurface {
  let cavity: ReturnType<RunContext['kernel']['revolve']> | undefined;
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
  };
}

export const hemisphericalHead: RunBuilder = (component, context) => {
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const a = diameter / 2;
  const outside = a + thickness;
  const s = Math.SQRT1_2;

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
    lower: { insideDiameter: diameter, outsideDiameter: 2 * outside },
    upper: null,
    landmarks: junctionLandmarks('lower', 0, diameter, 2 * outside, 'Tangent line'),
    host: headCrownHost(
      context,
      a,
      (rho) => (rho < a ? Math.sqrt(a * a - rho * rho) : 0),
      (rho) => Math.sqrt(outside * outside - rho * rho),
      () => cavityProfile(a, a / 4, [arc([0, a], [a * s, a * s])])
    ),
    notes: [],
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
    lower: { insideDiameter: diameter, outsideDiameter: diameter + 2 * thickness },
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
        ])
    ),
    notes: [],
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
    lower: { insideDiameter: diameter, outsideDiameter: 2 * ao },
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
        ])
    ),
    notes: [
      'Outside surface drawn as the ellipse of semi-axes a + t and h + t',
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
    lower: { insideDiameter: diameter, outsideDiameter: 2 * rim },
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
      () => cavityProfile(a, a / 4, [line(0, 0)])
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
  const ringEnd = { insideDiameter: bore, outsideDiameter };
  const hubEnd = { insideDiameter: bore, outsideDiameter: hasHub ? bore + 2 * hubSmall : outsideDiameter };

  const hubDown = hasHub && context.hubDown === true;
  if (hubDown) {
    solid = context.kernel.translate(context.kernel.flip(solid), [0, 0, height]);
  }

  return {
    solid,
    height,
    lower: hubDown ? hubEnd : ringEnd,
    upper: hubDown ? ringEnd : hubEnd,
    landmarks: [
      ...junctionLandmarks('lower', 0, bore, (hubDown ? hubEnd : ringEnd).outsideDiameter, 'Flange face'),
      ...junctionLandmarks('upper', height, bore, (hubDown ? ringEnd : hubEnd).outsideDiameter, 'Flange face'),
    ],
    notes: hasHub || component.kind !== 'integral_flange' ? [] : ['No hub stated — drawn as a plain ring'],
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
