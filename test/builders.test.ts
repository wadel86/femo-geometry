import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RUN_BUILDERS } from '../src/builders/runParts.ts';
import { kernel, part } from './fixtures.ts';

const build = (kind: string, dimensions: Record<string, number>) =>
  RUN_BUILDERS[kind](part('P', kind, dimensions), { kernel });

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

test('an ellipsoidal head bulges outwards', () => {
  const head = build('ellipsoidal_head', { inside_diameter: 2000, head_height: 500, thickness: 20 });
  // An ellipse revolves into a general surface of revolution, integrated numerically.
  close(kernel.volume(head.solid), (2 / 3) * Math.PI * (1020 ** 2 * 520 - 1000 ** 2 * 500), 1e-4);
  close(kernel.bounds(head.solid).max[2], 520, 1e-4);
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
