// Single-segmental baffles and a bundle's pass lanes: the shell-side internals a porous model of a
// shell-and-tube exchanger is built on. Invented dimensions, not any real exchanger's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { clearLanes, tubePattern } from '../src/builders/exchangers.ts';
import type { AssemblyDefinition, Placement } from '../src/definition.ts';
import { kernel, part } from './fixtures.ts';

const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ± ${tolerance}`);

const BORE = 1000;
const BUNDLE = { tube_pitch: 25, tube_outside_diameter: 19, tube_thickness: 1.2, tube_limit_radius: 450, tube_layout_angle: 45 };
const BAFFLES = {
  baffle_cut_length: 250, baffle_thickness: 8, baffle_spacing: 400, baffle_inlet_spacing: 300, baffle_outlet_spacing: 350,
  shell_baffle_clearance: 4, tube_baffle_clearance: 0.8,
};
const at = (azimuth: number): Placement => ({ anchor: 'shell_side', axialOffset: 1000, azimuth });

function exchanger(baffles: Record<string, number> = BAFFLES, bundle: Record<string, number> = BUNDLE, azimuth = 90): AssemblyDefinition {
  return {
    components: [
      part('S', 'cylindrical_shell', { inside_diameter: BORE, thickness: 10, course_length: 2000 }, 0),
      part('B', 'tube_bundle', bundle, 0, 'S'),
      part('F', 'segmental_baffles', baffles, 0, 'S'),
    ],
    placements: { B: at(0), F: at(azimuth) },
    reversed: [],
  };
}
const baffled = (definition: AssemblyDefinition) => new AssemblyBuilder(kernel).build(definition).parts.find((p) => p.componentId === 'F')!;

test('baffles stand from the low end at the inlet spacing, then every central spacing, as many as fit', () => {
  const f = baffled(exchanger());
  assert.equal(f.status, 'drawn', f.message);
  // (2000 − 300 − 350) / 400 + 1 = 4.375: four fit, the last 2000 − 1500 = 500 from the end.
  assert.deepEqual(f.baffles!.baffles.map((b) => b.offset), [300, 700, 1100, 1500]);
  assert.deepEqual(f.baffles!.baffles.map((b) => b.windowAzimuth), [90, 270, 90, 270]);
  assert.ok(f.notes.some((n) => /the 4 that fit/.test(n.message)), 'the derived count is said');
  // Two solids, each drawn again every other baffle.
  assert.equal(f.solids.length, 2);
  assert.deepEqual(f.copies?.map((c) => c?.map((v) => v[2])), [[800], [800]]);
});

test('each baffle is the disc less its clearance, cut square to its window at l_c from the shell wall', () => {
  const f = baffled(exchanger());
  const rim = (BORE - 4) / 2;
  const chord = BORE / 2 - 250;
  // The window segment beyond the chord, taken off the disc.
  const window = rim * rim * Math.acos(chord / rim) - chord * Math.sqrt(rim * rim - chord * chord);
  close(kernel.volume(f.solids[0]!), (Math.PI * rim * rim - window) * 8, 1e-6 * Math.PI * rim * rim * 8);
  // The first window faces +Y (azimuth 90°): the plate stops at the chord there, reaches the rim opposite.
  const bounds = kernel.bounds(f.solids[0]!);
  close(bounds.max[1], chord, 1e-3);
  close(bounds.min[1], -rim, 1e-3);
  close(bounds.max[2] - bounds.min[2], 8, 1e-6);
});

test('a stated count is kept when it fits and refused when its last baffle crowds the end', () => {
  assert.equal(baffled(exchanger({ ...BAFFLES, baffle_count: 3 })).baffles!.baffles.length, 3);
  const crowded = baffled(exchanger({ ...BAFFLES, baffle_count: 5 }));
  assert.equal(crowded.status, 'failed');
  assert.equal(crowded.scope?.parameter, 'baffle_count', crowded.message);
});

test('a window past half the bore, or a plate as thick as its spacing, is refused', () => {
  for (const [baffles, parameter] of [
    [{ ...BAFFLES, baffle_cut_length: 520 }, 'baffle_cut_length'],
    [{ ...BAFFLES, baffle_thickness: 400 }, 'baffle_thickness'],
  ] as const) {
    const f = baffled(exchanger(baffles));
    assert.equal(f.status, 'failed', JSON.stringify(baffles));
    assert.equal(f.scope?.parameter, parameter, f.message);
  }
});

test('a pass lane leaves no tube edge nearer its line than half its width', () => {
  const full = tubePattern(25, 450, 45);
  for (const [count, azimuth] of [[1, 0], [1, 90], [2, 0]] as const) {
    const lanes = { width: 16, azimuths: Array.from({ length: count }, (_, k) => azimuth + (k * 180) / count) };
    const kept = clearLanes(full, lanes, 19);
    assert.ok(kept.length < full.length, 'a lane takes tubes out');
    for (const c of kept) {
      for (const a of lanes.azimuths) {
        const r = (a * Math.PI) / 180;
        assert.ok(Math.abs(-c[0] * Math.sin(r) + c[1] * Math.cos(r)) - 19 / 2 >= 16 / 2 - 1e-6);
      }
    }
  }
});

test('the bundle carries its lanes and counts only the tubes it keeps', () => {
  const model = new AssemblyBuilder(kernel).build(exchanger(BAFFLES, { ...BUNDLE, pass_lane_width: 16, pass_lane_count: 2 }));
  const bundle = model.parts.find((p) => p.componentId === 'B')!;
  assert.equal(bundle.status, 'drawn', bundle.message);
  assert.deepEqual(bundle.bundle!.lanes, { width: 16, azimuths: [0, 90] });
  assert.equal(bundle.bundle!.count, clearLanes(tubePattern(25, 450, 45), { width: 16, azimuths: [0, 90] }, 19).length);
  assert.ok(bundle.bundle!.count < tubePattern(25, 450, 45).length);
});
