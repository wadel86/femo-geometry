// What the kernel does not draw, it says: a stated feature drawn other than asked is a refusal
// in analysis, never a silent simplification.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { kernel, part } from './fixtures.ts';

const refusals = (definition: AssemblyDefinition) =>
  resolveGeometry(definition, new AssemblyBuilder(kernel).build(definition), kernel, { mode: 'analysis' }).refusals;

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
