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

// ---------------------------------------------------------------- a ring that carries its head's knuckle
// ENSA's arrangement, in invented numbers: a 0.9D / 0.17D torispherical head whose tangent line lies
// inside the ring, the ring carrying its straight flange and the first 40° of its knuckle to a seam
// drawn normal to the wall; the slot's inner side is the knuckle's outer surface, its root below
// the tangent line.
const HEAD = { inside_diameter: 2000, crown_radius: 1800, knuckle_radius: 340, thickness: 60 };
const MEAN_KNUCKLE = 340 + 30;
const PHI_S = (40 * Math.PI) / 180;
const CARRYING = {
  inside_diameter: 2000,
  thickness: 120,
  transition_ring_height: 800,
  head_leg_thickness: 60,
  skirt_leg_thickness: 50,
  crotch_radius: 15,
  crotch_height: 310,
  tangent_line_height: 450,
  head_seam_distance: MEAN_KNUCKLE * PHI_S,
};

function carried(ring: Record<string, number> = CARRYING, head: Record<string, number> = HEAD, skirt: Record<string, number> = {}): AssemblyDefinition {
  return {
    components: [
      part('H1', 'torispherical_head', head, 0),
      part('R', 'forged_transition_ring', ring, 1),
      part('S', 'cylindrical_shell', { inside_diameter: 2000, thickness: 120, course_length: 3000 }, 2),
      part('H2', 'torispherical_head', { ...HEAD, thickness: 120, straight_flange_length: 50 }, 3),
      part('K', 'skirt_support', { inside_diameter: 2140, thickness: 50, course_length: 2000, ...skirt }, 0, 'R'),
    ],
    placements: { K: { anchor: 'shell_side', axialOffset: 0, azimuth: 0 } },
    reversed: [],
  };
}

test('a ring carrying its head: the run resolves with the head drawn from the seam', () => {
  const { model, geometry } = build(carried());
  for (const p of model.parts) assert.equal(p.status, 'drawn', `${p.componentId}: ${p.message ?? ''}`);
  assert.equal(geometry.refusals.length, 0, JSON.stringify(geometry.refusals));
  const head = model.parts.find((p) => p.componentId === 'H1')!;
  const ring = model.parts.find((p) => p.componentId === 'R')!;
  // One frame for both: the head's tangent line at z = 0, the ring's bottom face 450 mm below it.
  close(head.transform.dz, 0);
  close(ring.transform.dz, 0);
  close(kernel.bounds(ring.solids[0]).min[2], -450, 1e-3);
  close(model.parts.find((p) => p.componentId === 'S')!.transform.dz, 350);
  assert.equal(head.meridianStart, MEAN_KNUCKLE * PHI_S);
});

test('the truncated head and the knuckle the ring carries add up to the whole head', () => {
  const full = build({ components: [part('H', 'torispherical_head', { ...HEAD, straight_flange_length: 0 }, 0)], placements: {}, reversed: [] });
  const { model } = build(carried());
  const truncated = kernel.volume(model.parts.find((p) => p.componentId === 'H1')!.solids[0]);
  // Pappus on the annular sector the ring carries: 0 to φs about the knuckle's centre.
  const [r1, r2, xc] = [340, 400, 1000 - 340];
  const area = ((r2 ** 2 - r1 ** 2) / 2) * PHI_S;
  const centroid = xc + ((2 / 3) * (r2 ** 3 - r1 ** 3)) / (r2 ** 2 - r1 ** 2) * (Math.sin(PHI_S) / PHI_S);
  const carriedVolume = 2 * Math.PI * centroid * area;
  const whole = kernel.volume(full.model.parts[0].solids[0]);
  close(truncated + carriedVolume, whole, 1e-6 * whole);
});

test('the seam is an inclined butt weld on the knuckle, its trace across the wall declared', () => {
  const { geometry } = build(carried());
  const joint = geometry.joints.find((j) => j.id === 'H1:lower~R:lower')!;
  assert.ok(joint, geometry.joints.map((j) => j.id).join(', '));
  assert.equal(joint.kind, 'butt_weld');
  assert.deepEqual(joint.issues, []);
  const seam = geometry.discontinuities.find((d) => d.id === 'H1:lower:seam')!;
  // Normal to the wall at φs: the inside point on the knuckle's inside, the outside on its outside.
  const at = (r: number): number[] => [660 + r * Math.cos(PHI_S), 0, -r * Math.sin(PHI_S)];
  for (const [actual, expected] of [
    [seam.trace!.inside, at(340)],
    [seam.trace!.outside, at(400)],
  ] as const) {
    for (let i = 0; i < 3; i++) close(actual[i], expected[i], 1e-6);
  }
});

test("the head's tangent line belongs to the ring, its crown-to-knuckle junction to the head", () => {
  const { geometry } = build(carried());
  const tangent = geometry.discontinuities.find((d) => d.kind === 'tangent_line' && d.componentIds.includes('R'))!;
  assert.ok(tangent, geometry.discontinuities.map((d) => d.id).join(', '));
  assert.equal(tangent.id, 'R:tangent-line');
  assert.deepEqual(tangent.trace!.inside.map((v) => Math.round(v * 1e6) / 1e6), [1000, 0, 0]);
  assert.deepEqual(tangent.trace!.outside.map((v) => Math.round(v * 1e6) / 1e6), [1060, 0, 0]);
  assert.ok(!geometry.discontinuities.some((d) => d.id === 'H1:tangent-line'));
  assert.ok(geometry.discontinuities.some((d) => d.id === 'H1:crown-knuckle'));
  assert.ok(geometry.discontinuities.some((d) => d.id === 'R:crotch'));
});

test('the slot closes against the knuckle: every circle named, the root on the knuckle above the seam', () => {
  const { geometry } = build(carried());
  const ring = geometry.parts.find((p) => p.componentId === 'R')!;
  const refs = new Set(ring.edges.map((e) => e.ref));
  for (const key of [
    'lower-inside', 'lower-outside', 'upper-inside', 'upper-outside', 'tangent-inside',
    'skirt-leg-inside', 'skirt-leg-outside', 'crotch-head-leg', 'crotch-skirt-leg', 'crotch-apex-inner', 'crotch-apex-outer',
  ]) {
    assert.ok(refs.has(`R/landmark/${key}`), `${key} is not an edge: ${[...refs].join(', ')}`);
  }
  const unnamed = ring.edges.filter((e) => e.curve === 'circle' && e.closed && !e.ref.startsWith('R/landmark/'));
  assert.deepEqual(unnamed.map((e) => e.ref), []);
  // The buried flange has no outside edge: the knuckle's outer surface runs from the seam to the root.
  assert.ok(!refs.has('R/landmark/tangent-outside'));
});

test('a crotch above the tangent line closes against the flange instead', () => {
  // Above the tangent line the slot is what the flange and the skirt leg leave of the upper leg:
  // 120 − 60 − 50 = 10 mm, so the root radius is at most 5.
  const { model, geometry } = build(carried({ ...CARRYING, crotch_height: 520, crotch_radius: 4 }));
  assert.equal(model.parts.find((p) => p.componentId === 'R')!.status, 'drawn');
  const refs = new Set(geometry.parts.find((p) => p.componentId === 'R')!.edges.map((e) => e.ref));
  assert.ok(refs.has('R/landmark/tangent-outside'));
  assert.equal(geometry.refusals.length, 0, JSON.stringify(geometry.refusals));
});

test('with no crotch height the root is a full round, tangent to the skirt leg and the knuckle', () => {
  const { crotch_height: _, ...unsaid } = CARRYING;
  const { model, geometry } = build(carried(unsaid));
  assert.equal(model.parts.find((p) => p.componentId === 'R')!.status, 'drawn');
  assert.equal(geometry.refusals.length, 0, JSON.stringify(geometry.refusals));
  // Skirt leg inner face 1070, the round's centre 15 inside it; knuckle centre at 660, outer 400.
  const z0 = -Math.sqrt((400 + 15) ** 2 - (1070 - 15 - 660) ** 2);
  const ring = geometry.parts.find((p) => p.componentId === 'R')!;
  const refs = new Set(ring.edges.map((e) => e.ref));
  assert.ok(refs.has('R/landmark/crotch-apex'), [...refs].join(', '));
  assert.ok(!refs.has('R/landmark/crotch-apex-inner'));
  const built = model.parts.find((p) => p.componentId === 'R')!;
  const apex = built.landmarks!.find((l) => l.key === 'crotch-apex')!;
  close(apex.z, z0 + 15, 1e-6);
  close(apex.diameter, 2 * 1055, 1e-6);
  // A slot wider than the round at the tangent line has no full round: 10 mm against 2 × 4.
  const wide = build(carried({ ...unsaid, crotch_radius: 4 })).model.parts.find((p) => p.componentId === 'R')!;
  assert.equal(wide.status, 'failed');
  assert.equal(wide.scope?.parameter, 'crotch_radius', wide.message);
});

test('a carrying ring states both of its two dimensions, on a torispherical head, and its seam on the knuckle', () => {
  const { tangent_line_height: _t, ...seamOnly } = CARRYING;
  const cases: [Record<string, number>, Record<string, number>, string, string][] = [
    [seamOnly, HEAD, 'R', 'tangent_line_height'],
    [{ ...CARRYING, head_joint_height: 50 }, HEAD, 'R', 'head_joint_height'],
    [{ ...CARRYING, head_seam_distance: MEAN_KNUCKLE * 1.2 }, HEAD, 'R', 'head_seam_distance'],
    [{ ...CARRYING, crotch_height: 120 }, HEAD, 'R', 'crotch_height'],
    [{ ...CARRYING, crotch_radius: 30 }, HEAD, 'R', 'crotch_radius'],
    [{ ...CARRYING, tangent_line_height: 900 }, HEAD, 'R', 'tangent_line_height'],
  ];
  for (const [ring, head, id, parameter] of cases) {
    const { model } = build(carried(ring, head));
    const built = model.parts.find((p) => p.componentId === id)!;
    assert.equal(built.status, 'failed', `${JSON.stringify(ring)} was drawn`);
    assert.equal(built.scope?.parameter, parameter, `${JSON.stringify(ring)}: ${built.message}`);
  }
  const ellipsoidal = build({
    ...carried(),
    components: [part('H1', 'ellipsoidal_head', { inside_diameter: 2000, thickness: 60, head_height: 500 }, 0), ...carried().components.slice(1)],
  });
  assert.equal(ellipsoidal.model.parts.find((p) => p.componentId === 'R')!.status, 'failed');
});

test('a head-leg wall other than the head\'s own is drawn, and the seam reports the step', () => {
  const { geometry } = build(carried({ ...CARRYING, head_leg_thickness: 70, crotch_radius: 10 }));
  const joint = geometry.joints.find((j) => j.id === 'H1:lower~R:lower')!;
  assert.ok(joint.issues.some((i) => i.startsWith('Thickness steps')), joint.issues.join('; '));
});

test("the skirt's base face is named, with and without a base plate", () => {
  const plain = build(carried());
  assert.ok(plain.geometry.parts.find((p) => p.componentId === 'K')!.faces.some((f) => f.role === 'Skirt base'));
  const plated = build(
    carried(CARRYING, HEAD, {
      skirt_base_type: 1, base_plate_width: 200, base_plate_projection: 120, base_plate_thickness: 25,
      anchor_bolt_count: 8, anchor_bolt_diameter: 30, anchor_bolt_offset: 60,
    })
  );
  const faces = plated.geometry.parts.find((p) => p.componentId === 'K')!.faces.filter((f) => f.role === 'Skirt base');
  assert.equal(faces.length, 1);
});
