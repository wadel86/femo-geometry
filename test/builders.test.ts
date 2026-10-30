import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ellipseOffset } from '../src/builders/bezierFit.ts';
import { RUN_BUILDERS } from '../src/builders/runParts.ts';
import type { RunContext } from '../src/builders/types.ts';
import { kernel, part } from './fixtures.ts';

const build = (kind: string, dimensions: Record<string, number>, context: Omit<RunContext, 'kernel'> = {}) =>
  RUN_BUILDERS[kind](part('P', kind, dimensions), { kernel, ...context });

const close = (actual: number, expected: number, relative = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= relative * Math.abs(expected),
    `expected ${expected}, got ${actual}`
  );

test('a cylindrical course has the volume of its annulus', () => {
  const course = build('cylindrical_shell', { inside_diameter: 5000, thickness: 100, course_length: 8000 });
  close(kernel.volume(course.solid), Math.PI * (2600 ** 2 - 2500 ** 2) * 8000);
  assert.equal(course.height, 8000);
});

test('a course with no length is drawn, and says what it assumed', () => {
  const course = build('cylindrical_shell', { inside_diameter: 2000, thickness: 20 });
  assert.equal(course.height, 2000);
  assert.match(course.notes[0].message, /Course length not stated/);
  assert.equal(course.notes[0].symbol, 'course_length');
});

test('a conical course is the frustum between its two ends', () => {
  const cone = build('conical_shell', { inside_diameter: 3000, thickness: 20, half_apex_angle: 30, course_length: 1000 });
  const tan = Math.tan(Math.PI / 6);
  const across = 20 / Math.cos(Math.PI / 6);
  const frustum = (r0: number, r1: number) => (Math.PI * 1000 * (r0 * r0 + r0 * r1 + r1 * r1)) / 3;
  const r0 = 1500;
  const r1 = 1500 - 1000 * tan;
  close(kernel.volume(cone.solid), frustum(r0 + across, r1 + across) - frustum(r0, r1));
  close(cone.upper!.insideDiameter, 2 * r1);
});

test('a hemispherical head is half a spherical shell', () => {
  const head = build('hemispherical_head', { inside_diameter: 2000, thickness: 50 });
  close(kernel.volume(head.solid), ((2 / 3) * Math.PI * (1050 ** 3 - 1000 ** 3)));
});

test('an ellipsoidal head is t thick all over: its outside is the true offset of its inside', () => {
  const head = build('ellipsoidal_head', { inside_diameter: 2000, head_height: 500, thickness: 20 });
  // The exact offset shell, revolved from a dense polygon of the offset curve and the ellipse.
  const offset = ellipseOffset(1000, 500, 20).curve;
  const outline: [number, number][] = [];
  for (let i = 0; i <= 4000; i++) outline.push(offset.point((Math.PI / 2) * (i / 4000)) as [number, number]);
  for (let i = 4000; i >= 0; i--) {
    const u = (Math.PI / 2) * (i / 4000);
    outline.push([1000 * Math.cos(u), 500 * Math.sin(u)]);
  }
  const exact = outline.reduce((sum, [r0, z0], i) => {
    const [r1, z1] = outline[(i + 1) % outline.length];
    return sum + (Math.PI / 3) * (r0 * r0 + r0 * r1 + r1 * r1) * (z1 - z0);
  }, 0);
  close(kernel.volume(head.solid), Math.abs(exact), 2e-5);
  // The ellipse of semi-axes a + t and h + t, drawn before, held 3.4 % less metal.
  assert.ok(Math.abs(exact) / ((2 / 3) * Math.PI * (1020 ** 2 * 520 - 1000 ** 2 * 500)) > 1.03);
  close(kernel.bounds(head.solid).max[2], 520, 1e-6);
  assert.deepEqual(head.notes.map((n) => n.symbol), ['straight_flange_length']);
});

test('a straight flange lifts a head off its weld, and moves the tangent line with it', () => {
  const plain = build('hemispherical_head', { inside_diameter: 2000, thickness: 50, straight_flange_length: 0 });
  const flanged = build('hemispherical_head', { inside_diameter: 2000, thickness: 50, straight_flange_length: 40 });
  assert.deepEqual(plain.notes, [], 'a stated zero is an answer');
  close(flanged.height, plain.height + 40);
  close(kernel.volume(flanged.solid), kernel.volume(plain.solid) + Math.PI * (1050 ** 2 - 1000 ** 2) * 40);
  assert.equal(flanged.tangentLine, 40);
  assert.deepEqual(flanged.landmarks.map((l) => [l.key, l.z]).sort(), [
    ['lower-inside', 0],
    ['lower-outside', 0],
    ['tangent-inside', 40],
    ['tangent-outside', 40],
  ]);
  assert.equal(flanged.lower!.wall.surface.kind, 'cylinder', 'the weld is on the flange, not the sphere');

  for (const kind of ['torispherical_head', 'ellipsoidal_head'] as const) {
    const dimensions = { inside_diameter: 2000, thickness: 20, crown_radius: 2000, knuckle_radius: 200, head_height: 500 };
    const without = build(kind, { ...dimensions, straight_flange_length: 0 });
    const withFlange = build(kind, { ...dimensions, straight_flange_length: 50 });
    // The volume of a fitted surface of revolution is integrated numerically, to about 1e-5.
    close(kernel.volume(withFlange.solid), kernel.volume(without.solid) + Math.PI * (1020 ** 2 - 1000 ** 2) * 50, 3e-5);
  }
});

test('a spherical course is cut to meet its neighbours, not drawn whole between them', () => {
  const zone = build(
    'spherical_shell',
    { inside_diameter: 2000, thickness: 30 },
    { belowInsideDiameter: 1200, aboveInsideDiameter: 800 }
  );
  const c = Math.sqrt(1000 ** 2 - 600 ** 2);
  const top = c + Math.sqrt(1000 ** 2 - 400 ** 2);
  close(zone.height, top);
  close(zone.lower!.insideDiameter, 1200);
  close(zone.upper!.insideDiameter, 800);
  // A spherical zone between two planes: the outside's cap volume less the inside's.
  const capBetween = (radius: number, z0: number, z1: number) =>
    Math.PI * (radius * radius * (z1 - z0) - (z1 ** 3 - z0 ** 3) / 3);
  close(kernel.volume(zone.solid), capBetween(1030, -c, top - c) - capBetween(1000, -c, top - c), 1e-6);
  // Its walls meet the neighbours at an angle, pointing away from the sphere.
  assert.ok(zone.lower!.wall.meridian[0] < 0 && zone.lower!.wall.meridian[1] < 0);
  assert.ok(zone.upper!.wall.meridian[0] < 0 && zone.upper!.wall.meridian[1] > 0);
  assert.throws(() => build('spherical_shell', { inside_diameter: 2000, thickness: 30 }, { belowInsideDiameter: 2000 }), /no wider/);
});

test('a spherical shell is a whole sphere', () => {
  const sphere = build('spherical_shell', { inside_diameter: 2000, thickness: 30 });
  close(kernel.volume(sphere.solid), (4 / 3) * Math.PI * (1030 ** 3 - 1000 ** 3));
});

test('a torispherical head rises to its crown, and states both tangent lines', () => {
  const head = build('torispherical_head', { inside_diameter: 5000, crown_radius: 5000, knuckle_radius: 300, thickness: 100 });
  const xc = 2500 - 300;
  const zc = -Math.sqrt((5000 - 300) ** 2 - xc ** 2);
  close(head.height, zc + 5100);
  close(kernel.bounds(head.solid).max[2], zc + 5100, 1e-4);
  assert.deepEqual(
    head.landmarks.map((l) => l.key).sort(),
    ['crown-knuckle-inside', 'crown-knuckle-outside', 'lower-inside', 'lower-outside']
  );
});

test('a torispherical head whose crown cannot reach its knuckle is refused', () => {
  assert.throws(
    () => build('torispherical_head', { inside_diameter: 5000, crown_radius: 2000, knuckle_radius: 300, thickness: 100 }),
    /crown radius/
  );
});

test('a flange is its ring plus its hub', () => {
  const flange = build('integral_flange', {
    flange_bore: 1000, flange_outside_diameter: 1300, thickness: 80,
    hub_large_end_thickness: 40, hub_small_end_thickness: 20, hub_length: 100,
  });
  const ring = Math.PI * (650 ** 2 - 500 ** 2) * 80;
  // A linear taper from 40 to 20 over 100: a frustum of revolution minus the bore.
  const hub = (Math.PI * 100 * (540 ** 2 + 540 * 520 + 520 ** 2)) / 3 - Math.PI * 500 ** 2 * 100;
  close(kernel.volume(flange.solid), ring + hub);
  assert.equal(flange.height, 180);
});
