import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder, assemblyBounds, tessellationTolerance } from '../src/assembly/buildAssembly.ts';
import { tessellateModel } from '../src/assembly/tessellateModel.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { kernel, referenceVessel, shellSide } from './fixtures.ts';

function buildAndDescribe(builder: AssemblyBuilder, definition: AssemblyDefinition) {
  const model = builder.build(definition);
  const bounds = assemblyBounds(model, kernel);
  const tolerance = tessellationTolerance(bounds);
  const meshes = tessellateModel(model, kernel, tolerance, Math.max(0.05, tolerance * 5));
  return { model, bounds, meshes };
}

const refsOf = (meshes: ReturnType<typeof tessellateModel>, componentId: string) =>
  meshes
    .find((m) => m.componentId === componentId)!
    .solids.flatMap((s) => s.edges.map((e) => e.descriptor))
    .filter((d) => !d.hidden);

test('the reference vessel builds, every part drawn', () => {
  const { model, bounds, meshes } = buildAndDescribe(new AssemblyBuilder(kernel), referenceVessel());

  for (const part of model.parts) {
    assert.equal(part.status, 'drawn', `${part.name}: ${part.message}`);
  }
  for (const mesh of meshes) {
    assert.deepEqual(mesh.errors, [], mesh.name);
  }

  // The shell stands on the bottom head's tangent line; the top head sits on the shell's top.
  const shell = model.parts.find((p) => p.componentId === 'Shell')!;
  const top = model.parts.find((p) => p.componentId === 'Top head')!;
  const bottom = model.parts.find((p) => p.componentId === 'Bottom head')!;
  assert.deepEqual(shell.transform, { flipped: false, dz: 0 });
  assert.deepEqual(top.transform, { flipped: false, dz: 8000 });
  assert.deepEqual(bottom.transform, { flipped: true, dz: 0 });

  // Ø5200 outside, and a nozzle standing 300 mm proud of the shell at azimuth 0.
  assert.ok(bounds);
  assert.ok(Math.abs(bounds.max[0] - (2600 + 300)) < 1, `xMax ${bounds.max[0]}`);
  assert.ok(Math.abs(bounds.min[1] + 2600) < 1, `yMin ${bounds.min[1]}`);
});

test('the edges carry their meaning, not an index', () => {
  const { meshes } = buildAndDescribe(new AssemblyBuilder(kernel), referenceVessel());

  const shellRefs = refsOf(meshes, 'Shell');
  for (const nozzle of ['N1', 'N2', 'N3']) {
    for (const side of ['outside', 'inside']) {
      assert.ok(
        shellRefs.some((d) => d.ref === `Shell/opening/${nozzle}/${side}`),
        `the ${side} opening edge of ${nozzle}`
      );
    }
  }
  const junction = shellRefs.find((d) => d.ref === 'Shell/landmark/upper-inside');
  assert.ok(junction);
  assert.equal(junction.role, 'Tangent line, head-to-shell junction with Top head (inside)');
  assert.equal(junction.dimension?.label, 'Diameter');
  assert.ok(Math.abs(junction.dimension!.value - 5000) < 1e-6);

  // Crown/knuckle and knuckle/tangent: two clean circles each, inside and outside.
  const headRefs = refsOf(meshes, 'Top head').map((d) => d.ref).sort();
  for (const key of ['crown-knuckle-inside', 'crown-knuckle-outside', 'lower-inside', 'lower-outside']) {
    assert.equal(headRefs.filter((r) => r === `Top head/landmark/${key}`).length, 1, key);
  }
});

test('the edge ranges cover the line buffer exactly', () => {
  const { meshes } = buildAndDescribe(new AssemblyBuilder(kernel), referenceVessel());
  for (const mesh of meshes) {
    for (const solid of mesh.solids) {
      const vertices = solid.edges.reduce((sum, e) => sum + e.count, 0);
      assert.equal(vertices, solid.lines.length / 3, mesh.name);
      const indices = solid.faces.reduce((sum, f) => sum + f.count, 0);
      assert.equal(indices, solid.indices.length, mesh.name);
    }
  }
});

test('changing the shell diameter keeps the three nozzles anchored', () => {
  const builder = new AssemblyBuilder(kernel);
  const before = buildAndDescribe(builder, referenceVessel(5000));
  const after = buildAndDescribe(builder, referenceVessel(4000));

  for (const nozzle of ['N1', 'N2', 'N3']) {
    const part = after.model.parts.find((p) => p.componentId === nozzle)!;
    assert.equal(part.status, 'drawn', part.message);
    assert.deepEqual(part.placement, before.model.parts.find((p) => p.componentId === nozzle)!.placement);
  }
  const openings = (m: typeof before) =>
    refsOf(m.meshes, 'Shell').map((d) => d.ref).filter((r) => r.includes('/opening/')).sort();
  assert.deepEqual([...new Set(openings(after))], [...new Set(openings(before))]);
  assert.ok(Math.abs(after.bounds!.max[0] - (2100 + 300)) < 1);
});

test('a nozzle placed beyond its course fails loudly, naming the anchor', () => {
  const definition = referenceVessel();
  const { model } = buildAndDescribe(new AssemblyBuilder(kernel), {
    ...definition,
    placements: { ...definition.placements, N3: shellSide(7900, 0) },
  });
  const n3 = model.parts.find((p) => p.componentId === 'N3')!;
  assert.equal(n3.status, 'failed');
  assert.match(n3.message!, /^N3: .*runs past Shell, which is 8000 mm long/);
  // The rest of the vessel still builds.
  assert.equal(model.parts.find((p) => p.componentId === 'N1')!.status, 'drawn');
});

test('a part the modeller cannot draw yet says so, and blocks nothing', () => {
  const definition = referenceVessel();
  const { model } = buildAndDescribe(new AssemblyBuilder(kernel), {
    ...definition,
    components: [
      ...definition.components,
      { id: 'S1', name: 'S1', kind: 'a_part_from_the_future', position: 0, hostId: 'Shell', dimensions: {} },
    ],
  });
  assert.equal(model.parts.find((p) => p.componentId === 'S1')!.status, 'not_drawn');
  assert.equal(model.parts.find((p) => p.componentId === 'Shell')!.status, 'drawn');
});

test('rebuilds are incremental', () => {
  const builder = new AssemblyBuilder(kernel);
  const definition = referenceVessel();

  let started = performance.now();
  builder.build(definition);
  const cold = performance.now() - started;

  started = performance.now();
  builder.build(definition);
  const unchanged = performance.now() - started;

  started = performance.now();
  builder.build({ ...definition, placements: { ...definition.placements, N2: shellSide(4500, 120) } });
  const oneNozzleMoved = performance.now() - started;

  started = performance.now();
  const lengthened = {
    ...definition,
    components: definition.components.map((c) =>
      c.id === 'Bottom head' ? { ...c, dimensions: { ...c.dimensions, thickness: 120 } } : c
    ),
  };
  builder.build(lengthened);
  const bottomHeadChanged = performance.now() - started;

  console.log(
    `cold ${cold.toFixed(0)} ms, unchanged ${unchanged.toFixed(1)} ms, one nozzle moved ${oneNozzleMoved.toFixed(0)} ms, bottom head changed ${bottomHeadChanged.toFixed(0)} ms`
  );
  assert.ok(unchanged < 20, `an unchanged rebuild took ${unchanged} ms`);
  assert.ok(oneNozzleMoved < cold, 'moving one nozzle rebuilt more than it needed');
});

test('a ring is wrapped round a cone at the radius of its mid-plane', () => {
  const { model } = buildAndDescribe(new AssemblyBuilder(kernel), {
    components: [
      { id: 'C', name: 'C', kind: 'conical_shell', position: 0, hostId: null, dimensions: { inside_diameter: 3000, thickness: 20, half_apex_angle: 30, course_length: 1000 } },
      { id: 'R', name: 'R', kind: 'stiffening_ring', position: 0, hostId: 'C', dimensions: { ring_height: 100, ring_thickness: 20, ring_spacing: 500 } },
    ],
    placements: { R: shellSide(500, 0) },
    reversed: [],
  });
  const ring = model.parts.find((p) => p.componentId === 'R')!;
  assert.equal(ring.status, 'drawn', ring.message);
  const outside = 1500 - 500 * Math.tan(Math.PI / 6) + 20 / Math.cos(Math.PI / 6);
  assert.ok(Math.abs(kernel.bounds(ring.solids[0]).max[0] - (outside + 100)) < 1);
});

test('what the modeller cannot draw is reported as not drawn, not as a failure', () => {
  const definition = referenceVessel();
  const { model } = buildAndDescribe(new AssemblyBuilder(kernel), {
    ...definition,
    components: [
      ...definition.components,
      { id: 'R', name: 'R', kind: 'stiffening_ring', position: 0, hostId: 'Top head', dimensions: { ring_height: 100, ring_thickness: 20, ring_spacing: 500 } },
    ],
  });
  const ring = model.parts.find((p) => p.componentId === 'R')!;
  assert.equal(ring.status, 'not_drawn');
  assert.match(ring.message!, /Top head is not one/);
});
