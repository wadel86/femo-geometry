// EN 13445-3's parts that Part 4 does not size: the numbers their drawings must hold to, and the
// refusals they owe. Their specimens are draft entries, held by draftEntries.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { RUN_BUILDERS } from '../src/builders/runParts.ts';
import { DECLARATIONS, DRAFT_ENTRIES } from '../src/catalogue/draftEntries.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { kernel, part } from './fixtures.ts';

const close = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);

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
const volumeOf = (definition: AssemblyDefinition, id: string) => partOf(definition, id).solids.reduce((sum, s) => sum + kernel.volume(s), 0);

test('10.4.3: a knuckled flat end is a straight flange, a quarter torus and a disc — Pappus to the cubic millimetre', () => {
  const [a, t, r, sf] = [750, 30, 60, 50];
  const head = RUN_BUILDERS.flat_head(
    part('F', 'flat_head', { inside_diameter: 2 * a, thickness: t, knuckle_radius: r, straight_flange_length: sf }),
    { kernel, neighbourOutsideRadius: a + t }
  );
  close(head.height, sf + r + t, 1e-9);
  const xc = a - r;
  const R = r + t;
  const quarter = (Math.PI / 4) * (R * R - r * r);
  const centroid = ((4 / (3 * Math.PI)) * (R ** 3 - r ** 3)) / (R * R - r * r);
  const expected = Math.PI * ((a + t) ** 2 - a * a) * sf + 2 * Math.PI * (xc + centroid) * quarter + Math.PI * xc * xc * t;
  close(kernel.volume(head.solid), expected, 1e-6 * expected);
  assert.equal(head.landmarks.find((l) => l.key === 'knuckle-flat-inside')?.diameter, 2 * xc);
});

test('10.4.2.2 a): a knuckle under 1.3·e or under the shell\'s wall is refused', () => {
  const small = partOf(restated('flat_head.knuckled_rim', 'F', { knuckle_radius: 35 }), 'F');
  assert.equal(small.status, 'failed');
  assert.match(small.scope!.limit, /1\.3·e = 39 mm/);
  // A 50 mm shell under a 30 mm plate: r = 45 clears 1.3·e and not e_s.
  const thin = restated('flat_head.knuckled_rim', 'F', { knuckle_radius: 45 });
  const thick = {
    ...thin,
    components: thin.components.map((c) => (c.id === 'S' ? { ...c, dimensions: { ...c.dimensions, thickness: 50 } } : c)),
  };
  assert.match(partOf(thick, 'F').scope!.limit, /e_s = 50 mm/);
});

test('21: n_V ribs and a ring on the outer face, each rib its outline times e_R', () => {
  const model = partOf(specimen('flat_head.radial_stiffeners'), 'F');
  assert.equal(model.status, 'drawn');
  // The plate, the ring, eight ribs.
  assert.equal(model.solids.length, 10);
  const [t, h, eR, core, rim] = [40, 200, 20, 150, 800];
  const chamfer = 0.6 * h;
  const outline = (rim - core) * h - (chamfer * chamfer) / 2;
  for (const rib of model.solids.slice(2)) close(kernel.volume(rib), eR * outline, 2e-3 * eR * outline);
  const bounds = kernel.bounds(model.solids[2]);
  close(bounds.max[2] - bounds.min[2], h, 1e-6);
  // Welded where the shell meets it, the overhang notwithstanding.
  assert.equal(model.junctions?.lower?.outsideDiameter, 1532);
  close(kernel.bounds(model.solids[0]).max[0], 800, 1e-6);
  // The ribs stand on the plate's outer face.
  close(bounds.min[2], t, 1e-6);
});

test('21.1: fewer than 3 or more than 24 ribs, and ribs that overlap round the ring, are refused', () => {
  for (const count of [2, 25, 7.5]) {
    const refused = partOf(restated('flat_head.radial_stiffeners', 'F', { radial_stiffener_count: count }), 'F');
    assert.equal(refused.status, 'failed');
    assert.equal(refused.scope?.parameter, 'radial_stiffener_count');
  }
  const crowded = partOf(restated('flat_head.radial_stiffeners', 'F', { radial_stiffener_count: 24, radial_stiffener_thickness: 40 }), 'F');
  assert.equal(crowded.scope?.parameter, 'radial_stiffener_thickness');
});

test('a flat end states one variant: a knuckled rim with ribs is refused rather than half drawn', () => {
  const both = partOf(restated('flat_head.radial_stiffeners', 'F', { knuckle_radius: 60 }), 'F');
  assert.equal(both.status, 'failed');
  assert.match(both.message ?? '', /different flat ends/);
});

test('10.7.3: an annular end meets the course in its bore on that course\'s own wall, and refuses a bore as wide as itself', () => {
  const model = build(specimen('flat_head.annular'));
  const plate = model.parts.find((p) => p.componentId === 'F')!;
  assert.deepEqual(plate.junctions?.upper && [plate.junctions.upper.insideDiameter, plate.junctions.upper.outsideDiameter], [800, 824]);
  const t = 40;
  close(kernel.volume(plate.solids[0]), Math.PI * (766 ** 2 - 400 ** 2) * t, 1e-6 * Math.PI * 766 ** 2 * t);
  const wide = partOf(restated('flat_head.annular', 'F', { annulus_inside_diameter: 1500 }), 'F');
  assert.equal(wide.scope?.parameter, 'annulus_inside_diameter');
});

test('10.7.2: the non-circular flat ends are declared, not silently missing', () => {
  assert.ok(DECLARATIONS.some((d) => d.article === 'EN 13445-3 §10.7.2'));
});

test('16.12.5: the base plate lies past the skirt\'s free end, drilled for n_B bolts', () => {
  const skirt = partOf(specimen('skirt_support.base_plate'), 'M');
  assert.equal(skirt.status, 'drawn');
  const [tube, plate] = skirt.solids;
  // In the head's frame the skirt runs up, away from the vessel.
  close(kernel.bounds(plate).min[2], kernel.bounds(tube).max[2], 1e-6);
  const [inner, outer, e4, bolts, dB] = [877 - 160, 877, 25, 12, 30];
  close(kernel.volume(plate), (Math.PI * (outer ** 2 - inner ** 2) - bolts * Math.PI * (dB / 2) ** 2) * e4, 1e-6 * Math.PI * outer ** 2 * e4);
});

test('16.12.5: Version A puts one plate between bolts, Version B two at each, Type 3 a chair at each', () => {
  const count = (id: string, dimensions: Record<string, number> = {}) => partOf(restated(id, 'M', dimensions), 'M').solids.length;
  // Skirt and base plate, then the plates.
  assert.equal(count('skirt_support.base_gussets'), 2 + 12);
  assert.equal(count('skirt_support.base_gussets', { base_gusset_spacing: 100 }), 2 + 24);
  assert.equal(count('skirt_support.base_chairs'), 2 + 16 + 8);
  assert.equal(count('skirt_support.base_top_ring'), 2 + 24 + 1);
});

test('16.12.5: a plate that does not reach under the skirt, and bolts off the plate, are refused', () => {
  const short = partOf(restated('skirt_support.base_plate', 'M', { base_plate_width: 100 }), 'M');
  assert.equal(short.scope?.parameter, 'base_plate_width');
  const off = partOf(restated('skirt_support.base_plate', 'M', { anchor_bolt_offset: 110 }), 'M');
  assert.equal(off.scope?.parameter, 'anchor_bolt_offset');
  const crowded = partOf(restated('skirt_support.base_chairs', 'M', { top_plate_length: 110 }), 'M');
  assert.equal(crowded.scope?.parameter, 'top_plate_length');
});

test('16.12.3 Geometry A: the skirt hangs under its ring, clear of the shell; one too narrow to clear it is refused', () => {
  const skirt = partOf(specimen('skirt_support.ring_hung'), 'M');
  const [tube, ring] = skirt.solids;
  close(kernel.bounds(tube).max[2], 500 - 150, 1e-6);
  // From the shell's outside, 766, to the skirt's, 812, over the ring's 150.
  close(kernel.volume(ring), Math.PI * (812 ** 2 - 766 ** 2) * 150, 1);
  const tight = partOf(restated('skirt_support.ring_hung', 'M', { inside_diameter: 1520 }), 'M');
  assert.equal(tight.scope?.parameter, 'inside_diameter');
});

test('16.12.3 Geometry C: a course skirt on the course\'s outside says it is lapped', () => {
  const skirt = partOf(specimen('skirt_support.lapped'), 'M');
  assert.ok(skirt.notes.some((n) => n.message.includes('Geometry C')));
  const square = partOf(restated('skirt_support.lapped', 'M', { inside_diameter: 1600 }), 'M');
  assert.ok(!square.notes.some((n) => n.message.includes('Geometry C')));
});

test('16.12.4: two openings take two holes out of the skirt; a third, or one off its end, is refused', () => {
  const opened = volumeOf(specimen('skirt_support.access_openings'), 'M');
  const plain = volumeOf(restated('skirt_support.access_openings', 'M', { skirt_opening_diameter: 0 }), 'M');
  // Two radial holes of 500 through the wall from 745 to 757: off the hole's axis by y the wall is
  // √(757² − y²) − √(745² − y²) thick, more than 12, over a chord 2·√(250² − y²) of the hole.
  const [r, ri, ro, steps] = [250, 745, 757, 20000];
  let hole = 0;
  for (let i = 0; i < steps; i++) {
    const y = -r + ((i + 0.5) * 2 * r) / steps;
    hole += (Math.sqrt(ro * ro - y * y) - Math.sqrt(ri * ri - y * y)) * 2 * Math.sqrt(r * r - y * y) * ((2 * r) / steps);
  }
  // The integral converges to 4 780 550.1 mm³; the kernel's volume of two cylinder-cylinder cuts,
  // bounded by approximated intersection curves, comes 2.0e-4 under it.
  close(plain - opened, 2 * hole, 1e-3 * 2 * hole);
  assert.equal(partOf(restated('skirt_support.access_openings', 'M', { skirt_opening_count: 3 }), 'M').scope?.parameter, 'skirt_opening_count');
  assert.equal(partOf(restated('skirt_support.access_openings', 'M', { skirt_opening_elevation: 900 }), 'M').scope?.parameter, 'skirt_opening_elevation');
});

test('16.13: an integral box stands on n_s posts; an independent U stands t_0 off the shell on its bearing ring', () => {
  const integral = partOf(specimen('ring_support.integral'), 'M');
  assert.equal(integral.solids.length, 1 + 4);
  const [ring] = integral.solids;
  const [b, h, e] = [200, 250, 16];
  close(kernel.volume(ring), Math.PI * ((766 + b) ** 2 - 766 ** 2) * h - Math.PI * ((766 + b - e) ** 2 - (766 + e) ** 2) * (h - 2 * e), 1);

  const independent = partOf(specimen('ring_support.independent'), 'M');
  assert.equal(independent.solids.length, 1 + 1 + 8);
  // The loose ring touches nothing of the shell: its bore is t_0 off it.
  const loose = independent.solids[0];
  const shell = kernel.tube({ origin: [0, 0, 0], axis: [0, 0, 1] }, 0, 766 + 3, 0, 2000);
  assert.ok(kernel.volume(kernel.intersect(loose, shell)) < 1e-6);
});

test('16.13.4: five supports, a loose solid ring and plate too thick for b/e > 5 are refused', () => {
  assert.equal(partOf(restated('ring_support.integral', 'M', { ring_support_count: 5 }), 'M').scope?.parameter, 'ring_support_count');
  assert.equal(
    partOf(restated('ring_support.independent', 'M', { ring_support_section: 0 }), 'M').scope?.parameter,
    'ring_support_section'
  );
  assert.equal(
    partOf(restated('ring_support.integral', 'M', { ring_support_plate_thickness: 45 }), 'M').scope?.parameter,
    'ring_support_plate_thickness'
  );
});
