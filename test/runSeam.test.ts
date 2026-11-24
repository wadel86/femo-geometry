// Where a run's seams lie. Structural, by default: at azimuth 0 on every revolved wall, which is
// what the structural mesher re-seats and what every part cut against a host's own solid has.
// For a fluid domain: turned clear of the openings, all walls along one axis together — a course
// turned to 135° beside heads left at 0 failed the whole-vessel partition (TRESCA MESH,
// 2026-11-25). Generic dimensions, not any real vessel's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder, solidToAssembly, type BuildOptions } from '../src/assembly/buildAssembly.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { kernel, part } from './fixtures.ts';

const head = { inside_diameter: 1500, head_height: 375, thickness: 16, straight_flange_length: 50 };
const nozzle = { nozzle_inside_diameter: 200, nozzle_thickness: 12, nozzle_outward_projection: 200 };

const vessel = (n1: number, n2: number): AssemblyDefinition => ({
  components: [
    part('H1', 'ellipsoidal_head', head, 0),
    part('S', 'cylindrical_shell', { inside_diameter: 1500, thickness: 16, course_length: 3000 }, 1),
    part('H2', 'ellipsoidal_head', head, 2),
    part('N1', 'radial_nozzle', nozzle, 100, 'S'),
    part('N2', 'radial_nozzle', nozzle, 100, 'S'),
  ],
  placements: { N1: { anchor: 'shell_side', axialOffset: 1350, azimuth: n1 }, N2: { anchor: 'shell_side', axialOffset: 150, azimuth: n2 } },
  reversed: [],
});

/** Every straight axial edge on the run's two cylinders, as an azimuth in the assembly, per part. */
function seams(definition: AssemblyDefinition, options?: BuildOptions): Map<string, number[]> {
  const model = new AssemblyBuilder(kernel).build(definition, options);
  const found = new Map<string, number[]>();
  for (const p of model.parts) {
    if (p.hostId !== null || p.status !== 'drawn') continue;
    const world = solidToAssembly(kernel, p.solids[0]!, p.transform);
    for (const e of kernel.topology(world).edges) {
      const b = e.bounds;
      const r = Math.hypot(b.min[0]!, b.min[1]!);
      const axial = b.max[2]! - b.min[2]! > 10 && b.max[0]! - b.min[0]! < 1e-3 && b.max[1]! - b.min[1]! < 1e-3;
      if (!axial || !(Math.abs(r - 750) < 0.5 || Math.abs(r - 766) < 0.5)) continue;
      const azimuth = ((Math.atan2(b.min[1]!, b.min[0]!) * 180) / Math.PI + 360) % 360;
      found.set(p.componentId, [...(found.get(p.componentId) ?? []), Math.round(azimuth * 1e6) / 1e6]);
    }
  }
  return found;
}

const only = (found: Map<string, number[]>, id: string) => [...new Set(found.get(id) ?? [])];

test('structurally, a nozzle at azimuth 0 turns nothing: the course and both heads keep their seam at 0', () => {
  const found = seams(vessel(0, 270));
  for (const id of ['S', 'H1', 'H2']) assert.deepEqual(only(found, id), [0], `${id}: ${JSON.stringify(found.get(id))}`);
  assert.ok(new AssemblyBuilder(kernel).build(vessel(0, 270)).parts.every((p) => p.seamAzimuth === undefined));
});

test('for a fluid domain the whole run turns together: the course and both heads\' flanges share one seam, mid-way across the widest gap', () => {
  // N1 at 0 and N2 at 270: the widest gap is 0 → 270, so the seam is at 135° on all three.
  const clear: BuildOptions = { seams: 'clear_of_openings' };
  const found = seams(vessel(0, 270), clear);
  for (const id of ['S', 'H1', 'H2']) assert.deepEqual(only(found, id), [135], `${id}: ${JSON.stringify(found.get(id))}`);
  const model = new AssemblyBuilder(kernel).build(vessel(0, 270), clear);
  assert.equal(model.parts.find((p) => p.componentId === 'H1')!.seamAzimuth, 225, 'the bottom head, turned over, is turned the other way');
  // With no nozzle on azimuth 0 there is nothing to clear, and nothing is turned.
  const off = seams(vessel(45, 315), clear);
  for (const id of ['S', 'H1', 'H2']) assert.deepEqual(only(off, id), [0], id);
});
