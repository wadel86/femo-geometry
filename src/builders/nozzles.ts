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

    const part: MountedPart = {
      solids,
      opening: {
        tool: kernel.tube(frame, 0, outside, -through, 2 * footprint + 10),
        frame,
        radius: outside,
        depth: through,
      },
      footprint,
      neck: { insideRadius: inside, outsideRadius: outside, outward, inward, pad },
      notes,
    };
    return part;
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
