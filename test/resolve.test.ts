import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSolids, importSTEP, isValid, measureVolume, unwrap } from 'brepjs';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { RefusedError, resolveGeometry, stepOf } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { kernel, part, referenceVessel, shellSide } from './fixtures.ts';

/** The meshing check case: a Ø1000 × 20 course, 1500 long, one radial nozzle set in at mid-length. */
const cylinderWithNozzle = (): AssemblyDefinition => ({
  components: [
    part('S', 'cylindrical_shell', { inside_diameter: 1000, thickness: 20, course_length: 1500 }),
    part('N', 'radial_nozzle', {
      nozzle_inside_diameter: 200,
      nozzle_thickness: 15,
      nozzle_outward_projection: 400,
    }, 0, 'S'),
  ],
  placements: { N: shellSide(750, 0) },
  reversed: [],
});

const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);
const closeVec = (actual: readonly number[], expected: readonly number[], tolerance = 1e-6) =>
  actual.forEach((value, i) => close(value, expected[i], tolerance));

function resolve(definition: AssemblyDefinition, mode: 'display' | 'analysis' = 'display') {
  const model = new AssemblyBuilder(kernel).build(definition);
  return { model, resolved: resolveGeometry(definition, model, kernel, { mode }) };
}

test('the check case resolves ready for analysis, with its ports and its one joint', () => {
  const { resolved } = resolve(cylinderWithNozzle(), 'analysis');
  assert.deepEqual(resolved.refusals, []);
  assert.deepEqual(resolved.errors, []);
  assert.equal(resolved.ready, true);

  const shell = resolved.parts.find((p) => p.componentId === 'S')!;
  const nozzle = resolved.parts.find((p) => p.componentId === 'N')!;
  assert.deepEqual(shell.ports.map((p) => p.id).sort(), ['lower@S', 'opening:N@S', 'upper@S']);
  assert.deepEqual(nozzle.ports.map((p) => p.id).sort(), ['neck:host-end@N', 'neck:outer-end@N']);

  const opening = shell.ports.find((p) => p.kind === 'opening')!;
  closeVec(opening.location, [520, 0, 750]);
  closeVec(opening.axis, [1, 0, 0]);
  closeVec(opening.meridian, [0, 0, 1]);
  assert.deepEqual(opening.surface, { kind: 'cylinder', principalRadii: [null, 510] });
  close(opening.thickness, 20);
  close(opening.meanRadius!, 107.5);
  close(opening.outsideRadius!, 115);
  assert.deepEqual(opening.semanticRefs, ['S/opening/N/outside', 'S/opening/N/inside']);

  const hostEnd = nozzle.ports.find((p) => p.key === 'neck:host-end')!;
  closeVec(hostEnd.axis, [-1, 0, 0]);
  const outerEnd = nozzle.ports.find((p) => p.key === 'neck:outer-end')!;
  closeVec(outerEnd.location, [920, 0, 750]);
  assert.deepEqual(outerEnd.surface, { kind: 'cylinder', principalRadii: [null, 107.5] });
  close(outerEnd.thickness, 15);

  assert.deepEqual(resolved.joints, [
    {
      id: 'S:opening:N~N:neck:host-end',
      kind: 'set_in_nozzle',
      ports: ['opening:N@S', 'neck:host-end@N'],
      sourceRule: 'host',
      issues: [],
    },
  ]);

  // Every port reference names an entity the descriptors describe.
  const refs = new Set(resolved.parts.flatMap((p) => p.edges.map((e) => e.ref)));
  for (const port of [...shell.ports, ...nozzle.ports]) {
    for (const ref of port.semanticRefs) assert.ok(refs.has(ref), `${port.id} → ${ref}`);
  }
});

test('descriptors are measured, in the assembly frame', () => {
  const { resolved } = resolve(cylinderWithNozzle());
  const shell = resolved.parts.find((p) => p.componentId === 'S')!;

  const upper = shell.edges.filter((e) => e.ref === 'S/landmark/upper-outside');
  assert.equal(upper.length, 1);
  assert.equal(upper[0].curve, 'circle');
  closeVec(upper[0].center!, [0, 0, 1500]);
  close(upper[0].radius!, 520);

  // The outside wall: a cylinder about Z, its area the course's less the hole.
  const outside = shell.faces.filter((f) => f.surface === 'cylinder' && Math.abs(f.radii[1]! - 520) < 1e-6);
  assert.equal(outside.length, 1);
  closeVec(outside[0].axis!.axis.map(Math.abs), [0, 0, 1]);
  assert.ok(outside[0].area < 2 * Math.PI * 520 * 1500 && outside[0].area > 2 * Math.PI * 520 * 1500 - Math.PI * 115 ** 2 * 1.2);
  closeVec(outside[0].bounds.min, [-520, -520, 0], 1e-3);

  const outerEnd = resolved.parts.find((p) => p.componentId === 'N')!.edges.filter((e) => e.ref === 'N/neck/outer-end/outside');
  assert.equal(outerEnd.length, 1);
  closeVec(outerEnd[0].center!, [920, 0, 750]);
});

test('the STEP file holds one product per component, separate valid solids, millimetres', async () => {
  const definition = cylinderWithNozzle();
  const model = new AssemblyBuilder(kernel).build(definition);
  const step = stepOf(definition, model, kernel, 'analysis');

  assert.match(step, /ISO-10303-21/);
  assert.match(step, /PRODUCT\('S'/);
  assert.match(step, /PRODUCT\('N'/);
  assert.match(step, /SI_UNIT\(\.MILLI\.,\.METRE\.\)/);

  const shape = unwrap(await importSTEP(new Blob([step])));
  const solids = getSolids(shape);
  assert.equal(solids.length, 2, 'shell and neck, unfused');
  for (const solid of solids) assert.ok(isValid(solid));

  // The pierced shell and the neck, by volume: 400 out, 20 through the wall, and down to the
  // inside surface, which falls away from the neck's axis by up to 500 − √(500² − 115²).
  const volumes = solids.map((s) => unwrap(measureVolume(s))).sort((a, b) => a - b);
  const annulus = Math.PI * (115 ** 2 - 100 ** 2);
  assert.ok(volumes[0] > annulus * 420 && volumes[0] < annulus * (420 + 500 - Math.sqrt(500 ** 2 - 115 ** 2)), `neck ${volumes[0]}`);
  close(volumes[1], Math.PI * (520 ** 2 - 500 ** 2) * 1500 - Math.PI * 115 ** 2 * 20, Math.PI * 115 ** 2 * 1.5);
});

test('the run is joined end to end, mating ports facing each other', () => {
  const { resolved } = resolve(referenceVessel());
  const run = resolved.joints.filter((j) => j.sourceRule === 'run adjacency');
  assert.deepEqual(run.map((j) => j.id), ['Bottom head:lower~Shell:lower', 'Shell:upper~Top head:lower']);
  assert.ok(run.every((j) => j.kind === 'butt_weld' && j.issues.length === 0));

  const ports = new Map(resolved.parts.flatMap((p) => p.ports).map((p) => [p.id, p]));
  for (const joint of run) {
    const [a, b] = joint.ports.map((id) => ports.get(id)!);
    closeVec(a.location, b.location);
    closeVec(a.axis, b.axis.map((x) => -x));
    close(a.meanRadius!, b.meanRadius!);
  }
  // The bottom head is turned over: its tangent line faces up, and its meridian runs upwards,
  // away from the head below it.
  const bottom = ports.get('lower@Bottom head')!;
  closeVec(bottom.axis, [0, 0, 1]);
  closeVec(bottom.meridian, [0, 0, 1]);
  assert.equal(bottom.surface.kind, 'torus');
  assert.equal(resolved.joints.filter((j) => j.kind === 'set_in_nozzle').length, 3);
});

test('analysis mode refuses every assumption, naming its symbol', () => {
  const display = resolve(referenceVessel()).resolved;
  assert.deepEqual(display.refusals, []);
  // A head with no straight flange is fine on screen, so the screen does not hear about it.
  assert.ok(display.parts.every((p) => p.notes.every((n) => !n.analysisOnly)));

  const definition = referenceVessel();
  const analysis = resolve(
    {
      ...definition,
      components: definition.components.map((c) =>
        c.id === 'Shell' ? { ...c, dimensions: { inside_diameter: 5000, thickness: 100 } } : c
      ),
      placements: { N1: definition.placements.N1, N2: definition.placements.N2 },
    },
    'analysis'
  ).resolved;
  assert.equal(analysis.ready, false);
  const by = (id: string) => analysis.refusals.filter((r) => r.componentId === id);
  assert.deepEqual(by('Shell').map((r) => r.symbol), ['course_length']);
  assert.deepEqual(by('Top head').map((r) => r.symbol), ['straight_flange_length']);
  assert.match(by('N3')[0].message, /default position/);

  assert.throws(
    () => {
      const model = new AssemblyBuilder(kernel).build(definition);
      stepOf(definition, model, kernel, 'analysis');
    },
    (error: unknown) => error instanceof RefusedError && error.refusals.some((r) => r.symbol === 'straight_flange_length')
  );
});

test('a stated straight flange of zero is an answer, not a gap', () => {
  const definition = referenceVessel();
  const { resolved } = resolve(
    {
      ...definition,
      components: definition.components.map((c) =>
        c.kind === 'torispherical_head' ? { ...c, dimensions: { ...c.dimensions, straight_flange_length: 0 } } : c
      ),
    },
    'analysis'
  );
  assert.deepEqual(resolved.refusals, []);
  assert.equal(resolved.ready, true);
});

test('an analysis is not a part, and nothing is missing for it', () => {
  const definition = cylinderWithNozzle();
  const { resolved, model } = resolve(
    {
      ...definition,
      components: [
        ...definition.components,
        part('SCL', 'stress_classification_line', {}, 0, 'S'),
        part('FA', 'fatigue_assessment', {}, 5),
      ],
    },
    'analysis'
  );
  assert.equal(model.parts.find((p) => p.componentId === 'SCL')!.status, 'analysis');
  assert.equal(model.parts.find((p) => p.componentId === 'FA')!.status, 'analysis');
  assert.equal(resolved.ready, true);
  assert.equal(resolved.joints.filter((j) => j.sourceRule === 'run adjacency').length, 0);
});

test('a lug drawn from its stated dimensions assumes nothing', () => {
  const lug = (dimensions: Record<string, number>) =>
    resolve(
      {
        components: [
          part('S', 'cylindrical_shell', { inside_diameter: 2000, thickness: 20, course_length: 3000 }),
          part('L', 'lug_support', dimensions, 0, 'S'),
        ],
        placements: { L: shellSide(1500, 0) },
        reversed: [],
      },
      'analysis'
    ).resolved;

  const assumed = lug({});
  assert.deepEqual(
    assumed.refusals.map((r) => r.symbol).sort(),
    [
      'support_lug_base_plate_thickness',
      'support_lug_gusset_spacing',
      'support_lug_gusset_thickness',
      'support_lug_height',
      'support_lug_projection',
    ]
  );

  const stated = lug({
    support_lug_height: 300,
    support_lug_projection: 200,
    support_lug_gusset_spacing: 150,
    support_lug_gusset_thickness: 15,
    support_lug_base_plate_thickness: 20,
  });
  assert.deepEqual(stated.refusals, []);
  const joint = stated.joints.find((j) => j.kind === 'fillet_attachment')!;
  assert.equal(joint.id, 'S:wall:L~L:attach');
  const attach = stated.parts.find((p) => p.componentId === 'L')!.ports[0];
  close(attach.extent!.axial, 320);
  close(attach.thickness, 15);
});

test('a stated weld leg rides on the joint, and is refused as undrawn under analysis', () => {
  const definition = cylinderWithNozzle();
  const welded = {
    ...definition,
    components: definition.components.map((c) =>
      c.id === 'N' ? { ...c, dimensions: { ...c.dimensions, outer_fillet_weld_leg: 10 } } : c
    ),
  };
  assert.deepEqual(resolve(welded).resolved.joints[0].weld, { outer_fillet_weld_leg: 10 });
  assert.deepEqual(resolve(welded, 'analysis').resolved.refusals.map((r) => r.symbol), ['outer_fillet_weld_leg']);
});
