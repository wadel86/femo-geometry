// What closes a jacket onto its vessel (§4.11.3), and what relieves the vessel (Part 9).
import {
  NotDrawnError,
  Sym,
  assumedNote,
  optionalDimension,
  representedNote,
  requireDimension,
  scope,
  type Note,
} from '../definition.ts';
import type { Solid, Vec3 } from '../kernel/GeometryKernel.ts';
import { mm, requireWithinHost } from './placing.ts';
import type { MountedBuilder } from './types.ts';

/**
 * §4.11.3 — a jacket closure: the bar of thickness `t_c` closing the jacket space at the
 * placement, from the vessel's outside to the jacket's, and a length of the jacket of `t_j` it
 * closes, run towards the middle of the course. Table 4.11.1's eight details close the same
 * corner eight ways; they are told apart by the drawing's detail number, not by a dimension,
 * so all are drawn as the plain bar.
 */
export const jacketClosure: MountedBuilder = (component, context) => {
  const { kernel, placement, hostSurface, host } = context;
  const course = hostSurface.course;
  if (!course || course.halfApexAngle !== 0) {
    throw new NotDrawnError(
      component,
      `a jacket closure is drawn on a cylindrical course, and ${host.name} is not one`,
      scope('out_of_scope', 'host', 'a cylindrical course', course ? `a cone of ${course.halfApexAngle}°` : host.kind)
    );
  }
  const jacket = requireDimension(component, Sym.JACKET_THICKNESS);
  const bar = requireDimension(component, Sym.CLOSURE_THICKNESS);
  requireWithinHost(component, context, bar / 2);
  const notes: Note[] = [];

  const z = placement.axialOffset;
  const vessel = course.outsideRadiusAt(z);
  let radius = optionalDimension(component, Sym.JACKET_INSIDE_RADIUS);
  if (radius === undefined) {
    const space = optionalDimension(component, Sym.JACKET_SPACE) ?? Math.max(40, 0.05 * vessel);
    if (optionalDimension(component, Sym.JACKET_SPACE) === undefined) {
      notes.push(assumedNote(`Jacket space not stated — drawn ${mm(space)}`, Sym.JACKET_SPACE, mm(space)));
    }
    radius = vessel + space;
  }
  if (radius <= vessel) {
    throw new NotDrawnError(
      component,
      `a jacket of radius ${mm(radius)} does not clear ${host.name}`,
      scope('out_of_scope', Sym.JACKET_INSIDE_RADIUS, `> ${mm(vessel)}, the outside radius of ${host.name}`, mm(radius))
    );
  }

  // The jacket runs from the bar towards the middle of the course.
  const [low, high] = hostSurface.offsetRange;
  const direction = z <= (low + high) / 2 ? 1 : -1;
  const room = direction > 0 ? high - z - bar : z - bar - low;
  const run = Math.max(0, Math.min(room, Math.max(3 * (radius - vessel), 0.4 * vessel)));
  notes.push(
    representedNote(
      `Drawn as a closure bar with ${mm(run)} of the jacket it closes; the closure detail is not distinguished`,
      'closure detail',
      'one of Table 4.11.1\'s eight details',
      `a plain bar with ${mm(run)} of jacket`
    )
  );

  const ring = (inner: number, outer: number, z0: number, z1: number): Solid =>
    kernel.revolve({
      start: [inner, Math.min(z0, z1)],
      steps: [
        { kind: 'line', to: [outer, Math.min(z0, z1)] },
        { kind: 'line', to: [outer, Math.max(z0, z1)] },
        { kind: 'line', to: [inner, Math.max(z0, z1)] },
      ],
    });
  const solids = [ring(vessel, radius + jacket, z, z + direction * bar)];
  if (run > 0) solids.push(ring(radius, radius + jacket, z + direction * bar, z + direction * (bar + run)));
  return {
    solids,
    footprint: bar / 2,
    attachment: { axial: bar, circumferentialDeg: 360, thickness: bar },
    notes,
  };
};

/**
 * Part 9 — a pressure relief device. Part 9 states what it is set at and nothing of its size,
 * so it is drawn as a symbol — an inlet, a flange, a body, a bonnet and an outlet — sized to
 * its host, standing on the host's surface without opening it.
 */
export const pressureReliefDevice: MountedBuilder = (component, context) => {
  const { kernel, placement, hostSurface } = context;
  const reach = hostSurface.course?.outsideRadiusAt(placement.axialOffset) ?? hostSurface.offsetRange[1];
  const inlet = Math.min(120, Math.max(25, 0.08 * reach));
  requireWithinHost(component, context, inlet);

  const frame = hostSurface.frameAt(placement.axialOffset, placement.azimuth);
  const axis = frame.axis;
  // Square to the device's axis, for the outlet: round the vessel when the axis is radial.
  const side: Vec3 =
    Math.abs(axis[2]) > 0.9 ? [1, 0, 0] : ([-axis[1], axis[0], 0].map((c) => c / Math.hypot(axis[0], axis[1])) as unknown as Vec3);
  const along = (distance: number): Vec3 => [
    frame.origin[0] + distance * axis[0],
    frame.origin[1] + distance * axis[1],
    frame.origin[2] + distance * axis[2],
  ];

  // The inlet starts inside the wall and is cut to the host's outside, so it stands on it.
  const sunk = kernel.tube(frame, 0, inlet, -frame.wall, 2 * inlet);
  const cutters = context.hostSolid ? [context.hostSolid, hostSurface.cavity()] : [hostSurface.cavity()];
  const body = 2 * inlet + 0.4 * inlet;
  const solids: Solid[] = [
    kernel.cut(sunk, cutters),
    kernel.tube(frame, 0, 1.8 * inlet, 2 * inlet, 2.4 * inlet),
    kernel.tube(frame, 0, 1.4 * inlet, body, body + 3 * inlet),
    kernel.tube(frame, 0, 0.8 * inlet, body + 3 * inlet, body + 5.5 * inlet),
    kernel.tube({ origin: along(body + 1.5 * inlet), axis: side }, 0, 0.9 * inlet, 0, 3 * inlet),
  ];
  return {
    solids,
    footprint: inlet,
    attachment: { axial: 2 * inlet, circumferentialDeg: reach > 0 ? ((2 * inlet) / reach) * (180 / Math.PI) : 0, thickness: inlet },
    notes: [
      representedNote(
        'Drawn as a symbol: Part 9 states what the device is set at, not its size',
        'relief device body',
        'its real size',
        `a symbol scaled on a ${mm(2 * inlet)} inlet`
      ),
    ],
  };
};
