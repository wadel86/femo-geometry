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

const close = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ± ${tolerance}`);

/** A ring of triangular section, legs `radial` and `axial`, its right angle at radius `r`: Pappus. */
const ring = (r: number, radial: number, axial: number) => 2 * Math.PI * (r + radial / 3) * (radial * axial) / 2;

test("a cone stated on the shells' bores meets both of them, faired by weld metal on the shells", () => {
  const definition = reducer(2000, 1200);
  const model = new AssemblyBuilder(kernel).build(definition);
  const resolved = resolveGeometry(definition, model, kernel, { mode: 'analysis' });
  assert.deepEqual(radiusFindings(definition), []);

  const port = (id: string) => resolved.parts.flatMap((p) => p.ports).find((p) => p.id === id)!;
  // The bores agree at both welds, and so — built up — do the faces: t / cos α = 23.094 mm.
  for (const [cone, shell, bore] of [['lower@C', 'upper@S1', 1000], ['upper@C', 'lower@S2', 600]] as const) {
    assert.equal(port(cone).insideRadius, bore);
    assert.equal(port(shell).insideRadius, bore);
    close(port(shell).outsideRadius!, bore + across, 1e-9);
    close(port(cone).outsideRadius!, bore + across, 1e-9);
  }
  // Nothing is left to report: no radius, no step.
  assert.deepEqual(resolved.joints.flatMap((j) => j.findings), []);
  assert.equal(resolved.ready, true);
});

test('the build-up is weld metal on the thinner shell, 3:1 along the axis, and the cone is untouched', () => {
  const definition = reducer(2000, 1200);
  const model = new AssemblyBuilder(kernel).build(definition);
  const solid = (id: string) => model.parts.find((p) => p.componentId === id)!.solids[0];
  const alone = (id: string) => {
    const one = { ...definition, components: definition.components.filter((c) => c.id === id) };
    return kernel.volume(new AssemblyBuilder(kernel).build(one).parts[0].solids[0]);
  };
  for (const id of ['S1', 'C', 'S2']) assert.ok(kernel.isValid(solid(id)), id);
  // The cone keeps every millimetre of its wall.
  close(kernel.volume(solid('C')), alone('C'), 1e-6 * alone('C'));
  // Each shell gains exactly its ring: (t / cos α − t_shell) radially, three times that along the axis.
  close(kernel.volume(solid('S1')) - alone('S1'), ring(1022, across - 22, 3 * (across - 22)), 1e-3);
  close(kernel.volume(solid('S2')) - alone('S2'), ring(616, across - 16, 3 * (across - 16)), 1e-3);
  // Named where it ends, so a mesh can find the toe of the build-up.
  const S2 = model.parts.find((p) => p.componentId === 'S2')!;
  const toe = S2.landmarks?.find((l) => l.key === 'lower-buildup');
  assert.ok(toe, JSON.stringify(S2.landmarks));
  close(toe.z, 3 * (across - 16), 1e-9);
});

test('a flare end is faired on the shell, never cut into the torus', () => {
  const definition: AssemblyDefinition = {
    ...reducer(2000, 1200),
    components: reducer(2000, 1200).components.map((c) =>
      c.id === 'C' ? { ...c, dimensions: { ...c.dimensions, flare_radius: 100, flare_thickness: 20 } } : c
    ),
  };
  const model = new AssemblyBuilder(kernel).build(definition);
  const resolved = resolveGeometry(definition, model, kernel, { mode: 'analysis' });
  // A flare ends in a 20 mm cylinder with no straight length: the 16 mm shell is built up 4 mm over 12.
  assert.deepEqual(resolved.joints.filter((j) => j.id === 'C:upper~S2:lower').flatMap((j) => j.findings), []);
  const S2 = model.parts.find((p) => p.componentId === 'S2')!;
  close(S2.landmarks!.find((l) => l.key === 'lower-buildup')!.z, 12, 1e-9);
});

test('a shell too short for its build-up keeps the step, and says so', () => {
  const definition: AssemblyDefinition = {
    ...reducer(2000, 1200),
    components: reducer(2000, 1200).components.map((c) =>
      c.id === 'S2' ? { ...c, dimensions: { ...c.dimensions, course_length: 15 } } : c
    ),
  };
  const model = new AssemblyBuilder(kernel).build(definition);
  const resolved = resolveGeometry(definition, model, kernel, { mode: 'analysis' });
  // 7.094 mm at 3:1 needs 21.3 mm of straight shell; 15 is not enough.
  assert.deepEqual(
    resolved.joints.filter((j) => j.id === 'C:upper~S2:lower').flatMap((j) => j.findings.map((f) => f.parameter)),
    ['thickness step']
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

test('declaring a mid-wall datum moves the check onto the mid-surfaces of an unfaired joint', () => {
  // A faired joint's faces agree whatever the datum, so the check bites where nothing can be
  // faired: an upper shell of 15 mm cannot take the 21.3 mm a 7.094 mm build-up needs.
  const short = (definition: AssemblyDefinition): AssemblyDefinition => ({
    ...definition,
    components: definition.components.map((c) =>
      c.id === 'S2' ? { ...c, dimensions: { ...c.dimensions, course_length: 15 } } : c
    ),
  });
  const findings = radiusFindings(short(reducer(1200 + 16 - across + 800, 1200 + 16 - across, 'mid_wall')));
  assert.ok(!findings.some((f) => f.startsWith('C:upper~S2:lower')), JSON.stringify(findings));
  const flush = radiusFindings(short(reducer(2000, 1200, 'mid_wall')));
  assert.ok(flush.some((f) => f === 'C:upper~S2:lower: mean radius at the joint, in its plane'), JSON.stringify(flush));
});
