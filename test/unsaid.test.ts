// What the kernel does not draw, it says: a stated feature drawn other than asked is a refusal
// in analysis, never a silent simplification.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { kernel, part } from './fixtures.ts';

const close = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ± ${tolerance}`);

const refusals = (definition: AssemblyDefinition) => {
  const found = resolveGeometry(definition, new AssemblyBuilder(kernel).build(definition), kernel, { mode: 'analysis' }).refusals;
  // Whatever the case, no refusal goes out without the three things a reviewer judges it by.
  for (const r of found) {
    assert.ok(![r.parameter, r.limit, r.value].includes('unstated'), `${r.name}: ${r.message} names nothing`);
  }
  return found;
};

test('a refusal names its entry, the parameter, the limit and the value seen', () => {
  const head = { inside_diameter: 1800, crown_radius: 1440, knuckle_radius: 180, thickness: 22, straight_flange_length: 50 };
  const found = refusals({
    components: [
      part('S', 'cylindrical_shell', { inside_diameter: 1800, thickness: 20, course_length: 1500 }, 0),
      part('H', 'torispherical_head', head, 1),
      part('N', 'radial_nozzle', { nozzle_inside_diameter: 800, nozzle_thickness: 25, nozzle_outward_projection: 300 }, 0, 'H'),
    ],
    placements: { N: { anchor: 'head_crown', axialOffset: 861.43, azimuth: 0 } },
    reversed: [],
  });
  const nozzle = found.find((r) => r.componentId === 'N')!;
  assert.equal(nozzle.entry, 'radial_nozzle');
  assert.equal(nozzle.reason, 'out_of_scope');
  assert.equal(nozzle.parameter, 'distance from the axis to the far edge of the part');
  assert.equal(nozzle.limit, '≤ 900 mm, the inside radius of H');
  assert.equal(nozzle.value, '1286.4 mm');
});

test('a half-pipe coil is one helix on the shell; only its unstated pitch is refused', () => {
  const definition: AssemblyDefinition = {
    components: [
      part('S', 'cylindrical_shell', { inside_diameter: 1600, thickness: 14, course_length: 800 }),
      part('J', 'half_pipe_jacket', { half_pipe_inside_radius: 38.95, thickness: 5.5, half_pipe_size: 80, jacket_pressure: 1 }, 0, 'S'),
    ],
    placements: { J: { anchor: 'shell_side', axialOffset: 400, azimuth: 0 } },
    reversed: [],
  };
  const model = new AssemblyBuilder(kernel).build(definition);
  const [coil] = model.parts.find((p) => p.componentId === 'J')!.solids;
  const shell = model.parts.find((p) => p.componentId === 'S')!.solids[0];
  assert.ok(kernel.isValid(coil));
  assert.ok(kernel.volume(kernel.intersect(coil, shell)) < 1, 'the coil lies on the shell, not in it');
  // A little over half the annulus of 44.45 by 38.95 along the helix — its centre is on a surface
  // that curves away from it: 5 turns at 127.85 between the 64.45 mm margins of an 800 course.
  const lead = Math.hypot(2 * Math.PI * 821, 127.85);
  const halfAnnulus = (Math.PI * (44.45 ** 2 - 38.95 ** 2)) / 2;
  const volume = kernel.volume(coil);
  assert.ok(volume > halfAnnulus * lead * 5 && volume < 1.05 * halfAnnulus * lead * 5, `coil volume ${volume}`);

  const found = refusals(definition).filter((r) => r.componentId === 'J');
  assert.deepEqual(found.map((r) => r.reason), ['assumed']);
  assert.match(found[0].value, /^not stated — drawn 127\.85 mm over 800 mm$/);
});

test("a tubesheet meets its shell and channel on their own annuli, once it knows their walls", () => {
  const plate = {
    thickness: 80, flange_outside_diameter: 900, tube_pitch: 31.75, tube_outside_diameter: 25.4,
    tube_thickness: 2.1, tube_limit_radius: 260, tube_layout_angle: 30,
  };
  const exchanger = (walls: Record<string, number>): AssemblyDefinition => ({
    components: [
      part('C', 'cylindrical_shell', { inside_diameter: 800, thickness: 12, course_length: 800 }, 0),
      part('T', 'u_tube_tubesheet', { ...plate, ...walls }, 1),
      part('S', 'cylindrical_shell', { inside_diameter: 800, thickness: 12, course_length: 2000 }, 2),
    ],
    placements: {},
    reversed: [],
  });
  const radii = (walls: Record<string, number>) =>
    refusals(exchanger(walls)).filter((r) => r.parameter === 'mean radius at the joint, in its plane');
  // Not knowing where the shell lands, the plate offers its whole face: refused, as it should be.
  assert.equal(radii({}).length, 2);
  // Told the shell's and the channel's walls, its faces are their annuli, and both joints match.
  assert.deepEqual(
    radii({ shell_inside_diameter: 800, shell_thickness: 12, channel_inside_diameter: 800, channel_thickness: 12 }),
    []
  );
});

test('a saddle is plates — bearing, web, ribs, base — that touch and never overlap', () => {
  const saddle = {
    saddle_angle: 120, saddle_width: 200, wear_plate_thickness: 12, saddle_height: 450,
    saddle_bearing_plate_thickness: 12, saddle_web_thickness: 14, saddle_rib_count: 4,
    saddle_rib_thickness: 12, saddle_base_plate_thickness: 20,
  };
  const definition: AssemblyDefinition = {
    components: [
      part('S', 'cylindrical_shell', { inside_diameter: 2000, thickness: 20, course_length: 4000 }),
      part('SA', 'saddle_support', saddle, 0, 'S'),
    ],
    placements: { SA: { anchor: 'shell_side', axialOffset: 1000, azimuth: 0 } },
    reversed: [],
  };
  const model = new AssemblyBuilder(kernel).build(definition);
  const solids = model.parts.find((p) => p.componentId === 'SA')!.solids;
  // Wear plate, bearing plate, base plate, web, and four ribs in two halves each.
  assert.equal(solids.length, 1 + 3 + 2 * 4);
  for (const s of solids) assert.ok(kernel.isValid(s));
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const shared = kernel.volume(kernel.intersect(solids[i], solids[j]));
      assert.ok(shared < 1, `plates ${i} and ${j} overlap by ${shared} mm³`);
    }
  }
  // Everything stated: nothing about the saddle is assumed, approximated or refused.
  assert.deepEqual(refusals(definition).filter((r) => r.componentId === 'SA'), []);
  // Nothing stated but its contact: each plate it had to choose is an assumption, and said.
  const bare = refusals({
    ...definition,
    components: [definition.components[0], part('SA', 'saddle_support', { saddle_angle: 120, saddle_width: 200 }, 0, 'S')],
  }).filter((r) => r.componentId === 'SA');
  assert.equal(bare.length, 6);
  assert.ok(bare.every((r) => r.reason === 'assumed'));
});

test('a pad on a head is the head thickened: it lies on the head and nowhere in it', () => {
  const head = { inside_diameter: 1800, head_height: 450, thickness: 20, straight_flange_length: 50 };
  const vessel = (offset: number, width: number): AssemblyDefinition => ({
    components: [
      part('S', 'cylindrical_shell', { inside_diameter: 1800, thickness: 20, course_length: 1500 }, 0),
      part('H', 'ellipsoidal_head', head, 1),
      part('N', 'radial_nozzle', {
        nozzle_inside_diameter: 300, nozzle_thickness: 16, nozzle_outward_projection: 250,
        pad_width: width, pad_thickness: 20,
      }, 0, 'H'),
    ],
    placements: { N: { anchor: 'head_crown', axialOffset: offset, azimuth: 0 } },
    reversed: [],
  });
  const model = new AssemblyBuilder(kernel).build(vessel(0, 150));
  const [neck, pad] = model.parts.find((p) => p.componentId === 'N')!.solids;
  assert.ok(neck && pad && kernel.isValid(pad));
  const headSolid = model.parts.find((p) => p.componentId === 'H')!.solids[0];
  assert.ok(kernel.volume(kernel.intersect(pad, headSolid)) < 1, 'the pad lies on the head, not in it');
  // An annulus 166 to 316 mm from the axis, 20 thick, on a gently curved crown: about π(316² − 166²)·20.
  close(kernel.volume(pad), Math.PI * (316 ** 2 - 166 ** 2) * 20, 0.05 * Math.PI * (316 ** 2 - 166 ** 2) * 20);
  assert.deepEqual(refusals(vessel(0, 150)).filter((r) => r.componentId === 'N'), []);

  // Off the crown the neck stands parallel to the vessel axis, not normal to the head: said.
  const off = refusals(vessel(400, 150)).filter((r) => r.componentId === 'N');
  assert.deepEqual(off.map((r) => r.reason), ['represented']);
  // Past the head's inside radius it would leave its host: out of scope, and not drawn.
  const past = refusals(vessel(400, 400)).filter((r) => r.componentId === 'N');
  assert.equal(past[0].reason, 'out_of_scope');
  assert.equal(past[0].value, '966 mm');
});

test("a cone's knuckle and flare are drawn, so nothing about them is refused", () => {
  const found = refusals({
    components: [
      part('C', 'conical_shell', {
        inside_diameter: 2000, thickness: 20, half_apex_angle: 30, small_end_diameter: 1200,
        knuckle_radius: 200, flare_radius: 100,
      }),
    ],
    placements: {},
    reversed: [],
  });
  assert.deepEqual(found.filter((r) => /knuckle|flare/.test(r.message)), []);
});

test('a flat head next to an obround body is not joined to it, and analysis says so', () => {
  const obround = { obround_radius: 400, obround_flat_half_length: 1200, curved_thickness: 14, flat_thickness: 14, course_length: 2000 };
  const plate = { inside_diameter: 800, thickness: 28, attachment_factor: 0.33 };
  const found = refusals({
    components: [part('E1', 'flat_head', plate, 0), part('B', 'obround_vessel', obround, 1), part('E2', 'flat_head', plate, 2)],
    placements: {},
    reversed: [],
  });
  const joins = found.filter((r) => /offers no circular end/.test(r.message));
  assert.deepEqual(joins.map((r) => r.componentId), ['B', 'E2']);
  assert.match(joins[0].message, /B is not joined to E1: B offers no circular end/);
});

test('stays given as a pitch on a non-circular body are said not to be drawn', () => {
  const messages = refusals({
    components: [
      part('B', 'obround_vessel', {
        obround_radius: 400, obround_flat_half_length: 1200, curved_thickness: 14, flat_thickness: 14,
        course_length: 2000, stay_pitch: 300, stay_diameter: 25,
      }),
    ],
    placements: {},
    reversed: [],
  }).map((r) => r.message);
  assert.ok(messages.some((m) => /Stays at a 300 mm pitch are stated and not drawn/.test(m)), messages.join('\n'));
});
