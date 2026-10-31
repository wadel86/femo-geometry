import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { kernel, part, shellSide } from './fixtures.ts';

const close = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ± ${tolerance}`);

const head = (thickness: number, straightFlange: number) =>
  part('H', 'ellipsoidal_head', {
    inside_diameter: 1200, head_height: 300, thickness, straight_flange_length: straightFlange,
  }, 0);

const vessel = (headThickness: number, straightFlange = 50): AssemblyDefinition => ({
  components: [
    head(headThickness, straightFlange),
    part('S', 'cylindrical_shell', { inside_diameter: 1200, thickness: 14, course_length: 1000 }, 1),
  ],
  placements: {},
  reversed: [],
});

test('a thicker head is tapered 3:1 on the outside down to the shell it is welded to', () => {
  const plain = new AssemblyBuilder(kernel).build(vessel(14));
  const stepped = new AssemblyBuilder(kernel).build(vessel(16));
  const resolved = resolveGeometry(vessel(16), stepped, kernel, { mode: 'analysis' });

  // The weld now joins two 14 mm walls on one mean radius: nothing to refuse.
  assert.deepEqual(resolved.refusals, []);
  assert.deepEqual(resolved.errors, []);
  assert.ok(resolved.joints.every((j) => j.issues.length === 0), JSON.stringify(resolved.joints));

  const H = stepped.parts.find((p) => p.componentId === 'H')!;
  assert.ok(kernel.isValid(H.solids[0]));
  // Outside, at the weld: the shell's 1228; 3·2 = 6 mm in, the head's own 1232.
  const bounds = kernel.bounds(H.solids[0]);
  close(bounds.max[0], 616, 1e-3);
  const taper = resolved.parts.find((p) => p.componentId === 'H')!.edges;
  assert.ok(taper.length > 0);

  // What came off is the ring between the cone and the 616 cylinder over 6 mm: a third of the
  // 2 mm step's annulus, on average.
  const removed = Math.PI * 6 * (616 ** 2 - (614 ** 2 + 614 * 616 + 616 ** 2) / 3);
  const unchangedShell = (built: typeof plain) => kernel.volume(built.parts.find((p) => p.componentId === 'S')!.solids[0]);
  close(unchangedShell(stepped), unchangedShell(plain), 1e-6 * unchangedShell(plain));
  const full = new AssemblyBuilder(kernel).build({ ...vessel(16), components: [head(16, 50)] });
  close(kernel.volume(full.parts[0].solids[0]) - kernel.volume(H.solids[0]), removed, 0.01 * removed);
});

test('a straight flange shorter than the taper leaves the step, and it is still refused', () => {
  // A 2 mm step needs 6 mm of straight wall; 4 mm of flange is not enough.
  const definition = vessel(16, 4);
  const resolved = resolveGeometry(definition, new AssemblyBuilder(kernel).build(definition), kernel, { mode: 'analysis' });
  assert.ok(resolved.refusals.some((r) => /taper is not drawn/.test(r.message)));
});

test('two openings overlap within 2.5·√(R·t), not within twice that', () => {
  // R = 510, t = 20: √(R·t) = 101, a zone of 252.5.
  const nozzle = (id: string) =>
    part(id, 'radial_nozzle', { nozzle_inside_diameter: 200, nozzle_thickness: 15, nozzle_outward_projection: 300 }, 0, 'S');
  const at = (offset: number) => {
    const definition: AssemblyDefinition = {
      components: [
        part('S', 'cylindrical_shell', { inside_diameter: 1000, thickness: 20, course_length: 2000 }),
        nozzle('N1'),
        nozzle('N2'),
      ],
      placements: { N1: shellSide(500, 0), N2: shellSide(500 + offset, 0) },
      reversed: [],
    };
    const resolved = resolveGeometry(definition, new AssemblyBuilder(kernel).build(definition), kernel);
    return resolved.proximities.find((p) => p.between.includes('S:opening:N1') && p.between.includes('S:opening:N2'))!;
  };
  // Necks 230 across: centres 400 apart leave 170 between edges, 700 apart 470.
  assert.equal(at(400).overlap, true);
  const far = at(700);
  close(far.distance, 470, 1);
  assert.equal(far.overlap, false, 'inside two zones, but not inside one');
});
