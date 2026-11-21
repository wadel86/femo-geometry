// A pad round a neck that leans on its host: its width is the rules', measured along the surface.
// §4.5.9.2's nozzle parallel to the axis in a 30° cone leaves the neck 60° off the surface's
// normal; a circle of the pad's reach square to the neck traced a pad twice as wide as stated
// along the meridian, and the 100 mm pad of demo E then ran past both ends of its cone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { kernel, part, shellSide } from './fixtures.ts';

const close = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ± ${tolerance}`);

// Demo E's reducer, sharp, and N2: DN200 × 16 parallel to the axis with a pad of `width` × 20.
const reducer = (offset: number, width: number): AssemblyDefinition => ({
  components: [
    part('C', 'conical_shell', { inside_diameter: 2000, small_end_diameter: 1200, half_apex_angle: 30, thickness: 20 }, 0),
    part('N', 'axial_nozzle', {
      nozzle_inside_diameter: 200, nozzle_thickness: 16, nozzle_outward_projection: 250, pad_width: width, pad_thickness: 20,
    }, 0, 'C'),
  ],
  placements: { N: shellSide(offset, 90) },
  reversed: [],
});

test('a pad on a neck 60° off the surface is as wide along the surface as it is stated', () => {
  const definition = reducer(350, 100);
  const model = new AssemblyBuilder(kernel).build(definition);
  const resolved = resolveGeometry(definition, model, kernel, { mode: 'analysis' });
  // Nothing refused: it fits on the cone, and nothing is drawn other than stated.
  assert.deepEqual(resolved.refusals, []);
  assert.equal(resolved.ready, true);

  const pad = model.parts.find((p) => p.componentId === 'N')!.solids[1];
  assert.ok(kernel.isValid(pad));
  // On the surface the opening traces 116 / cos 60° = 232 along the meridian by 116 across; the
  // pad's edge 100 further each way, 332 by 216. Twenty millimetres thick on a cone of R ≈ 800 it
  // is the flat ring to 0.02 %. The old circle made it 432 by 216, 4.17e6 mm³ — 48 % more.
  const ring = Math.PI * (332 * 216 - 232 * 116) * 20;
  close(kernel.volume(pad), ring, 0.01 * ring);
  // Across the meridian the neck is normal to the surface: 116 + 100 either side of it.
  close(kernel.bounds(pad).max[0], 216, 1e-3);
  close(kernel.bounds(pad).min[0], -216, 1e-3);
});

test("the pad's reach along the cone is the opening's plus its width along the meridian", () => {
  // The opening reaches 232·cos 30° = 200.9 mm along the axis; the pad 100·cos 30° = 86.6 more,
  // 287.5 in all, where the old circle claimed 374. Centred 290 from the large end, its lower
  // edge is 2.5 mm onto the cone; centred 280, 7.5 mm past it.
  for (const [offset, fits] of [[290, true], [280, false]] as const) {
    const definition = reducer(offset, 100);
    const resolved = resolveGeometry(definition, new AssemblyBuilder(kernel).build(definition), kernel, { mode: 'analysis' });
    const refusal = resolved.refusals.find((r) => r.parameter.startsWith('pad edge'));
    assert.equal(refusal === undefined, fits, JSON.stringify(refusal));
  }
});

test('a pad round a neck normal to its host is still the circle of its reach', () => {
  // A radial nozzle in the same cone: no lean, the pad's trace is the 116 + 100 circle.
  const definition: AssemblyDefinition = {
    ...reducer(350, 100),
    components: [
      reducer(350, 100).components[0],
      part('N', 'radial_nozzle', {
        nozzle_inside_diameter: 200, nozzle_thickness: 16, nozzle_outward_projection: 250, pad_width: 100, pad_thickness: 20,
      }, 0, 'C'),
    ],
  };
  const model = new AssemblyBuilder(kernel).build(definition);
  const pad = model.parts.find((p) => p.componentId === 'N')!.solids[1];
  // The flat annulus to under 1 %: the curved cone adds the rest.
  const ring = Math.PI * (216 ** 2 - 116 ** 2) * 20;
  close(kernel.volume(pad), ring, 0.02 * ring);
});
