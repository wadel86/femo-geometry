import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder, toAssembly } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { kernel, part, shellSide } from './fixtures.ts';

function resolve(definition: AssemblyDefinition, mode: 'display' | 'analysis' = 'display') {
  const model = new AssemblyBuilder(kernel).build(definition);
  for (const p of model.parts) assert.notEqual(p.status, 'failed', `${p.name}: ${p.message}`);
  return { model, resolved: resolveGeometry(definition, model, kernel, { mode }) };
}

const close = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ± ${tolerance}`);

const nozzle = (id: string) =>
  part(id, 'radial_nozzle', { nozzle_inside_diameter: 200, nozzle_thickness: 15, nozzle_outward_projection: 300 }, 0, 'S');

test('two adjacent nozzles: their clear spacing is measured between the necks, and their zones overlap', () => {
  const { resolved } = resolve({
    components: [
      part('S', 'cylindrical_shell', { inside_diameter: 1000, thickness: 20, course_length: 1500 }),
      nozzle('N1'),
      nozzle('N2'),
    ],
    placements: { N1: shellSide(750, 0), N2: shellSide(750, 40) },
    reversed: [],
    layoutRevision: 7,
  });

  // Round the outside surface: the chord between the centres less each neck's outside radius.
  const chord = 2 * 520 * Math.sin((20 * Math.PI) / 180);
  const spacing = resolved.measured.N1.nozzle_spacing;
  close(spacing.value, chord - 2 * 115, 0.01);
  assert.equal(spacing.fillable, true);
  assert.equal(spacing.layoutRevision, 7);
  close(resolved.measured.N2.nozzle_spacing.value, spacing.value, 1e-9);

  const pair = resolved.proximities.find((p) => p.between.includes('S:opening:N1') && p.between.includes('S:opening:N2'))!;
  close(pair.distance, (520 * 40 * Math.PI) / 180 - 2 * 115, 0.01);
  assert.equal(pair.overlap, true, `${pair.distance} against 2.5·2·√(510·20)`);

  // A course butted to an equal one is a seam, not a discontinuity; the courses' ends are not either.
  assert.deepEqual(
    resolved.discontinuities.map((d) => d.kind),
    ['opening', 'opening']
  );
  const opening = resolved.discontinuities[0];
  close(opening.sqrtRt.below, Math.sqrt(510 * 20), 1e-9);
  close(opening.meridional[1] - opening.meridional[0], 230, 1e-6);
});

test('a stated spacing the layout contradicts is an issue, and a refusal under analysis', () => {
  const definition: AssemblyDefinition = {
    components: [
      part('S', 'cylindrical_shell', { inside_diameter: 1000, thickness: 20, course_length: 1500 }),
      { ...nozzle('N1'), dimensions: { ...nozzle('N1').dimensions, nozzle_spacing: 400 } },
      nozzle('N2'),
    ],
    placements: { N1: shellSide(750, 0), N2: shellSide(750, 40) },
    reversed: [],
  };
  const display = resolve(definition).resolved;
  assert.equal(display.issues.length, 1);
  assert.match(display.issues[0].message, /N1: nozzle_spacing is stated as 400 mm but the layout measures 125\.\d+ mm/);
  // Reported, never resolved: the stated value is left as it is.
  assert.equal(definition.components[1].dimensions.nozzle_spacing, 400);

  const analysis = resolve(definition, 'analysis').resolved;
  assert.ok(analysis.refusals.some((r) => r.symbol === 'nozzle_spacing'));
  assert.equal(analysis.ready, false);
});

test('a saddle near a head: a is measured to the tangent line, past the straight flange', () => {
  const head = { inside_diameter: 2000, head_height: 500, thickness: 16, straight_flange_length: 50 };
  const saddle = { saddle_angle: 120, saddle_width: 250, saddle_distance: 600 };
  const { resolved, model } = resolve({
    components: [
      part('H1', 'ellipsoidal_head', head, 0),
      part('S', 'cylindrical_shell', { inside_diameter: 2000, thickness: 16, course_length: 6000 }, 1),
      part('H2', 'ellipsoidal_head', head, 2),
      part('SA1', 'saddle_support', saddle, 0, 'S'),
      part('SA2', 'saddle_support', saddle, 0, 'S'),
    ],
    placements: { SA2: shellSide(6000 - 700, 0) },
    reversed: [],
  });

  // Unplaced, SA1 is drawn a = 600 from the tangent line: 550 along its course.
  assert.equal(model.parts.find((p) => p.componentId === 'SA1')!.placement?.axialOffset, 550);
  close(resolved.measured.SA1.saddle_distance.value, 600, 1e-6);
  // SA2 was placed 700 from the course's end, which is 750 from the tangent line.
  close(resolved.measured.SA2.saddle_distance.value, 750, 1e-6);
  assert.deepEqual(resolved.issues.map((i) => [i.componentId, i.symbol]), [['SA2', 'saddle_distance']]);

  // The tangent line is a discontinuity of its own, 50 up the flange from the head-to-shell weld.
  const kinds = resolved.discontinuities.map((d) => d.kind);
  assert.equal(kinds.filter((k) => k === 'tangent_line').length, 2);
  const tangent = resolved.discontinuities.find((d) => d.id === 'H1:tangent-line')!;
  const weld = resolved.discontinuities.find((d) => d.kind === 'junction' && d.componentIds.includes('H1'));
  // Ellipsoid to cylinder at the flange end is not a discontinuity at all: the flange is a cylinder.
  assert.equal(weld, undefined);
  const saddleZone = resolved.discontinuities.find((d) => d.id === 'S:wall:SA1')!;
  const pair = resolved.proximities.find((p) => p.between.includes(tangent.id) && p.between.includes(saddleZone.id))!;
  close(pair.distance, 600 - 125, 0.5);
});

test('a nozzle in a knuckle sits inside the knuckle-to-crown zone', () => {
  const { resolved } = resolve({
    components: [
      part('S', 'cylindrical_shell', { inside_diameter: 2000, thickness: 20, course_length: 2000 }, 0),
      part('H', 'torispherical_head', {
        inside_diameter: 2000, crown_radius: 2000, knuckle_radius: 200, thickness: 20, straight_flange_length: 40,
      }, 1),
      part('N', 'radial_nozzle', { nozzle_inside_diameter: 100, nozzle_thickness: 10, nozzle_outward_projection: 200 }, 0, 'H'),
    ],
    placements: { N: { anchor: 'head_crown', axialOffset: 750, azimuth: 0 } },
    reversed: [],
  });
  const knuckle = resolved.discontinuities.find((d) => d.kind === 'knuckle')!;
  assert.ok(knuckle, 'the crown-to-knuckle circle is a discontinuity');
  const pair = resolved.proximities.find((p) => p.between.includes(knuckle.id) && p.between.includes('H:opening:N'))!;
  assert.equal(pair.overlap, true, `${pair.distance} mm from the knuckle`);
  // Both on the head: one developed surface, its meridian and round it.
  assert.match(pair.basis, /one part/);
});

test('a skirt welded to the knuckle of the bottom head', () => {
  const { resolved, model } = resolve({
    components: [
      part('H', 'ellipsoidal_head', { inside_diameter: 2000, head_height: 500, thickness: 20, straight_flange_length: 0 }, 0),
      part('S', 'cylindrical_shell', { inside_diameter: 2000, thickness: 20, course_length: 3000 }, 1),
      part('SK', 'skirt_support', { inside_diameter: 1900, thickness: 16, course_length: 2500 }, 0, 'H'),
    ],
    placements: {},
    reversed: [],
  });
  const skirt = model.parts.find((p) => p.componentId === 'SK')!;
  assert.equal(skirt.status, 'drawn', skirt.message);
  assert.ok(kernel.isValid(skirt.solids[0]));
  // Placed by its own diameter: its mid-wall meets the head's outside.
  close(skirt.placement!.axialOffset, 958, 1e-9);
  // Built in the head's frame, which is turned over: the skirt runs downwards in the assembly's.
  const local = kernel.bounds(skirt.solids[0]);
  const [top, foot] = [toAssembly(local.min, skirt.transform)[2], toAssembly(local.max, skirt.transform)[2]];
  assert.ok(foot < -2500 && foot > -2700, `skirt foot at ${foot}`);
  assert.ok(top < 0 && top > -300, `skirt top at ${top}, below the tangent line and on the knuckle`);

  const attachment = resolved.discontinuities.find((d) => d.id === 'H:wall:SK')!;
  assert.equal(attachment.circumferential, null, 'a skirt goes all round');
  const junction = resolved.discontinuities.find((d) => d.kind === 'junction')!;
  const pair = resolved.proximities.find((p) => p.between.includes(attachment.id) && p.between.includes(junction.id))!;
  assert.equal(pair.overlap, true, `skirt weld ${pair.distance} mm from the head-to-shell junction`);
  assert.deepEqual(
    resolved.joints.filter((j) => j.sourceRule === 'host').map((j) => j.id),
    ['H:wall:SK~SK:attach']
  );
});

test("a lug's distance to a discontinuity is an upper bound: reported, never a fill", () => {
  const lug = (stated: number | undefined) =>
    resolve({
      components: [
        part('H', 'hemispherical_head', { inside_diameter: 2000, thickness: 20, straight_flange_length: 0 }, 0),
        part('S', 'cylindrical_shell', { inside_diameter: 2000, thickness: 20, course_length: 4000 }, 1),
        part('L', 'lug_support', {
          support_lug_height: 300, support_lug_projection: 200, support_lug_gusset_spacing: 150,
          support_lug_gusset_thickness: 15, support_lug_base_plate_thickness: 20,
          ...(stated === undefined ? {} : { support_to_discontinuity: stated }),
        }, 0, 'S'),
      ],
      placements: { L: shellSide(1000, 90) },
      reversed: [],
    }).resolved;

  const measured = lug(undefined).measured.L.support_to_discontinuity;
  assert.equal(measured.fillable, false);
  assert.match(measured.basis, /longitudinal \(Category A\) seams are not modelled, so this is an upper bound/);
  // The lug spans 320 mm, centred 1000 above the junction with the head.
  close(measured.value, 1000 - 160, 0.5);
  // Nearer than the geometry is a weld seam the assembly does not have: no contradiction.
  assert.deepEqual(lug(500).issues, []);
  // Further than the geometry allows is.
  assert.equal(lug(1200).issues.length, 1);
});

test('a circumferential seam between two equal courses is no discontinuity, but a lug measures to it', () => {
  const course = { inside_diameter: 2000, thickness: 20, course_length: 2000 };
  const { resolved } = resolve({
    components: [
      part('S1', 'cylindrical_shell', course, 0),
      part('S2', 'cylindrical_shell', course, 1),
      part('L', 'lug_support', {
        support_lug_height: 300, support_lug_projection: 200, support_lug_gusset_spacing: 150,
        support_lug_gusset_thickness: 15, support_lug_base_plate_thickness: 20,
      }, 0, 'S1'),
    ],
    placements: { L: shellSide(1800, 0) },
    reversed: [],
  });
  const seam = resolved.discontinuities.find((d) => d.kind === 'weld_seam')!;
  assert.equal(seam.category, 'B');
  assert.equal(resolved.discontinuities.filter((d) => d.kind === 'junction').length, 0);
  // A seam takes part in no overlap: it disturbs no membrane solution.
  assert.ok(resolved.proximities.every((p) => !p.between.includes(seam.id)));
  // The lug's 320 mm span, centred 1800 up the 2000 mm course, ends 40 short of the seam.
  close(resolved.measured.L.support_to_discontinuity.value, 40, 0.5);
});
