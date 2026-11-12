// CODAP 2005 Partie C's parts that Part 4 does not size: the numbers their drawings must hold to,
// and the refusals they owe. Their specimens are draft entries, held by draftEntries.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { RUN_BUILDERS } from '../src/builders/runParts.ts';
import { DRAFT_ENTRIES } from '../src/catalogue/draftEntries.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { kernel, part } from './fixtures.ts';

const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);

const CONE = { inside_diameter: 2000, small_end_diameter: 1200, half_apex_angle: 30, thickness: 20 };
const cone = (dimensions: Record<string, number>) =>
  RUN_BUILDERS.conical_shell(part('C', 'conical_shell', { ...CONE, ...dimensions }), { kernel });

test('C2.3.8: α is the symmetric generatrix\'s, as the rules engine reads it, and the small end stands off by δ', () => {
  const tan30 = Math.tan(Math.PI / 6);
  const offset = cone({ cone_axis_offset: 250 });
  // The length is the symmetric cone's; ConeAngle.degrees recovers the same L from α and the diameters.
  close(offset.height, 400 / tan30, 1e-9);
  assert.deepEqual(offset.upper?.centre?.map((c) => Math.round(c * 1e6) / 1e6), [250, 0]);
  const alphaMax = (Math.atan(650 / (400 / tan30)) * 180) / Math.PI;
  close(alphaMax, 43.17, 0.01);
  assert.ok(offset.notes.some((n) => n.message.includes('250 mm apart (CODAP C2.3.8)') && n.message.includes('α_max = 43.17°')));
  assert.ok(offset.centres, 'an offset cone states its circles\' centres');
});

test('C2.3.8: no offset, a zero one or a negative one is the symmetric, revolved cone', () => {
  for (const dimensions of [{}, { cone_axis_offset: 0 }, { cone_axis_offset: -10 }] as Record<string, number>[]) {
    const symmetric = cone(dimensions);
    assert.equal(symmetric.centres, undefined);
    close(symmetric.height, 400 / Math.tan(Math.PI / 6), 1e-6);
  }
});

const build = (definition: AssemblyDefinition) => new AssemblyBuilder(kernel).build(definition);
const specimen = (id: string) => DRAFT_ENTRIES.find((e) => e.id === id)!.specimen!;
const restated = (id: string, focus: string, dimensions: Record<string, number>): AssemblyDefinition => {
  const definition = specimen(id);
  return {
    ...definition,
    components: definition.components.map((c) => (c.id === focus ? { ...c, dimensions: { ...c.dimensions, ...dimensions } } : c)),
  };
};
const partOf = (definition: AssemblyDefinition, id: string) => build(definition).parts.find((p) => p.componentId === id)!;

test('C3.2.6: the groove leaves e_r under it, and a groove deeper than the plate is refused', () => {
  const head = RUN_BUILDERS.flat_head(
    part('F', 'flat_head', { inside_diameter: 1500, thickness: 60, relief_groove_radius: 10, groove_remaining_thickness: 40 }),
    { kernel, neighbourOutsideRadius: 766 }
  );
  const bottom = head.landmarks.find((l) => l.key === 'groove-bottom')!;
  close(head.height - bottom.z, 40);
  close(bottom.diameter, 1500 - 20);
  // A butt-welded spigot as thick as the shell, not a plate over the shell's end.
  assert.equal(head.lower?.wall.thickness, 16);
  assert.equal(head.lower?.outsideDiameter, 1532);

  const deep = partOf(restated('flat_head.relief_groove', 'F', { groove_remaining_thickness: 60 }), 'F');
  assert.equal(deep.status, 'failed');
  assert.equal(deep.scope?.parameter, 'groove_remaining_thickness');
  const shallow = partOf(restated('flat_head.relief_groove', 'F', { groove_remaining_thickness: 55 }), 'F');
  assert.equal(shallow.scope?.parameter, 'groove depth e_f − e_r');
});

test('C3.2.6: with nothing to weld its spigot to, the head says so', () => {
  assert.throws(
    () => RUN_BUILDERS.flat_head(part('F', 'flat_head', { inside_diameter: 1500, thickness: 60, relief_groove_radius: 10, groove_remaining_thickness: 40 }), { kernel }),
    /spigot/
  );
});

test('C9.6: a lug turned anywhere but along or round the axis is refused', () => {
  const turned = partOf(restated('lifting_lug.circumferential', 'M', { lifting_lug_orientation: 45 }), 'M');
  assert.equal(turned.status, 'failed');
  assert.equal(turned.scope?.parameter, 'lifting_lug_orientation');
});

test('C9.3.3: past 180° the supports are not drawn, and outside C9.3.3.1.7-1 they are refused', () => {
  const wide = partOf(restated('support_ring.cradle', 'M', { support_opening_angle: 240 }), 'M');
  assert.equal(wide.status, 'not_drawn');
  assert.equal(wide.scope?.reason, 'not_built');
  const narrow = partOf(restated('support_ring.cradle', 'M', { support_opening_angle: 20 }), 'M');
  assert.equal(narrow.status, 'failed');
  assert.equal(narrow.scope?.limit, '30° to 330°, C9.3.3.1.7-1');
});

test('C9.3.3: a cradle stands on one base and two links on two', () => {
  const solidsOf = (id: string) => partOf(specimen(id), 'M').solids.length;
  // The ring, two posts, then one base or two.
  assert.equal(solidsOf('support_ring.cradle'), 4);
  assert.equal(solidsOf('support_ring.two_links'), 5);
});

test('C9.5: a leg on a head stands clear of it and reaches leg_length below where it meets it', () => {
  const model = build(specimen('leg_support.on_head'));
  const leg = model.parts.find((p) => p.componentId === 'M')!;
  assert.equal(leg.status, 'drawn');
  const pipe = kernel.bounds(leg.solids[0]);
  // In the head's frame +z points away from the vessel: the pipe runs leg_length past the head.
  assert.ok(pipe.max[2] - pipe.min[2] > 900, `pipe runs ${pipe.max[2] - pipe.min[2]} mm`);
  // Cut to the head: no metal of the leg inside it.
  const overlap = kernel.volume(kernel.intersect(leg.solids[0], model.parts.find((p) => p.componentId === 'H')!.solids[0]));
  assert.ok(overlap < 1, `the leg overlaps the head by ${overlap} mm³`);
});
