import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { zoneOutlines } from '../src/ports/zoneOutlines.ts';
import { kernel, part, shellSide } from './fixtures.ts';

const close = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ± ${tolerance}`);

const points = (line: Float32Array): [number, number, number][] =>
  Array.from({ length: line.length / 3 }, (_, k) => [line[3 * k], line[3 * k + 1], line[3 * k + 2]]);

function outlines(definition: AssemblyDefinition) {
  const model = new AssemblyBuilder(kernel).build(definition);
  const resolved = resolveGeometry(definition, model, kernel);
  return { resolved, outlines: zoneOutlines(definition, model, resolved) };
}

const nozzle = (id: string) =>
  part(id, 'radial_nozzle', { nozzle_inside_diameter: 200, nozzle_thickness: 15, nozzle_outward_projection: 300 }, 0, 'S');

const shell = part('S', 'cylindrical_shell', { inside_diameter: 1000, thickness: 20, course_length: 2000 });

test("an opening's zone runs 1.25·√(R·t) beyond its neck, on the outside surface", () => {
  const { outlines: all } = outlines({ components: [shell, nozzle('N')], placements: { N: shellSide(1000, 0) }, reversed: [] });
  const opening = all.find((o) => o.id === 'S:opening:N')!;
  assert.equal(opening.overlap, false);

  const grow = 1.25 * Math.sqrt(510 * 20);
  const zone = points(opening.zone[0]);
  // On the outside surface, 520, and 1.5 proud of it.
  for (const [x, y] of zone) close(Math.hypot(x, y), 521.5, 1e-3);
  close(Math.max(...zone.map((p) => p[2])), 1000 + 115 + grow, 0.5);
  close(Math.min(...zone.map((p) => p[2])), 1000 - 115 - grow, 0.5);
  const neck = points(opening.footprint[0]);
  close(Math.max(...neck.map((p) => p[2])), 1000 + 115, 0.5);
});

test('two outlines touch where the overlap flag changes', () => {
  // Necks 230 across on R = 510, t = 20: the flag changes 2.5·√(R·t) = 252.5 edge to edge.
  const at = (gap: number) =>
    outlines({
      components: [shell, nozzle('N1'), nozzle('N2')],
      placements: { N1: shellSide(700, 0), N2: shellSide(700 + 230 + gap, 0) },
      reversed: [],
    });
  const near = at(240);
  assert.ok(near.outlines.every((o) => o.overlap));
  const zones = ['S:opening:N1', 'S:opening:N2'].map((id) => points(near.outlines.find((o) => o.id === id)!.zone[0]));
  // The lower zone's top above the upper zone's bottom: they cross.
  assert.ok(Math.max(...zones[0].map((p) => p[2])) > Math.min(...zones[1].map((p) => p[2])));

  const far = at(265);
  assert.ok(far.outlines.every((o) => !o.overlap));
  const apart = ['S:opening:N1', 'S:opening:N2'].map((id) => points(far.outlines.find((o) => o.id === id)!.zone[0]));
  assert.ok(Math.max(...apart[0].map((p) => p[2])) < Math.min(...apart[1].map((p) => p[2])));
});

test("a head's tangent line is outlined all round, each side on its own wall", () => {
  const { outlines: all, resolved } = outlines({
    components: [
      part('H', 'ellipsoidal_head', { inside_diameter: 1000, head_height: 250, thickness: 20, straight_flange_length: 300 }, 0),
      part('S', 'cylindrical_shell', { inside_diameter: 1000, thickness: 20, course_length: 1000 }, 1),
    ],
    placements: {},
    reversed: [],
  });
  const tangent = all.find((o) => o.id === 'H:tangent-line')!;
  assert.equal(tangent.footprint.length, 1);
  assert.equal(tangent.zone.length, 2);
  // Turned over at the bottom, the tangent line is 300 below the weld; the flange side is above it.
  const z = (line: Float32Array) => points(line)[0][2];
  const line = z(tangent.footprint[0]);
  const d = resolved.discontinuities.find((x) => x.id === 'H:tangent-line')!;
  close(z(tangent.zone[1]) - line, 1.25 * d.sqrtRt.above, 0.5);
  for (const [x, y] of points(tangent.zone[1])) close(Math.hypot(x, y), 521.5, 1e-3);
});
