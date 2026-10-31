// What the kernel does not draw, it says: a stated feature drawn other than asked is a refusal
// in analysis, never a silent simplification.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { kernel, part } from './fixtures.ts';

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

test('a coil drawn as rings is a representation, its pitch an assumption: two refusals, told apart', () => {
  const found = refusals({
    components: [
      part('S', 'cylindrical_shell', { inside_diameter: 1600, thickness: 14, course_length: 2000 }),
      part('J', 'half_pipe_jacket', { half_pipe_inside_radius: 38.95, thickness: 5.5, half_pipe_size: 80, jacket_pressure: 1 }, 0, 'S'),
    ],
    placements: { J: { anchor: 'shell_side', axialOffset: 1000, azimuth: 0 } },
    reversed: [],
  }).filter((r) => r.componentId === 'J');
  assert.deepEqual(found.map((r) => r.reason), ['represented', 'assumed']);
  assert.equal(found[0].limit, 'a helix');
  assert.match(found[1].value, /^not stated — drawn 127\.85 mm over 2000 mm$/);
});

test("a cone's knuckle and flare are stated, not drawn, and said to be", () => {
  const messages = refusals({
    components: [
      part('C', 'conical_shell', {
        inside_diameter: 2000, thickness: 20, half_apex_angle: 30, small_end_diameter: 1200,
        knuckle_radius: 200, flare_radius: 100,
      }),
    ],
    placements: {},
    reversed: [],
  }).map((r) => r.message);
  assert.ok(messages.some((m) => /knuckle at the large end of 200 mm is stated and not drawn/.test(m)), messages.join('\n'));
  assert.ok(messages.some((m) => /flare at the small end of 100 mm is stated and not drawn/.test(m)));
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
