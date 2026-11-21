// §4.3.12's knuckle and flare carry their own thickness, t_k and t_f, formed from plate other than
// the cone's. Eq. (4.3.63) wants t_k at least the cylinder's, so a knuckle is routinely thicker
// than the cone it turns into; the kernel drew both arcs at the cone's wall and said nothing.
// Drawn on the cone's bore, an arc that differs from the cone meets it in a step at its tangent
// line, faired 3:1 by weld metal on the thinner side (user decision 2026-11-20).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { applyConstructionDetails } from '../src/details/apply.ts';
import { kernel, part, shellSide } from './fixtures.ts';

const close = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ± ${tolerance}`);

const A = Math.PI / 6;
// Demo E: 2000 × 22 below, a 20 mm cone at 30° with a 200 mm knuckle and a 100 mm flare, 1200 × 16 above.
const cone = (dimensions: Record<string, number> = {}) =>
  part('C', 'conical_shell', {
    inside_diameter: 2000, small_end_diameter: 1200, half_apex_angle: 30, thickness: 20,
    knuckle_radius: 200, flare_radius: 100, ...dimensions,
  }, 1);
const reducer = (dimensions: Record<string, number> = {}): AssemblyDefinition => ({
  components: [
    part('S1', 'cylindrical_shell', { inside_diameter: 2000, thickness: 22, course_length: 1000 }, 0),
    cone(dimensions),
    part('S2', 'cylindrical_shell', { inside_diameter: 1200, thickness: 16, course_length: 1000 }, 2),
  ],
  placements: {},
  reversed: [],
});
const alone = (dimensions: Record<string, number>) =>
  new AssemblyBuilder(kernel).build({ components: [cone(dimensions)], placements: {}, reversed: [] }).parts[0];

test("a knuckle as thick as the shell meets it whole: nothing tapered, nothing refused", () => {
  const definition = reducer({ knuckle_thickness: 22 });
  const model = new AssemblyBuilder(kernel).build(definition);
  const resolved = resolveGeometry(definition, model, kernel, { mode: 'analysis' });
  assert.deepEqual(resolved.refusals, []);
  assert.deepEqual(resolved.joints.flatMap((j) => j.findings), []);
  assert.equal(resolved.ready, true);
  const port = (id: string) => resolved.parts.flatMap((p) => p.ports).find((p) => p.id === id)!;
  close(port('lower@C').outsideRadius! - port('lower@C').insideRadius!, 22, 1e-9);
  close(port('upper@S1').outsideRadius! - port('upper@S1').insideRadius!, 22, 1e-9);
  // Before, the knuckle was drawn at 20 and the shell cut 3:1 down to it.
  const S1 = model.parts.find((p) => p.componentId === 'S1')!;
  assert.ok(!(S1.landmarks ?? []).some((l) => /taper|buildup/.test(l.key)), JSON.stringify(S1.landmarks));
});

test('the thicker knuckle adds its own 2 mm of torus and a 3:1 build-up on the cone, nothing else', () => {
  const thick = alone({ knuckle_thickness: 22 });
  const thin = alone({});
  assert.ok(kernel.isValid(thick.solids[0]));
  // Knuckle centre at r = 1000 − 200 = 800; its outside turns from 220 to 222 over 30°.
  const [K, R1, R2] = [200, 220, 222];
  const sector = (A / 2) * (R2 ** 2 - R1 ** 2);
  const reach = ((2 / 3) * (R2 ** 3 - R1 ** 3) / (R2 ** 2 - R1 ** 2)) * Math.sin(A / 2) / (A / 2);
  const torus = 2 * Math.PI * (1000 - K + reach * Math.cos(A / 2)) * sector;
  // The ring: 2 mm square to the cone at its tangent line, 6 mm up its meridian.
  const at = (radius: number): [number, number] => [800 + radius * Math.cos(A), radius * Math.sin(A)];
  const [p1, p2] = [at(R1), at(R2)];
  const toe: [number, number] = [p1[0] - 6 * Math.sin(A), p1[1] + 6 * Math.cos(A)];
  const ring = 2 * Math.PI * ((p1[0] + p2[0] + toe[0]) / 3) * ((2 * 6) / 2);
  close(kernel.volume(thick.solids[0]) - kernel.volume(thin.solids[0]), torus + ring, 1e-3 * (torus + ring));
  // Its toe is named, where a mesh can find it.
  const landmark = thick.landmarks!.find((l) => l.key === 'knuckle-cone-buildup')!;
  close(landmark.z, toe[1], 1e-9);
  assert.match(landmark.role, /^3:1 weld metal build-up on the cone/);
});

test('a knuckle thinner than the cone is built up round its own arc, and the cone keeps its wall', () => {
  const part = alone({ knuckle_thickness: 18 });
  assert.ok(kernel.isValid(part.solids[0]));
  assert.equal(part.junctions!.lower!.wall.thickness, 18);
  const landmark = part.landmarks!.find((l) => l.key === 'knuckle-cone-buildup')!;
  assert.match(landmark.role, /on the knuckle to the 20 mm cone/);
  // 6 mm round the knuckle's 218 mm outside, back from its tangent line at 30°.
  close(landmark.z, 218 * Math.sin(A - 6 / 218), 1e-9);
});

test('a flare thicker than the cone is faired onto the cone below its tangent line', () => {
  const part = alone({ flare_thickness: 24 });
  assert.ok(kernel.isValid(part.solids[0]));
  assert.equal(part.junctions!.upper!.wall.thickness, 24);
  close(part.junctions!.upper!.outsideDiameter - part.junctions!.upper!.insideDiameter, 48, 1e-9);
  assert.match(part.landmarks!.find((l) => l.key === 'flare-cone-buildup')!.role, /on the cone to the 24 mm flare/);
});

test('unstated, the knuckle and the flare are the cone\'s own wall, drawn as before', () => {
  const plain = alone({});
  const stated = alone({ knuckle_thickness: 20, flare_thickness: 20 });
  close(kernel.volume(stated.solids[0]), kernel.volume(plain.solids[0]), 1e-9 * kernel.volume(plain.solids[0]));
  assert.ok(!plain.landmarks!.some((l) => l.key.endsWith('buildup')));
});

test('a build-up longer than the straight cone is refused, by how much', () => {
  // The straight cone between the arcs is 800 − 300·tan 15° = 719.6 mm; 3·(260 − 20) is 720.
  const resolved = resolveGeometry(reducer({ knuckle_thickness: 260 }), new AssemblyBuilder(kernel).build(reducer({ knuckle_thickness: 260 })), kernel, { mode: 'analysis' });
  const refusal = resolved.refusals.find((r) => r.parameter === 'build-up along the cone');
  assert.ok(refusal, JSON.stringify(resolved.refusals));
  assert.equal(refusal.reason, 'out_of_scope');
});

test('a pad on a cone with a thicker knuckle is cut from the whole part thickened, arcs and all', () => {
  // Demo E's N2: the pad is the host rebuilt 20 mm thicker. Rebuilt with only the cone's wall
  // thickened, the 20 mm flare met a 40 mm cone and was refused as too short to fair.
  const definition: AssemblyDefinition = {
    ...reducer({ knuckle_thickness: 22, flare_thickness: 20 }),
    components: [
      ...reducer({ knuckle_thickness: 22, flare_thickness: 20 }).components,
      part('N', 'axial_nozzle', {
        nozzle_inside_diameter: 200, nozzle_thickness: 16, nozzle_outward_projection: 250, pad_width: 100, pad_thickness: 20,
      }, 0, 'C'),
    ],
    placements: { N: shellSide(411.6, 90) },
  };
  const model = new AssemblyBuilder(kernel).build(definition);
  const resolved = resolveGeometry(definition, model, kernel, { mode: 'analysis' });
  assert.deepEqual(resolved.refusals.filter((r) => r.componentId === 'N' || r.componentId === 'C'), []);
  assert.ok(kernel.isValid(model.parts.find((p) => p.componentId === 'N')!.solids[1]));
});

test('corroded, the knuckle and the flare lose the allowance with the cone', () => {
  const definition: AssemblyDefinition = {
    ...reducer({ knuckle_thickness: 22, flare_thickness: 20 }),
    details: { equipment: { corroded_model: 'corroded', corrosion_allowance: 3, corroded_surfaces: 'inside' } },
  };
  const { definition: effective } = applyConstructionDetails(definition);
  const c = effective.components.find((x) => x.id === 'C')!.dimensions;
  assert.equal(c.thickness, 17);
  assert.equal(c.knuckle_thickness, 19);
  assert.equal(c.flare_thickness, 17);
});
