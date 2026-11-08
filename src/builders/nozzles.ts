// Nozzles: the five geometries §4.5 distinguishes, each one a neck set through its host's wall.
//
// They differ only in where the neck's axis runs — normal to the wall, offset from the vessel
// axis, leaning towards it, or square to it in a cone — so each one states its axis and the
// neck, its projections, its pad and the real opening in the host are built the same way. The
// opening is always a boolean: an ellipse where the axis is not normal to the wall.
import {
  AnchorError,
  BuildError,
  NotDrawnError,
  Sym,
  assumedNote,
  notBuiltNote,
  note,
  optionalDimension,
  representedNote,
  requireDimension,
  scope,
  type ComponentDefinition,
  type Note,
} from '../definition.ts';
import type { Vec3 } from '../kernel/GeometryKernel.ts';
import { mm, requireWithinHost } from './placing.ts';
import type { CourseShape, HostFrame, MountedBuilder, MountedContext, MountedPart, Neck } from './types.ts';

const DEG = Math.PI / 180;

/** Where a neck runs, and how far its opening reaches along the host's offset. */
interface Aim {
  readonly frame: HostFrame;
  readonly footprint: number;
  /** A pad is only drawn round a neck normal to a cylindrical course. */
  readonly padAllowed: boolean;
}

type Aimer = (component: ComponentDefinition, context: MountedContext, outside: number) => Aim;

function courseOf(component: ComponentDefinition, context: MountedContext, what: string): CourseShape {
  const course = context.hostSurface.course;
  if (!course) {
    throw new NotDrawnError(
      component,
      `${what} is drawn in a course, and ${context.host.name} is not one`,
      scope('out_of_scope', 'host', 'a cylindrical or conical course', context.host.kind)
    );
  }
  return course;
}

function nozzle(aimer: Aimer): MountedBuilder {
  return (component, context) => {
    const { kernel, hostSurface, host } = context;
    const inside = requireDimension(component, Sym.NOZZLE_INSIDE_DIAMETER) / 2;
    const outside = inside + requireDimension(component, Sym.NOZZLE_THICKNESS);
    const notes: Note[] = [];

    let outward = optionalDimension(component, Sym.NOZZLE_OUTWARD_PROJECTION);
    if (outward === undefined) {
      outward = Math.max(150, 2 * outside);
      notes.push(assumedNote(`Outward projection not stated — drawn ${mm(outward)}`, Sym.NOZZLE_OUTWARD_PROJECTION, mm(outward)));
    }
    // The kernel invents no weld: a stated leg is carried on the joint, and not drawn yet.
    for (const leg of [Sym.OUTER_FILLET_WELD_LEG, Sym.INNER_FILLET_WELD_LEG, Sym.PAD_FILLET_WELD_LEG]) {
      const value = optionalDimension(component, leg);
      if (value !== undefined) {
        notes.push(notBuiltNote(`A ${leg.replace(/_/g, ' ')} of ${mm(value)} is stated but not drawn`, leg, mm(value), 'any entry: the kernel draws no weld', true));
      }
    }
    const inward = optionalDimension(component, Sym.NOZZLE_INWARD_PROJECTION) ?? 0;

    const { frame, footprint, padAllowed } = aimer(component, context, outside);
    if (!frame.origin.every(Number.isFinite) || !(frame.wall > 0)) {
      throw new AnchorError(
        component,
        `no surface of ${host.name} where it is placed`,
        scope('out_of_scope', 'placement', `on the surface of ${host.name}`, `${mm(context.placement.axialOffset)}, ${context.placement.azimuth}°`)
      );
    }

    // Deep enough to cross the wall all round the neck, where a curved or sloping host falls
    // away from the axis.
    const through = frame.wall + 2 * footprint + 1;
    const neck =
      inward > 0
        ? kernel.tube(frame, inside, outside, -(frame.wall + inward), outward)
        : kernel.cut(kernel.tube(frame, inside, outside, -through, outward), [hostSurface.cavity()]);
    const solids = [neck];

    const padWidth = optionalDimension(component, Sym.PAD_WIDTH);
    const padThickness = optionalDimension(component, Sym.PAD_THICKNESS);
    let pad: Neck['pad'];
    if (padWidth !== undefined && padThickness !== undefined) {
      const radius = hostSurface.outsideRadius;
      if (radius === undefined || !padAllowed) {
        // Anywhere else, the pad is the host's own wall thickened outward, within its reach of the
        // neck's axis: its inner face IS the host's outside surface, a knuckle's or a cone's alike.
        const reach = outside + padWidth;
        const along = reach * (footprint / outside);
        const [low, high] = hostSurface.offsetRange;
        const at = context.placement.axialOffset;
        const fits = hostSurface.anchor === 'head_crown' ? at + reach <= high : at - along >= low && at + along <= high;
        if (fits && !context.thickenedHost) {
          // Tapered at a joint, the host is no longer what its builder would make thicker.
          notes.push(
            notBuiltNote(
              'Reinforcing pad not drawn: its host is tapered at a joint',
              Sym.PAD_WIDTH,
              `${mm(padWidth)} × ${mm(padThickness)} on ${host.kind}`,
              `${component.kind} on a host tapered to its neighbour`
            )
          );
        } else if (!fits) {
          notes.push(
            note(
              'Reinforcing pad reaches past its host',
              Sym.PAD_WIDTH,
              hostSurface.anchor === 'head_crown'
                ? scope('out_of_scope', 'pad reach from the axis', `≤ ${mm(high)}, the inside radius of ${host.name}`, mm(at + reach))
                : scope('out_of_scope', `pad edge along ${host.name}`, `within ${mm(low)} to ${mm(high)}, its one host`, `${mm(at - along)} to ${mm(at + along)}`)
            )
          );
        } else if (context.thickenedHost) {
          const around = kernel.tube(frame, outside, reach, -(through + 2 * reach), padThickness + 2 * reach);
          const thick = context.thickenedHost(padThickness);
          solids.push(kernel.cut(kernel.intersect(thick, around), [context.hostSolid ?? hostSurface.cavity(), hostSurface.cavity()]));
          pad = { reach, thickness: padThickness };
          // Not normal to the surface, the reach is measured square to the neck rather than along it.
          const wallHere = hostSurface.wallAt(at);
          const phi = (context.placement.azimuth * Math.PI) / 180;
          const axialRadial = frame.axis[0] * Math.cos(phi) + frame.axis[1] * Math.sin(phi);
          const normality = Math.abs(axialRadial * wallHere.meridian[1] - frame.axis[2] * wallHere.meridian[0]);
          if (normality < 0.999) {
            notes.push(
              representedNote(
                `Reinforcing pad's width measured square to the neck, ${Math.round((Math.acos(Math.min(1, normality)) * 180) / Math.PI)}° off the surface's normal`,
                'pad width',
                `${mm(padWidth)} along the surface`,
                `${mm(padWidth)} square to the neck's axis`
              )
            );
          }
        }
      } else {
        pad = { reach: outside + padWidth, thickness: padThickness };
        const reach = outside + padWidth;
        const z = frame.origin[2];
        const band = kernel.revolve({
          start: [radius, z - reach - 1],
          steps: [
            { kind: 'line', to: [radius + padThickness, z - reach - 1] },
            { kind: 'line', to: [radius + padThickness, z + reach + 1] },
            { kind: 'line', to: [radius, z + reach + 1] },
          ],
        });
        const around = kernel.tube(frame, outside, reach, -frame.wall, padThickness + reach + 1);
        solids.push(kernel.intersect(band, around));
      }
    }

    let tool = kernel.tube(frame, 0, outside, -through, 2 * footprint + 10);
    let bore = outside;
    let hostAddition: MountedPart['hostAddition'];
    if (context.corner) {
      const rounded = roundCorners(
        context,
        frame,
        { inside, outside, inward, outward, through },
        solids[0],
        tool,
        pad !== undefined
      );
      solids[0] = rounded.neck;
      tool = rounded.tool;
      bore = rounded.bore ?? outside;
      hostAddition = rounded.hostAddition;
      notes.push(...rounded.notes);
    }

    const part: MountedPart = {
      solids,
      ...(hostAddition ? { hostAddition } : {}),
      opening: {
        tool,
        frame,
        // Rounded, the host is bored past the corner's toes and given the rounding back as a solid.
        radius: bore,
        depth: through,
      },
      footprint,
      neck: { insideRadius: inside, outsideRadius: outside, outward, inward, pad },
      notes,
    };
    return part;
  };
}

/**
 * A nozzle's two corners rounded, as a construction detail declares them.
 *
 * The catalogue nozzle is a uniform tube meeting its host at a sharp corner, which no real nozzle
 * has: the crotch, where the neck meets the host's outside surface, is welded or forged to a
 * radius, and the bore's edge at the inside surface is ground to one. The neck and the host stay
 * separate solids — whoever meshes them decides where they are joined — so the rounding is done
 * on a patch of the host fused with the neck, and the result split back into the two across the
 * fillets (see below). The edges are chosen by where they run — at the neck's radius from its axis,
 * on the host's surface — never by index.
 */
function roundCorners(
  context: MountedContext,
  frame: HostFrame,
  neck: { inside: number; outside: number; inward: number; outward: number; through: number },
  neckSolid: ReturnType<MountedContext['kernel']['tube']>,
  tool: ReturnType<MountedContext['kernel']['tube']>,
  padded: boolean
): { neck: typeof neckSolid; hostAddition?: typeof neckSolid; tool: typeof tool; bore?: number; notes: Note[] } {
  const { kernel, hostSurface } = context;
  const { outside: rOut, inside: rIn } = context.corner!;
  const refused = (message: string, parameter: string, limit: string, value: string) => ({
    neck: neckSolid,
    tool,
    notes: [note(message, undefined, scope('not_built', parameter, limit, value))],
  });
  if (padded) {
    return refused(
      'Corner radii not drawn: the neck meets a reinforcing pad, not the host',
      'nozzle corner radius',
      'a nozzle without a pad',
      `${mm(rOut)} outside, ${mm(rIn)} inside`
    );
  }
  if (!context.hostSolid) {
    return refused('Corner radii not drawn: the host solid is not available', 'nozzle corner radius', 'a drawn host', 'none');
  }

  const reach = neck.outside + 3 * Math.max(rOut, rIn) + neck.through;
  const patch = kernel.cut(kernel.intersect(context.hostSolid, kernel.tube(frame, 0, reach, -(neck.through + 2 * reach), 2 * reach)), [tool]);
  const fused = kernel.fuse(patch, neckSolid);

  // Where an edge runs, in the neck's own terms: how far from its axis, how far along it.
  const across = (p: readonly [number, number, number]) => {
    const v = [p[0] - frame.origin[0], p[1] - frame.origin[1], p[2] - frame.origin[2]];
    const along = v[0] * frame.axis[0] + v[1] * frame.axis[1] + v[2] * frame.axis[2];
    const off = Math.hypot(v[0] - along * frame.axis[0], v[1] - along * frame.axis[1], v[2] - along * frame.axis[2]);
    return { along, off };
  };
  const tolerance = 1e-3 * Math.max(1, neck.outside);
  const near = (p: readonly [number, number, number], radius: number, side: 'inside' | 'outside') => {
    const { along, off } = across(p);
    return Math.abs(off - radius) < tolerance && along <= 1 && along >= -(neck.through + 1) && hostSurface.sideOf(p) === side;
  };
  // Inside, the corner is the bore's edge on a flush neck, and the neck's own crotch on one that
  // projects inwards: it then ADDS metal, as the outside one does.
  const insideRadius = neck.inward > 0 ? neck.outside : neck.inside;

  let rounded;
  try {
    rounded = kernel.fillet(fused, (edge) =>
      rOut > 0 && near(edge.middle, neck.outside, 'outside') ? rOut : rIn > 0 && near(edge.middle, insideRadius, 'inside') ? rIn : null
    );
  } catch (error) {
    return refused(
      `Corner radii not drawn: the kernel could not round them (${error instanceof Error ? error.message : String(error)})`,
      'nozzle corner radius',
      'rounded by the kernel',
      `${mm(rOut)} outside, ${mm(rIn)} inside`
    );
  }
  // A radius that rounded nothing is a corner the selector did not find: said, never passed off.
  const changed = Math.abs(kernel.volume(rounded) - kernel.volume(fused)) + kernel.volume(kernel.cut(fused, [rounded]));
  if (!(changed > 0)) {
    return refused(
      'Corner radii not drawn: the corner was not found on the neck',
      'nozzle corner radius',
      'a corner where the neck meets the host',
      `${mm(rOut)} outside, ${mm(rIn)} inside`
    );
  }
  // Split back into neck and host ACROSS the fillets, never along them. A fillet meets the surfaces it
  // rounds tangentially, so a boundary between two solids laid along it — the ring the rounding adds,
  // as its own solid — ends in a knife edge of zero angle at each toe, which no boolean downstream can
  // unite and no tetrahedron can fill (Demo A's N1 at PTB-3's radii: OCC's fuse returned no solid, and
  // NETGEN 192 inverted cells). Two cylinders about the neck's axis instead: the neck takes everything
  // within r_s, half way up the crotch's radius; the host takes the rest out to r_p, past both toes, as a
  // second solid beside its own wall bored to r_p. Each toe then lies inside ONE solid, and every
  // boundary between two of them crosses the wall or the fillet square to it.
  const toes = Math.max(neck.outside + rOut, (neck.inward > 0 ? neck.outside : neck.inside) + rIn);
  const bore = toes + Math.max(frame.wall, 5);
  // With no crotch radius, half way out to the bore: at r_o itself the split would lie ON the neck's
  // outside surface, two coincident faces (NETGEN: "some edges multiple times in surface mesh").
  const split = rOut > 0 ? neck.outside + rOut / 2 : (neck.outside + bore) / 2;
  const down = -(neck.through + 2 * reach);
  const up = Math.max(2 * reach, neck.outward + 10);
  return {
    neck: kernel.intersect(rounded, kernel.tube(frame, 0, split, down, up)),
    hostAddition: kernel.intersect(rounded, kernel.tube(frame, split, bore, down, up)),
    tool: kernel.tube(frame, 0, bore, -neck.through, up),
    bore,
    notes: [],
  };
}

/** §4.5.5 and §4.5.10 — normal to the wall, whatever the host. */
const radial: Aimer = (component, context, outside) => {
  requireWithinHost(component, context, outside);
  return {
    frame: context.hostSurface.frameAt(context.placement.axialOffset, context.placement.azimuth),
    footprint: outside,
    padAllowed: true,
  };
};

/**
 * §4.5.6 — parallel to a radius of a cylinder but offset from the vessel axis by `D_X`, so it
 * meets the wall off-centre and cuts an ellipse stretched round the circumference.
 */
const hillside: Aimer = (component, context, outside) => {
  const course = courseOf(component, context, 'a hillside nozzle');
  if (course.halfApexAngle !== 0) {
    throw new NotDrawnError(
      component,
      `a hillside nozzle is drawn in a cylinder, and ${context.host.name} is a cone`,
      scope('out_of_scope', 'host half-apex angle', '0° (a cylinder)', `${course.halfApexAngle}°`)
    );
  }
  const offset = requireDimension(component, Sym.NOZZLE_OFFSET);
  requireWithinHost(component, context, outside);

  const z = context.placement.axialOffset;
  const a = course.insideRadiusAt(z);
  const ro = course.outsideRadiusAt(z);
  if (offset + outside >= a) {
    throw new AnchorError(
      component,
      `offset ${mm(offset)} from the axis, its ${mm(2 * outside)} neck no longer meets the inside of ${context.host.name} (radius ${mm(a)})`,
      scope('out_of_scope', `${Sym.NOZZLE_OFFSET} plus the neck's outside radius`, `< ${mm(a)}, the inside radius`, mm(offset + outside))
    );
  }

  const phi = context.placement.azimuth * DEG;
  const radial: Vec3 = [Math.cos(phi), Math.sin(phi), 0];
  const across: Vec3 = [-Math.sin(phi), Math.cos(phi), 0];
  const out = Math.sqrt(ro * ro - offset * offset);
  const inn = Math.sqrt(a * a - offset * offset);
  return {
    frame: {
      origin: [offset * across[0] + out * radial[0], offset * across[1] + out * radial[1], z],
      axis: radial,
      wall: out - inn,
    },
    footprint: outside,
    padAllowed: true,
  };
};

/**
 * §4.5.7 — in a cylinder, on the centreline of the course but leaning: its axis makes `θ` with
 * the vessel axis, and the opening stretches to `R_n/sin θ` along the course.
 */
const angled: Aimer = (component, context, outside) => {
  const course = courseOf(component, context, 'a nozzle at an angle');
  if (course.halfApexAngle !== 0) {
    throw new NotDrawnError(
      component,
      `a nozzle at an angle is drawn in a cylinder, and ${context.host.name} is a cone`,
      scope('out_of_scope', 'host half-apex angle', '0° (a cylinder, §4.5.7)', `${course.halfApexAngle}°`)
    );
  }
  const theta = requireDimension(component, Sym.NOZZLE_ANGLE);
  if (theta >= 180) {
    throw new BuildError(
      component,
      `leans at ${theta}°, which is not an angle to the axis`,
      scope('out_of_scope', Sym.NOZZLE_ANGLE, '< 180°', `${theta}°`)
    );
  }
  const sin = Math.sin(theta * DEG);
  const footprint = outside / sin;
  requireWithinHost(component, context, footprint);

  const z = context.placement.axialOffset;
  const ro = course.outsideRadiusAt(z);
  const phi = context.placement.azimuth * DEG;
  return {
    frame: {
      origin: [ro * Math.cos(phi), ro * Math.sin(phi), z],
      axis: [sin * Math.cos(phi), sin * Math.sin(phi), Math.cos(theta * DEG)],
      wall: course.thickness / sin,
    },
    footprint,
    padAllowed: false,
  };
};

/** §4.5.9.1 — in a cone, square to the vessel axis: horizontal, cutting `R_n/cos α` along the cone. */
const perpendicular: Aimer = (component, context, outside) => {
  const course = courseOf(component, context, 'a nozzle perpendicular to the axis');
  requireWithinHost(component, context, outside);

  const z = context.placement.axialOffset;
  const cos = Math.cos(course.halfApexAngle * DEG);
  const ro = course.outsideRadiusAt(z);
  const phi = context.placement.azimuth * DEG;
  return {
    frame: {
      origin: [ro * Math.cos(phi), ro * Math.sin(phi), z],
      axis: [Math.cos(phi), Math.sin(phi), 0],
      wall: course.thickness / cos,
    },
    footprint: outside,
    padAllowed: course.halfApexAngle === 0,
  };
};

/**
 * §4.5.9.2 — in a cone, parallel to the vessel axis: vertical, meeting the sloping wall on a
 * chord of `R_n/sin α`. The shallower the cone, the longer the chord.
 */
const axial: Aimer = (component, context, outside) => {
  const course = courseOf(component, context, 'a nozzle parallel to the axis');
  const alpha = course.halfApexAngle;
  if (alpha <= 0) {
    throw new NotDrawnError(
      component,
      `a nozzle parallel to the axis never meets the wall of a cylinder`,
      scope('out_of_scope', 'host half-apex angle', '> 0° (a cone, §4.5.9.2)', `${alpha}°`)
    );
  }
  const footprint = outside / Math.tan(alpha * DEG);
  requireWithinHost(component, context, footprint);

  const z = context.placement.axialOffset;
  const rho = course.outsideRadiusAt(z);
  const phi = context.placement.azimuth * DEG;
  return {
    frame: {
      origin: [rho * Math.cos(phi), rho * Math.sin(phi), z],
      axis: [0, 0, 1],
      wall: course.thickness / Math.sin(alpha * DEG),
    },
    footprint,
    padAllowed: false,
  };
};

export const radialNozzle = nozzle(radial);
export const hillsideNozzle = nozzle(hillside);
export const angledNozzle = nozzle(angled);
export const perpendicularNozzle = nozzle(perpendicular);
export const axialNozzle = nozzle(axial);
