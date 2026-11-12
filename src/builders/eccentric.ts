// §4.3.4's eccentric cone: a transition whose two ends do not share an axis.
//
// One generatrix stays square to the ends, in line with the shells either side — the flat side,
// which a horizontal drum keeps at the bottom so it drains — and the one opposite takes the
// whole slope. Every section square to the axis is still a CIRCLE: only its centre moves, and its
// radius with it. So the part is not revolved: its circles are lofted, and it states their
// centres beside its meridian, which is all layer 1 (`ports/section.ts`) needs to describe it.
//
// CODAP C2.3.8's cone between two cylinders on parallel, offset axes is the same lofted body with
// the offset free. The rules engine carries it as a `conical_shell` stating `cone_axis_offset`,
// not as a kind of its own, so that is how it is drawn: `conicalShell` hands it over here.
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
  note,
  signedDimension,
  type ComponentDefinition,
  type Note,
} from '../definition.ts';
import type { CircleSection, Point2 } from '../kernel/GeometryKernel.ts';
import { mm } from './placing.ts';
import type { RunBuilder, RunContext, RunPart } from './types.ts';

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

  const notes = sharpEnds(component);
  const facing = signedDimension(component, Sym.FLAT_SIDE_AZIMUTH);
  if (facing === undefined) notes.push(assumedNote('Flat side not oriented — drawn facing +X', Sym.FLAT_SIDE_AZIMUTH, '0°'));

  const R = large / 2;
  const r = small / 2;
  // The centre moves towards the flat side by what the radius loses, so that side stays put.
  return loftedCone(context, { R, r, t, height: (large - small) / Math.tan(alpha * DEG), shift: R - r, phi: (facing ?? 0) * DEG, steep: alpha }, notes);
};

/**
 * CODAP C2.3.8: a `conical_shell` that states `cone_axis_offset`, `δ`, joins two cylinders whose
 * axes are parallel and `δ` apart. Read the way the rules engine reads it: the stated `α` is the
 * SYMMETRIC generatrix's, so the cone is `L = (D − D_s)/(2·tan α)` long whatever `δ` is, and one
 * side steepens to `α_max = atan(((D − D_s)/2 + δ)/L)` while the other eases by as much — which is
 * the angle C2.3.8.2 runs C2.3.5 to C2.3.7 at. The catalogue carries no direction for the offset,
 * so it is drawn towards +X. Unstated or zero, the cone is the symmetric one, and is revolved.
 */
export const offsetConicalShell = (component: ComponentDefinition, context: RunContext): RunPart => {
  const { kernel } = context;
  const large = requireDimension(component, Sym.INSIDE_DIAMETER);
  const small = requireDimension(component, Sym.SMALL_END_DIAMETER);
  const alpha = requireDimension(component, Sym.HALF_APEX_ANGLE);
  const t = requireDimension(component, Sym.THICKNESS);
  const delta = requireDimension(component, Sym.CONE_AXIS_OFFSET);
  if (small >= large) {
    throw new BuildError(component, `narrows from ${mm(large)} to ${mm(small)}`, scope('out_of_scope', Sym.SMALL_END_DIAMETER, `< ${mm(large)}, the large end`, mm(small)));
  }
  if (alpha >= 90) {
    throw new BuildError(component, `has a half-apex angle of ${alpha}°`, scope('out_of_scope', Sym.HALF_APEX_ANGLE, '< 90°', `${alpha}°`));
  }
  if (!kernel.loft) {
    throw new NotDrawnError(component, 'an offset cone is lofted through its circles, and this kernel cannot loft', scope('not_built', 'kernel operation', 'loft', 'absent'));
  }

  const R = large / 2;
  const r = small / 2;
  const height = (R - r) / Math.tan(alpha * DEG);
  const steep = Math.atan((R - r + delta) / height) / DEG;
  const gentle = Math.atan((R - r - delta) / height) / DEG;
  const notes = sharpEnds(component);
  notes.push(
    note('The catalogue carries no direction for the offset — drawn towards +X', undefined, scope('assumed', 'direction of the offset', 'not carried by the catalogue', '+X')),
    representedNote(
      `Its axes are ${mm(delta)} apart (CODAP C2.3.8): α is the symmetric generatrix's, so one side is at α_max = ${Number(steep.toPrecision(4))}° and the other at ${Number(gentle.toPrecision(4))}°`,
      Sym.CONE_AXIS_OFFSET,
      `${alpha}° all round`,
      `${Number(steep.toPrecision(4))}° to ${Number(gentle.toPrecision(4))}°`
    )
  );
  return loftedCone(context, { R, r, t, height, shift: delta, phi: 0, steep }, notes);
};

/** Knuckles and flares are drawn on a revolved cone only. */
function sharpEnds(component: ComponentDefinition): Note[] {
  const notes: Note[] = [];
  for (const symbol of [Sym.KNUCKLE_RADIUS, Sym.FLARE_RADIUS]) {
    const stated = optionalDimension(component, symbol);
    if (stated !== undefined) {
      notes.push(notBuiltNote(`A ${symbol.replace(/_/g, ' ')} on an eccentric cone is not drawn: its ends are sharp`, symbol, mm(stated), component.kind));
    }
  }
  return notes;
}

interface ConeGeometry {
  /** The two inside radii, large then small. */
  readonly R: number;
  readonly r: number;
  readonly t: number;
  readonly height: number;
  /** How far the small end's centre stands off the large end's, towards `phi`. */
  readonly shift: number;
  readonly phi: number;
  /** The steepest generatrix's angle to the axis, degrees. */
  readonly steep: number;
}

/** Circles from `R` to `r` whose centres walk `shift` towards `phi`, lofted and bored. */
function loftedCone(context: RunContext, geometry: ConeGeometry, notes: Note[]): RunPart {
  const { kernel } = context;
  // Both callers refuse a kernel that cannot loft before they get here.
  const loft = kernel.loft!.bind(kernel);
  const { R, r, t, height, shift, phi, steep } = geometry;
  const large = 2 * R;
  const small = 2 * r;
  const centreAt = (z: number): Point2 => [(shift * z * Math.cos(phi)) / height, (shift * z * Math.sin(phi)) / height];
  const circlesAt = (z: number, extra: number): CircleSection => ({ z, centre: centreAt(z), radius: R + ((r - R) * z) / height + extra });

  // The wall is t WIDE in every section, so each end meets a cylinder of t flush on both faces.
  // Normal to the wall that is t·cos of each side's angle: t itself on a flat side.
  const margin = Math.max(1, t);
  const outer = loft([circlesAt(0, t), circlesAt(height, t)]);
  const bore = loft([circlesAt(-margin, 0), circlesAt(height + margin, 0)]);
  const gentle = mm(t * Math.cos(Math.atan((R - r - shift) / height)));
  const side = Math.abs(R - r - shift) < 1e-9 ? 'flat' : 'gentler';
  notes.push(
    representedNote(
      `Its wall is ${mm(t)} wide in every section, so both ends meet a ${mm(t)} cylinder flush: normal to the wall that is ${gentle} on the ${side} side and ${mm(t * Math.cos(steep * DEG))} on the steep side`,
      'wall thickness normal to the wall',
      `${mm(t)} all round`,
      `${gentle} on the ${side} side to ${mm(t * Math.cos(steep * DEG))} on the steep side`
    )
  );

  // In the half-plane of azimuth 0, as a port reads it: vertical only where the flat side is.
  const dx = (shift * Math.cos(phi) - (R - r)) / height;
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
}
