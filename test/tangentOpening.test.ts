// An opening whose edge lies ON its host's boundary — a course's end, where the next part's face
// begins, or a head's rim — or nearer to it than OPENING_CLEARANCE, is refused rather than drawn
// or nudged (the user, 2026-11-26, after E-101's shell came back from FreeCAD with two wires that
// intersect). Generic dimensions, not any real vessel's.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { OPENING_CLEARANCE } from '../src/builders/placing.ts';
import type { AssemblyDefinition, Placement } from '../src/definition.ts';
import { kernel, part } from './fixtures.ts';

const D = 1200;
const T = 12;
const LENGTH = 1000;
const NECK = { nozzle_inside_diameter: 180, nozzle_thickness: 10, nozzle_outward_projection: 200 }; // 200 outside
const R = 100;

const vessel = (placement: Placement): AssemblyDefinition => ({
  components: [
    part('H1', 'ellipsoidal_head', { inside_diameter: D, head_height: D / 4, thickness: T, straight_flange_length: 0 }, 0),
    part('S', 'cylindrical_shell', { inside_diameter: D, thickness: T, course_length: LENGTH }, 1),
    part('H2', 'ellipsoidal_head', { inside_diameter: D, head_height: D / 4, thickness: T, straight_flange_length: 0 }, 2),
    part('N', 'radial_nozzle', NECK, 0, placement.anchor === 'head_crown' ? 'H2' : 'S'),
  ],
  placements: { N: placement },
  reversed: [],
});
const build = (definition: AssemblyDefinition) => new AssemblyBuilder(kernel).build(definition);
const nozzle = (definition: AssemblyDefinition) => build(definition).parts.find((p) => p.componentId === 'N')!;
const side = (axialOffset: number): Placement => ({ anchor: 'shell_side', axialOffset, azimuth: 45 });

test('an opening exactly on a course end is refused, naming the end and how far to move it', () => {
  const low = nozzle(vessel(side(R)));
  assert.equal(low.status, 'failed');
  assert.match(low.message ?? '', /exactly on the lower end of S: tangent.*move it at least 0\.1 mm up the course/);
  const high = nozzle(vessel(side(LENGTH - R)));
  assert.equal(high.status, 'failed');
  assert.match(high.message ?? '', /exactly on the upper end of S.*down the course/);
});

test('within the clearance it is refused too, and the remaining move is stated', () => {
  const near = nozzle(vessel(side(R + 0.04)));
  assert.equal(near.status, 'failed');
  assert.match(near.message ?? '', /0\.04 mm from the lower end of S.*move it at least 0\.06 mm/);
  assert.equal(near.scope?.limit, `≥ ${OPENING_CLEARANCE} mm, clear of it`);
});

test('at the clearance the opening is drawn and the pierced course is a valid solid', () => {
  const model = build(vessel(side(R + OPENING_CLEARANCE)));
  assert.equal(model.parts.find((p) => p.componentId === 'N')!.status, 'drawn');
  const shell = model.parts.find((p) => p.componentId === 'S')!;
  assert.equal(shell.status, 'drawn');
  assert.ok(kernel.isValid(shell.solids[0]!));
});

test('a part that cuts nothing may still sit flush with its host\'s end', () => {
  // A stiffening ring at the very bottom of the course: no opening, no outline to touch.
  const definition: AssemblyDefinition = {
    ...vessel(side(500)),
    components: [
      ...vessel(side(500)).components.filter((c) => c.id !== 'N'),
      part('G', 'stiffening_ring', { ring_height: 80, ring_thickness: 20 }, 0, 'S'),
    ],
    placements: { G: side(10) },
  };
  const ring = build(definition).parts.find((p) => p.componentId === 'G')!;
  assert.notEqual(ring.status, 'failed', ring.message);
});

test('on a head, an opening reaching the rim is refused', () => {
  const rim = nozzle(vessel({ anchor: 'head_crown', axialOffset: D / 2 - R, azimuth: 0 }));
  assert.equal(rim.status, 'failed');
  assert.match(rim.message ?? '', /exactly on the rim of H2.*towards the axis/);
});

test('E-101 as it was, N1 tangent to the tubesheet face, is refused; as it is now, drawn', () => {
  const e101: AssemblyDefinition = JSON.parse(readFileSync(new URL('./fixtures/e101-assembly.json', import.meta.url), 'utf8'));
  const was: AssemblyDefinition = { ...e101, placements: { ...e101.placements, N1: { ...e101.placements.N1!, axialOffset: 109.55 } } };
  const n1 = build(was).parts.find((p) => p.componentId === 'N1')!;
  assert.equal(n1.status, 'failed');
  assert.match(n1.message ?? '', /exactly on the lower end of Shell/);
  assert.equal(build(e101).parts.find((p) => p.componentId === 'N1')!.status, 'drawn');
});
