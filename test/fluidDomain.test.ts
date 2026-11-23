// The fluid domain of a chamber, derived from the drawn parts: E-101 (TRESCA THERMAL's Shah &
// Sekulić Example 9.4 instance), a second exchanger nothing in the code was written for, and a
// plain vessel with no internals at all.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import type { AssemblyDefinition, ComponentDefinition } from '../src/definition.ts';
import { FluidDomainError, fluidDomain, fluidManifest, fluidStep, type FluidDomain } from '../src/fluid/fluidDomain.ts';
import { kernel, part } from './fixtures.ts';

const close = (actual: number, expected: number, relative = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= relative * Math.abs(expected), `${actual} is not ${expected} ± ${relative * 100} %`);

const E101: AssemblyDefinition = JSON.parse(readFileSync(new URL('./fixtures/e101-assembly.json', import.meta.url), 'utf8'));
const domainOf = (definition: AssemblyDefinition, chamber: string, extension?: number) =>
  fluidDomain(definition, new AssemblyBuilder(kernel).build(definition), kernel, { chamber, ...(extension !== undefined ? { extension } : {}) });

/** E-101 with the book's own end spaces, 154.8 mm, and N1 centred over the first: the nozzle does not fit. */
function asPrinted(): AssemblyDefinition {
  const change = (id: string, dimensions: Record<string, number>) => (c: ComponentDefinition) => (c.id === id ? { ...c, dimensions: { ...c.dimensions, ...dimensions } } : c);
  return {
    ...E101,
    components: E101.components.map(change('F', { baffle_inlet_spacing: 154.8, baffle_outlet_spacing: 154.8 })),
    placements: { ...E101.placements, N1: { ...E101.placements.N1!, axialOffset: 77.4 } },
  };
}

const SHELL = 2567.501;
const area = (domain: FluidDomain, name: string) => domain.boundaries.find((b) => b.name === name)?.area;

test('with the book\'s 154.8 mm end spaces E-101 has no domain: the chamber is asked for by a nozzle the kernel refuses', () => {
  assert.throws(
    () => domainOf(asPrinted(), 'N1'),
    (error: unknown) => error instanceof FluidDomainError && error.parameter === 'chamber' && /Shell inlet: 219\.1 mm wide at 77\.4 mm runs past Shell/.test(error.message)
  );
});

let e101: FluidDomain;
test('fitted, its shell side is the bundle, its lane, the bypass annulus and the two nozzle bores', () => {
  // N1's edge lands on the tubesheet face to the last bit of a double: tangent, and drawn.
  e101 = domainOf(E101, 'N1', 200);
  const zones = Object.fromEntries(e101.zones.map((z) => [z.name, z]));
  assert.deepEqual(Object.keys(zones).sort(), ['zone:bundle', 'zone:bypass', 'zone:fluid', 'zone:lane:1']);
  // The envelope is D_otl = 2·176.75 + 19 = 372.5 between the tubesheet faces, the bypass the rest of the 387 bore.
  close(zones['zone:bundle']!.volume + zones['zone:lane:1']!.volume, Math.PI * 186.25 ** 2 * SHELL);
  // A thin annulus: the booleans' tolerance shows at a few parts in a million.
  close(zones['zone:bypass']!.volume, Math.PI * (193.5 ** 2 - 186.25 ** 2) * SHELL, 1e-5);
  assert.equal(zones['zone:bundle']!.type, 'porous');
  assert.deepEqual(zones['zone:bundle']!.axis, [0, 0, 1]);
  assert.equal(zones['zone:bypass']!.type, 'fluid');
  // A lane holds no tubes: clear fluid, in a zone of its own.
  assert.equal(zones['zone:lane:1']!.type, 'fluid');
  close(e101.zones.reduce((s, z) => s + z.volume, 0), e101.volume);
});

test('its boundaries: the two capped openings, one wall group per part, one face per baffle', () => {
  const groups = e101.boundaries.map((b) => b.name);
  for (const name of ['opening:N1', 'opening:N2', 'wall:S', 'wall:T1', 'wall:T2', 'wall:N1', 'wall:N1:extension']) assert.ok(groups.includes(name), `${name} among ${groups.join(', ')}`);
  assert.ok(!groups.includes('wall:unassigned'), 'every face of the domain is some wall\'s');
  close(area(e101, 'opening:N1')!, Math.PI * 101.37 ** 2, 1e-4);
  const baffles = e101.boundaries.filter((b) => b.type === 'baffle');
  assert.equal(baffles.length, 14);
  // The bore of 387 cut 96.75 deep: the plate side of the chord, clearances not drawn.
  const r = 193.5;
  const c = r - 96.75;
  const plate = Math.PI * r * r - (r * r * Math.acos(c / r) - c * Math.sqrt(r * r - c * c));
  for (const b of baffles) close(b.area, plate, 1e-5);
  assert.ok(e101.boundaries.some((b) => b.type === 'interface' && b.name === 'interface:bundle~bypass'));
});

test('its leakage areas match the rating book form for book form, on the design\'s 147 tubes', () => {
  const leak = e101.leakage!;
  assert.deepEqual(leak.tubes, { drawn: 140, stated: 147, difference: (140 - 147) / 147 });
  assert.equal(leak.parallelLanes, 0, 'the lane runs across the crossflow');
  // TRESCA THERMAL's ShellSideGeometry for E-101, m²: A_o,tb 0.002892, A_o,sb 0.001194, A_o,bp 0.002245.
  close(leak.baffles[0]!.book.tubeToBaffle, 2892, 0.01);
  close(leak.baffles[0]!.book.shellToBaffle, 1194, 0.01);
  close(leak.spaces.find((s) => s.name === 'central:1')!.book, 2245, 0.01);
  // Drawn: 140 holes and window tubes between them, the exact annulus per hole.
  const drawn = leak.baffles[0]!.drawn;
  assert.equal(drawn.holes + drawn.windowTubes, 140);
  close(drawn.tubeToBaffle, drawn.holes * (Math.PI / 4) * ((19 + 0.794) ** 2 - 19 ** 2));
});

test('its manifest carries every group by name, and its STEP every zone, baffle and opening as a product', () => {
  const manifest = fluidManifest(e101, kernel);
  assert.equal(manifest.chamber, 'N1');
  assert.ok(manifest.boundaries.every((b) => !('sheet' in b)), 'no shape in the manifest');
  // Every zone solid and every baffle carries its box, so a reader pairing STEP products by
  // position can check each pair by place as well as by size.
  for (const z of manifest.zones) {
    assert.ok(z.solids.length > 0, `${z.name} has solids`);
    close(z.solids.reduce((s, x) => s + x.volume, 0), z.volume);
    for (const s of z.solids) assert.ok([0, 1, 2].every((i) => s.bounds.min[i]! <= s.bounds.max[i]!), `${z.name} solid has a box`);
  }
  const lane = manifest.zones.find((z) => z.name === 'zone:lane:1')!;
  close(lane.solids[0]!.bounds.max[0]! - lane.solids[0]!.bounds.min[0]!, 16 + 2 * 0.177669529663703, 1e-6);
  for (const b of manifest.boundaries.filter((b) => b.type === 'baffle')) {
    assert.ok(b.bounds, `${b.name} carries its box`);
    assert.ok(b.bounds.max[2]! - b.bounds.min[2]! < 1e-6, `${b.name} is flat, square to the axis`);
  }
  const zs = manifest.boundaries.filter((b) => b.type === 'baffle').map((b) => b.bounds!.min[2]!);
  assert.deepEqual(zs, [...zs].sort((a, b) => a - b), 'baffles in order along the shell');
  // N1's end ring on the shell's inside surface is its own face, and the manifest says it lies on
  // the shell's cylinder: parallel axis, on the same line, the same radius.
  const shell = manifest.boundaries.find((b) => b.name === 'wall:S')!.faces!.find((f) => f.surface === 'cylinder')!;
  const ring = manifest.boundaries.find((b) => b.name === 'wall:N1')!.faces!.find((f) => f.surface === 'cylinder' && Math.abs(f.radius! - 193.5) < 1e-6);
  assert.ok(ring, 'wall:N1 has a face on the shell bore');
  close(shell.radius!, 193.5);
  assert.deepEqual(ring.axis!.direction.map((x) => Math.round(x * 1e9) / 1e9), shell.axis!.direction.map((x) => Math.round(x * 1e9) / 1e9));
  assert.ok(Math.hypot(ring.axis!.origin[0], ring.axis!.origin[1]) < 1e-6, 'the ring\'s axis is the vessel axis');
  const step = fluidStep(e101, kernel);
  for (const name of ['zone:bundle', 'zone:bypass', 'zone:lane:1', 'zone:fluid', 'baffle:1', 'baffle:14', 'opening:N1', 'opening:N2']) {
    assert.ok(step.includes(`PRODUCT('${name}'`), `${name} is a product of the STEP`);
  }
});

test('a second exchanger goes through unchanged: four passes, a vertical cut, one lane along the crossflow', () => {
  const sheet = {
    thickness: 50, flange_outside_diameter: 760, tube_pitch: 25.4, tube_outside_diameter: 19.05, tube_thickness: 1.65, tube_limit_radius: 270,
    tube_layout_angle: 30, shell_inside_diameter: 600, shell_thickness: 10, channel_inside_diameter: 600, channel_thickness: 10,
  };
  const head = { inside_diameter: 600, head_height: 150, thickness: 10, straight_flange_length: 25 };
  const course = (length: number) => ({ inside_diameter: 600, thickness: 10, course_length: length });
  const nozzle = { nozzle_inside_diameter: 154, nozzle_thickness: 7.1, nozzle_outward_projection: 200 };
  const definition: AssemblyDefinition = {
    components: [
      part('HF', 'ellipsoidal_head', head, 0),
      part('CH1', 'cylindrical_shell', course(400), 1),
      part('T1', 'fixed_tubesheet', sheet, 2),
      part('S', 'cylindrical_shell', course(3000), 3),
      part('T2', 'fixed_tubesheet', sheet, 4),
      part('CH2', 'cylindrical_shell', course(400), 5),
      part('HR', 'ellipsoidal_head', head, 6),
      part('B', 'tube_bundle', { ...sheet, pass_lane_width: 16, pass_lane_count: 2 }, 100, 'S'),
      part('F', 'segmental_baffles', { baffle_cut_length: 150, baffle_thickness: 6, baffle_spacing: 300, baffle_inlet_spacing: 400, baffle_outlet_spacing: 400, shell_baffle_clearance: 3.2, tube_baffle_clearance: 0.8 }, 100, 'S'),
      part('N1', 'radial_nozzle', nozzle, 100, 'S'),
      part('N2', 'radial_nozzle', nozzle, 100, 'S'),
    ].map((c) => (c.id === 'B' ? { ...c, dimensions: Object.fromEntries(Object.entries(c.dimensions).filter(([k]) => k.startsWith('tube_') || k.startsWith('pass_'))) } : c)),
    placements: {
      B: { anchor: 'shell_side', axialOffset: 1500, azimuth: 0 },
      F: { anchor: 'shell_side', axialOffset: 1500, azimuth: 90 },
      N1: { anchor: 'shell_side', axialOffset: 200, azimuth: 270 },
      N2: { anchor: 'shell_side', axialOffset: 2800, azimuth: 90 },
    },
    reversed: [],
  };
  const domain = domainOf(definition, 'N2');
  assert.deepEqual(domain.zones.map((z) => z.name).sort(), ['zone:bundle', 'zone:bypass', 'zone:fluid', 'zone:lane:1', 'zone:lane:2']);
  assert.equal(domain.boundaries.filter((b) => b.type === 'baffle').length, 8);
  const leak = domain.leakage!;
  // Windows at 90° and 270°: the crossflow runs along 90°, so the lane at 90° is parallel to it and the one at 0° across it.
  assert.equal(leak.parallelLanes, 1);
  const space = leak.spaces.find((s) => s.name === 'central:1')!;
  close(space.book, 300 * (600 - (2 * 270 + 19.05) + 0.5 * 16));
  close(domain.zones.reduce((s, z) => s + z.volume, 0), domain.volume);
});

test('a plain vessel is one zone of free fluid, and a part that is not an opening is refused', () => {
  const head = { inside_diameter: 1000, head_height: 250, thickness: 12, straight_flange_length: 40 };
  const nozzle = { nozzle_inside_diameter: 100, nozzle_thickness: 8, nozzle_outward_projection: 150 };
  const definition: AssemblyDefinition = {
    components: [
      part('H1', 'ellipsoidal_head', head, 0),
      part('S', 'cylindrical_shell', { inside_diameter: 1000, thickness: 12, course_length: 2000 }, 1),
      part('H2', 'ellipsoidal_head', head, 2),
      part('N1', 'radial_nozzle', nozzle, 100, 'S'),
      part('N2', 'radial_nozzle', nozzle, 100, 'S'),
    ],
    placements: { N1: { anchor: 'shell_side', axialOffset: 300, azimuth: 180 }, N2: { anchor: 'shell_side', axialOffset: 1700, azimuth: 0 } },
    reversed: [],
  };
  const domain = domainOf(definition, 'N1');
  assert.deepEqual(domain.zones.map((z) => z.name), ['zone:fluid']);
  assert.equal(domain.leakage, null);
  assert.deepEqual(domain.boundaries.filter((b) => b.type === 'opening').map((b) => b.name).sort(), ['opening:N1', 'opening:N2']);
  // The bore, the two 2:1 heads' halves of an ellipsoid and their straight flanges, and the two nozzle bores.
  const body = Math.PI * 500 ** 2 * (2000 + 2 * 40) + 2 * ((2 / 3) * Math.PI * 500 ** 2 * 250);
  assert.ok(domain.volume > body && domain.volume < body * 1.01, `${domain.volume} against ${body}`);
  assert.throws(() => domainOf(definition, 'S'), (error: unknown) => error instanceof FluidDomainError && /not an opening/.test(error.message));
});
