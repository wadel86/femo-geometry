// §4.17 — a clamp connection: two hubs face to face, and the clamp that wedges them together.
//
// A clamp does not pull its hubs together the way a flange's bolts do: it closes radially, and
// the taper on the back of each hub's shoulder turns that into axial load. So what the drawing
// must get right is the shoulder's back face, inclined at the clamp angle φ, and the clamp's
// lips bearing on it. The clamp is drawn as a whole ring; a real one is split into segments
// drawn together by bolts, which are not modelled.
import {
  BuildError,
  Sym,
  assumedNote,
  optionalDimension,
  representedNote,
  requireDimension,
  scope,
  type Note,
} from '../definition.ts';
import type { Point2, ProfileStep } from '../kernel/GeometryKernel.ts';
import { mm } from './placing.ts';
import type { RunBuilder } from './types.ts';
import { cylinderSurface } from './walls.ts';

const DEG = Math.PI / 180;

export const clampedConnection: RunBuilder = (component, context) => {
  const bore = requireDimension(component, Sym.FLANGE_BORE);
  const gasket = requireDimension(component, Sym.GASKET_CONTACT_DIAMETER);
  const phi = requireDimension(component, Sym.CLAMP_TAPER_ANGLE);
  if (phi <= 0 || phi >= 60) {
    throw new BuildError(component, `has a clamp angle of ${phi}°`, scope('out_of_scope', Sym.CLAMP_TAPER_ANGLE, '0° < φ < 60°', `${phi}°`));
  }
  const notes: Note[] = [];
  const assumed = (symbol: string, label: string, value: number): number => {
    const stated = optionalDimension(component, symbol);
    if (stated !== undefined) return stated;
    notes.push(assumedNote(`${label} not stated — drawn ${mm(value)}`, symbol, mm(value)));
    return value;
  };

  const b = bore / 2;
  const neck = assumed(Sym.HUB_NECK_OUTSIDE_DIAMETER, 'Hub neck outside diameter', bore + 2 * Math.max(10, 0.06 * bore)) / 2;
  const rim = assumed(Sym.FLANGE_OUTSIDE_DIAMETER, 'Hub outside diameter', Math.max(gasket, 2 * neck) + 2 * Math.max(15, 0.08 * bore)) / 2;
  const shoulder = assumed(Sym.HUB_SHOULDER_THICKNESS, 'Hub shoulder thickness', Math.max(15, 0.08 * bore));
  const length = assumed(Sym.HUB_LENGTH, 'Hub length', Math.max(50, 0.25 * bore));
  const clampInside = assumed(Sym.CLAMP_INSIDE_DIAMETER, 'Clamp inside diameter', 2 * rim + 2) / 2;
  const clampWall = assumed(Sym.CLAMP_THICKNESS, 'Clamp thickness', Math.max(15, 0.08 * bore));
  if (!(b < neck && neck < rim && rim < clampInside)) {
    throw new BuildError(
      component,
      `has bore, neck, hub and clamp diameters out of order`,
      scope('out_of_scope', 'diameters', 'bore < neck < hub < clamp', `${mm(2 * b)}, ${mm(2 * neck)}, ${mm(2 * rim)}, ${mm(2 * clampInside)}`)
    );
  }

  // The shoulder's back face climbs from the neck to the rim at φ to the joint face.
  const rise = (rim - neck) * Math.tan(phi * DEG);
  const joint = length + rise + shoulder;
  const backAt = (r: number) => length + (r - neck) * Math.tan(phi * DEG);
  const hub = (mirror: boolean) => {
    const z = (value: number) => (mirror ? 2 * joint - value : value);
    const points: Point2[] = [
      [b, z(0)],
      [neck, z(0)],
      [neck, z(length)],
      [rim, z(length + rise)],
      [rim, z(joint)],
      [b, z(joint)],
    ];
    return context.kernel.revolve({
      start: points[0],
      steps: points.slice(1).map((to): ProfileStep => ({ kind: 'line', to })),
    });
  };

  // The clamp: its lips bear on both back faces, from halfway down the shoulder to the rim.
  const lip = (neck + rim) / 2;
  const reach = joint - backAt(lip);
  const width = optionalDimension(component, Sym.CLAMP_WIDTH) ?? 2 * (reach + clampWall / 2);
  const half = Math.max(width / 2, reach + 1);
  const outer = clampInside + clampWall;
  const clamp = context.kernel.revolve({
    start: [lip, joint - half],
    steps: (
      [
        [lip, backAt(lip)],
        [rim, backAt(rim)],
        [clampInside, backAt(rim)],
        [clampInside, 2 * joint - backAt(rim)],
        [rim, 2 * joint - backAt(rim)],
        [lip, 2 * joint - backAt(lip)],
        [lip, joint + half],
        [outer, joint + half],
        [outer, joint - half],
      ] as Point2[]
    ).map((to): ProfileStep => ({ kind: 'line', to })),
  });
  notes.push(representedNote('The clamp is drawn as one ring; its segments and their bolts are not modelled', 'clamp', 'segments and their bolts', 'one whole ring'));

  const surface = cylinderSurface((b + neck) / 2);
  const end = (meridian: Point2) => ({
    insideDiameter: bore,
    outsideDiameter: 2 * neck,
    wall: { surface, thickness: neck - b, meridian },
  });
  const height = 2 * joint;
  return {
    solid: hub(false),
    extraSolids: [hub(true), clamp],
    height,
    lower: end([0, -1]),
    upper: end([0, 1]),
    landmarks: [
      { key: 'lower-inside', z: 0, diameter: bore, role: 'Hub end (inside)', junction: 'lower' },
      { key: 'lower-outside', z: 0, diameter: 2 * neck, role: 'Hub end (outside)', junction: 'lower' },
      { key: 'upper-inside', z: height, diameter: bore, role: 'Hub end (inside)', junction: 'upper' },
      { key: 'upper-outside', z: height, diameter: 2 * neck, role: 'Hub end (outside)', junction: 'upper' },
      { key: 'joint-rim', z: joint, diameter: 2 * rim, role: 'Hub faces, clamped together' },
    ],
    meridian: [
      [(b + neck) / 2, 0],
      [(b + neck) / 2, height],
    ],
    notes,
  };
};
