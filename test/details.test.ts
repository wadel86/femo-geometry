import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry, stepOf } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { applyConstructionDetails, withDetailNotes } from '../src/details/apply.ts';
import { DETAILS, Detail, resolveDetail } from '../src/details/constructionDetails.ts';
import { runSection, sectionAt } from '../src/ports/section.ts';
import { kernel, part, referenceVessel, shellSide } from './fixtures.ts';

const close = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ± ${tolerance}`);

const IN = 25.4;

/** PTB-3 E5.2.1's vessel, nominal: an 84 in shell 0.9375 in thick, a 2:1 head 1.0625 in thick. */
const ptb3 = (details?: AssemblyDefinition['details']): AssemblyDefinition => ({
  components: [
    part('S', 'cylindrical_shell', { inside_diameter: 84 * IN, thickness: 0.9375 * IN, course_length: 1100 }, 0),
    part('H', 'ellipsoidal_head', { inside_diameter: 84 * IN, head_height: 21 * IN, thickness: 1.0625 * IN }, 1),
  ],
  placements: {},
  reversed: [],
  ...(details ? { details } : {}),
});

/** Demo A's N1 on S1. */
const n1 = (details?: AssemblyDefinition['details']): AssemblyDefinition => ({
  components: [
    part('S', 'cylindrical_shell', { inside_diameter: 1500, thickness: 16, course_length: 1600 }, 0),
    part('N', 'radial_nozzle', { nozzle_inside_diameter: 200, nozzle_thickness: 12, nozzle_outward_projection: 250 }, 0, 'S'),
  ],
  placements: { N: shellSide(800, 0) },
  reversed: [],
  ...(details ? { details } : {}),
});

const build = (definition: AssemblyDefinition) => {
  const { definition: effective, details } = applyConstructionDetails(definition);
  const model = withDetailNotes(new AssemblyBuilder(kernel).build(effective), details);
  return { effective, details, model };
};

test('a definition that declares no detail is built exactly as before', () => {
  const definition = referenceVessel();
  const { definition: effective } = applyConstructionDetails(definition);
  assert.deepEqual(effective.components, definition.components);
  assert.equal(effective.joints, undefined);
});

test('each layer overrides the one before: profile, project, equipment, joint', () => {
  const layers = {
    profile: { name: 'EPC standard', details: { taper_ratio: 4, straight_flange_length: 50 } },
    project: { taper_ratio: 5 },
    equipment: {},
    joints: { 'S~H': { taper_ratio: 6 } },
  };
  assert.deepEqual(resolveDetail(layers, Detail.TAPER_RATIO), { value: 5, source: 'project' });
  assert.deepEqual(resolveDetail(layers, Detail.TAPER_RATIO, ['S~H']), { value: 6, source: 'joint', joint: 'S~H' });
  assert.deepEqual(resolveDetail(layers, Detail.STRAIGHT_FLANGE_LENGTH), { value: 50, source: 'profile' });
  // Corrosion is the equipment's, never a joint's: a joint layer cannot reach it.
  assert.equal(resolveDetail({ joints: { 'S~H': { corroded_model: 'corroded' } } }, Detail.CORRODED_MODEL, ['S~H']).value, 'nominal');
  // A bad declaration is said, and the less specific one used.
  const bad = resolveDetail({ profile: { name: 'p', details: { taper_ratio: 4 } }, equipment: { taper_ratio: 2 } }, Detail.TAPER_RATIO);
  assert.equal(bad.value, 4);
  assert.equal(bad.rejected?.source, 'equipment');
});

test('the profile taper ratio reaches every thickness change, and a stated joint still wins', () => {
  const profile = { profile: { name: 'EPC', details: { taper_ratio: 4, straight_flange_length: 76.2 } } };
  const { effective } = build(ptb3(profile));
  assert.deepEqual(effective.joints?.['S~H'], { taperRatio: 4 });
  const stated = build({ ...ptb3(profile), joints: { 'S~H': { taperRatio: 5 } } });
  assert.equal(stated.effective.joints?.['S~H']?.taperRatio, 5);
});

test('a head that states no straight flange takes the profile\'s, and says where it came from', () => {
  const { effective, details, model } = build(ptb3({ profile: { name: 'EPC', details: { straight_flange_length: 76.2 } } }));
  assert.equal(effective.components.find((c) => c.id === 'H')!.dimensions.straight_flange_length, 76.2);
  assert.ok(details.applied.some((a) => a.key === Detail.STRAIGHT_FLANGE_LENGTH && a.at === 'H' && a.source === 'profile'));
  const resolved = resolveGeometry(effective, model, kernel, { mode: 'analysis', details });
  // Declared, the flange is no assumption: nothing about it is refused.
  assert.ok(!resolved.refusals.some((r) => r.parameter === 'straight_flange_length'), JSON.stringify(resolved.refusals));
});

test('the corroded model comes off the inside, and a 2:1 head\'s rule is the one declared', () => {
  const corroded = (rule: string) =>
    build(ptb3({ equipment: { corroded_model: 'corroded', corrosion_allowance: 0.125 * IN, corroded_surfaces: 'inside', corroded_head_rule: rule } }));
  const trueShape = corroded('true_shape').effective.components;
  const uniform = corroded('uniform_offset').effective.components;
  const H = (cs: typeof trueShape) => cs.find((c) => c.id === 'H')!.dimensions;
  const S = (cs: typeof trueShape) => cs.find((c) => c.id === 'S')!.dimensions;
  close(S(trueShape).inside_diameter, 84.25 * IN, 1e-9);
  close(S(trueShape).thickness, 0.8125 * IN, 1e-9);
  close(H(trueShape).thickness, 0.9375 * IN, 1e-9);
  // PTB-3's two readings of "corroded": a true ellipse on the corroded bore, or the nominal grown.
  close(H(trueShape).head_height, 21.0625 * IN, 1e-9);
  close(H(uniform).head_height, 21.125 * IN, 1e-9);
});

test('a corroded model with no allowance declared is refused under analysis', () => {
  const { effective, details, model } = build(ptb3({ equipment: { corroded_model: 'corroded' } }));
  const resolved = resolveGeometry(effective, model, kernel, { mode: 'analysis', details });
  assert.ok(resolved.refusals.some((r) => r.parameter === Detail.CORROSION_ALLOWANCE && r.reason === 'assumed'));
});

test('an outside-flush datum moves the thinner wall out, and the thicker one is tapered inside', () => {
  // Shell 14 mm, head 16 mm, both stated at 1200: outside flush puts the shell's bore at 1204.
  const definition = (datum: string): AssemblyDefinition => ({
    components: [
      part('H', 'ellipsoidal_head', { inside_diameter: 1200, head_height: 300, thickness: 16, straight_flange_length: 50 }, 0),
      part('S', 'cylindrical_shell', { inside_diameter: 1200, thickness: 14, course_length: 1000 }, 1),
    ],
    placements: {},
    reversed: [],
    details: { joints: { 'H~S': { alignment_datum: datum } } },
  });
  const outside = build(definition('outside_flush'));
  close(outside.effective.components.find((c) => c.id === 'S')!.dimensions.inside_diameter, 1204, 1e-9);
  const H = outside.model.parts.find((p) => p.componentId === 'H')!;
  assert.ok(kernel.isValid(H.solids[0]));
  // Flush outside: the head keeps its 1232 outside; its inside steps from 1200 to the shell's 1204.
  const resolved = resolveGeometry(outside.effective, outside.model, kernel, { mode: 'analysis', details: outside.details });
  assert.deepEqual(resolved.refusals, []);
  assert.ok(H.landmarks.some((l) => l.key.endsWith('taper-inside')));
  assert.ok(!H.landmarks.some((l) => l.key.endsWith('-taper')));

  const mid = build(definition('mid_wall'));
  close(mid.effective.components.find((c) => c.id === 'S')!.dimensions.inside_diameter, 1202, 1e-9);
  const Hm = mid.model.parts.find((p) => p.componentId === 'H')!;
  assert.ok(Hm.landmarks.some((l) => l.key.endsWith('taper-inside')) && Hm.landmarks.some((l) => l.key.endsWith('-taper')));
  // Mid-wall at 3:1: 1 mm each side over 3 mm. Inside flush is the joint as it always was.
  const inside = build(definition('inside_flush'));
  close(inside.effective.components.find((c) => c.id === 'S')!.dimensions.inside_diameter, 1200, 1e-9);
});

test('a datum the stated bores contradict is a mismatch, refused under analysis', () => {
  const definition: AssemblyDefinition = {
    components: [
      part('S1', 'cylindrical_shell', { inside_diameter: 1200, thickness: 16, course_length: 1000 }, 0),
      part('S2', 'cylindrical_shell', { inside_diameter: 1210, thickness: 14, course_length: 1000 }, 1),
    ],
    placements: {},
    reversed: [],
    details: { equipment: { alignment_datum: 'outside_flush' } },
  };
  const { effective, details, model } = build(definition);
  const resolved = resolveGeometry(effective, model, kernel, { mode: 'analysis', details });
  assert.ok(resolved.refusals.some((r) => r.reason === 'mismatch' && r.parameter === Detail.ALIGNMENT_DATUM), JSON.stringify(resolved.refusals));
});

test('a nozzle\'s corners are rounded: metal added at the crotch, taken from the bore', () => {
  const sharp = build(n1());
  const rounded = build(n1({ equipment: { nozzle_outside_corner_radius: 38.1, nozzle_inside_corner_radius: 19.05 } }));
  const part = (b: typeof sharp, id: string) => b.model.parts.find((p) => p.componentId === id)!;
  const metal = (b: typeof sharp) =>
    [...part(b, 'N').solids, ...part(b, 'S').solids].reduce((sum, s) => sum + kernel.volume(s), 0);
  assert.equal(part(sharp, 'N').solids.length, 1);
  assert.equal(part(sharp, 'S').solids.length, 1);
  // Split ACROSS the fillets: the neck keeps one solid, the host gets the rounded annulus back as a
  // second, so no boundary between two solids runs along a fillet to a knife edge.
  assert.equal(part(rounded, 'N').solids.length, 1, JSON.stringify(part(rounded, 'N').notes));
  assert.equal(part(rounded, 'S').solids.length, 2);
  for (const s of [...part(rounded, 'N').solids, ...part(rounded, 'S').solids]) assert.ok(kernel.isValid(s));
  // The metal changes by what the crotch adds less what the bore's edge loses: positive, and less than
  // the crotch's planar estimate (1 − π/4)·R²·2π·(r + x̄), the cylinder's curvature taking some away.
  const R = 38.1;
  const planar = (1 - Math.PI / 4) * R * R * 2 * Math.PI * (112 + (R * (10 - 3 * Math.PI)) / (3 * (4 - Math.PI)));
  const delta = metal(rounded) - metal(sharp);
  assert.ok(delta > 0 && delta < planar, `${delta} against ${planar}`);
  const resolved = resolveGeometry(rounded.effective, rounded.model, kernel, { mode: 'analysis', details: rounded.details });
  assert.deepEqual(resolved.refusals, []);
  assert.ok(stepOf(rounded.effective, rounded.model, kernel, 'analysis').length > 0);
});

test('layer 1 is a circular section per station, centred on the axis, and says who assumes it', () => {
  const { effective, model } = build(ptb3({ profile: { name: 'EPC', details: { straight_flange_length: 76.2 } } }));
  const section = runSection(effective, model);
  assert.equal(section.representation, 'circular_section');
  assert.equal(section.axisymmetric, true);
  assert.ok(section.stations.every((s, i, all) => i === 0 || s.s >= all[i - 1].s));
  assert.ok(section.stations.every((s) => s.centre[0] === 0 && s.centre[1] === 0));
  close(sectionAt(section, 10)!.radius, 42 * IN + 0.46875 * IN, 1e-6);
  assert.deepEqual(section.assumptions.map((a) => a.rule), ['layer 1', 'layer 1: s', 'the run, stacked', 'zones: √(R·t)']);
  // The representation itself no longer assumes the axis; what reads it from below still does.
  assert.equal(section.assumptions.find((a) => a.rule === 'layer 1')!.assumesAxisymmetry, false);
  const resolved = resolveGeometry(effective, model, kernel, {});
  assert.equal(resolved.influenceAssumption.assumesAxisymmetry, true);
  assert.equal(resolved.section.stations.length, section.stations.length);
});

test('every detail declares its effect', () => {
  for (const spec of DETAILS) {
    assert.ok(['not_measured', 'moves', 'below_resolution'].includes(spec.effect.status), spec.key);
    assert.ok(spec.effect.summary.length > 0, spec.key);
    if (spec.effect.status !== 'not_measured') assert.ok(spec.effect.measurements.length > 0, spec.key);
  }
});
