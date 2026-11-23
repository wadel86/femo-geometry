// A forged boss set into a head at its pole (ENSA's boss detail, shapes from TRESCA QUALIFICATION):
// a DISC that replaces a circular patch of the head wall — the head's full thickness, its top on
// the inner sphere, its bottom on the outer, butt-welded into the plate at its diameter — and,
// standing out of it, a CYLINDER joined to the head by a root fillet, a small BREAK radius into
// a CONE, and a fillet into a short SPIGOT the pipe butt-welds onto. The pipe's bore runs through.
//
// Heights run along the axis from the spigot's end back towards the head: `boss_height` to the
// head's outer surface at the cylinder's root, `boss_cone_height` to the cylinder-to-cone break.
// The cone's angle fixes the spigot's length, so the spigot is not stated.
//
// One revolved profile in the head's frame, crown up: the boss is a body of revolution about the
// vessel axis, so it stands on the pole and nowhere else. The joint face to the plate is normal to
// the wall — a cone through the sphere's centre — so the butt weld is square to the plate; the
// disc's diameter is the joint's on the OUTER surface, and on the inner one it is smaller by
// inner/outer. The bore's edge on the inner surface may be rounded.
import {
  BuildError,
  Sym,
  assumedNote,
  optionalDimension,
  requireDimension,
  scope,
  sharpUnlessStated,
  type Note,
} from '../definition.ts';
import type { Point2, ProfileStep } from '../kernel/GeometryKernel.ts';
import { mm } from './placing.ts';
import type { MountedBuilder, MountedPart } from './types.ts';

const DEG = Math.PI / 180;

type Vec = Point2;
const add = (p: Vec, q: Vec, k = 1): Vec => [p[0] + k * q[0], p[1] + k * q[1]];
const unit = (v: Vec): Vec => {
  const n = Math.hypot(v[0], v[1]);
  return [v[0] / n, v[1] / n];
};

/**
 * A corner at `q` between a line arriving along `d1` and one leaving along `d2`, rounded by `r`:
 * where the arc leaves the first line, its middle, and where it joins the second.
 */
function corner(q: Vec, d1: Vec, d2: Vec, r: number): { from: Vec; mid: Vec; to: Vec; reach: number } | null {
  const turn = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
  if (!(r > 0) || turn < 1e-9) return null;
  const reach = r * Math.tan(turn / 2);
  const bisector = unit([d2[0] - d1[0], d2[1] - d1[1]]);
  const centre = add(q, bisector, r / Math.cos(turn / 2));
  return { from: add(q, d1, -reach), mid: add(centre, bisector, -r), to: add(q, d2, reach), reach };
}

export const headPoleBoss: MountedBuilder = (component, context) => {
  const { kernel, hostSurface, host, placement } = context;
  const notes: Note[] = [];
  if (hostSurface.anchor !== 'head_crown') {
    throw new BuildError(component, `stands on a head's pole, and ${host.name} is not a head`, scope('out_of_scope', 'host', 'a head', host.kind));
  }
  if (Math.abs(placement.axialOffset) > 1e-6) {
    throw new BuildError(
      component,
      `is a body of revolution about the vessel axis, placed ${mm(placement.axialOffset)} off it`,
      scope('out_of_scope', 'placement', '0 mm from the axis: the pole', mm(placement.axialOffset))
    );
  }

  const rd = requireDimension(component, Sym.BOSS_DISC_DIAMETER) / 2;
  const rb = requireDimension(component, Sym.BOSS_OUTSIDE_DIAMETER) / 2;
  const rp = requireDimension(component, Sym.BOSS_PIPE_OUTSIDE_DIAMETER) / 2;
  const ri = requireDimension(component, Sym.BOSS_BORE_DIAMETER) / 2;
  const height = requireDimension(component, Sym.BOSS_HEIGHT);
  const coneHeight = requireDimension(component, Sym.BOSS_CONE_HEIGHT);
  const stated = (symbol: string, what: string, assumed: number, drawn: string): number => {
    const value = optionalDimension(component, symbol);
    if (value !== undefined) return value;
    notes.push(assumedNote(`${what} not stated — drawn ${drawn}`, symbol, drawn));
    return assumed;
  };
  const alpha = stated(Sym.BOSS_CONE_ANGLE, 'Cone half-angle', 45, '45°') * DEG;

  // The crown the disc is cut from: a sphere about the axis, read off the host where the disc is.
  const wall = hostSurface.wallAt(0);
  const atDisc = hostSurface.wallAt(rd);
  const mean = wall.surface.principalRadii[0];
  if (wall.surface.kind !== 'sphere' || atDisc.surface.kind !== 'sphere' || mean === null || atDisc.surface.principalRadii[0] !== mean) {
    throw new BuildError(
      component,
      `is set into a spherical crown, and ${host.name} is not spherical out to ${mm(rd)} from the axis`,
      scope('out_of_scope', Sym.BOSS_DISC_DIAMETER, `within the spherical crown of ${host.name}`, mm(2 * rd))
    );
  }
  const t = wall.thickness;
  const outer = mean + t / 2;
  const inner = mean - t / 2;
  const zCentre = hostSurface.frameAt(0, 0).origin[2] - outer;
  const zOut = (r: number) => zCentre + Math.sqrt(outer * outer - r * r);
  const zIn = (r: number) => zCentre + Math.sqrt(inner * inner - r * r);

  const root = stated(Sym.BOSS_ROOT_RADIUS, 'Root fillet radius', t / 2, `${mm(t / 2)}, half the head's wall`);
  const breakRadius = sharpUnlessStated(component, notes, Sym.BOSS_BREAK_RADIUS, 'Cylinder-to-cone break radius');
  const neckRadius = sharpUnlessStated(component, notes, Sym.BOSS_NECK_RADIUS, 'Cone-to-spigot fillet radius');
  const boreEdge = sharpUnlessStated(component, notes, Sym.BOSS_BORE_EDGE_RADIUS, "Bore edge radius on the head's inner surface");

  if (!(ri < rp && rp < rb && rb < rd)) {
    throw new BuildError(
      component,
      `has bore ${mm(2 * ri)}, pipe ${mm(2 * rp)}, boss ${mm(2 * rb)} and disc ${mm(2 * rd)}, not each inside the next`,
      scope('out_of_scope', 'diameters', 'bore < pipe OD < boss OD < disc', `${mm(2 * ri)} < ${mm(2 * rp)} < ${mm(2 * rb)} < ${mm(2 * rd)}`)
    );
  }
  if (!(alpha > 0 && alpha < Math.PI / 2)) {
    throw new BuildError(component, `has a cone half-angle of ${alpha / DEG}°`, scope('out_of_scope', Sym.BOSS_CONE_ANGLE, 'between 0° and 90°', `${alpha / DEG}°`));
  }

  // Outward is +z in the head's frame, crown up: the spigot's end is the boss's far end.
  const end = zOut(rb) + height;
  const zBreak = end - coneHeight;
  const zNeck = zBreak + (rb - rp) / Math.tan(alpha);
  const UP: Vec = [0, 1];
  const cone: Vec = [-Math.sin(alpha), Math.cos(alpha)];

  // The root: a fillet between the outer sphere, which the boss stands on, and its cylinder.
  const reach = outer + root;
  const zRoot = zCentre + Math.sqrt(reach * reach - (rb + root) ** 2);
  const onSphere: Vec = [(outer * (rb + root)) / reach, zCentre + (outer * (zRoot - zCentre)) / reach];
  const onCylinder: Vec = [rb, zRoot];
  const rootMid = add([rb + root, zRoot], unit([onSphere[0] + onCylinder[0] - 2 * (rb + root), onSphere[1] + onCylinder[1] - 2 * zRoot]), root);
  if (!(onSphere[0] < rd)) {
    throw new BuildError(
      component,
      `has a ${mm(root)} root fillet reaching past its ${mm(2 * rd)} disc`,
      scope('out_of_scope', Sym.BOSS_ROOT_RADIUS, `small enough to stay on the disc`, mm(root))
    );
  }
  const brk = corner([rb, zBreak], UP, cone, breakRadius);
  const nck = corner([rp, zNeck], cone, UP, neckRadius);
  const cylinderTop = brk ? brk.from[1] : zBreak;
  const coneStart = brk ? brk.to : ([rb, zBreak] as Vec);
  const coneEnd = nck ? nck.from : ([rp, zNeck] as Vec);
  const spigotStart = nck ? nck.to[1] : zNeck;
  if (!(cylinderTop > zRoot + 1e-9)) {
    throw new BuildError(
      component,
      `leaves no cylinder between its root and its cone: ${mm(coneHeight)} of cone in ${mm(height)} of boss`,
      scope('out_of_scope', Sym.BOSS_CONE_HEIGHT, `< ${mm(end - zRoot - (brk?.reach ?? 0))}`, mm(coneHeight))
    );
  }
  if (!(spigotStart < end - 1e-9) || !(coneEnd[1] > coneStart[1] - 1e-9)) {
    throw new BuildError(
      component,
      `leaves no spigot: a ${alpha / DEG}° cone from ${mm(2 * rb)} to ${mm(2 * rp)} is longer than ${mm(coneHeight)}`,
      scope('out_of_scope', Sym.BOSS_CONE_HEIGHT, `> ${mm((rb - rp) / Math.tan(alpha) + (nck?.reach ?? 0))}`, mm(coneHeight))
    );
  }

  // The joint face, on the radius from the sphere's centre through the disc's outer corner.
  const centre: Vec = [0, zCentre];
  const jointOut: Vec = [rd, zOut(rd)];
  const jointIn = add(centre, [jointOut[0], jointOut[1] - zCentre], inner / outer);

  // The bore's edge: a round tangent to the bore and to the inner sphere, inside the metal.
  let start: Vec = [ri, zIn(ri)];
  const edgeSteps: ProfileStep[] = [];
  let innerFrom = ri;
  if (boreEdge > 0) {
    const c: Vec = [ri + boreEdge, zCentre + Math.sqrt((inner + boreEdge) ** 2 - (ri + boreEdge) ** 2)];
    const onInner = add(centre, [c[0], c[1] - zCentre], inner / (inner + boreEdge));
    if (!(onInner[0] < jointIn[0])) {
      throw new BuildError(
        component,
        `has a ${mm(boreEdge)} bore edge radius reaching past its joint face`,
        scope('out_of_scope', Sym.BOSS_BORE_EDGE_RADIUS, 'small enough to stay on the disc', mm(boreEdge))
      );
    }
    start = [ri, c[1]];
    edgeSteps.push({ kind: 'arc', to: onInner, through: add(c, unit([ri - c[0], zIn(ri) - c[1]]), boreEdge) });
    innerFrom = onInner[0];
  }

  const arcThrough = (to: Vec, through: Vec): ProfileStep => ({ kind: 'arc', to, through });
  const line = (to: Vec): ProfileStep => ({ kind: 'line', to });
  const midIn = (innerFrom + jointIn[0]) / 2;
  const midOut = (rd + onSphere[0]) / 2;
  const steps: ProfileStep[] = [
    ...edgeSteps,
    arcThrough(jointIn, [midIn, zIn(midIn)]),
    line(jointOut),
    arcThrough(onSphere, [midOut, zOut(midOut)]),
    arcThrough(onCylinder, rootMid),
    line([rb, cylinderTop]),
    ...(brk ? [arcThrough(brk.to, brk.mid)] : []),
    line(coneEnd),
    ...(nck ? [arcThrough(nck.to, nck.mid)] : []),
    line([rp, end]),
    line([ri, end]),
  ];
  const boss = kernel.revolve({ start, steps });

  // The plate is cut by exactly the disc: its faces on the head's own spheres, so the cut's edges
  // are the disc's circles rather than a cone-sphere intersection the kernel would fit a spline to.
  const frame = hostSurface.frameAt(0, 0);
  const through = frame.wall + 2 * rd + 1;
  const tool = kernel.revolve({
    start: [0, zIn(0)],
    steps: [
      arcThrough(jointIn, [jointIn[0] / 2, zIn(jointIn[0] / 2)]),
      line(jointOut),
      arcThrough([0, zOut(0)], [rd / 2, zOut(rd / 2)]),
    ],
  });
  const part: MountedPart = {
    solids: [boss],
    opening: { tool, frame, radius: rd, insideRadius: jointIn[0], depth: through },
    footprint: rd,
    neck: {
      insideRadius: ri,
      outsideRadius: rd,
      outward: end - frame.origin[2],
      inward: 0,
      insert: true,
      end: { insideRadius: ri, outsideRadius: rp },
    },
    notes,
  };
  return part;
};
