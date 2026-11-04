// §4.3.12: a cone with a knuckle at its large end and a flare at its small end, each tangent to
// the cone and to the cylinder it meets — so the transition meets both cylinders square, on their
// own bores, and its ports match theirs with nothing to refuse.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { kernel, part } from './fixtures.ts';

const close = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ± ${tolerance}`);

const transition = (cone: Record<string, number>): AssemblyDefinition => ({
  components: [
    part('L', 'cylindrical_shell', { inside_diameter: 2000, thickness: 20, course_length: 1000 }, 0),
    part('C', 'conical_shell', { inside_diameter: 2000, small_end_diameter: 1200, half_apex_angle: 30, thickness: 20, ...cone }, 1),
    part('S', 'cylindrical_shell', { inside_diameter: 1200, thickness: 20, course_length: 1000 }, 2),
  ],
  placements: {},
  reversed: [],
});

const KNUCKLED = { knuckle_radius: 200, flare_radius: 100 };

test('a knuckled and flared cone meets both cylinders square, on their bores', () => {
  const definition = transition(KNUCKLED);
  const model = new AssemblyBuilder(kernel).build(definition);
  const cone = model.parts.find((p) => p.componentId === 'C')!;
  assert.equal(cone.status, 'drawn');
  assert.ok(kernel.isValid(cone.solids[0]));

  // Each end is a cylinder's: the bore and the wall of the course it is welded to.
  assert.deepEqual(
    [cone.junctions!.lower!.insideDiameter, cone.junctions!.lower!.outsideDiameter, cone.junctions!.lower!.wall.meridian],
    [2000, 2040, [0, -1]]
  );
  assert.deepEqual(
    [cone.junctions!.upper!.insideDiameter, cone.junctions!.upper!.outsideDiameter, cone.junctions!.upper!.wall.meridian],
    [1200, 1240, [0, 1]]
  );

  // Between the virtual corners 400/tan 30° = 692.8; the knuckle adds r_k·tan 15°, the flare r_f·tan 15°.
  const tan15 = Math.tan((15 * Math.PI) / 180);
  const height = 400 / Math.tan(Math.PI / 6) + 300 * tan15;
  const bounds = kernel.bounds(cone.solids[0]);
  close(bounds.max[2] - bounds.min[2], height, 1e-6);
  close(bounds.max[0], 1020, 1e-6);

  // The tangent lines: knuckle to cone at (800 + 200 cos 30°, 200 sin 30°) inside.
  const knuckle = cone.landmarks.find((l) => l.key === 'knuckle-cone-inside')!;
  close(knuckle.diameter, 2 * (800 + 200 * Math.cos(Math.PI / 6)), 1e-9);
  close(knuckle.z, 100, 1e-9);
  const flare = cone.landmarks.find((l) => l.key === 'flare-cone-inside')!;
  close(flare.diameter, 2 * (700 - 100 * Math.cos(Math.PI / 6)), 1e-9);

  // Pappus on the mid-surface, exact on the straight parts and within t³ on the arcs.
  const meridian = cone.meridian!;
  let area = 0;
  for (let i = 1; i < meridian.length; i++) {
    const [r0, z0] = meridian[i - 1];
    const [r1, z1] = meridian[i];
    area += Math.PI * (r0 + r1) * Math.hypot(r1 - r0, z1 - z0);
  }
  close(kernel.volume(cone.solids[0]), 20 * area, 0.002 * 20 * area);

  const resolved = resolveGeometry(definition, model, kernel, { mode: 'analysis' });
  assert.deepEqual(resolved.refusals, [], JSON.stringify(resolved.refusals));
  assert.ok(resolved.joints.every((j) => j.issues.length === 0), JSON.stringify(resolved.joints.map((j) => j.issues)));
  // Four curvature lines: knuckle to cylinder (on the weld), knuckle to cone, cone to flare, flare to cylinder.
  const curvature = resolved.discontinuities.filter((d) => d.componentId === 'C' && d.causes.includes('curvature'));
  assert.deepEqual(curvature.map((d) => d.id).sort(), ['C:flare-cone', 'C:flare-cylinder', 'C:knuckle-cone', 'C:knuckle-cylinder']);
});

test('a knuckle alone leaves the small end sharp, and a sharp cone is drawn as before', () => {
  const knuckleOnly = new AssemblyBuilder(kernel).build(transition({ knuckle_radius: 200 })).parts.find((p) => p.componentId === 'C')!;
  assert.ok(kernel.isValid(knuckleOnly.solids[0]));
  assert.equal(knuckleOnly.junctions!.lower!.wall.meridian[1], -1);
  close(knuckleOnly.junctions!.upper!.outsideDiameter, 1200 + 40 / Math.cos(Math.PI / 6), 1e-9);

  const sharp = new AssemblyBuilder(kernel).build(transition({})).parts.find((p) => p.componentId === 'C')!;
  close(kernel.bounds(sharp.solids[0]).max[2] - kernel.bounds(sharp.solids[0]).min[2], 400 / Math.tan(Math.PI / 6), 1e-6);
  assert.equal(sharp.landmarks.some((l) => l.key.startsWith('knuckle')), false);
});

test('a knuckle and a flare too large for the cone, or a flare no wider than the wall, are refused', () => {
  // (900 + 2500)·tan 15° = 911 mm of an 800 mm slant.
  const tooBig = new AssemblyBuilder(kernel).build(transition({ knuckle_radius: 900, flare_radius: 2500 }));
  const cone = tooBig.parts.find((p) => p.componentId === 'C')!;
  assert.equal(cone.status, 'failed');
  assert.equal(cone.scope?.parameter, 'knuckle and flare along the cone');
  const thin = new AssemblyBuilder(kernel).build(transition({ flare_radius: 15 })).parts.find((p) => p.componentId === 'C')!;
  assert.equal(thin.status, 'failed');
  assert.equal(thin.scope?.parameter, 'flare_radius');
});
