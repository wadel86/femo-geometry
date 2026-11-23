// RCC-M H3232 / Annexe ZVI: a linear support member, drawn from what A and l fix. Generic
// dimensions, not any real vessel's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder, solidToAssembly } from '../src/assembly/buildAssembly.ts';
import type { AssemblyDefinition, Placement } from '../src/definition.ts';
import { kernel, part } from './fixtures.ts';

const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ± ${tolerance}`);

const COURSE = { inside_diameter: 1500, thickness: 16, course_length: 2000 };
const MEMBER = { member_area: 6400, member_length: 1500, member_radius_of_gyration_x: 23.1, member_radius_of_gyration_y: 23.1 };
const at: Placement = { anchor: 'shell_side', axialOffset: 400, azimuth: 0 };

const vessel = (member: Record<string, number>, placement: Placement = at): AssemblyDefinition => ({
  components: [part('S', 'cylindrical_shell', COURSE, 0), part('M', 'linear_support_member', member, 0, 'S')],
  placements: { M: placement },
  reversed: [],
});
const member = (definition: AssemblyDefinition) => new AssemblyBuilder(kernel).build(definition).parts.find((p) => p.componentId === 'M')!;
const box = (definition: AssemblyDefinition) => {
  const m = member(definition);
  assert.equal(m.status, 'drawn', m.message);
  return kernel.bounds(solidToAssembly(kernel, m.solids[0]!, m.transform));
};

test('a square bar of side √A, l long, its top at the placement against the shell', () => {
  const m = member(vessel(MEMBER));
  close(kernel.volume(m.solids[0]!), 6400 * 1500, 1e-3);
  const b = box(vessel(MEMBER));
  close(b.min[0]!, 766, 1e-6); // the shell's outside, R_o = 750 + 16
  close(b.max[0]! - b.min[0]!, 80, 1e-6);
  close(b.max[2]!, 400, 1e-6);
  close(b.min[2]!, 400 - 1500, 1e-6);
});

test('an inclination swings the foot outward in the plane of the azimuth, about its top at the shell', () => {
  const b = box(vessel({ ...MEMBER, member_inclination: 15 }));
  const t = (15 * Math.PI) / 180;
  // The outer bottom corner moves out by l·sin θ (plus the side's own turn).
  close(b.max[0]!, 766 + 1500 * Math.sin(t) + 80 * Math.cos(t), 1e-6);
  close(b.min[0]!, 766, 1e-6);
  close(b.max[2]!, 400 + 80 * Math.sin(t), 1e-6);
});

test('a profile other than square is said, not invented; out-of-range values are refused', () => {
  const m = member(vessel({ ...MEMBER, member_profile: 1 }));
  assert.equal(m.status, 'drawn');
  assert.ok(m.notes.some((n) => n.scope?.reason === 'not_built' && n.symbol === 'member_profile'));
  assert.equal(member(vessel({ ...MEMBER, member_profile: 7 })).scope?.parameter, 'member_profile');
  assert.equal(member(vessel({ ...MEMBER, member_inclination: 85 })).scope?.parameter, 'member_inclination');
});
