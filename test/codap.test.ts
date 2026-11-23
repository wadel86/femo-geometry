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
  const wide = partOf(restated('ring_support.cradle', 'M', { support_opening_angle: 240 }), 'M');
  assert.equal(wide.status, 'not_drawn');
  assert.equal(wide.scope?.reason, 'not_built');
  const narrow = partOf(restated('ring_support.cradle', 'M', { support_opening_angle: 20 }), 'M');
  assert.equal(narrow.status, 'failed');
  assert.equal(narrow.scope?.limit, '30° to 330°, C9.3.3.1.7-1');
});

test('C9.3.3: a cradle stands on one base and two hinges on two', () => {
  const solidsOf = (id: string) => partOf(specimen(id), 'M').solids.length;
  // The ring, two posts, then one base or two.
  assert.equal(solidsOf('ring_support.cradle'), 4);
  assert.equal(solidsOf('ring_support.two_links'), 5);
  // C9.3.3.6's two points are §16.9's two hinges: either name, the same ring.
  assert.equal(partOf(restated('ring_support.cradle', 'M', { ring_on_two_hinges: undefined as unknown as number, support_ring_two_point: 1 }), 'M').solids.length, 5);
});

test('§16.9: the section the engine checks is the bar drawn — A_R, h_G, R_R and t_ring agree or are refused', () => {
  // The specimen: a 120 × 20 bar on a course of 1500 inside, 16 thick, so R_o = 766 and R_R = 826.
  const agreeing = partOf(restated('ring_support.cradle', 'M', { support_ring_area: 2400, support_ring_centroid: 60, support_ring_radius: 826, support_ring_contact_width: 20 }), 'M');
  assert.equal(agreeing.status, 'drawn', agreeing.message);
  for (const [symbol, value] of [['support_ring_area', 3000], ['support_ring_centroid', 70], ['support_ring_radius', 850], ['support_ring_contact_width', 25]] as const) {
    const off = partOf(restated('ring_support.cradle', 'M', { [symbol]: value }), 'M');
    assert.equal(off.status, 'failed', `${symbol} ${value} was drawn`);
    assert.equal(off.scope?.reason, 'mismatch');
    assert.equal(off.scope?.parameter, symbol);
  }
  // Stated only as the engine requires it — A_R, h_G, R_R and δ — the bar is still fixed, and drawn.
  const engineOnly = restated('ring_support.cradle', 'M', { support_ring_area: 2400, support_ring_centroid: 60, support_ring_radius: 826 });
  const m = engineOnly.components.find((c) => c.id === 'M')!;
  const { support_ring_height: _h, support_ring_web_thickness: _t, ...rest } = m.dimensions;
  const asEngine = partOf({ ...engineOnly, components: engineOnly.components.map((c) => (c.id === 'M' ? { ...c, dimensions: rest } : c)) }, 'M');
  assert.equal(asEngine.status, 'drawn', asEngine.message);
  assert.equal(asEngine.solids.length, 4);
  // CODAP's names for the same quantities are read too, and checked the same way.
  assert.equal(partOf(restated('ring_support.cradle', 'M', { support_section_area: 2400, support_ring_neutral_axis: 60, support_ring_footprint: 20 }), 'M').status, 'drawn');
  assert.equal(partOf(restated('ring_support.cradle', 'M', { support_ring_neutral_axis: 70 }), 'M').scope?.parameter, 'support_ring_neutral_axis');
  const twice = partOf(restated('ring_support.cradle', 'M', { support_contact_angle: 100 }), 'M');
  assert.equal(twice.scope?.reason, 'mismatch');
  assert.equal(twice.scope?.parameter, 'support_contact_angle');
});

test('§16.9 / C9.A5: the ring flags are switches — 1 yes, 0 or absent no — as the engine reads them', () => {
  // 0 is no: a cradle stays a cradle, a tee stays a tee.
  for (const symbol of ['ring_on_two_hinges', 'support_ring_two_point', 'support_ring_channel']) {
    const zero = partOf(restated('ring_support.cradle', 'M', { [symbol]: 0 }), 'M');
    assert.equal(zero.status, 'drawn', `${symbol} = 0: ${zero.message ?? ''}`);
    assert.equal(zero.solids.length, 4, `${symbol} = 0 is a cradle`);
    assert.equal(partOf(restated('ring_support.cradle', 'M', { [symbol]: 2 }), 'M').scope?.limit, '0 or 1');
  }
  // Inside the shell, a ring has nothing for its posts to stand on.
  const inside = partOf(restated('ring_support.cradle', 'M', { support_ring_external: 0 }), 'M');
  assert.equal(inside.status, 'not_drawn');
  assert.equal(inside.scope?.parameter, 'support_ring_external');
  // Unstated, the side is drawn outside and said, because the engine reads it as inside.
  const unsided = partOf(restated('ring_support.cradle', 'M', { support_ring_external: undefined as unknown as number }), 'M');
  assert.equal(unsided.status, 'drawn');
  assert.ok(unsided.notes.some((n) => n.symbol === 'support_ring_external' && n.scope?.reason === 'assumed'));
});

test('C9.A5.4 and C9.A5.5: a tee and a channel are revolved from their sections, with the engine\'s A_R and h_G', () => {
  // Tee: h 160, web 16, flange 120 × 20. A_R = 140·16 + 120·20 = 4640; h_G = 160 − [(120 − 16)·20² + 16·160²]/(2·4640).
  const tee = partOf(specimen('ring_support.tee'), 'M');
  assert.equal(tee.status, 'drawn', tee.message);
  const teeArea = 140 * 16 + 120 * 20;
  const teeCentroid = 160 - ((120 - 16) * 400 + 16 * 160 * 160) / (2 * teeArea);
  const R = 766;
  // Pappus: the ring's volume is A_R times the circle its centroid runs round.
  const close = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b} ± ${tol}`);
  close(kernel.volume(tee.solids[0]!), teeArea * 2 * Math.PI * (R + teeCentroid), 1e-6 * teeArea * 2 * Math.PI * R);
  assert.equal(partOf(restated('ring_support.tee', 'M', { support_ring_area: teeArea, support_ring_centroid: teeCentroid }), 'M').status, 'drawn');
  assert.equal(partOf(restated('ring_support.tee', 'M', { support_ring_centroid: 80 }), 'M').scope?.reason, 'mismatch');

  // Channel: two webs 12 at the edges of a 120 × 16 flange. A_R = 2·144·12 + 120·16 = 5376.
  const channel = partOf(specimen('ring_support.channel'), 'M');
  assert.equal(channel.status, 'drawn', channel.message);
  const chArea = 2 * 144 * 12 + 120 * 16;
  const chCentroid = 160 - ((120 - 24) * 256 + 24 * 160 * 160) / (2 * chArea);
  close(kernel.volume(channel.solids[0]!), chArea * 2 * Math.PI * (R + chCentroid), 1e-6 * chArea * 2 * Math.PI * R);
  // Its footprint on the shell is the flange's width, as the engine defaults it.
  assert.equal(partOf(restated('ring_support.channel', 'M', { support_ring_footprint: 120 }), 'M').status, 'drawn');
  assert.equal(partOf(restated('ring_support.channel', 'M', { support_ring_footprint: 12 }), 'M').scope?.reason, 'mismatch');
  // Half a flange, or a channel with none, is refused.
  assert.equal(partOf(restated('ring_support.tee', 'M', { support_ring_flange_width: undefined as unknown as number }), 'M').scope?.parameter, 'support_ring_flange_width');
  assert.equal(partOf(restated('ring_support.cradle', 'M', { support_ring_channel: 1 }), 'M').scope?.parameter, 'support_ring_flange_width');
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
