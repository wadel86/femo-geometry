import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { tubePattern } from '../src/builders/exchangers.ts';
import { RUN_BUILDERS } from '../src/builders/runParts.ts';
import type { RunContext } from '../src/builders/types.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { kernel, part, shellSide } from './fixtures.ts';

const build = (kind: string, dimensions: Record<string, number>, context: Omit<RunContext, 'kernel'> = {}) =>
  RUN_BUILDERS[kind](part('P', kind, dimensions), { kernel, ...context });

const close = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ± ${tolerance}`);

const valid = (solids: readonly unknown[]) => {
  for (const solid of solids) assert.ok(kernel.isValid(solid as never), 'a solid fails the kernel check');
};

const BELLOWS = {
  bellows_inside_diameter: 600,
  thickness: 1.2,
  ply_count: 2,
  convolution_height: 60,
  convolution_pitch: 40,
  convolution_count: 6,
  end_tangent_length: 30,
};

test('a U-shaped bellows is 2·Lt + N·q long and reaches Db/2 + w at its crests', () => {
  for (const kind of ['u_shaped_bellows_as_formed', 'u_shaped_bellows_annealed']) {
    const bellows = build(kind, BELLOWS);
    valid([bellows.solid]);
    close(bellows.height, 2 * 30 + 6 * 40, 1e-9);
    const bounds = kernel.bounds(bellows.solid);
    close(bounds.max[0], 300 + 60, 1e-3);
    close(bellows.lower!.insideDiameter, 600, 1e-9);
    close(bellows.lower!.outsideDiameter, 600 + 2 * 2.4, 1e-9);
    assert.ok(bellows.notes.some((n) => n.symbol === 'ply_count' && n.analysisOnly));
    assert.deepEqual(bellows.idealisations?.map((i) => [i.kind, i.data.plies]), [['plies_as_one_wall', 2]]);
  }
});

test('a reinforced bellows carries a ring in each root between convolutions', () => {
  const bellows = build('u_shaped_reinforced_bellows_as_formed', { ...BELLOWS, reinforcing_ring_area: 150 });
  valid([bellows.solid, ...(bellows.extraSolids ?? [])]);
  assert.equal(bellows.extraSolids?.length, 1, 'one ring, repeated');
  assert.equal(bellows.copies?.[1]?.length, 6 - 2, 'five roots: the first ring and four copies');
  // At the pitch apart, all of them.
  assert.deepEqual(bellows.copies?.[1]?.map((c) => c[2]), [40, 80, 120, 160]);
});

test('a toroidal bellows and a flanged-and-flued joint are folded walls on their tangents', () => {
  const torus = build('toroidal_bellows', {
    bellows_inside_diameter: 600, thickness: 1.5, ply_count: 1, toroidal_radius: 18,
    convolution_pitch: 44, convolution_count: 4, toroidal_weld_spacing: 260,
  });
  valid([torus.solid]);
  close(torus.height, 260, 1e-9);

  const joint = build('flanged_and_flued_expansion_joint', { inside_diameter: 1000, thickness: 12 });
  valid([joint.solid]);
  assert.ok(kernel.bounds(joint.solid).max[0] > 500 + 0.1 * 1000, 'the flanges stand out from the shell');
  assert.equal(joint.notes.length, 1, 'its proportions are assumed, and said');
});

test("tubesheets: an equivalent solid plate, and the bundle on §4.18.4.a's patterns", () => {
  // Square at a pitch of 10 out to 10: the centre and its four neighbours.
  assert.equal(tubePattern(10, 10, 90).length, 5);
  // Triangular: the density of an equilateral pattern, within a row of the boundary.
  const triangular = tubePattern(25, 400, 30).length;
  const expected = (Math.PI * 400 ** 2) / ((25 ** 2 * Math.sqrt(3)) / 2);
  assert.ok(Math.abs(triangular - expected) / expected < 0.08, `${triangular} tubes against ${expected.toFixed(0)}`);

  for (const kind of [
    'u_tube_tubesheet',
    'fixed_tubesheet',
    'floating_tubesheet_immersed',
    'floating_tubesheet_externally_sealed',
    'floating_tubesheet_internally_sealed',
  ]) {
    const sheet = build(kind, {
      thickness: 60, flange_outside_diameter: 1000, tube_pitch: 32, tube_outside_diameter: 25,
      tube_thickness: 2, tube_limit_radius: 400, tube_layout_angle: 30,
    });
    valid([sheet.solid, ...(sheet.extraSolids ?? [])]);
    close(kernel.volume(sheet.solid), Math.PI * 500 ** 2 * 60, 1);
    assert.equal(1 + (sheet.copies?.[1]?.length ?? 0), tubePattern(32, 400, 30).length);
    // Solid by idealisation, the holes carried as data for a plan that wants them drilled.
    const [plate] = sheet.idealisations ?? [];
    assert.equal(plate?.kind, 'equivalent_solid_plate');
    assert.deepEqual(
      [plate.data.pattern, plate.data.pitch, plate.data.holeDiameter, plate.data.limitRadius, plate.data.count],
      ['triangular', 32, 25, 400, tubePattern(32, 400, 30).length]
    );
  }
  assert.throws(
    () => build('fixed_tubesheet', {
      thickness: 60, flange_outside_diameter: 1000, tube_pitch: 32, tube_outside_diameter: 25,
      tube_thickness: 2, tube_limit_radius: 400, tube_layout_angle: 50,
    }),
    /none of §4.18.4.a's patterns/
  );
});

test('a clamp connection: two hubs and the clamp bearing on their tapered shoulders', () => {
  const clamp = build('clamped_connection', { flange_bore: 300, gasket_contact_diameter: 340, clamp_taper_angle: 20 });
  valid([clamp.solid, ...(clamp.extraSolids ?? [])]);
  assert.equal(clamp.extraSolids?.length, 2, 'the second hub and the clamp');
  // The three are apart: their volumes add up to the volume of their union only if they do not overlap.
  const volumes = [clamp.solid, ...clamp.extraSolids!].map((s) => kernel.volume(s));
  assert.ok(volumes.every((v) => v > 0));
  close(volumes[0], volumes[1], 1e-6 * volumes[0]);
  assert.ok(clamp.notes.some((n) => n.symbol === 'hub_neck_outside_diameter'), 'assumed dimensions are said');
});

test('a Type D cover springs its dish from the bore, cut clear of the ring', () => {
  const cover = build('dished_cover_type_d', {
    crown_radius: 1000, thickness: 30, flange_bore: 900, flange_outside_diameter: 1250,
    flange_ring_thickness: 100, bolt_circle: 1130, bolt_count: 24,
  });
  valid([cover.solid, ...(cover.extraSolids ?? [])]);
  const dish = kernel.bounds(cover.extraSolids![0]);
  close(dish.min[2], 0, 1e-6);
});

test('an octagonal vessel is the rectangle with its corners chamfered, each side in its own plate', () => {
  const octagon = build('octagonal_vessel', {
    octagon_half_width: 500, octagon_half_height: 400, short_side_thickness: 20, long_side_thickness: 25,
    corner_radius: 0, stiffener_pitch: 400,
    short_stiffener_half_length: 250, short_bare_half_length: 50,
    long_stiffener_half_length: 200, long_bare_half_length: 50, course_length: 1000,
  });
  valid([octagon.solid]);
  const inside = 4 * 500 * 400 - 4 * (0.5 * 200 * 150);
  const bounds = kernel.bounds(octagon.solid);
  close(bounds.max[0], 500 + 25, 1e-6);
  close(bounds.max[1], 400 + 20, 1e-6);
  assert.ok(kernel.volume(octagon.solid) > 0 && kernel.volume(octagon.solid) < (4 * 525 * 420 - inside) * 1000);
});

test('a jacket closure and a relief device stand on their hosts', () => {
  const definition: AssemblyDefinition = {
    components: [
      part('H', 'ellipsoidal_head', { inside_diameter: 1200, head_height: 300, thickness: 20, straight_flange_length: 40 }, 0),
      part('S', 'cylindrical_shell', { inside_diameter: 1200, thickness: 20, course_length: 2000 }, 1),
      part('J', 'jacket_closure', { jacket_pressure: 0.6, jacket_thickness: 10, closure_thickness: 16 }, 0, 'S'),
      part('V1', 'pressure_relief_device', { set_pressure: 1.5 }, 0, 'S'),
      part('V2', 'pressure_relief_device', { set_pressure: 1.5 }, 0, 'H'),
    ],
    placements: {
      J: shellSide(300, 0),
      V1: shellSide(1500, 90),
      V2: { anchor: 'head_crown', axialOffset: 300, azimuth: 0 },
    },
    reversed: [],
  };
  const model = new AssemblyBuilder(kernel).build(definition);
  for (const id of ['J', 'V1', 'V2']) {
    const built = model.parts.find((p) => p.componentId === id)!;
    assert.equal(built.status, 'drawn', `${id}: ${built.message}`);
    valid(built.solids);
  }
  assert.equal(model.parts.find((p) => p.componentId === 'J')!.solids.length, 2, 'the bar and its jacket');
});
