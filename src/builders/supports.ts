// Supports and jackets: what is welded to the outside of a course without opening it.
//
// Built in the course's frame, round +X and then turned to their azimuth: a saddle at azimuth 0
// is the one a horizontal vessel stands on.
import {
  BuildError,
  NotDrawnError,
  Sym,
  assumedNote,
  note,
  optionalDimension,
  representedNote,
  requireDimension,
  scope,
  type ComponentDefinition,
  type Note,
} from '../definition.ts';
import type { Point2, Profile, Solid } from '../kernel/GeometryKernel.ts';
import { mm, requireWithinHost } from './placing.ts';
import type { CourseShape, MountedBuilder, MountedContext, MountedPart } from './types.ts';

const DEG = Math.PI / 180;

function cylinderOf(component: ComponentDefinition, context: MountedContext, what: string): CourseShape {
  const course = context.hostSurface.course;
  if (!course || course.halfApexAngle !== 0) {
    throw new NotDrawnError(
      component,
      `${what} is drawn on a cylindrical course, and ${context.host.name} is not one`,
      scope('out_of_scope', 'host', 'a cylindrical course', course ? `a cone of ${course.halfApexAngle}°` : context.host.kind)
    );
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
    notes.push(assumedNote(`Saddle width not stated — drawn ${mm(width)}`, Sym.SADDLE_WIDTH, mm(width)));
  }
  const plateWidth =
    plate === undefined ? width : width + 1.56 * Math.sqrt(((inside + outside) / 2) * course.thickness);
  requireWithinHost(component, context, plateWidth / 2);

  // a is measured from a head's tangent line, which a straight flange puts past the course's end.
  const distance = optionalDimension(component, Sym.SADDLE_DISTANCE);
  const [low, high] = context.tangentLines ?? hostSurface.offsetRange;
  if (distance !== undefined && Math.abs(z - low - distance) > 1 && Math.abs(high - z - distance) > 1) {
    notes.push(
      note(
        `Drawn at ${mm(z)}, but its a = ${mm(distance)} puts it that far from a tangent line`,
        Sym.SADDLE_DISTANCE,
        scope(
          'mismatch',
          Sym.SADDLE_DISTANCE,
          `the layout's ${mm(z - low)} or ${mm(high - z)} from the tangent lines of its course`,
          `stated ${mm(distance)}`
        )
      )
    );
  }

  // A fabricated saddle: a bearing plate wrapping the shell — or its wear plate — over θ, a web
  // across the vessel at the saddle's centre, ribs along the vessel at intervals across the
  // chord, the outer two at the horns, and a base plate. Every plate meets the next on a face,
  // none overlaps another, and the bearing plate follows the shell's own circle, so the saddle
  // needs nothing of a doubly curved surface. Its plates are the drawing's, read by no rule.
  const stated = (symbol: string, label: string, assumed: number): number => {
    const value = optionalDimension(component, symbol);
    if (value !== undefined) return value;
    notes.push(assumedNote(`${label} not stated — drawn ${mm(assumed)}`, symbol, mm(assumed)));
    return assumed;
  };
  const contact = outside + (plate ?? 0);
  const half = (theta * DEG) / 2;
  const bearing = stated(Sym.SADDLE_BEARING_PLATE_THICKNESS, 'Saddle bearing plate thickness', 12);
  const outer = contact + bearing;
  const height = stated(Sym.SADDLE_HEIGHT, 'Saddle height', contact - outside + Math.max(150, 0.25 * outside));
  const basePlate = stated(Sym.SADDLE_BASE_PLATE_THICKNESS, 'Saddle base plate thickness', 16);
  const web = stated(Sym.SADDLE_WEB_THICKNESS, 'Saddle web thickness', 12);
  const rib = stated(Sym.SADDLE_RIB_THICKNESS, 'Saddle rib thickness', 12);
  const horn = outer * Math.sin(half);
  const ribCount = Math.round(stated(Sym.SADDLE_RIB_COUNT, 'Saddle rib count', 2 + Math.floor((2 * horn) / 600)));

  // x runs from the axis out through the saddle: its base is the far side of the bottom of the shell.
  const base = outside + height;
  const baseTop = base - basePlate;
  if (baseTop <= outer) {
    throw new BuildError(
      component,
      `is ${mm(height)} high, which leaves no web under its ${mm(bearing)} bearing plate`,
      scope('out_of_scope', Sym.SADDLE_HEIGHT, `> ${mm(outer - outside + basePlate)}, the bearing and base plates`, mm(height))
    );
  }
  if (ribCount < 2 || web >= width || rib * ribCount >= 2 * horn) {
    throw new BuildError(
      component,
      `has ${ribCount} ribs of ${mm(rib)} and a ${mm(web)} web on a saddle ${mm(width)} wide and ${mm(2 * horn)} across`,
      scope('out_of_scope', 'ribs and web', `≥ 2 ribs, all fitting the ${mm(2 * horn)} chord; a web thinner than ${mm(width)}`, `${ribCount} × ${mm(rib)}, web ${mm(web)}`)
    );
  }

  const solids: Solid[] = [];
  const [hx, hy] = polar(outer, half);
  const [cx, cy] = polar(contact, half);
  // The bearing plate, on the shell's circle.
  solids.push(
    kernel.extrude(
      {
        start: [cx, -cy],
        steps: [
          { kind: 'line', to: [hx, -hy] },
          { kind: 'arc', to: [hx, hy], through: [outer, 0] },
          { kind: 'line', to: [cx, cy] },
          { kind: 'arc', to: [cx, -cy], through: [contact, 0] },
        ],
      },
      z - width / 2,
      z + width / 2
    )
  );
  // The base plate, the chord's width across.
  solids.push(kernel.extrude(rectangle(baseTop, base, -horn, horn), z - width / 2, z + width / 2));
  // The web, from the bearing plate down to the base plate, across the vessel.
  solids.push(
    kernel.extrude(
      {
        start: [hx, -hy],
        steps: [
          { kind: 'arc', to: [hx, hy], through: [outer, 0] },
          { kind: 'line', to: [baseTop, hy] },
          { kind: 'line', to: [baseTop, -hy] },
        ],
      },
      z - web / 2,
      z + web / 2
    )
  );
  // The ribs, each in two halves either side of the web, its top on the bearing plate's circle.
  const onCircle = (y: number): [number, number] => [Math.sqrt(outer * outer - y * y), y];
  for (let k = 0; k < ribCount; k++) {
    const y = -(horn - rib / 2) + (k * 2 * (horn - rib / 2)) / (ribCount - 1);
    const outline = {
      start: onCircle(y - rib / 2),
      steps: [
        { kind: 'arc' as const, to: onCircle(y + rib / 2), through: onCircle(y) },
        { kind: 'line' as const, to: [baseTop, y + rib / 2] as [number, number] },
        { kind: 'line' as const, to: [baseTop, y - rib / 2] as [number, number] },
      ],
    };
    solids.push(kernel.extrude(outline, z - width / 2, z - web / 2), kernel.extrude(outline, z + web / 2, z + width / 2));
  }

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

/**
 * A skirt — §4.15.4: a cylinder hanging from the course, from its placement downwards; or,
 * hosted on a head, welded to the head's knuckle.
 */
export const skirtSupport: MountedBuilder = (component, context) => {
  if (context.hostSurface.anchor === 'head_crown') return skirtOnHead(component, context);
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
    notes: [
      representedNote(
        'Drawn from its placement on the course downwards, not welded to a knuckle',
        'skirt top',
        'cut to the surface it is welded to',
        'square, from its placement downwards'
      ),
    ],
  };
};

/**
 * A skirt welded to a head's knuckle, the usual way a tall column stands: where it meets the head
 * is not a placement but the skirt's own diameter — the circle on which the head's outside
 * reaches the skirt's mid-wall — so the placement's offset is not read. The skirt's top is cut
 * to the head's outside surface, so the two meet on the same surface and a mesher can join them;
 * the skirt runs its length from that circle, away from the vessel.
 */
function skirtOnHead(component: ComponentDefinition, context: MountedContext): MountedPart {
  const { kernel, hostSurface, host } = context;
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const length = requireDimension(component, Sym.COURSE_LENGTH);
  if (!context.hostSolid) {
    throw new NotDrawnError(
      component,
      `${host.name} offers no surface to cut the skirt to`,
      scope('out_of_scope', 'host', 'a drawn head', `${host.name}, no solid`)
    );
  }

  const inner = diameter / 2;
  const outer = inner + thickness;
  const middle = inner + thickness / 2;
  const [, reach] = hostSurface.offsetRange;
  // Past the head's inside radius the outside surface falls to the tangent line and below.
  const headOutside = hostSurface.frameAt(reach, 0);
  const headOutsideRadius = reach + hostSurface.wallAt(reach).thickness;
  if (outer >= headOutsideRadius) {
    throw new NotDrawnError(
      component,
      `as wide as ${host.name} or wider, the skirt meets its shell rather than its knuckle — host it on the course`,
      scope('out_of_scope', 'skirt outside radius', `< ${mm(headOutsideRadius)}, the outside radius of ${host.name}`, mm(outer))
    );
  }
  if (inner <= 0) throw new BuildError(component, 'has no inside radius', scope('out_of_scope', Sym.INSIDE_DIAMETER, '> 0', mm(diameter)));

  // The head's outside surface is stated out to its own outside radius, past the inside one.
  const weld = hostSurface.frameAt(middle, 0).origin[2];
  const lowest = Math.min(headOutside.origin[2], hostSurface.frameAt(outer, 0).origin[2]) - 1;
  const tube = kernel.tube({ origin: [0, 0, 0], axis: [0, 0, 1] }, inner, outer, lowest, weld + length);
  return {
    solids: [kernel.cut(tube, [context.hostSolid, hostSurface.cavity()])],
    footprint: 0,
    attachment: { axial: thickness, circumferentialDeg: 360, thickness },
    anchorOffset: middle,
    notes: [],
  };
}

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
    notes.push(assumedNote(`${label} not stated — drawn ${mm(assumed)}`, symbol, mm(assumed)));
    return assumed;
  };

  const reach = stated(Sym.SUPPORT_LUG_PROJECTION, 'Lug projection', Math.min(400, Math.max(100, 0.24 * outside)));
  const height = stated(Sym.SUPPORT_LUG_HEIGHT, 'Lug height', 1.5 * reach);
  const gap = stated(Sym.SUPPORT_LUG_GUSSET_SPACING, 'Gusset spacing', 0.6 * reach);
  const assumedPlate = Math.min(30, Math.max(10, 0.024 * outside));
  const plate = stated(Sym.SUPPORT_LUG_GUSSET_THICKNESS, 'Gusset thickness', assumedPlate);
  const base = stated(Sym.SUPPORT_LUG_BASE_PLATE_THICKNESS, 'Base plate thickness', assumedPlate);
  if (gap <= plate) {
    throw new BuildError(
      component,
      `has gussets ${mm(plate)} thick only ${mm(gap)} apart`,
      scope('out_of_scope', Sym.SUPPORT_LUG_GUSSET_SPACING, `> ${mm(plate)}, the gusset thickness`, mm(gap))
    );
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
 * A leg — §4.15.5: a pipe column welded along the side of a course and carried down past it to
 * its base plate on the foundation. One component per leg, placed by azimuth like a lug. The
 * placement's offset is the middle of the weld, so where the leg is attached — the station
 * §4.15.5.5 measures its 1.8·√(D·t) from — is the placement itself, and the layout measures it.
 * It may run past the course's lower end: only its weld has to stay on its host.
 */
export const legSupport: MountedBuilder = (component, context) => {
  const { kernel, placement } = context;
  const course = cylinderOf(component, context, 'a leg');
  const diameter = requireDimension(component, Sym.LEG_OUTSIDE_DIAMETER);
  const wall = requireDimension(component, Sym.LEG_THICKNESS);
  const length = requireDimension(component, Sym.LEG_LENGTH);
  const weld = requireDimension(component, Sym.LEG_ATTACHMENT_LENGTH);
  if (wall >= diameter / 2) {
    throw new BuildError(component, `has a wall of ${mm(wall)} on a ${mm(diameter)} pipe`, scope('out_of_scope', Sym.LEG_THICKNESS, `< ${mm(diameter / 2)}`, mm(wall)));
  }
  if (weld > length) {
    throw new BuildError(component, `is welded over ${mm(weld)} of a ${mm(length)} leg`, scope('out_of_scope', Sym.LEG_ATTACHMENT_LENGTH, `≤ ${mm(length)}, the leg`, mm(weld)));
  }
  requireWithinHost(component, context, weld / 2);
  const notes: Note[] = [];
  const statedBase = optionalDimension(component, Sym.SUPPORT_LUG_BASE_PLATE_THICKNESS);
  const base = statedBase ?? Math.max(12, 2 * wall);
  if (statedBase === undefined) notes.push(assumedNote(`Base plate thickness not stated — drawn ${mm(base)}`, Sym.SUPPORT_LUG_BASE_PLATE_THICKNESS, mm(base)));

  const z = placement.axialOffset;
  const outside = course.outsideRadiusAt(z);
  // Standing against the shell, touching it along one generatrix.
  const axis = outside + diameter / 2;
  const top = z + weld / 2;
  const bottom = top - length;
  const half = 0.75 * diameter;
  const solids = [
    kernel.tube({ origin: [axis, 0, 0], axis: [0, 0, 1] }, diameter / 2 - wall, diameter / 2, bottom, top),
    kernel.extrude(rectangle(axis - half, axis + half, -half, half), bottom - base, bottom),
  ];
  notes.push(
    representedNote(
      'A pipe leg touches the shell along one line; the weld either side of it is not drawn, and the attachment is taken a pipe diameter wide',
      'leg to shell weld',
      'two fillets along the line of contact',
      `a patch ${mm(weld)} by ${mm(diameter)}`,
      true
    )
  );
  return {
    solids: solids.map((solid) => kernel.rotateZ(solid, placement.azimuth)),
    footprint: weld / 2,
    attachment: { axial: weld, circumferentialDeg: (diameter / outside) * (180 / Math.PI), thickness: wall },
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
  if (turns < 2) {
    throw new NotDrawnError(
      component,
      `${context.host.name} is too short for a turn of half-pipe`,
      scope('out_of_scope', 'course length', `≥ ${mm(2 * margin + pitch)}, one turn and its margins`, mm(high - low))
    );
  }

  // One continuous helix. Two circular tubes swept with their centre ON the shell's outside
  // surface, the inner taken from the outer, and what lies inside the shell's outside cylinder
  // cut away: the coil's two weld lines then lie exactly on the shell's cylinder, which no
  // profile swept with its edges on the shell would give.
  const z = low + margin;
  const rise = (turns - 1) * pitch;
  const shellOutside = kernel.revolve({
    start: [0, low - 1],
    steps: [
      { kind: 'line', to: [outside, low - 1] },
      { kind: 'line', to: [outside, high + 1] },
      { kind: 'line', to: [0, high + 1] },
    ],
  });
  const coil = kernel.cut(kernel.helicalTube(outside, pitch, z, rise, reach), [
    kernel.helicalTube(outside, pitch, z, rise, radius),
    shellOutside,
  ]);
  return {
    solids: [coil],
    footprint: 0,
    attachment: { axial: rise + 2 * reach, circumferentialDeg: 360, thickness },
    // The coil is the jacket itself now; its pitch and extent are still chosen here, the type
    // carrying neither.
    notes: [
      note(
        `Pitch and extent not stated — drawn at a ${mm(pitch)} pitch over the whole course`,
        undefined,
        scope('assumed', 'pitch and jacketed length', 'stated', `not stated — drawn ${mm(pitch)} over ${mm(high - low)}`)
      ),
    ],
  };
};
