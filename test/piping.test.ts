// RCC-M C3641 and C3642: a straight pipe and a bend, stated on the outside diameter their code
// reads. Generic DN 200 dimensions, not any real line's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder, solidToAssembly } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition, ComponentDefinition } from '../src/definition.ts';
import { kernel, part } from './fixtures.ts';

const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ± ${tolerance}`);

const PIPE = { pipe_outside_diameter: 219.1, thickness: 8.18 };
const ro = 219.1 / 2;
const ri = ro - 8.18;
const R = 1.5 * 219.1;

const line = (...components: ComponentDefinition[]): AssemblyDefinition => ({ components, placements: {}, reversed: [] });
const build = (definition: AssemblyDefinition) => new AssemblyBuilder(kernel).build(definition);
const partOf = (definition: AssemblyDefinition, id: string) => build(definition).parts.find((p) => p.componentId === id)!;

test('a straight pipe is the course of bore D_o − 2·t_n, its wall inward from D_o', () => {
  const p = partOf(line(part('P', 'pipe_segment', { ...PIPE, course_length: 1000 }, 0)), 'P');
  assert.equal(p.status, 'drawn', p.message);
  const annulus = Math.PI * (ro * ro - ri * ri) * 1000;
  close(kernel.volume(p.solids[0]!), annulus, 1e-6 * annulus);
  const box = kernel.bounds(p.solids[0]!);
  close(box.max[0]!, ro, 1e-6);
  // It meets a plain course of the same bore butt to butt, as two courses do.
  const definition = line(part('P', 'pipe_segment', { ...PIPE, course_length: 500 }, 0), part('S', 'cylindrical_shell', { inside_diameter: 2 * ri, thickness: 8.18, course_length: 500 }, 1));
  const joint = resolveGeometry(definition, build(definition), kernel).joints.find((j) => j.kind === 'butt_weld');
  assert.ok(joint, 'pipe to course is a butt weld');
  assert.deepEqual(joint.issues, []);
});

test('a branch on a straight pipe is a nozzle on its course — C3643\'s host — set in, with no issue', () => {
  const definition: AssemblyDefinition = {
    components: [
      part('P', 'pipe_segment', { ...PIPE, course_length: 1000 }, 0),
      part('N', 'radial_nozzle', { nozzle_inside_diameter: 80, nozzle_thickness: 5.5, nozzle_outward_projection: 150 }, 0, 'P'),
    ],
    placements: { N: { anchor: 'shell_side', axialOffset: 500, azimuth: 90 } },
    reversed: [],
  };
  const model = build(definition);
  assert.equal(model.parts.find((p) => p.componentId === 'N')!.status, 'drawn');
  const joint = resolveGeometry(definition, model, kernel).joints.find((j) => j.id === 'P:opening:N~N:neck:host-end');
  assert.equal(joint?.kind, 'set_in_nozzle');
  assert.deepEqual(joint?.issues, []);
});

test('a bend sweeps the tube through α on R: its volume is the annulus times R·α, its outlet where the centreline ends', () => {
  for (const angle of [45, 90, 180]) {
    const model = build(line(part('P', 'pipe_segment', { ...PIPE, course_length: 500 }, 0), part('B', 'pipe_bend', { ...PIPE, pipe_bend_radius: R, pipe_bend_angle: angle }, 1)));
    const b = model.parts.find((p) => p.componentId === 'B')!;
    assert.equal(b.status, 'drawn', `${angle}°: ${b.message ?? ''}`);
    const solid = solidToAssembly(kernel, b.solids[0]!, b.transform);
    assert.ok(kernel.isValid(solid));
    const alpha = (angle * Math.PI) / 180;
    // A wedge cut at an angle that is not a multiple of 90° costs the boolean a few parts per million.
    close(kernel.volume(solid), Math.PI * (ro * ro - ri * ri) * R * alpha, 1e-5 * kernel.volume(solid));
    // It starts on the run's axis at the pipe's end and turns towards azimuth 0 (+X).
    const box = kernel.bounds(solid);
    close(box.min[2]!, 500, 1e-6);
    close(box.min[0]!, -ro, 1e-6);
    if (angle === 90) {
      close(box.max[0]!, R, 1e-6); // the outlet face lies in the plane x = R
      close(box.max[2]!, 500 + R + ro, 1e-6);
    }
    if (angle === 180) close(box.max[0]!, 2 * R + ro, 1e-6); // the return bend comes back down beside itself
  }
});

test('a bend ends its run: a course after it is not drawn, and a bend tighter than its own tube is refused', () => {
  const after = build(
    line(
      part('P', 'pipe_segment', { ...PIPE, course_length: 500 }, 0),
      part('B', 'pipe_bend', { ...PIPE, pipe_bend_radius: R, pipe_bend_angle: 90 }, 1),
      part('Q', 'pipe_segment', { ...PIPE, course_length: 300 }, 2)
    )
  ).parts.find((p) => p.componentId === 'Q')!;
  assert.equal(after.status, 'not_drawn');
  assert.equal(after.scope?.reason, 'not_built');
  assert.equal(after.scope?.parameter, 'position');

  const tight = partOf(line(part('B', 'pipe_bend', { ...PIPE, pipe_bend_radius: 100, pipe_bend_angle: 90 }, 0)), 'B');
  assert.equal(tight.status, 'failed');
  assert.equal(tight.scope?.parameter, 'pipe_bend_radius');
  const over = partOf(line(part('B', 'pipe_bend', { ...PIPE, pipe_bend_radius: R, pipe_bend_angle: 200 }, 0)), 'B');
  assert.equal(over.scope?.parameter, 'pipe_bend_angle');
  const solidWall = partOf(line(part('P', 'pipe_segment', { pipe_outside_diameter: 100, thickness: 50, course_length: 100 }, 0)), 'P');
  assert.equal(solidWall.scope?.parameter, 'thickness');
});
