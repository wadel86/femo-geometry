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
    // The stubs stand for the bundle's tubes, which a fluid domain sees through the bundle itself.
    fluid: { role: 'wall', exclude: centres.length > 0 ? [1] : [] },
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

  const lanes = passLanes(component, tube);
  const pattern = lanes ? clearLanes(tubePattern(pitch, limit, angle), lanes, tube) : tubePattern(pitch, limit, angle);
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
    lanes
      ? representedNote(
          `Drawn straight: a U-bend and the tie rods are not. ${lanes.azimuths.length} pass lane(s) ${mm(lanes.width)} wide cleared from the pattern`,
          'bundle',
          'tubes with their bends and tie rods',
          'straight tubes, pass lanes clear'
        )
      : representedNote(
          'Drawn straight: a U-bend and the tie rods are not, and the pass lanes are left in the pattern (no pass_lane_width stated)',
          'bundle',
          'tubes with their bends and tie rods, pass lanes clear',
          'straight tubes on the full pattern'
        )
  );
  const first = centres[0] ?? [0, 0, 0];
  const one: Solid = kernel.tube({ origin: [first[0], first[1], 0], axis: [0, 0, 1] }, tube / 2 - wall, tube / 2, high - length, high);
  const designCount = optionalDimension(component, Sym.TUBE_COUNT);
  if (designCount !== undefined && !Number.isInteger(designCount)) {
    throw new BuildError(component, `states ${designCount} tubes`, scope('out_of_scope', Sym.TUBE_COUNT, 'a whole number of tubes', String(designCount)));
  }

  // In a fluid domain the bundle is not two thousand tubes but the cylinder they fill, out to the
  // outer tube limit D_otl = 2·r_o + d_o, between their ends; each pass lane is its own zone, as
  // wide as the clear gap the drawn rows leave; and the annulus between that cylinder and the
  // shell's bore is the bypass stream's.
  const span: [number, number] = [high - length, high];
  const axisFrame = { origin: [0, 0, 0] as Vec3, axis: [0, 0, 1] as Vec3 };
  const envelope = kernel.tube(axisFrame, 0, limit + tube / 2, span[0], span[1]);
  const subZones = (lanes?.azimuths ?? []).map((azimuth, k) => {
    const r = (azimuth * Math.PI) / 180;
    const half = Math.min(...pattern.map((c) => Math.abs(-c[0] * Math.sin(r) + c[1] * Math.cos(r)))) - tube / 2;
    const reach = limit + tube;
    const slab = kernel.extrude(
      { start: [-reach, -half], steps: [{ kind: 'line', to: [reach, -half] }, { kind: 'line', to: [reach, half] }, { kind: 'line', to: [-reach, half] }] },
      span[0],
      span[1]
    );
    // A lane holds no tubes: clear fluid, in a zone of its own so it can be told apart.
    return { name: `lane:${k + 1}`, type: 'fluid' as const, solid: kernel.intersect(kernel.rotateZ(slab, azimuth), envelope) };
  });
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
      ...(lanes ? { lanes } : {}),
      ...(designCount !== undefined ? { statedCount: designCount } : {}),
    },
    fluid: {
      role: 'porous',
      name: 'bundle',
      envelope,
      axis: [0, 0, 1],
      subZones,
      bypass: { name: 'bypass', solid: kernel.tube(axisFrame, 0, bore, span[0], span[1]) },
    },
    notes,
  };
};

/** The pass lanes a bundle states, or none: `w_p` wide, `n` of them through the axis. */
function passLanes(component: ComponentDefinition, tube: number): { width: number; azimuths: number[] } | undefined {
  const width = optionalDimension(component, Sym.PASS_LANE_WIDTH);
  if (width === undefined) return undefined;
  const count = optionalDimension(component, Sym.PASS_LANE_COUNT) ?? 1;
  if (!Number.isInteger(count)) {
    throw new BuildError(component, `states ${count} pass lanes`, scope('out_of_scope', Sym.PASS_LANE_COUNT, 'a whole number of lanes', String(count)));
  }
  if (width >= 20 * tube) {
    throw new BuildError(component, `has a pass lane ${mm(width)} wide on ${mm(tube)} tubes`, scope('out_of_scope', Sym.PASS_LANE_WIDTH, `< ${mm(20 * tube)}`, mm(width)));
  }
  const first = optionalDimension(component, Sym.PASS_LANE_AZIMUTH) ?? 0;
  return { width, azimuths: Array.from({ length: count }, (_, k) => first + (k * 180) / count) };
}

/**
 * The pattern with every tube left out whose edge would stand in a lane: a centre nearer the
 * lane's line than half the lane plus half a tube, so the clear gap is at least `w_p`.
 */
export function clearLanes(centres: readonly Vec3[], lanes: { width: number; azimuths: readonly number[] }, tube: number): Vec3[] {
  const reach = (lanes.width + tube) / 2 - 1e-9;
  const normals = lanes.azimuths.map((a) => [-Math.sin((a * Math.PI) / 180), Math.cos((a * Math.PI) / 180)] as const);
  return centres.filter((c) => normals.every(([nx, ny]) => Math.abs(c[0] * nx + c[1] * ny) >= reach));
}

/**
 * Single-segmental baffles — the whole set as ONE part, as the bundle is: each a disc across the
 * shell's bore less `δ_sb`, cut square to its window at `l_c` from the shell's inside wall, `t_b`
 * thick, the windows alternating. They stand from the course's low end: the first at `L_b,i`,
 * then every `L_b,c`, the last no nearer the high end than `L_b,o`. Hosted by the shell for where
 * they stand only — a baffle hangs on the tie rods and is welded to nothing, so it has no joint.
 *
 * Drawn undrilled, as the tubesheet is: the tube holes are not cut, and `δ_tb` — which belongs
 * to the bundle a baffle crosses, not to the baffle — is carried for the leakage it makes.
 */
export const segmentalBaffles: MountedBuilder = (component, context) => {
  const { kernel, hostSurface, placement } = context;
  const course = boreOf(component, context, 'a baffle');
  requireWithinHost(component, context, 0);
  const [low, high] = hostSurface.offsetRange;
  const shell = 2 * course.insideRadiusAt(low);
  const cut = requireDimension(component, Sym.BAFFLE_CUT_LENGTH);
  const thickness = requireDimension(component, Sym.BAFFLE_THICKNESS);
  const spacing = requireDimension(component, Sym.BAFFLE_SPACING);
  const notes: Note[] = [];
  const stated = (symbol: string, what: string, assumed: number, drawn: string): number => {
    const value = optionalDimension(component, symbol);
    if (value !== undefined) return value;
    notes.push(assumedNote(`${what} not stated — drawn ${drawn}`, symbol, drawn));
    return assumed;
  };
  const inlet = stated(Sym.BAFFLE_INLET_SPACING, 'Inlet spacing', spacing, `${mm(spacing)}, the central spacing`);
  const outlet = stated(Sym.BAFFLE_OUTLET_SPACING, 'Outlet spacing', inlet, `${mm(inlet)}, the inlet spacing`);
  const shellClearance = stated(Sym.SHELL_BAFFLE_CLEARANCE, 'Shell-to-baffle clearance', 0, 'tight to the bore');
  const tubeClearance = stated(Sym.TUBE_BAFFLE_CLEARANCE, 'Tube-to-baffle clearance', 0, 'tight to the tubes');

  const rim = (shell - shellClearance) / 2;
  const chord = shell / 2 - cut;
  if (!(shellClearance < shell / 10)) {
    throw new BuildError(component, `has a ${mm(shellClearance)} clearance in a ${mm(shell)} bore`, scope('out_of_scope', Sym.SHELL_BAFFLE_CLEARANCE, `< ${mm(shell / 10)}`, mm(shellClearance)));
  }
  if (!(chord < rim) || !(cut < shell / 2)) {
    throw new BuildError(
      component,
      `cuts its window ${mm(cut)} deep in a ${mm(shell)} bore`,
      scope('out_of_scope', Sym.BAFFLE_CUT_LENGTH, `between ${mm(shellClearance / 2)} and ${mm(shell / 2)}, half the bore: a single-segmental window`, mm(cut))
    );
  }
  if (!(thickness < spacing)) {
    throw new BuildError(component, `is ${mm(thickness)} thick at a ${mm(spacing)} spacing`, scope('out_of_scope', Sym.BAFFLE_THICKNESS, `< ${mm(spacing)}, the spacing`, mm(thickness)));
  }

  const length = high - low;
  const given = optionalDimension(component, Sym.BAFFLE_COUNT);
  if (given !== undefined && !Number.isInteger(given)) {
    throw new BuildError(component, `states ${given} baffles`, scope('out_of_scope', Sym.BAFFLE_COUNT, 'a whole number of baffles', String(given)));
  }
  const fits = Math.floor((length - inlet - outlet) / spacing + 1e-9) + 1;
  const count = given ?? fits;
  if (count < 1 || inlet - thickness / 2 < 0) {
    throw new BuildError(
      component,
      `fits no baffle: ${mm(inlet)} in and ${mm(outlet)} out of a ${mm(length)} course`,
      scope('out_of_scope', `${Sym.BAFFLE_INLET_SPACING} plus ${Sym.BAFFLE_OUTLET_SPACING}`, `≤ ${mm(length)}, the course`, mm(inlet + outlet))
    );
  }
  const offsets = Array.from({ length: count }, (_, k) => low + inlet + k * spacing);
  const last = offsets[count - 1]!;
  if (high - last < outlet - 1e-6) {
    throw new BuildError(
      component,
      `puts its last baffle ${mm(high - last)} from the course's end, nearer than its ${mm(outlet)} outlet spacing`,
      scope('out_of_scope', Sym.BAFFLE_COUNT, `≤ ${fits}, the baffles that fit`, String(count))
    );
  }
  if (given === undefined) {
    notes.push(assumedNote(`Baffle count not stated — the ${count} that fit, the last ${mm(high - last)} from the course's end`, Sym.BAFFLE_COUNT, String(count)));
  }
  notes.push(
    representedNote(
      'Drawn undrilled: the tube holes are not cut, their clearance is carried for the leakage it makes; the tie rods and spacers are not drawn',
      'baffle tube holes',
      'drilled to the tube diameter plus δ_tb',
      'undrilled plates'
    )
  );

  const yc = Math.sqrt(rim * rim - chord * chord);
  const one = (offset: number, azimuth: number): Solid =>
    kernel.rotateZ(
      kernel.extrude(
        {
          start: [chord, -yc],
          steps: [
            { kind: 'line', to: [chord, yc] },
            { kind: 'arc', to: [chord, -yc], through: [-rim, 0] },
          ],
        },
        offset - thickness / 2,
        offset + thickness / 2
      ),
      azimuth
    );
  const windowAzimuth = (k: number) => placement.azimuth + (k % 2 === 0 ? 0 : 180);
  const solids = offsets.slice(0, 2).map((offset, k) => one(offset, windowAzimuth(k)));
  const copies = solids.map((_, k) =>
    offsets
      .map((offset, i) => ({ offset, i }))
      .filter(({ i }) => i > k && i % 2 === k)
      .map(({ offset }): Vec3 => [0, 0, offset - offsets[k]!])
  );
  // In a fluid domain each baffle is a zero-thickness face on its mid-plane, out to the shell's
  // bore: the clearances are a few millimetres on a metre-scale domain, carried as leakage areas
  // rather than drawn. The region is the side of the cut the plate stands on, a little wider than
  // the bore so the clip takes the whole section there.
  const reach = (shell / 2) * 1.02;
  const side = Math.sqrt(reach * reach - chord * chord);
  const region = (offset: number, azimuth: number): Solid =>
    kernel.rotateZ(
      kernel.extrude(
        { start: [chord, -side], steps: [{ kind: 'line', to: [chord, side] }, { kind: 'arc', to: [chord, -side], through: [-reach, 0] }] },
        offset - 1,
        offset + 1
      ),
      azimuth
    );
  return {
    solids,
    copies,
    footprint: 0,
    anchorOffset: (low + high) / 2,
    fluid: {
      role: 'baffle',
      faces: offsets.map((offset, k) => ({
        name: `baffle:${k + 1}`,
        origin: [0, 0, offset] as Vec3,
        normal: [0, 0, 1] as Vec3,
        region: region(offset, windowAzimuth(k)),
      })),
    },
    baffles: {
      shellDiameter: shell,
      cutLength: cut,
      thickness,
      shellClearance,
      tubeClearance,
      baffles: offsets.map((offset, k) => ({ offset, windowAzimuth: windowAzimuth(k) })),
      spacing,
      span: [low, high],
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
