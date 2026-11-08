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
  NotDrawnError,
  Sym,
  assumedNote,
  optionalDimension,
  representedNote,
  requireDimension,
  scope,
  type ComponentDefinition,
  type Note,
} from '../definition.ts';
import type { Solid, Vec3 } from '../kernel/GeometryKernel.ts';
import { mm, requireWithinHost } from './placing.ts';
import type { Idealisation, MountedBuilder, MountedContext, RunBuilder } from './types.ts';
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

/** A course's straight bore, or the reason the part needs one. */
function boreOf(component: ComponentDefinition, context: MountedContext, what: string) {
  const course = context.hostSurface.course;
  if (!course || course.halfApexAngle !== 0) {
    throw new NotDrawnError(
      component,
      `${what} is drawn in a cylindrical course, and ${context.host.name} is not one`,
      scope('out_of_scope', 'host', 'a cylindrical course', course ? `a cone of ${course.halfApexAngle}°` : context.host.kind)
    );
  }
  return course;
}

/**
 * The tube bundle — §4.18 — as ONE part carrying its pattern: `d_t` × `t_t` tubes on pitch `p`
 * out to `r_o`, standing in the shell from its upper end, where the tubesheet is, down `L_t`.
 * The shell is its host for where it stands along the axis and nothing else: nothing welds a
 * bundle to its shell, so it has no attachment and no joint with it. What it joins is a
 * tubesheet, at each end of its tubes, all of them at once (`ports.ts`, `tube_to_tubesheet`).
 */
export const tubeBundle: MountedBuilder = (component, context) => {
  const { kernel, hostSurface } = context;
  const course = boreOf(component, context, 'a tube bundle');
  requireWithinHost(component, context, 0);
  const pitch = requireDimension(component, Sym.TUBE_PITCH);
  const tube = requireDimension(component, Sym.TUBE_OUTSIDE_DIAMETER);
  const wall = requireDimension(component, Sym.TUBE_THICKNESS);
  const limit = requireDimension(component, Sym.TUBE_LIMIT_RADIUS);
  const angle = requireDimension(component, Sym.TUBE_LAYOUT_ANGLE);
  if (![30, 45, 60, 90].some((a) => Math.abs(angle - a) < 1)) {
    throw new BuildError(component, `has a tube layout of ${angle}°, which is none of §4.18.4.a's patterns`, scope('out_of_scope', Sym.TUBE_LAYOUT_ANGLE, '30°, 45°, 60° or 90°', `${angle}°`));
  }
  if (pitch <= tube) {
    throw new BuildError(component, `has its tubes (${mm(tube)}) no narrower than their pitch`, scope('out_of_scope', Sym.TUBE_PITCH, `> ${mm(tube)}, the tube diameter`, mm(pitch)));
  }
  if (wall >= tube / 2) {
    throw new BuildError(component, `has a tube wall of ${mm(wall)} on a ${mm(tube)} tube`, scope('out_of_scope', Sym.TUBE_THICKNESS, `< ${mm(tube / 2)}`, mm(wall)));
  }
  const [low, high] = hostSurface.offsetRange;
  const bore = course.insideRadiusAt(high);
  if (limit + tube / 2 > bore) {
    throw new BuildError(
      component,
      `places tubes out to ${mm(limit + tube / 2)}, outside the shell's bore`,
      scope('out_of_scope', `${Sym.TUBE_LIMIT_RADIUS} plus half a tube`, `≤ ${mm(bore)}, the shell's inside radius`, mm(limit + tube / 2))
    );
  }
  const notes: Note[] = [];
  const stated = optionalDimension(component, Sym.TUBE_LENGTH_OUTER);
  const length = stated ?? high - low;
  if (stated === undefined) notes.push(assumedNote(`Tube length not stated — drawn the length of ${context.host.name}`, Sym.TUBE_LENGTH_OUTER, mm(length)));

  const pattern = tubePattern(pitch, limit, angle);
  let centres = pattern;
  if (centres.length > MOST_TUBES) {
    const kept = centres.filter((c) => Math.hypot(c[0], c[1]) > limit - 3 * pitch);
    notes.push(representedNote(`${centres.length} tubes on the pattern; the outer ${kept.length} drawn`, 'tubes drawn', `all ${centres.length}`, `the outer ${kept.length}`));
    centres = kept;
  }
  // §4.18.10's weld legs belong to the joint with the tubesheet, which reads them off the bundle;
  // the tube ends are drawn flush with the plate's face and the weld itself is not drawn.
  const legs = [Sym.FILLET_WELD_LEG, Sym.GROOVE_WELD_LEG].filter((s) => optionalDimension(component, s) !== undefined);
  if (legs.length > 0) {
    notes.push(
      representedNote(
        `The tube-to-tubesheet weld (${legs.map((s) => s.replace(/_/g, ' ')).join(' and ')}) is not drawn: the tube ends are flush with the plate`,
        'tube-to-tubesheet weld',
        'drawn',
        'carried on the joint, not drawn',
        true
      )
    );
  }
  notes.push(
    representedNote(
      'Drawn straight: a U-bend, the baffles and the tie rods are not, and the pass lanes are left in the pattern',
      'bundle',
      'tubes with their bends, baffles and tie rods, pass lanes clear',
      'straight tubes on the full pattern'
    )
  );
  const first = centres[0] ?? [0, 0, 0];
  const one: Solid = kernel.tube({ origin: [first[0], first[1], 0], axis: [0, 0, 1] }, tube / 2 - wall, tube / 2, high - length, high);
  return {
    solids: [one],
    copies: [centres.slice(1).map((c): Vec3 => [c[0] - first[0], c[1] - first[1], 0])],
    footprint: 0,
    anchorOffset: high,
    bundle: {
      count: pattern.length,
      pitch,
      layoutAngle: angle,
      limitRadius: limit,
      tubeOutsideDiameter: tube,
      tubeThickness: wall,
      ends: [high - length, high],
    },
    notes,
  };
};

/**
 * A pass partition plate — §4.18 — `t_p` thick, across the channel's bore in the plane through
 * the axis at the placement's azimuth, over the channel's whole length. Welded to the channel
 * along both edges; its end against the tubesheet sits in the plate's pass partition groove,
 * gasketed rather than welded, so that end is a seat and no port. It bounds the passes: the
 * channel and the tube-side face of the tubesheet on either side of it are separate chambers.
 */
export const passPartitionPlate: MountedBuilder = (component, context) => {
  const { kernel, hostSurface, placement } = context;
  const course = boreOf(component, context, 'a pass partition plate');
  const thickness = requireDimension(component, Sym.PASS_PARTITION_THICKNESS);
  requireWithinHost(component, context, 0);
  const [low, high] = hostSurface.offsetRange;
  const bore = course.insideRadiusAt(low);
  if (thickness >= bore) {
    throw new BuildError(component, `is ${mm(thickness)} thick in a ${mm(2 * bore)} bore`, scope('out_of_scope', Sym.PASS_PARTITION_THICKNESS, `< ${mm(bore)}`, mm(thickness)));
  }
  // Its corners on the bore: the plate meets the wall along two lines.
  const reach = Math.sqrt(bore * bore - (thickness * thickness) / 4);
  const plate = kernel.extrude(
    {
      start: [-reach, -thickness / 2],
      steps: [
        { kind: 'line', to: [reach, -thickness / 2] },
        { kind: 'line', to: [reach, thickness / 2] },
        { kind: 'line', to: [-reach, thickness / 2] },
      ],
    },
    low,
    high
  );
  return {
    solids: [kernel.rotateZ(plate, placement.azimuth)],
    footprint: (high - low) / 2,
    anchorOffset: (low + high) / 2,
    attachment: { axial: high - low, circumferentialDeg: (thickness / bore) * (180 / Math.PI), thickness },
    notes: [
      representedNote(
        'Welded to the channel along two lines, 180° apart; a part has one patch on its host, so the second edge carries no port',
        'pass partition welds',
        'two edges, each welded',
        'one patch at the placement azimuth',
        true
      ),
    ],
  };
};

export const TUBESHEET_BUILDERS: Readonly<Record<string, RunBuilder>> = {
  [Kind.U_TUBE_TUBESHEET]: tubesheet,
  [Kind.FIXED_TUBESHEET]: tubesheet,
  [Kind.FLOATING_TUBESHEET_IMMERSED]: tubesheet,
  [Kind.FLOATING_TUBESHEET_EXTERNALLY_SEALED]: tubesheet,
  [Kind.FLOATING_TUBESHEET_INTERNALLY_SEALED]: tubesheet,
};
