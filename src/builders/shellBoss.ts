// A forged boss set into a cylindrical shell, radial — a manhole or a large nozzle whose forging
// carries its own reinforcement (shapes from TRESCA QUALIFICATION, ENSA's manhole detail). The
// head_pole_boss's family on a course:
//
// - a DISC that replaces a patch of the shell wall — the shell's thickness and curvature, because
//   it IS the wall there — butt-welded into the plate on a joint face about the nozzle axis: a
//   cylinder, or a cone leaning `boss_joint_angle` from the axis, wider at the inner surface;
// - standing out of it, a BOSS cylinder joined to the shell's outside by a root fillet, a BREAK
//   radius into a CONE, a fillet into the NECK, and the neck out to its end (a flange face, or the
//   pipe's weld); the bore through, its edge at the inner surface rounded.
//
// Heights run along the nozzle axis from the neck's end back towards the shell: `boss_height` to
// the shell's outer surface ON THE AXIS — a cylinder's outside is not level round the nozzle, so
// the radial nozzle's datum is the only one that does not depend on the direction — and
// `boss_cone_height` to the boss-to-cone break. `boss_disc_diameter` is the joint face's at that
// same level.
//
// Built as the pole boss is, except where a cylinder forbids it: the profile from the root up is
// revolved about the nozzle axis, but a cylinder's outer surface is not one of its curves, so the
// root fillet and the bore's edge are rounded on the solid, where the boss meets the disc, rather
// than drawn into the profile.
import { BuildError, Sym, assumedNote, optionalDimension, requireDimension, scope, sharpUnlessStated, signedDimension, type Note } from '../definition.ts';
import type { Point2, ProfileStep, Solid, Vec3 } from '../kernel/GeometryKernel.ts';
import { mm, requireWithinHost } from './placing.ts';
import type { MountedBuilder } from './types.ts';

const DEG = Math.PI / 180;

type Vec = Point2;
const add = (p: Vec, q: Vec, k = 1): Vec => [p[0] + k * q[0], p[1] + k * q[1]];
const unit = (v: Vec): Vec => {
  const n = Math.hypot(v[0], v[1]);
  return [v[0] / n, v[1] / n];
};

/** A corner at `q` between a line arriving along `d1` and one leaving along `d2`, rounded by `r`. */
function corner(q: Vec, d1: Vec, d2: Vec, r: number): { from: Vec; mid: Vec; to: Vec; reach: number } | null {
  const turn = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
  if (!(r > 0) || turn < 1e-9) return null;
  const reach = r * Math.tan(turn / 2);
  const bisector = unit([d2[0] - d1[0], d2[1] - d1[1]]);
  const centre = add(q, bisector, r / Math.cos(turn / 2));
  return { from: add(q, d1, -reach), mid: add(centre, bisector, -r), to: add(q, d2, reach), reach };
}

export const shellBoss: MountedBuilder = (component, context) => {
  const { kernel, hostSurface, host, placement } = context;
  const notes: Note[] = [];
  const course = hostSurface.course;
  if (!course || course.halfApexAngle !== 0) {
    throw new BuildError(component, `is set into a cylindrical shell, and ${host.name} is not one`, scope('out_of_scope', 'host', 'a cylindrical course', host.kind));
  }
  if (!context.hostSolid) {
    throw new BuildError(component, 'needs its host drawn to cut its disc from', scope('out_of_scope', 'host', 'a drawn course', 'none'));
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
  // A square face is a real answer, so a stated 0° is stated: only absence is assumed.
  const statedLean = signedDimension(component, Sym.BOSS_JOINT_ANGLE);
  const lean = (statedLean ?? 0) * DEG;
  if (statedLean === undefined) notes.push(assumedNote('Joint face lean not stated — drawn square, a cylinder about the nozzle axis', Sym.BOSS_JOINT_ANGLE, '0°'));
  // §4.5.7's θ, the angle of the boss's axis to the vessel's, as an angled nozzle states it: 90°
  // radial, less leaning towards increasing offset, more towards decreasing.
  const theta = stated(Sym.NOZZLE_ANGLE, 'Axis angle to the vessel axis', 90, '90°, radial') * DEG;
  if (!(theta > Math.PI / 4 && theta < (3 * Math.PI) / 4)) {
    throw new BuildError(component, `leans at ${theta / DEG}° to the vessel axis`, scope('out_of_scope', Sym.NOZZLE_ANGLE, '45° to 135°', `${theta / DEG}°`));
  }

  const z = placement.axialOffset;
  const outer = course.outsideRadiusAt(z);
  const inner = course.insideRadiusAt(z);
  const t = outer - inner;
  const root = stated(Sym.BOSS_ROOT_RADIUS, 'Root fillet radius', t / 2, `${mm(t / 2)}, half the shell's wall`);
  const breakRadius = sharpUnlessStated(component, notes, Sym.BOSS_BREAK_RADIUS, 'Boss-to-cone break radius');
  const neckRadius = sharpUnlessStated(component, notes, Sym.BOSS_NECK_RADIUS, 'Cone-to-neck fillet radius');
  const boreEdge = sharpUnlessStated(component, notes, Sym.BOSS_BORE_EDGE_RADIUS, "Bore edge radius on the shell's inner surface");

  if (!(ri < rp && rp < rb && rb < rd)) {
    throw new BuildError(
      component,
      `has bore ${mm(2 * ri)}, neck ${mm(2 * rp)}, boss ${mm(2 * rb)} and disc ${mm(2 * rd)}, not each inside the next`,
      scope('out_of_scope', 'diameters', 'bore < neck OD < boss OD < disc', `${mm(2 * ri)} < ${mm(2 * rp)} < ${mm(2 * rb)} < ${mm(2 * rd)}`)
    );
  }
  if (!(alpha > 0 && alpha < Math.PI / 2)) {
    throw new BuildError(component, `has a cone half-angle of ${alpha / DEG}°`, scope('out_of_scope', Sym.BOSS_CONE_ANGLE, 'between 0° and 90°', `${alpha / DEG}°`));
  }
  if (!(lean >= 0 && lean < Math.PI / 4)) {
    throw new BuildError(component, `has its joint face leaning ${lean / DEG}°`, scope('out_of_scope', Sym.BOSS_JOINT_ANGLE, '0° to 45°', `${lean / DEG}°`));
  }
  // The disc at the inner surface, its widest: on the shell's far side of the nozzle axis it has
  // to stay a patch of wall, not wrap round the course.
  const rdIn = rd + (t + (outer - Math.sqrt(Math.max(0, outer * outer - rd * rd)))) * Math.tan(lean);
  if (!(rdIn < 0.8 * inner)) {
    throw new BuildError(component, `has a ${mm(2 * rdIn)} disc in a ${mm(2 * inner)} bore`, scope('out_of_scope', Sym.BOSS_DISC_DIAMETER, `< ${mm(1.6 * inner)}, a patch of the wall`, mm(2 * rd)));
  }
  requireWithinHost(component, context, rdIn / Math.sin(theta));

  // The nozzle's own frame: h along its axis from the vessel's, ρ from its axis. Built about +Z at
  // the origin, turned onto the radial at the placement's azimuth and moved to its offset, then
  // leant to θ about the tangent through where its axis leaves the shell's outer surface — so the
  // datum boss_height is measured from stays where it is.
  const phi = placement.azimuth * DEG;
  const pivot: Vec3 = [outer * Math.cos(phi), outer * Math.sin(phi), z];
  const tangent: Vec3 = [-Math.sin(phi), Math.cos(phi), 0];
  const place = (solid: Solid): Solid =>
    kernel.rotate(kernel.translate(kernel.rotateZ(kernel.rotate(solid, 90, [0, 1, 0]), placement.azimuth), [0, 0, z]), (theta - Math.PI / 2) / DEG, tangent, pivot);
  const end = outer + height;
  const zBreak = end - coneHeight;
  const zNeck = zBreak + (rb - rp) / Math.tan(alpha);
  const UP: Vec = [0, 1];
  const cone: Vec = [-Math.sin(alpha), Math.cos(alpha)];
  const brk = corner([rb, zBreak], UP, cone, breakRadius);
  const nck = corner([rp, zNeck], cone, UP, neckRadius);
  const cylinderTop = brk ? brk.from[1] : zBreak;
  const coneEnd = nck ? nck.from : ([rp, zNeck] as Vec);
  const neckStart = nck ? nck.to[1] : zNeck;
  // The root fillet climbs the boss from where it leaves the shell, at the axial plane's R_o.
  if (!(cylinderTop > outer + root + 1e-9)) {
    throw new BuildError(
      component,
      `leaves no boss between its root and its cone: ${mm(coneHeight)} of cone in ${mm(height)}`,
      scope('out_of_scope', Sym.BOSS_CONE_HEIGHT, `< ${mm(height - root - (brk?.reach ?? 0))}`, mm(coneHeight))
    );
  }
  if (!(neckStart < end - 1e-9) || !(coneEnd[1] > (brk ? brk.to[1] : zBreak) - 1e-9)) {
    throw new BuildError(
      component,
      `leaves no neck: a ${alpha / DEG}° cone from ${mm(2 * rb)} to ${mm(2 * rp)} is longer than ${mm(coneHeight)}`,
      scope('out_of_scope', Sym.BOSS_CONE_HEIGHT, `> ${mm((rb - rp) / Math.tan(alpha) + (nck?.reach ?? 0))}`, mm(coneHeight))
    );
  }
  const arcThrough = (to: Vec, through: Vec): ProfileStep => ({ kind: 'arc', to, through });
  const line = (to: Vec): ProfileStep => ({ kind: 'line', to });
  // From the vessel's axis up: the vessel's inside is cut away after, the wall is the disc's.
  const standing = kernel.revolve({
    start: [0, 0],
    steps: [
      line([rb, 0]),
      line([rb, cylinderTop]),
      ...(brk ? [arcThrough(brk.to, brk.mid)] : []),
      line(coneEnd),
      ...(nck ? [arcThrough(nck.to, nck.mid)] : []),
      line([rp, end]),
      line([0, end]),
    ],
  });

  // The joint face: ρ = r_d at the outer surface on the axis, widening inward by the lean. Below
  // the inner surface it only has to clear the wall, so it stops short of the vessel's axis.
  const low = Math.max(0, Math.sqrt(Math.max(0, inner * inner - rdIn * rdIn)) - t);
  const at = (h: number) => rd + (outer - h) * Math.tan(lean);
  const joint = kernel.revolve({ start: [0, low], steps: [line([at(low), low]), line([at(end), end]), line([0, end])] });

  const frame = {
    origin: pivot,
    axis: [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)] as Vec3,
    wall: t / Math.sin(theta),
  };
  const tool = place(joint);
  const disc = kernel.intersect(context.hostSolid, tool);
  const boss = kernel.cut(place(standing), [hostSurface.cavity()]);
  const bore = kernel.tube(frame, 0, ri, -(t + 2 * rdIn), height + 1);
  const forging = kernel.cut(kernel.fuse(disc, boss), [bore]);

  // The root and the bore's edge, found by where they run: at the boss's radius on the shell's
  // outside, at the bore's on its inside.
  const across = (p: Vec3) => {
    const v: Vec3 = [p[0] - frame.origin[0], p[1] - frame.origin[1], p[2] - frame.origin[2]];
    const along = v[0] * frame.axis[0] + v[1] * frame.axis[1] + v[2] * frame.axis[2];
    return Math.hypot(v[0] - along * frame.axis[0], v[1] - along * frame.axis[1], v[2] - along * frame.axis[2]);
  };
  const tolerance = 1e-3 * Math.max(1, rb);
  // One at a time, so each can be seen to have done what it should: the root ADDS metal, the
  // bore's round takes it off, and together they can nearly cancel.
  const round = (solid: Solid, radius: number, at: number, side: 'inside' | 'outside', symbol: string, what: string, grows: boolean): Solid => {
    let rounded: Solid;
    try {
      rounded = kernel.fillet(solid, (edge) => (Math.abs(across(edge.middle) - at) < tolerance && hostSurface.sideOf(edge.middle) === side ? radius : null));
    } catch (error) {
      throw new BuildError(component, `could not have its ${what} (${mm(radius)}) rounded: ${error instanceof Error ? error.message : String(error)}`, scope('out_of_scope', symbol, 'a radius the kernel can blend', mm(radius)));
    }
    const change = kernel.volume(rounded) - kernel.volume(solid);
    if (!(grows ? change > 0 : change < 0)) {
      throw new BuildError(component, `has a ${what} that was not found on the forging`, scope('out_of_scope', symbol, `a ${what} the kernel finds`, mm(radius)));
    }
    return rounded;
  };
  const rooted = round(forging, root, rb, 'outside', Sym.BOSS_ROOT_RADIUS, 'root fillet', true);
  const rounded = boreEdge > 0 ? round(rooted, boreEdge, ri, 'inside', Sym.BOSS_BORE_EDGE_RADIUS, 'bore edge round', false) : rooted;

  return {
    solids: [rounded],
    opening: { tool, frame, radius: rd, ...(lean > 0 ? { taper: Math.tan(lean) } : {}), depth: t + 2 * rdIn },
    footprint: rdIn / Math.sin(theta),
    neck: {
      insideRadius: ri,
      outsideRadius: rd,
      outward: height,
      inward: 0,
      insert: true,
      end: { insideRadius: ri, outsideRadius: rp },
    },
    notes,
  };
};
