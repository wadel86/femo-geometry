// Closures that are not formed heads: bolted dished covers (§4.7), quick-actuating closures
// (§4.8) and braced and stayed plates (§4.9).
//
// Built like the heads, in the part's frame, rising from z = 0 where they meet the run; the
// assembly turns them over when they close its bottom.
import {
  BuildError,
  Sym,
  analysisNote,
  note,
  optionalDimension,
  requireDimension,
  type ComponentDefinition,
  type Note,
} from '../definition.ts';
import type { Point2, ProfileStep, Solid, Vec3 } from '../kernel/GeometryKernel.ts';
import { mm } from './placing.ts';
import type { Landmark, RunBuilder, RunContext } from './types.ts';
import { PLANE, sphereSurface } from './walls.ts';

const line = (r: number, z: number): ProfileStep => ({ kind: 'line', to: [r, z] });

/** The opening a closure with no diameter of its own closes: its neighbour's. */
function openingOf(component: ComponentDefinition, context: RunContext): number {
  const stated = optionalDimension(component, Sym.INSIDE_DIAMETER);
  if (stated !== undefined) return stated;
  if (context.neighbourInsideDiameter !== undefined) return context.neighbourInsideDiameter;
  throw new BuildError(component, 'has no diameter of its own and closes nothing it could take one from');
}

/**
 * A spherical dish of inside radius `L` and thickness `t`, whose inside meets the plane
 * `z = base` on a circle of radius `rim`. Convex upwards.
 */
function dish(context: RunContext, crown: number, thickness: number, rim: number, base: number) {
  if (rim >= crown) {
    throw new Error(`a crown radius of ${mm(crown)} cannot span an opening of ${mm(2 * rim)}`);
  }
  const zc = base - Math.sqrt(crown * crown - rim * rim);
  const outsideRim = Math.sqrt((crown + thickness) ** 2 - (base - zc) ** 2);
  const middle = (radius: number, from: number): Point2 => {
    const angle = (Math.atan2(base - zc, from) + Math.PI / 2) / 2;
    return [radius * Math.cos(angle), zc + radius * Math.sin(angle)];
  };
  const solid = context.kernel.revolve({
    start: [rim, base],
    steps: [
      line(outsideRim, base),
      { kind: 'arc', to: [0, zc + crown + thickness], through: middle(crown + thickness, outsideRim) },
      line(0, zc + crown),
      { kind: 'arc', to: [rim, base], through: middle(crown, rim) },
    ],
  });
  // The mid-surface's meridian at the rim, carried on past it: away from the dish.
  const middleRadius = crown + thickness / 2;
  const meridian: Point2 = [(base - zc) / crown, -rim / crown];
  return { solid, top: zc + crown + thickness, outsideRim, middleRadius, meridian };
}

/** §4.7 — the dish alone, closing what it sits on. */
export const sphericallyDishedCover: RunBuilder = (component, context) => {
  const crown = requireDimension(component, Sym.CROWN_RADIUS);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const opening = openingOf(component, context);

  let built;
  try {
    built = dish(context, crown, thickness, opening / 2, 0);
  } catch (error) {
    throw new BuildError(component, `: ${(error as Error).message}`);
  }
  return {
    solid: built.solid,
    height: built.top,
    lower: {
      insideDiameter: opening,
      outsideDiameter: 2 * built.outsideRim,
      wall: { surface: sphereSurface(built.middleRadius), thickness, meridian: built.meridian },
    },
    upper: null,
    landmarks: [
      { key: 'lower-inside', z: 0, diameter: opening, role: 'Dish rim (inside)', junction: 'lower' },
      { key: 'lower-outside', z: 0, diameter: 2 * built.outsideRim, role: 'Dish rim (outside)', junction: 'lower' },
    ],
    notes: [note('Drawn as the dish alone, on the opening of the part it closes')],
  };
};

/**
 * §4.7 Types B and C — the dish on a bolting ring of bore `B`, outside diameter `A` and
 * thickness `T`. Type B has the dish butt welded into the ring; Type C seats it on the ring's
 * face. Bolt holes are drawn when the number of bolts is stated.
 */
function dishedCoverOnRing(type: 'B' | 'C'): RunBuilder {
  return (component, context) => {
    const crown = requireDimension(component, Sym.CROWN_RADIUS);
    const thickness = requireDimension(component, Sym.THICKNESS);
    const bore = requireDimension(component, Sym.FLANGE_BORE);
    const outsideDiameter = requireDimension(component, Sym.FLANGE_OUTSIDE_DIAMETER);
    const ring = requireDimension(component, Sym.FLANGE_RING_THICKNESS);
    if (outsideDiameter <= bore) {
      throw new BuildError(component, 'has a ring outside diameter no larger than its bore');
    }
    const notes: Note[] = [
      analysisNote(`The dish meets the ring on a plane placed by convention (Type ${type})`),
    ];
    const { kernel } = context;

    let ringSolid: Solid = kernel.revolve({
      start: [bore / 2, 0],
      steps: [line(outsideDiameter / 2, 0), line(outsideDiameter / 2, ring), line(bore / 2, ring)],
    });

    const boltCircle = optionalDimension(component, Sym.BOLT_CIRCLE);
    const count = optionalDimension(component, Sym.BOLT_COUNT);
    if (boltCircle !== undefined && count !== undefined && count >= 2) {
      const hole =
        (optionalDimension(component, Sym.BOLT_DIAMETER) ?? Math.min(36, (outsideDiameter - boltCircle) / 2)) + 3;
      const holes = Array.from({ length: Math.round(count) }, (_, i) => {
        const angle = (2 * Math.PI * i) / Math.round(count);
        return kernel.tube(
          { origin: [(boltCircle / 2) * Math.cos(angle), (boltCircle / 2) * Math.sin(angle), 0], axis: [0, 0, 1] },
          0,
          hole / 2,
          -1,
          ring + 1
        );
      });
      ringSolid = kernel.cut(ringSolid, holes);
    } else {
      notes.push(note('Number of bolts not stated — the bolt holes are not drawn', Sym.BOLT_COUNT));
    }

    let built;
    try {
      built = dish(context, crown, thickness, bore / 2, type === 'B' ? ring / 2 : ring);
    } catch (error) {
      throw new BuildError(component, `: ${(error as Error).message}`);
    }

    const landmarks: Landmark[] = [
      { key: 'lower-inside', z: 0, diameter: bore, role: 'Ring bore, joint face', junction: 'lower' },
      { key: 'lower-outside', z: 0, diameter: outsideDiameter, role: 'Ring outside, joint face', junction: 'lower' },
      { key: 'ring-top-outside', z: ring, diameter: outsideDiameter, role: 'Ring outside, back face' },
    ];

    return {
      solid: ringSolid,
      extraSolids: [built.solid],
      height: Math.max(ring, built.top),
      lower: {
        insideDiameter: bore,
        outsideDiameter,
        face: true,
        wall: { surface: PLANE, thickness: (outsideDiameter - bore) / 2, meridian: [0, -1] },
      },
      upper: null,
      landmarks,
      notes,
    };
  };
}

export const dishedCoverTypeB = dishedCoverOnRing('B');
export const dishedCoverTypeC = dishedCoverOnRing('C');

/**
 * §4.8 — a quick-actuating closure, drawn as its door: a plate of thickness `t` over the
 * opening, with a lip. §4.8 provides no calculation method and neither is its locking
 * mechanism modelled.
 */
export const quickActuatingClosure: RunBuilder = (component, context) => {
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const rim = Math.max(diameter / 2 + Math.max(2 * thickness, 0.05 * diameter), context.neighbourOutsideRadius ?? 0);
  return {
    solid: context.kernel.revolve({
      start: [0, 0],
      steps: [line(rim, 0), line(rim, thickness), line(0, thickness)],
    }),
    height: thickness,
    lower: {
      insideDiameter: diameter,
      outsideDiameter: 2 * rim,
      face: true,
      wall: { surface: PLANE, thickness: rim - diameter / 2, meridian: [0, -1] },
    },
    upper: null,
    landmarks: [{ key: 'lower-rim', z: 0, diameter: 2 * rim, role: 'Door rim (inner face)', junction: 'lower' }],
    notes: [note('Drawn as its door; the locking mechanism is not modelled')],
  };
};

/**
 * §4.9 — a flat plate held by stays. §4.9.5's pitch is the largest distance between rows, which
 * on a square array is the diagonal, so the stays are drawn a pitch/√2 apart. They reach into
 * the vessel as far as three rows, the plate being all the rule reads of them.
 */
export const stayedSurface: RunBuilder = (component, context) => {
  const thickness = requireDimension(component, Sym.THICKNESS);
  const pitch = requireDimension(component, Sym.STAY_PITCH);
  const stay = requireDimension(component, Sym.STAY_DIAMETER);
  const diameter = openingOf(component, context);
  const { kernel } = context;

  const a = diameter / 2;
  const rim = Math.max(a, context.neighbourOutsideRadius ?? a);
  const spacing = pitch / Math.SQRT2;
  const depth = Math.min(a, 3 * spacing);
  const reach = Math.max(0, a - stay);

  // One stay, built and meshed once, repeated over the array.
  const positions: Vec3[] = [];
  const rows = Math.floor(reach / spacing);
  for (let i = -rows; i <= rows; i++) {
    for (let j = -rows; j <= rows; j++) {
      const x = i * spacing;
      const y = j * spacing;
      if (Math.hypot(x, y) + stay / 2 > reach || positions.length >= 400) continue;
      positions.push([x, y, 0]);
    }
  }
  const one: Solid = kernel.tube({ origin: [0, 0, 0], axis: [0, 0, 1] }, 0, stay / 2, -depth, thickness + stay / 2);

  return {
    solid: kernel.revolve({ start: [0, 0], steps: [line(rim, 0), line(rim, thickness), line(0, thickness)] }),
    extraSolids: positions.length > 0 ? [one] : [],
    // The stay sits at the centre; the array is every other position.
    copies: [undefined, positions.filter(([x, y]) => x !== 0 || y !== 0)],
    height: thickness,
    lower: {
      insideDiameter: diameter,
      outsideDiameter: 2 * rim,
      wall: { surface: PLANE, thickness, meridian: [1, 0] },
    },
    upper: null,
    landmarks: [{ key: 'lower-rim', z: 0, diameter: 2 * rim, role: 'Plate rim (inner face)', junction: 'lower' }],
    notes: [note(`${positions.length} stays on a square array ${mm(spacing)} apart, drawn ${mm(depth)} into the vessel`)],
  };
};
