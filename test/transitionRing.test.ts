// A skirt on a forged transition ring: the Y-shaped forging between the bottom course and the
// lower head, whose outer leg is the skirt's top. Invented dimensions, not any real vessel's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { kernel, part } from './fixtures.ts';

const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ± ${tolerance}`);

/** Ø2000 bore; a 120 mm upper leg splitting into a 50 mm head leg and a 40 mm skirt leg. */
const RING = {
  inside_diameter: 2000,
  thickness: 120,
  transition_ring_height: 600,
  head_leg_thickness: 50,
  skirt_leg_thickness: 40,
  crotch_radius: 12,
  crotch_height: 350,
  head_joint_height: 100,
};

function vessel(ring: Record<string, number> = RING, skirt: Record<string, number> = {}): AssemblyDefinition {
  return {
    components: [
      part('H1', 'ellipsoidal_head', { inside_diameter: 2000, thickness: 50, head_height: 500, straight_flange_length: 40 }, 0),
      part('R', 'forged_transition_ring', ring, 1),
      part('S', 'cylindrical_shell', { inside_diameter: 2000, thickness: 120, course_length: 3000 }, 2),
      part('H2', 'ellipsoidal_head', { inside_diameter: 2000, thickness: 120, head_height: 500, straight_flange_length: 40 }, 3),
      part('K', 'skirt_support', { inside_diameter: 2160, thickness: 40, course_length: 2000, ...skirt }, 0, 'R'),
    ],
    // The skirt stands where the leg ends; only its azimuth, which its openings would read, is used.
    placements: { K: { anchor: 'shell_side', axialOffset: 0, azimuth: 0 } },
    reversed: [],
  };
}

const build = (definition: AssemblyDefinition) => {
  const model = new AssemblyBuilder(kernel).build(definition);
  return { model, geometry: resolveGeometry(definition, model, kernel, { mode: 'analysis' }) };
};

test('the ring stacks between the head and the course, its bottom face below the head joint', () => {
  const { model, geometry } = build(vessel());
  for (const p of model.parts) assert.equal(p.status, 'drawn', `${p.componentId}: ${p.message ?? ''}`);
  const ring = model.parts.find((p) => p.componentId === 'R')!;
  const shell = model.parts.find((p) => p.componentId === 'S')!;
  close(ring.transform.dz, 0);
  // The course sits on the ring's top: 600 mm of ring, 100 of it below the head joint.
  close(shell.transform.dz, 500);
  const bounds = kernel.bounds(ring.solids[0]);
  close(bounds.min[2], -100, 1e-3);
  close(bounds.max[2], 500, 1e-3);
  close(bounds.max[0], 1120, 1e-3);
  // Pappus on the section: a 120 × 600 rectangle, less the slot — 30 wide, 350 deep from the
  // bottom face — and less the 50 × 100 the inner leg does not reach below the head joint, plus
  // the two spandrels the crotch radius leaves in the slot's top corners.
  const rc = 12;
  const spandrel = (1 - Math.PI / 4) * rc * rc;
  const inset = (rc * (10 - 3 * Math.PI)) / (3 * (4 - Math.PI));
  const moment =
    120 * 600 * 1060 - 30 * 350 * 1065 - 50 * 100 * 1025 + spandrel * (1050 + inset) + spandrel * (1080 - inset);
  close(kernel.volume(ring.solids[0]), 2 * Math.PI * moment, 1e-6 * 2 * Math.PI * moment);
  assert.equal(geometry.refusals.length, 0, JSON.stringify(geometry.refusals));
});

test('three butt welds meet at the ring: the course, the head and the skirt', () => {
  const { geometry } = build(vessel());
  const ids = geometry.joints.map((j) => j.id);
  const course = geometry.joints.find((j) => j.id === 'R:upper~S:lower')!;
  const head = geometry.joints.find((j) => j.id === 'H1:lower~R:lower' || j.id === 'H1:upper~R:lower');
  const skirt = geometry.joints.find((j) => j.id === 'R:seat:K~K:upper')!;
  assert.ok(course, ids.join(', '));
  assert.ok(head, ids.join(', '));
  assert.ok(skirt, ids.join(', '));
  for (const j of [course, head!, skirt]) {
    assert.equal(j.kind, 'butt_weld');
    assert.deepEqual(j.issues, [], `${j.id}: ${j.issues.join('; ')}`);
  }
  const ports = geometry.parts.flatMap((p) => p.ports);
  const seat = ports.find((p) => p.id === skirt.ports[0])!;
  close(seat.location[2], -100);
  close(seat.insideRadius!, 1080);
  close(seat.outsideRadius!, 1120);
  assert.deepEqual(seat.axis, [0, 0, -1]);
  const top = ports.find((p) => p.id === skirt.ports[1])!;
  assert.deepEqual(top.axis, [0, 0, 1]);
});

test('the crotch and the legs are named for the mesher', () => {
  const { geometry } = build(vessel());
  const ring = geometry.parts.find((p) => p.componentId === 'R')!;
  const refs = new Set(ring.edges.map((e) => e.ref));
  for (const key of [
    'lower-inside',
    'lower-outside',
    'upper-inside',
    'upper-outside',
    'skirt-leg-inside',
    'skirt-leg-outside',
    'crotch-head-leg',
    'crotch-skirt-leg',
    'crotch-apex-inner',
    'crotch-apex-outer',
  ]) {
    assert.ok(refs.has(`R/landmark/${key}`), `${key} is not an edge: ${[...refs].join(', ')}`);
  }
  // Every circle of the ring's section is named: none is left to its index.
  const unnamed = ring.edges.filter((e) => e.curve === 'circle' && e.closed && !e.ref.startsWith('R/landmark/'));
  assert.deepEqual(unnamed.map((e) => e.ref), []);
  // The slot's faces and the crotch are called what they are, not a knuckle and the vessel's skin.
  const roles = ring.faces.map((f) => f.role);
  assert.equal(roles.filter((r) => r === 'Crotch').length, 2);
  assert.ok(roles.includes('Slot, head leg side'), roles.join(', '));
  assert.ok(roles.includes('Slot, skirt leg side'), roles.join(', '));
  assert.ok(!roles.includes('Knuckle'));
});

test('the crotch is a junction, and the skirt seam is reached through it', () => {
  const { geometry } = build(vessel());
  const crotch = geometry.discontinuities.find((d) => d.id === 'R:crotch')!;
  assert.ok(crotch, geometry.discontinuities.map((d) => d.id).join(', '));
  assert.equal(crotch.kind, 'junction');
  assert.deepEqual(crotch.causes, ['thickness', 'branch']);
  close(crotch.location[2], 250);
  close(crotch.sqrtRt.below, Math.sqrt(1025 * 50));
  close(crotch.sqrtRt.above, Math.sqrt(1060 * 120));

  const seam = geometry.discontinuities.find((d) => d.id === 'R:seat:K:seam')!;
  assert.equal(seam.kind, 'weld_seam');
  assert.deepEqual(seam.meridional, crotch.meridional);
  assert.equal(seam.branch?.length, 350);
  // No patch of wall for the skirt: it is not fillet-welded to the ring's side.
  assert.ok(!geometry.discontinuities.some((d) => d.id === 'R:wall:K'));

  // The head's tangent line is 40 mm of straight flange and 250 mm of head leg from the crotch.
  const tangent = geometry.proximities.find((p) => p.between.includes('H1:tangent-line') && p.between.includes('R:crotch'))!;
  close(tangent.distance, 290);
});

test('a slot exactly as wide as the crotch is round meets at one apex', () => {
  const { model, geometry } = build(vessel({ ...RING, crotch_radius: 15 }));
  assert.equal(model.parts.find((p) => p.componentId === 'R')!.status, 'drawn');
  const refs = new Set(geometry.parts.find((p) => p.componentId === 'R')!.edges.map((e) => e.ref));
  assert.ok(refs.has('R/landmark/crotch-apex'));
  assert.ok(!refs.has('R/landmark/crotch-apex-inner'));
});

test('both legs may end on the bottom face', () => {
  const { head_joint_height: _, ...flush } = RING;
  const { model, geometry } = build(vessel(flush));
  const ring = model.parts.find((p) => p.componentId === 'R')!;
  assert.equal(ring.status, 'drawn', ring.message);
  close(kernel.bounds(ring.solids[0]).min[2], 0, 1e-3);
  assert.equal(geometry.refusals.length, 0, JSON.stringify(geometry.refusals));
});

test('an unstated crotch height is drawn at mid-height and refused under analysis', () => {
  const { crotch_height: _, ...unsaid } = RING;
  const { model, geometry } = build(vessel(unsaid));
  assert.equal(model.parts.find((p) => p.componentId === 'R')!.status, 'drawn');
  const refusal = geometry.refusals.find((r) => r.componentId === 'R');
  assert.ok(refusal, 'no refusal for the ring');
  assert.equal(refusal!.parameter, 'crotch_height');
});

test('a ring whose dimensions do not describe a Y is refused, naming what is wrong', () => {
  const cases: [Record<string, number>, string][] = [
    [{ ...RING, head_leg_thickness: 70, skirt_leg_thickness: 50 }, 'slot width'],
    [{ ...RING, crotch_radius: 16 }, 'crotch_radius'],
    [{ ...RING, crotch_height: 100 }, 'crotch_height'],
    [{ ...RING, crotch_height: 600 }, 'crotch_height'],
    [{ ...RING, crotch_height: 110 }, 'crotch_radius'],
    [{ ...RING, head_joint_height: -5 }, 'head_joint_height'],
  ];
  for (const [ring, parameter] of cases) {
    const { model } = build(vessel(ring));
    const built = model.parts.find((p) => p.componentId === 'R')!;
    assert.equal(built.status, 'failed', `${JSON.stringify(ring)} was drawn`);
    assert.equal(built.scope?.parameter, parameter, `${JSON.stringify(ring)}: ${built.message}`);
  }
});

test('a skirt not flush with the leg is refused; a thinner one is drawn and the joint says so', () => {
  const wide = build(vessel(RING, { inside_diameter: 2200 }));
  assert.equal(wide.model.parts.find((p) => p.componentId === 'K')!.status, 'failed');

  const thin = build(vessel(RING, { inside_diameter: 2180, thickness: 30 }));
  assert.equal(thin.model.parts.find((p) => p.componentId === 'K')!.status, 'drawn');
  const joint = thin.geometry.joints.find((j) => j.id === 'R:seat:K~K:upper')!;
  assert.ok(joint.issues.some((i) => i.startsWith('Thickness steps from 40 mm to 30 mm')), joint.issues.join('; '));
});
