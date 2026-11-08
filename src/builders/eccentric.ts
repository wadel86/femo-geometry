// §4.3.4's eccentric cone: a transition whose two ends do not share an axis.
//
// One generatrix stays square to the ends, in line with the shells either side — the flat side,
// which a horizontal drum keeps at the bottom so it drains — and the one opposite takes the
// whole slope. Every section square to the axis is still a CIRCLE: only its centre moves, and its
// radius with it. So the part is not revolved: its circles are lofted, and it states their
// centres beside its meridian, which is all layer 1 (`ports/section.ts`) needs to describe it.
import {
  BuildError,
  NotDrawnError,
  Sym,
  assumedNote,
  notBuiltNote,
  optionalDimension,
  representedNote,
  requireDimension,
  scope,
  signedDimension,
  type Note,
} from '../definition.ts';
import type { CircleSection, Point2 } from '../kernel/GeometryKernel.ts';
import { mm } from './placing.ts';
import type { RunBuilder } from './types.ts';

const DEG = Math.PI / 180;

/**
 * An eccentric cone from `D` at its lower end to `D_s` at its upper, `α` being the angle its
 * steep side makes with the axis — the largest half-apex angle round it, which is the one
 * §4.3.4 reads for an eccentric cone. The tangent side faces `flat_side_azimuth`.
 */
export const eccentricConicalShell: RunBuilder = (component, context) => {
  const { kernel } = context;
  const large = requireDimension(component, Sym.INSIDE_DIAMETER);
  const small = requireDimension(component, Sym.SMALL_END_DIAMETER);
  const alpha = requireDimension(component, Sym.HALF_APEX_ANGLE);
  const t = requireDimension(component, Sym.THICKNESS);
  if (small >= large) {
    throw new BuildError(
      component,
      `narrows from ${mm(large)} to ${mm(small)}`,
      scope('out_of_scope', Sym.SMALL_END_DIAMETER, `< ${mm(large)}, the large end`, mm(small))
    );
  }
  if (alpha >= 90) {
    throw new BuildError(component, `has a steep side at ${alpha}° to the axis`, scope('out_of_scope', Sym.HALF_APEX_ANGLE, '< 90°', `${alpha}°`));
  }
  if (!kernel.loft) {
    throw new NotDrawnError(
      component,
      'an eccentric cone is lofted through its circles, and this kernel cannot loft',
      scope('not_built', 'kernel operation', 'loft', 'absent')
    );
  }

  const notes: Note[] = [];
  for (const symbol of [Sym.KNUCKLE_RADIUS, Sym.FLARE_RADIUS]) {
    const stated = optionalDimension(component, symbol);
    if (stated !== undefined) {
      notes.push(notBuiltNote(`A ${symbol.replace(/_/g, ' ')} on an eccentric cone is not drawn: its ends are sharp`, symbol, mm(stated), 'eccentric_conical_shell'));
    }
  }
  const facing = signedDimension(component, Sym.FLAT_SIDE_AZIMUTH);
  if (facing === undefined) notes.push(assumedNote('Flat side not oriented — drawn facing +X', Sym.FLAT_SIDE_AZIMUTH, '0°'));
  const phi = (facing ?? 0) * DEG;

  const R = large / 2;
  const r = small / 2;
  const height = (large - small) / Math.tan(alpha * DEG);
  // The centre moves towards the flat side by what the radius loses, so that side stays put.
  const shift = R - r;
  const centreAt = (z: number): Point2 => [(shift * z * Math.cos(phi)) / height, (shift * z * Math.sin(phi)) / height];
  const circlesAt = (z: number, extra: number): CircleSection => ({ z, centre: centreAt(z), radius: R + ((r - R) * z) / height + extra });

  // The wall is t WIDE in every section, so each end meets a cylinder of t flush on both faces.
  // Normal to the wall that is t on the flat side and t·cos α on the steep one.
  const margin = Math.max(1, t);
  const outer = kernel.loft([circlesAt(0, t), circlesAt(height, t)]);
  const bore = kernel.loft([circlesAt(-margin, 0), circlesAt(height + margin, 0)]);
  notes.push(
    representedNote(
      `Its wall is ${mm(t)} wide in every section, so both ends meet a ${mm(t)} cylinder flush: normal to the wall that is ${mm(t)} on the flat side and ${mm(t * Math.cos(alpha * DEG))} on the steep side`,
      'wall thickness normal to the wall',
      `${mm(t)} all round`,
      `${mm(t)} on the flat side to ${mm(t * Math.cos(alpha * DEG))} on the steep side`
    )
  );

  // In the half-plane of azimuth 0, as a port reads it: vertical only where the flat side is.
  const dx = (shift / height) * (Math.cos(phi) - 1);
  const slope = Math.hypot(dx, 1);
  const top = centreAt(height);
  const wallAt = (direction: 1 | -1, meanRadius: number) => ({
    surface: { kind: 'cone' as const, principalRadii: [null, meanRadius] as const },
    thickness: t,
    meridian: [(direction * dx) / slope, direction / slope] as Point2,
  });
  return {
    solid: kernel.cut(outer, [bore]),
    height,
    lower: { insideDiameter: large, outsideDiameter: large + 2 * t, wall: wallAt(-1, R + t / 2) },
    upper: { insideDiameter: small, outsideDiameter: small + 2 * t, centre: top, wall: wallAt(1, r + t / 2) },
    landmarks: [
      { key: 'lower-inside', z: 0, diameter: large, role: 'Large end (inside)', junction: 'lower' },
      { key: 'lower-outside', z: 0, diameter: large + 2 * t, role: 'Large end (outside)', junction: 'lower' },
      { key: 'upper-inside', z: height, diameter: small, role: 'Small end (inside)', junction: 'upper', centre: top },
      { key: 'upper-outside', z: height, diameter: small + 2 * t, role: 'Small end (outside)', junction: 'upper', centre: top },
    ],
    meridian: [
      [R + t / 2, 0],
      [r + t / 2, height],
    ],
    centres: [[0, 0], top],
    notes,
  };
};
