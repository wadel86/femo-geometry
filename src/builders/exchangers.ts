// §4.18's tubesheets: the plate a heat exchanger's tubes are held in, and the tubes themselves.
//
// The plate is drawn as §4.18.6.4.b draws it for the calculation: a SOLID plate of the same
// size, the tube holes not drilled. A tubesheet has hundreds or thousands of holes and no
// rule reads one of them by position — every equation of §4.18 is written on the equivalent
// plate — so drilling them would cost a boolean per hole to show nothing the rules see. The
// tubes are drawn as stubs on the stated pattern, standing off the shell-side face: one stub
// built once and repeated, so a bundle of two thousand costs one tube.
import {
  BuildError,
  Kind,
  Sym,
  optionalDimension,
  representedNote,
  requireDimension,
  scope,
  type Note,
} from '../definition.ts';
import type { Solid, Vec3 } from '../kernel/GeometryKernel.ts';
import { mm } from './placing.ts';
import type { Idealisation, RunBuilder } from './types.ts';
import { PLANE } from './walls.ts';

/** More than this and the stubs are thinned to the outermost rows: a picture, not a count. */
const MOST_TUBES = 3000;

/**
 * The tube centres of §4.18.4.a's patterns within the tube limit circle: equilateral
 * triangles at 30° or 60°, squares at 90° or turned at 45°, at pitch `p`.
 */
export function tubePattern(pitch: number, limit: number, angle: number): Vec3[] {
  const triangular = Math.abs(angle - 30) < 1 || Math.abs(angle - 60) < 1;
  const rowSpacing = triangular ? (pitch * Math.sqrt(3)) / 2 : pitch;
  const turn = Math.abs(angle - 45) < 1 ? Math.PI / 4 : Math.abs(angle - 60) < 1 ? Math.PI / 2 : 0;
  const rows = Math.ceil(limit / rowSpacing) + 1;
  const columns = Math.ceil(limit / pitch) + 1;
  const centres: Vec3[] = [];
  for (let j = -rows; j <= rows; j++) {
    const shift = triangular && j % 2 !== 0 ? pitch / 2 : 0;
    for (let i = -columns; i <= columns; i++) {
      const x0 = i * pitch + shift;
      const y0 = j * rowSpacing;
      const x = x0 * Math.cos(turn) - y0 * Math.sin(turn);
      const y = x0 * Math.sin(turn) + y0 * Math.cos(turn);
      if (Math.hypot(x, y) <= limit + 1e-9) centres.push([x, y, 0]);
    }
  }
  return centres;
}

/**
 * A tubesheet of thickness `h` and outside diameter `A`, its tubes of `d_t` × `t_t` on pitch
 * `p` out to `r_o`. The shell side is its lower face, where the stubs stand; the channel side
 * its upper. Five kinds share the drawing: what tells them apart is how the far end of the
 * bundle is held, which is not on this plate.
 */
export const tubesheet: RunBuilder = (component, context) => {
  const thickness = requireDimension(component, Sym.THICKNESS);
  const outside = requireDimension(component, Sym.FLANGE_OUTSIDE_DIAMETER);
  const pitch = requireDimension(component, Sym.TUBE_PITCH);
  const tube = requireDimension(component, Sym.TUBE_OUTSIDE_DIAMETER);
  const wall = requireDimension(component, Sym.TUBE_THICKNESS);
  const limit = requireDimension(component, Sym.TUBE_LIMIT_RADIUS);
  const angle = requireDimension(component, Sym.TUBE_LAYOUT_ANGLE);
  if (![30, 45, 60, 90].some((a) => Math.abs(angle - a) < 1)) {
    throw new BuildError(
      component,
      `has a tube layout of ${angle}°, which is none of §4.18.4.a's patterns`,
      scope('out_of_scope', Sym.TUBE_LAYOUT_ANGLE, '30°, 45°, 60° or 90°', `${angle}°`)
    );
  }
  if (pitch <= tube) {
    throw new BuildError(
      component,
      `has its tubes (${mm(tube)}) no narrower than their pitch`,
      scope('out_of_scope', Sym.TUBE_PITCH, `> ${mm(tube)}, the tube diameter`, mm(pitch))
    );
  }
  if (limit + tube / 2 > outside / 2) {
    throw new BuildError(
      component,
      `places tubes out to ${mm(limit + tube / 2)}, past its own rim`,
      scope('out_of_scope', `${Sym.TUBE_LIMIT_RADIUS} plus half a tube`, `≤ ${mm(outside / 2)}, the plate's rim`, mm(limit + tube / 2))
    );
  }
  const { kernel } = context;
  const hole = optionalDimension(component, Sym.TUBE_HOLE_DIAMETER) ?? tube;
  const pattern = tubePattern(pitch, limit, angle);
  const notes: Note[] = [
    representedNote(
      'Idealised as §4.18.6.4.b\'s equivalent solid plate: the tube holes are carried as data, not drilled',
      'tube holes',
      `${pattern.length} holes drilled`,
      '§4.18.6.4.b\'s equivalent solid plate'
    ),
  ];
  const idealisation: Idealisation = {
    kind: 'equivalent_solid_plate',
    message: 'The tube holes are not drilled; their pattern is carried here, to be drilled when an analysis asks for it',
    data: {
      pattern: Math.abs(angle - 30) < 1 || Math.abs(angle - 60) < 1 ? 'triangular' : 'square',
      layoutAngle: angle,
      pitch,
      holeDiameter: hole,
      limitRadius: limit,
      count: pattern.length,
      // Through the plate, from its shell-side face at z = 0 to its channel side at z = h.
      drilledFrom: 'shell_side',
      depth: thickness,
    },
  };

  let centres = pattern;
  if (centres.length > MOST_TUBES) {
    const kept = centres.filter((c) => Math.hypot(c[0], c[1]) > limit - 3 * pitch);
    notes.push(
      representedNote(`${centres.length} tubes on the pattern; the outer ${kept.length} drawn`, 'tubes drawn', `all ${centres.length}`, `the outer ${kept.length}`)
    );
    centres = kept;
  }
  const stated = optionalDimension(component, Sym.TUBE_LENGTH_OUTER);
  const stub = Math.min(4 * pitch, stated ?? Infinity);
  notes.push(
    representedNote(
      `${centres.length} tubes on a ${angle}° pattern, drawn as ${mm(stub)} stubs from the shell-side face`,
      'tube length',
      stated === undefined ? 'the bundle, U-bends included' : `${mm(stated)} between the plates`,
      `${mm(stub)} stubs`
    )
  );

  const r = outside / 2;
  const plate = kernel.revolve({
    start: [0, 0],
    steps: [
      { kind: 'line', to: [r, 0] },
      { kind: 'line', to: [r, thickness] },
      { kind: 'line', to: [0, thickness] },
    ],
  });
  // One stub at the first centre, the rest repeated from it.
  const first = centres[0] ?? [0, 0, 0];
  const one: Solid = kernel.tube({ origin: [first[0], first[1], 0], axis: [0, 0, 1] }, tube / 2 - wall, tube / 2, -stub, 0);
  const copies = centres.slice(1).map((c): Vec3 => [c[0] - first[0], c[1] - first[1], 0]);

  // The shell and the channel meet the plate on its faces, each on the annulus of its own wall —
  // as a flat head's face is its course's. Without their diameter and thickness stated, the
  // plate's own rim stands in, and a course welded there does not match it.
  const shell = optionalDimension(component, Sym.SHELL_INSIDE_DIAMETER) ?? 2 * (limit + pitch);
  const channel = optionalDimension(component, Sym.CHANNEL_INSIDE_DIAMETER) ?? shell;
  const landing = (inside: number, wallSymbol: string): number => {
    const wall = optionalDimension(component, wallSymbol);
    return wall !== undefined && inside + 2 * wall <= outside ? inside + 2 * wall : outside;
  };
  const face = (inside: number, wallSymbol: string, meridian: readonly [number, number]) => {
    const across = landing(inside, wallSymbol);
    return {
      insideDiameter: inside,
      outsideDiameter: across,
      face: true,
      wall: { surface: PLANE, thickness: (across - inside) / 2, meridian },
    };
  };

  return {
    solid: plate,
    extraSolids: centres.length > 0 ? [one] : [],
    copies: [undefined, copies],
    height: thickness,
    lower: face(shell, Sym.SHELL_THICKNESS, [0, -1]),
    upper: face(channel, Sym.CHANNEL_THICKNESS, [0, 1]),
    landmarks: [
      { key: 'lower-rim', z: 0, diameter: outside, role: 'Tubesheet rim, shell side', junction: 'lower' },
      { key: 'upper-rim', z: thickness, diameter: outside, role: 'Tubesheet rim, channel side', junction: 'upper' },
    ],
    meridian: [
      [r, thickness / 2],
      [0, thickness / 2],
    ],
    idealisations: [idealisation],
    notes,
  };
};

export const TUBESHEET_BUILDERS: Readonly<Record<string, RunBuilder>> = {
  [Kind.U_TUBE_TUBESHEET]: tubesheet,
  [Kind.FIXED_TUBESHEET]: tubesheet,
  [Kind.FLOATING_TUBESHEET_IMMERSED]: tubesheet,
  [Kind.FLOATING_TUBESHEET_EXTERNALLY_SEALED]: tubesheet,
  [Kind.FLOATING_TUBESHEET_INTERNALLY_SEALED]: tubesheet,
};
