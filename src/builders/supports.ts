// Supports and jackets: what is welded to the outside of a course without opening it.
//
// Built in the course's frame, round +X and then turned to their azimuth: a saddle at azimuth 0
// is the one a horizontal vessel stands on.
import {
  BuildError,
  NotDrawnError,
  Sym,
  note,
  optionalDimension,
  requireDimension,
  type ComponentDefinition,
  type Note,
} from '../definition.ts';
import type { Point2, Profile, Solid, Vec3 } from '../kernel/GeometryKernel.ts';
import { mm, requireWithinHost } from './placing.ts';
import type { CourseShape, MountedBuilder, MountedContext } from './types.ts';

const DEG = Math.PI / 180;

function cylinderOf(component: ComponentDefinition, context: MountedContext, what: string): CourseShape {
  const course = context.hostSurface.course;
  if (!course || course.halfApexAngle !== 0) {
    throw new NotDrawnError(component, `${what} is drawn on a cylindrical course, and ${context.host.name} is not one`);
  }
  return course;
}

const polar = (radius: number, angle: number): Point2 => [radius * Math.cos(angle), radius * Math.sin(angle)];

/** A rectangle of the XY plane, as an outline to extrude. */
const rectangle = (x0: number, x1: number, y0: number, y1: number): Profile => ({
  start: [x0, y0],
  steps: [
    { kind: 'line', to: [x1, y0] },
    { kind: 'line', to: [x1, y1] },
    { kind: 'line', to: [x0, y1] },
  ],
});

/**
 * A saddle — §4.15.3. A block bearing on the shell over the arc `θ`, `b` wide, down to a base
 * as wide as the chord it spans; and its wear plate when `t_r` is stated, over the wider arc
 * `θ + θ/12` and the width `b + 1.56·sqrt(R_m·t)` that §4.15.3.1 gives it.
 *
 * The saddle is drawn where its placement puts it. Its own `a` is what the engine reads, so a
 * saddle drawn elsewhere says so.
 */
export const saddleSupport: MountedBuilder = (component, context) => {
  const { kernel, placement, hostSurface } = context;
  const course = cylinderOf(component, context, 'a saddle');
  const theta = requireDimension(component, Sym.SADDLE_ANGLE);
  const plate = optionalDimension(component, Sym.WEAR_PLATE_THICKNESS);
  const notes: Note[] = [];

  const z = placement.axialOffset;
  const inside = course.insideRadiusAt(z);
  const outside = course.outsideRadiusAt(z);
  let width = optionalDimension(component, Sym.SADDLE_WIDTH);
  if (width === undefined) {
    width = Math.max(150, 0.12 * outside);
    notes.push(note(`Saddle width not stated — drawn ${mm(width)}`, Sym.SADDLE_WIDTH));
  }
  const plateWidth =
    plate === undefined ? width : width + 1.56 * Math.sqrt(((inside + outside) / 2) * course.thickness);
  requireWithinHost(component, context, plateWidth / 2);

  const distance = optionalDimension(component, Sym.SADDLE_DISTANCE);
  const [low, high] = hostSurface.offsetRange;
  if (distance !== undefined && Math.abs(z - low - distance) > 1 && Math.abs(high - z - distance) > 1) {
    notes.push(
      note(`Drawn at ${mm(z)}, but its a = ${mm(distance)} puts it that far from a tangent line`, Sym.SADDLE_DISTANCE)
    );
  }

  const solids: Solid[] = [];
  const contact = outside + (plate ?? 0);
  const half = (theta * DEG) / 2;
  const base = contact + Math.max(150, 0.25 * outside);
  const [x1, y1] = polar(contact, half);
  solids.push(
    kernel.extrude(
      {
        start: [x1, -y1],
        steps: [
          { kind: 'arc', to: [x1, y1], through: [contact, 0] },
          { kind: 'line', to: [base, y1] },
          { kind: 'line', to: [base, -y1] },
        ],
      },
      z - width / 2,
      z + width / 2
    )
  );

  if (plate !== undefined) {
    const halfPlate = half * (13 / 12);
    const [ix, iy] = polar(outside, halfPlate);
    const [ox, oy] = polar(outside + plate, halfPlate);
    solids.push(
      kernel.extrude(
        {
          start: [ix, -iy],
          steps: [
            { kind: 'line', to: [ox, -oy] },
            { kind: 'arc', to: [ox, oy], through: [outside + plate, 0] },
            { kind: 'line', to: [ix, iy] },
            { kind: 'arc', to: [ix, -iy], through: [outside, 0] },
          ],
        },
        z - plateWidth / 2,
        z + plateWidth / 2
      )
    );
  }

  notes.push(note('Drawn as a solid block; its web and ribs are not modelled'));
  return {
    solids: solids.map((solid) => kernel.rotateZ(solid, placement.azimuth)),
    footprint: plateWidth / 2,
    attachment: {
      axial: plateWidth,
      circumferentialDeg: plate === undefined ? theta : (theta * 13) / 12,
      thickness: plate ?? width,
    },
    notes,
  };
};

/** A skirt — §4.15.4: a cylinder hanging from the course, from its placement downwards. */
export const skirtSupport: MountedBuilder = (component, context) => {
  const { kernel, placement } = context;
  cylinderOf(component, context, 'a skirt');
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const length = requireDimension(component, Sym.COURSE_LENGTH);
  requireWithinHost(component, context, 0);

  const top = placement.axialOffset;
  const a = diameter / 2;
  return {
    solids: [
      kernel.revolve({
        start: [a, top - length],
        steps: [
          { kind: 'line', to: [a + thickness, top - length] },
          { kind: 'line', to: [a + thickness, top] },
          { kind: 'line', to: [a, top] },
        ],
      }),
    ],
    footprint: 0,
    attachment: { axial: thickness, circumferentialDeg: 360, thickness },
    notes: [note('Drawn from its placement on the course downwards, not welded to a knuckle')],
  };
};

/**
 * A lug — §4.15.5: two gussets on a base plate. No rule reads its dimensions, so the
 * `SUPPORT_LUG_*` symbols exist for the drawing alone; what is not stated is drawn to
 * proportions of the course, and said.
 */
export const lugSupport: MountedBuilder = (component, context) => {
  const { kernel, placement } = context;
  const course = cylinderOf(component, context, 'a lug');
  const z = placement.axialOffset;
  const outside = course.outsideRadiusAt(z);
  const notes: Note[] = [];
  const stated = (symbol: string, label: string, assumed: number): number => {
    const value = optionalDimension(component, symbol);
    if (value !== undefined) return value;
    notes.push(note(`${label} not stated — drawn ${mm(assumed)}`, symbol));
    return assumed;
  };

  const reach = stated(Sym.SUPPORT_LUG_PROJECTION, 'Lug projection', Math.min(400, Math.max(100, 0.24 * outside)));
  const height = stated(Sym.SUPPORT_LUG_HEIGHT, 'Lug height', 1.5 * reach);
  const gap = stated(Sym.SUPPORT_LUG_GUSSET_SPACING, 'Gusset spacing', 0.6 * reach);
  const assumedPlate = Math.min(30, Math.max(10, 0.024 * outside));
  const plate = stated(Sym.SUPPORT_LUG_GUSSET_THICKNESS, 'Gusset thickness', assumedPlate);
  const base = stated(Sym.SUPPORT_LUG_BASE_PLATE_THICKNESS, 'Base plate thickness', assumedPlate);
  if (gap <= plate) {
    throw new BuildError(component, `has gussets ${mm(plate)} thick only ${mm(gap)} apart`);
  }
  requireWithinHost(component, context, height / 2 + base);

  const inner = outside - 1;
  const solids = [
    kernel.extrude(rectangle(inner, outside + reach, gap / 2 - plate / 2, gap / 2 + plate / 2), z - height / 2, z + height / 2),
    kernel.extrude(rectangle(inner, outside + reach, -gap / 2 - plate / 2, -gap / 2 + plate / 2), z - height / 2, z + height / 2),
    kernel.extrude(rectangle(inner, outside + reach, -gap / 2 - plate / 2, gap / 2 + plate / 2), z - height / 2 - base, z - height / 2),
  ];
  return {
    solids: solids.map((solid) => kernel.rotateZ(solid, placement.azimuth)),
    footprint: height / 2 + base,
    attachment: {
      axial: height + base,
      circumferentialDeg: ((gap + plate) / outside) * (180 / Math.PI),
      thickness: plate,
    },
    notes,
  };
};

/**
 * A half-pipe jacket — §4.11.6. Drawn as closed turns of the half-pipe on the whole course, at
 * a pitch of a little more than its own width: the helix is not modelled, and neither is the
 * pitch, which the type does not carry.
 */
export const halfPipeJacket: MountedBuilder = (component, context) => {
  const { kernel, hostSurface } = context;
  const course = cylinderOf(component, context, 'a half-pipe jacket');
  const radius = requireDimension(component, Sym.HALF_PIPE_INSIDE_RADIUS);
  const thickness = requireDimension(component, Sym.THICKNESS);
  requireWithinHost(component, context, 0);

  const [low, high] = hostSurface.offsetRange;
  const outside = course.outsideRadiusAt(low);
  const reach = radius + thickness;
  const pitch = 2 * reach + Math.max(20, radius);
  const margin = reach + 20;
  const turns = Math.min(60, Math.floor((high - low - 2 * margin) / pitch) + 1);
  if (turns < 1) {
    throw new NotDrawnError(component, `${context.host.name} is too short for a turn of half-pipe`);
  }

  // One turn, built and meshed once, repeated up the course.
  const z = low + margin;
  const turn = kernel.revolve({
    start: [outside, z - reach],
    steps: [
      { kind: 'line', to: [outside, z - radius] },
      { kind: 'arc', to: [outside, z + radius], through: [outside + radius, z] },
      { kind: 'line', to: [outside, z + reach] },
      { kind: 'arc', to: [outside, z - reach], through: [outside + reach, z] },
    ],
  });
  return {
    solids: [turn],
    copies: [Array.from({ length: turns - 1 }, (_, k): Vec3 => [0, 0, (k + 1) * pitch])],
    footprint: 0,
    attachment: { axial: (turns - 1) * pitch + 2 * reach, circumferentialDeg: 360, thickness },
    notes: [note(`Drawn as ${turns} closed turns at a ${mm(pitch)} pitch over the whole course — the helix is not modelled`)],
  };
};
