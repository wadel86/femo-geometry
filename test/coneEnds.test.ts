// A cone's D and D_S are INSIDE diameters, as every diameter the catalogue states (user decision,
// 2026-11-20): its bore runs flush with the shells it is welded to, and the engine matches it to
// them on the bore. Its mid-surface then steps against theirs by half the difference of the walls
// across the joint plane — the end plane cuts a cone's wall at t / cos α — and that step is the
// weld's real eccentricity, not a misfit. A mid-wall fit-up is a datum the joint declares.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry } from '../src/assembly/resolve.ts';
import type { AlignmentDatum, AssemblyDefinition } from '../src/definition.ts';
import { kernel, part } from './fixtures.ts';

// Demo E's reducer, sharp at both ends: 2000 × 22 below, a 20 mm cone at 30°, 1200 × 16 above.
const across = 20 / Math.cos(Math.PI / 6);

const reducer = (large: number, small: number, alignment?: AlignmentDatum): AssemblyDefinition => ({
  components: [
    part('S1', 'cylindrical_shell', { inside_diameter: 2000, thickness: 22, course_length: 1000 }, 0),
    part('C', 'conical_shell', { inside_diameter: large, thickness: 20, half_apex_angle: 30, small_end_diameter: small }, 1),
    part('S2', 'cylindrical_shell', { inside_diameter: 1200, thickness: 16, course_length: 1000 }, 2),
  ],
  placements: {},
  reversed: [],
  ...(alignment ? { joints: { 'S1~C': { alignment }, 'C~S2': { alignment } } } : {}),
});

const radiusFindings = (definition: AssemblyDefinition) => {
  const model = new AssemblyBuilder(kernel).build(definition);
  const resolved = resolveGeometry(definition, model, kernel, { mode: 'analysis' });
  return resolved.joints.flatMap((j) =>
    j.findings.filter((f) => f.parameter.includes('radius at the joint')).map((f) => `${j.id}: ${f.parameter}`)
  );
};

test("a cone stated on the shells' bores meets both of them, its mid-surface eccentric", () => {
  const definition = reducer(2000, 1200);
  const model = new AssemblyBuilder(kernel).build(definition);
  const resolved = resolveGeometry(definition, model, kernel, { mode: 'analysis' });
  assert.deepEqual(radiusFindings(definition), []);

  const port = (id: string) => resolved.parts.flatMap((p) => p.ports).find((p) => p.id === id)!;
  // The bores agree at both welds…
  assert.equal(port('lower@C').insideRadius, 1000);
  assert.equal(port('upper@C').insideRadius, 600);
  assert.equal(port('lower@S2').insideRadius, 600);
  // …and the small end's mid-surfaces stand (t_shell − t / cos α) / 2 apart: 3.547 mm, kept.
  const small = port('upper@C').meanRadius! - port('lower@S2').meanRadius!;
  assert.ok(Math.abs(small - (across - 16) / 2) < 1e-6, `${small}`);
  // What is left is real and is not about the radius: a sharp cone's end face is t / cos α =
  // 23.094 mm wide, against 22 and 16 mm shells, and no taper is drawn on a cone's end.
  assert.deepEqual(
    resolved.joints.flatMap((j) => j.findings.map((f) => `${j.id}: ${f.parameter}`)),
    ['S1:upper~C:lower: thickness step', 'C:upper~S2:lower: thickness step']
  );
});

test('a cone sized on mid-wall diameters is refused at the bore, by how far it is off', () => {
  // Demo E's old workaround: the mid-wall diameters less the wall across the end plane.
  // 3.547 mm of radius off at the small end, past 0.1 % of 600; the large end's 0.547 is inside
  // 0.1 % of 1000 — and inside the engine's 1 mm, which is why only the small end went INCOMPLETE.
  assert.deepEqual(radiusFindings(reducer(2000 + 22 - across, 1200 + 16 - across)), [
    'C:upper~S2:lower: inside radius at the joint, in its plane',
  ]);
});

test('declaring a mid-wall datum moves the check onto the mid-surfaces', () => {
  const findings = radiusFindings(reducer(1200 + 16 - across + 800, 1200 + 16 - across, 'mid_wall'));
  assert.ok(!findings.some((f) => f.startsWith('C:upper~S2:lower')), JSON.stringify(findings));
  const flush = radiusFindings(reducer(2000, 1200, 'mid_wall'));
  assert.ok(flush.some((f) => f === 'C:upper~S2:lower: mean radius at the joint, in its plane'), JSON.stringify(flush));
});
