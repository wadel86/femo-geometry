// A radial nozzle on a formed head, off its pole and radial to the HEAD: the `head_normal`
// anchor (TRESCA QUALIFICATION, 2026-11-25). Each head's own geometry says what normal is — a
// radius of the sphere, the gradient of the ellipse, the crown's or the knuckle's radius of the
// torisphere — and the neck must lie along it. Generic dimensions, not any real vessel's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition, ComponentDefinition, Placement } from '../src/definition.ts';
import { kernel, part } from './fixtures.ts';

type V = readonly number[];
const near = (actual: V, expected: V, tolerance = 1e-6) =>
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]!) <= tolerance, `${JSON.stringify(actual)} is not ${JSON.stringify(expected)}`));
const unit = (v: V) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};

const A = 750; // inside radius
const T = 16;
const LENGTH = 1000;
const NECK = { nozzle_inside_diameter: 80, nozzle_thickness: 10, nozzle_outward_projection: 150 };
const PHI = (30 * Math.PI) / 180;

const onTop = (head: ComponentDefinition, placement: Placement, neck: Record<string, number> = NECK): AssemblyDefinition => ({
  components: [
    part('S', 'cylindrical_shell', { inside_diameter: 2 * A, thickness: T, course_length: LENGTH }, 0),
    { ...head, position: 1 },
    part('M', 'radial_nozzle', neck, 0, 'H'),
  ],
  placements: { M: placement },
  reversed: [],
});
const normal = (rho: number, azimuth = 30): Placement => ({ anchor: 'head_normal', axialOffset: rho, azimuth });

/** The neck as drawn and resolved: its frame in the assembly, and its joint to the head. */
function neckOf(definition: AssemblyDefinition) {
  const model = new AssemblyBuilder(kernel).build(definition);
  const m = model.parts.find((p) => p.componentId === 'M')!;
  assert.equal(m.status, 'drawn', m.message);
  for (const s of m.solids) assert.ok(kernel.isValid(s));
  const resolved = resolveGeometry(definition, model, kernel);
  const frame = resolved.parts.find((p) => p.componentId === 'M')!.frame!;
  const joint = resolved.joints.find((j) => j.id === 'H:opening:M~M:neck:host-end');
  assert.equal(joint?.kind, 'set_in_nozzle');
  assert.deepEqual(joint?.issues, []);
  return frame;
}

/** Where the neck's axis should cross the inside surface, and the normal there, in the assembly. */
const expected = (rho: number, z: number, normalRZ: V) => {
  const [nr, nz] = unit(normalRZ);
  const axis = [nr! * Math.cos(PHI), nr! * Math.sin(PHI), nz!];
  const origin = [(rho + T * nr!) * Math.cos(PHI), (rho + T * nr!) * Math.sin(PHI), z + T * nz!];
  return { axis, origin };
};

test('on a hemispherical head the neck is a radius of the sphere', () => {
  const head = part('H', 'hemispherical_head', { inside_diameter: 2 * A, thickness: T, straight_flange_length: 0 });
  const rho = 400;
  const up = Math.sqrt(A * A - rho * rho);
  const frame = neckOf(onTop(head, normal(rho)));
  const { axis, origin } = expected(rho, LENGTH + up, [rho, up]);
  near(frame.axis, axis);
  near(frame.origin, origin, 1e-3);
});

test('on a 2:1 ellipsoidal head the neck is along the ellipse\'s gradient, not its radius', () => {
  const b = A / 2;
  const head = part('H', 'ellipsoidal_head', { inside_diameter: 2 * A, head_height: b, thickness: T, straight_flange_length: 0 });
  const rho = 400;
  const up = b * Math.sqrt(1 - (rho / A) ** 2);
  const frame = neckOf(onTop(head, normal(rho)));
  // ∇(r²/a² + z²/b²) = (2r/a², 2z/b²): steeper than the line from the centre.
  const { axis, origin } = expected(rho, LENGTH + up, [rho / A ** 2, up / b ** 2]);
  near(frame.axis, axis, 1e-5);
  near(frame.origin, origin, 1e-2);
});

test('on a torispherical head the neck is a radius of the crown on the crown, and of the knuckle on the knuckle', () => {
  const L = 2 * A;
  const r = 0.06 * 2 * A;
  const head = part('H', 'torispherical_head', { inside_diameter: 2 * A, crown_radius: L, knuckle_radius: r, thickness: T, straight_flange_length: 0 });
  // The knuckle's centre is a − r out and on the tangent line; the crown's is on the axis, L − r from it.
  const zc = LENGTH - Math.sqrt((L - r) ** 2 - (A - r) ** 2);
  const crownEdge = ((A - r) * L) / (L - r);

  const onCrown = 400;
  assert.ok(onCrown < crownEdge);
  const zCrown = zc + Math.sqrt(L * L - onCrown * onCrown);
  const crown = expected(onCrown, zCrown, [onCrown, zCrown - zc]);
  near(neckOf(onTop(head, normal(onCrown))).axis, crown.axis, 1e-5);

  // A small neck on the knuckle, 50 mm off the knuckle's centre: the normal leans 34° from horizontal.
  const onKnuckle = A - r + 50;
  assert.ok(onKnuckle > crownEdge);
  const small = { nozzle_inside_diameter: 25, nozzle_thickness: 6, nozzle_outward_projection: 80 };
  const zKnuckle = LENGTH + Math.sqrt(r * r - 50 * 50);
  const knuckle = expected(onKnuckle, zKnuckle, [50, zKnuckle - LENGTH]);
  const frame = neckOf(onTop(head, normal(onKnuckle), small));
  near(frame.axis, knuckle.axis, 1e-4);
  near(frame.origin, knuckle.origin, 1e-2);

  // Further down the knuckle the same neck would run past the tangent line onto the course: refused.
  const low = new AssemblyBuilder(kernel).build(onTop(head, normal(A - 2, 30), { ...small, nozzle_inside_diameter: 60 })).parts.find((p) => p.componentId === 'M')!;
  assert.equal(low.status, 'failed');
  assert.match(low.message ?? '', /lower end/);
});

test('on the bottom head, turned over, the neck points down and out; a reinforced neck stands on it as well', () => {
  const b = A / 2;
  const head = (id: string, position: number) => part(id, 'ellipsoidal_head', { inside_diameter: 2 * A, head_height: b, thickness: T, straight_flange_length: 0 }, position);
  const definition: AssemblyDefinition = {
    components: [
      head('H', 0),
      part('S', 'cylindrical_shell', { inside_diameter: 2 * A, thickness: T, course_length: LENGTH }, 1),
      head('H2', 2),
      part('M', 'radial_nozzle', { ...NECK, branch_connected_thickness: 5, branch_reinforcement_height: 60 }, 0, 'H'),
    ],
    placements: { M: normal(400) },
    reversed: [],
  };
  const frame = neckOf(definition);
  const up = b * Math.sqrt(1 - (400 / A) ** 2);
  const [nr, nz] = unit([400 / A ** 2, up / b ** 2]);
  // Turned over, the head points down; a placement's azimuth is the assembly's, so still 30°.
  near(frame.axis, [nr! * Math.cos(PHI), nr! * Math.sin(PHI), -nz!], 1e-5);
});

test('head_normal is refused on a course, and on anything that is not a radial nozzle', () => {
  const course: AssemblyDefinition = {
    components: [part('S', 'cylindrical_shell', { inside_diameter: 2 * A, thickness: T, course_length: LENGTH }, 0), part('M', 'radial_nozzle', NECK, 0, 'S')],
    placements: { M: normal(400) },
    reversed: [],
  };
  const onCourse = new AssemblyBuilder(kernel).build(course).parts.find((p) => p.componentId === 'M')!;
  assert.equal(onCourse.status, 'failed');
  assert.equal(onCourse.scope?.reason, 'mismatch');

  const head = part('H', 'ellipsoidal_head', { inside_diameter: 2 * A, head_height: A / 2, thickness: T, straight_flange_length: 0 });
  const boss = onTop(head, normal(400), { nozzle_inside_diameter: 80, nozzle_thickness: 10, nozzle_outward_projection: 150 });
  const hillside = { ...boss, components: boss.components.map((c) => (c.id === 'M' ? { ...c, kind: 'hillside_nozzle', dimensions: { ...c.dimensions, nozzle_offset: 100 } } : c)) };
  assert.notEqual(new AssemblyBuilder(kernel).build(hillside).parts.find((p) => p.componentId === 'M')!.status, 'drawn');
});
