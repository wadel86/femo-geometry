// The parts drawn after the first increment, on the dimensions of the reference assemblies the
// design-by-rule engine is verified against (simulation-platform/_scripts/reference_assemblies.py).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder, assemblyBounds, tessellationTolerance } from '../src/assembly/buildAssembly.ts';
import { tessellateModel } from '../src/assembly/tessellateModel.ts';
import type { AssemblyDefinition, ComponentDefinition, Placement } from '../src/definition.ts';
import { kernel } from './fixtures.ts';

let position = 0;
const part = (
  name: string,
  kind: string,
  dimensions: Record<string, number>,
  hostId: string | null = null
): ComponentDefinition => ({ id: name, name, kind, position: ++position, hostId, dimensions });

const at = (axialOffset: number, azimuth: number): Placement => ({ anchor: 'shell_side', axialOffset, azimuth });

/** Builds, tessellates and names everything, and says what did not come out drawn. */
function build(definition: AssemblyDefinition) {
  const started = performance.now();
  const model = new AssemblyBuilder(kernel).build(definition);
  const bounds = assemblyBounds(model, kernel);
  const tolerance = tessellationTolerance(bounds);
  const meshes = tessellateModel(model, kernel, tolerance, Math.max(0.05, tolerance * 5));
  const elapsed = performance.now() - started;
  const problems = meshes.flatMap((m) => [
    ...(m.status === 'drawn' ? [] : [`${m.name}: ${m.status} — ${m.message}`]),
    ...m.errors,
  ]);
  return { model, meshes, elapsed, problems };
}

const partNamed = (result: ReturnType<typeof build>, name: string) =>
  result.meshes.find((m) => m.componentId === name)!;

test('lot 1 — the four nozzle geometries of the reference column cut real openings', () => {
  const nozzle = { nozzle_inside_diameter: 200, nozzle_thickness: 12, nozzle_outward_projection: 250 };
  const coneNozzle = { nozzle_inside_diameter: 150, nozzle_thickness: 12, nozzle_outward_projection: 200 };
  const result = build({
    components: [
      part('S1', 'cylindrical_shell', { inside_diameter: 1500, thickness: 22, course_length: 3000 }),
      part('C1', 'conical_shell', { inside_diameter: 1500, small_end_diameter: 900, half_apex_angle: 30, thickness: 26, course_length: 520 }),
      part('N1', 'radial_nozzle', nozzle, 'S1'),
      part('N2', 'hillside_nozzle', { ...nozzle, nozzle_offset: 400 }, 'S1'),
      part('N7', 'angled_nozzle', { ...nozzle, nozzle_angle: 60 }, 'S1'),
      part('N3', 'radial_nozzle', coneNozzle, 'C1'),
      part('N4', 'perpendicular_nozzle', coneNozzle, 'C1'),
      part('N5', 'axial_nozzle', coneNozzle, 'C1'),
    ],
    placements: {
      N1: at(600, 0),
      N2: at(1500, 90),
      N7: at(2400, 180),
      N3: at(260, 0),
      N4: at(260, 120),
      N5: at(260, 240),
    },
    reversed: [],
  });
  assert.deepEqual(result.problems, []);

  for (const [host, nozzles] of [['S1', ['N1', 'N2', 'N7']], ['C1', ['N3', 'N4', 'N5']]] as const) {
    const refs = partNamed(result, host).solids.flatMap((s) => s.edges.map((e) => e.descriptor.ref));
    for (const id of nozzles) {
      assert.ok(refs.includes(`${host}/opening/${id}/outside`), `${id}'s opening on ${host}`);
      assert.ok(refs.includes(`${host}/opening/${id}/inside`), `${id}'s opening on ${host}, inside`);
    }
  }
  console.log(`lot 1: ${result.elapsed.toFixed(0)} ms`);
});

test('lot 1 — a radial nozzle in a sphere stands normal to it, off the pole', () => {
  const result = build({
    components: [
      part('S4', 'spherical_shell', { inside_diameter: 1200, thickness: 20 }),
      part('N6', 'radial_nozzle', { nozzle_inside_diameter: 200, nozzle_thickness: 12, nozzle_outward_projection: 250 }, 'S4'),
    ],
    placements: { N6: { anchor: 'head_crown', axialOffset: 300, azimuth: 45 } },
    reversed: [],
  });
  assert.deepEqual(result.problems, []);
  const refs = partNamed(result, 'S4').solids.flatMap((s) => s.edges.map((e) => e.descriptor.ref));
  assert.ok(refs.includes('S4/opening/N6/outside') && refs.includes('S4/opening/N6/inside'));
});

test('a default position a part does not fit at is retried mid-host; a stated one fails', () => {
  const cone = { inside_diameter: 1500, small_end_diameter: 900, half_apex_angle: 30, thickness: 26, course_length: 520 };
  const axial = { nozzle_inside_diameter: 150, nozzle_thickness: 12 };
  // Its opening runs 301 mm along the cone: unplaced, the spread would put it off the end.
  const components = [
    part('C', 'conical_shell', cone),
    part('A1', 'axial_nozzle', axial, 'C'),
    part('A2', 'axial_nozzle', axial, 'C'),
  ];
  const unplaced = build({ components, placements: {}, reversed: [] });
  assert.equal(partNamed(unplaced, 'A2').status, 'drawn', partNamed(unplaced, 'A2').message);

  const stated = build({ components, placements: { A2: at(100, 0) }, reversed: [] });
  assert.equal(partNamed(stated, 'A2').status, 'failed');
});

test('lot 1 — a hillside nozzle offset past the inside of its shell fails naming it', () => {
  const result = build({
    components: [
      part('S', 'cylindrical_shell', { inside_diameter: 1500, thickness: 22, course_length: 3000 }),
      part('N', 'hillside_nozzle', { nozzle_inside_diameter: 200, nozzle_thickness: 12, nozzle_offset: 700 }, 'S'),
    ],
    placements: { N: at(1500, 0) },
    reversed: [],
  });
  assert.equal(partNamed(result, 'N').status, 'failed');
  assert.match(partNamed(result, 'N').message!, /^N: offset 700 mm from the axis/);
});

test('lot 2 — saddles, skirt, lug and bulkhead ring', () => {
  const saddle = { saddle_angle: 120, saddle_distance: 900, support_span: 8000, head_depth: 500, saddle_load: 250000, saddle_width: 250 };
  const drum = build({
    components: [
      part('H8', 'ellipsoidal_head', { inside_diameter: 2000, head_height: 500, thickness: 16 }),
      part('S8', 'cylindrical_shell', { inside_diameter: 2000, thickness: 16, course_length: 8000 }),
      part('H9', 'ellipsoidal_head', { inside_diameter: 2000, head_height: 500, thickness: 16 }),
      part('SA1', 'saddle_support', saddle, 'S8'),
      part('SA2', 'saddle_support', { ...saddle, wear_plate_thickness: 30 }, 'S8'),
    ],
    placements: {},
    reversed: [],
  });
  assert.deepEqual(drum.problems, []);
  // Unplaced, the two saddles stand a = 900 from either end, at the bottom.
  const sa1 = drum.model.parts.find((p) => p.componentId === 'SA1')!;
  const sa2 = drum.model.parts.find((p) => p.componentId === 'SA2')!;
  assert.deepEqual([sa1.placement?.axialOffset, sa2.placement?.axialOffset], [900, 7100]);
  assert.equal(sa2.solids.length, 2, 'the saddle and its wear plate');

  const column = build({
    components: [
      part('S1', 'cylindrical_shell', { inside_diameter: 1500, thickness: 22, course_length: 3000 }),
      part('SK1', 'skirt_support', { inside_diameter: 1500, thickness: 20, course_length: 3000 }, 'S1'),
      part('LG1', 'lug_support', { support_to_discontinuity: 700 }, 'S1'),
      part('R2', 'large_stiffening_ring', { ring_height: 150, ring_thickness: 20, large_ring_spacing: 3000 }, 'S1'),
    ],
    placements: {},
    reversed: [],
  });
  assert.deepEqual(column.problems, []);
  const skirt = column.model.parts.find((p) => p.componentId === 'SK1')!;
  assert.ok(Math.abs(kernel.bounds(skirt.solids[0]).min[2] + 3000) < 1, 'the skirt hangs 3000 below the course');
  console.log(`lot 2: drum ${drum.elapsed.toFixed(0)} ms, column ${column.elapsed.toFixed(0)} ms`);
});

test('lot 3 — dished covers, quick-actuating closure and stayed plate', () => {
  const cover = {
    crown_radius: 1500, thickness: 40, flange_bore: 400, flange_outside_diameter: 580,
    flange_ring_thickness: 70, bolt_circle: 520,
  };
  const covers = build({
    components: [
      part('S7', 'cylindrical_shell', { inside_diameter: 1500, thickness: 20, course_length: 2000 }),
      part('C1', 'spherically_dished_cover', { crown_radius: 1500, thickness: 40 }),
      part('C2', 'dished_cover_type_b', { ...cover, bolt_count: 16 }),
      part('C3', 'dished_cover_type_c', cover),
    ],
    placements: {},
    reversed: [],
  });
  assert.deepEqual(covers.problems, []);
  assert.equal(partNamed(covers, 'C2').solids.length, 2, 'ring and dish');
  assert.match(partNamed(covers, 'C3').notes.join(' '), /bolt holes are not drawn/);

  const plates = build({
    components: [
      part('S6', 'cylindrical_shell', { inside_diameter: 800, thickness: 20, course_length: 2000 }),
      part('QC1', 'quick_actuating_closure', { inside_diameter: 800, thickness: 40 }),
      part('ST1', 'stayed_surface', { inside_diameter: 800, thickness: 16, stay_pitch: 150, stay_diameter: 25 }),
    ],
    placements: {},
    reversed: [],
  });
  assert.deepEqual(plates.problems, []);
  const stayed = partNamed(plates, 'ST1');
  assert.equal(stayed.solids.length, 2, 'the plate and one stay');
  assert.ok((stayed.solids[1].copies?.length ?? 0) > 20, 'the stay repeated over the array');
  console.log(`lot 3: covers ${covers.elapsed.toFixed(0)} ms, plates ${plates.elapsed.toFixed(0)} ms`);
});

test('obround vessels, and the stay plates that divide a vessel into chambers', () => {
  const obround = { obround_radius: 400, obround_flat_half_length: 300, curved_thickness: 32, flat_thickness: 32, course_length: 2000 };
  const result = build({
    components: [
      part('O1', 'obround_vessel', obround),
      part('O4', 'obround_vessel', { ...obround, flat_thickness: 40 }),
      part('O3', 'obround_vessel', { ...obround, stay_planes: 1, stay_plate_thickness: 20 }),
      part('B3', 'rectangular_vessel', { short_side: 600, long_side: 900, short_side_thickness: 40, long_side_thickness: 40, stay_planes: 2, stay_plate_thickness: 20 }),
      part('V1', 'cylindrical_shell', { inside_diameter: 800, thickness: 32, course_length: 2000, stay_plate_thickness: 20 }),
    ],
    placements: {},
    reversed: [],
  });
  assert.deepEqual(result.problems, []);

  // Two half-annuli and two flat plates, 2000 long.
  const o1 = result.model.parts.find((p) => p.componentId === 'O1')!;
  const section = Math.PI * (432 ** 2 - 400 ** 2) + 2 * 600 * 32;
  assert.ok(Math.abs(kernel.volume(o1.solids[0]) - section * 2000) / (section * 2000) < 1e-6);

  assert.equal(partNamed(result, 'O3').solids.length, 2, 'the obround and its stay plate');
  assert.equal(partNamed(result, 'B3').solids.length, 3, 'the box and its two stay plates');
  assert.equal(partNamed(result, 'V1').solids.length, 2, 'the course and its dividing plate');
});

test('lot 4 — rectangular vessel and half-pipe jacket', () => {
  const result = build({
    components: [
      part('B1', 'rectangular_vessel', { short_side: 600, long_side: 900, short_side_thickness: 40, long_side_thickness: 40, course_length: 2000 }),
      part('S6', 'cylindrical_shell', { inside_diameter: 800, thickness: 20, course_length: 2000 }),
      part('J1', 'half_pipe_jacket', { thickness: 6, half_pipe_inside_radius: 26.24, jacket_pressure: 0.7 }, 'S6'),
    ],
    placements: {},
    reversed: [],
  });
  assert.deepEqual(result.problems, []);
  const box = result.model.parts.find((p) => p.componentId === 'B1')!;
  const volume = kernel.volume(box.solids[0]);
  assert.ok(Math.abs(volume - (980 * 680 - 900 * 600) * 2000) < 1, `box volume ${volume}`);
  const jacket = partNamed(result, 'J1');
  assert.equal(jacket.solids.length, 1, 'one turn, built once');
  assert.ok((jacket.solids[0].copies?.length ?? 0) >= 10, 'repeated up the course');
  console.log(`lot 4: ${result.elapsed.toFixed(0)} ms`);
});
