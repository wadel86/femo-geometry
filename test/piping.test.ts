// RCC-M C3641 and C3642: a straight pipe and a bend, stated on the outside diameter their code
// reads. Generic DN 200 dimensions, not any real line's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder, solidToAssembly } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition, ComponentDefinition } from '../src/definition.ts';
import { fluidDomain } from '../src/fluid/fluidDomain.ts';
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

test('a pump casing is drawn from its four drawing dimensions, or not drawn without them', () => {
  // Figure C3431.1.3: A1 and A2 in plan, from the centre — 330 at the tongue, 420 across the far
  // side — and B = 120 the axial width inside.
  const PUMP = {
    thickness: 20, pump_type: 1, pump_volute_a1: 330, pump_volute_a2: 420, pump_shape_factor: 1.2,
    pump_base_circle_diameter: 400, pump_casing_width: 120, pump_suction_bore: 202.74, pump_discharge_bore: 100,
  };
  const definition = line(part('P', 'pipe_segment', { ...PIPE, course_length: 600 }, 0), part('U', 'pump_casing', PUMP, 1));
  const model = build(definition);
  const u = model.parts.find((p) => p.componentId === 'U')!;
  assert.equal(u.status, 'drawn', u.message);
  assert.ok(kernel.isValid(u.solids[0]!));
  // The outer wall passes A1 + t at azimuth 0 and A2 + t at 180°; a neck of 3·t = 60 under
  // B + 2·t = 160 of casing.
  const box = kernel.bounds(solidToAssembly(kernel, u.solids[0]!, u.transform));
  close(box.max[0]!, 330 + 20, 1e-6);
  close(box.min[0]!, -(420 + 20), 1e-6);
  close(box.max[2]! - box.min[2]!, 60 + 120 + 40, 1e-6);
  const joint = resolveGeometry(definition, model, kernel).joints.find((j) => j.id === 'P:upper~U:lower');
  assert.deepEqual(joint?.issues, []);

  // Stated only as the engine asks, it is not drawn, and says which dimension it lacks.
  const { pump_base_circle_diameter: _b, ...asEngine } = PUMP;
  const bare = partOf(line(part('U', 'pump_casing', asEngine, 0)), 'U');
  assert.equal(bare.status, 'not_drawn');
  assert.equal(bare.scope?.parameter, 'pump_base_circle_diameter');
  // A discharge wider than the throat, A2 short of A1, or A1 inside the base circle, is refused.
  assert.equal(partOf(line(part('U', 'pump_casing', { ...PUMP, pump_discharge_bore: 200 }, 0)), 'U').scope?.parameter, 'pump_discharge_bore');
  assert.equal(partOf(line(part('U', 'pump_casing', { ...PUMP, pump_volute_a2: 300 }, 0)), 'U').scope?.parameter, 'pump_volute_a2');
  assert.equal(partOf(line(part('U', 'pump_casing', { ...PUMP, pump_volute_a1: 150 }, 0)), 'U').scope?.parameter, 'pump_volute_a1');
});

const bend = (id: string, position: number, angle = 90) =>
  part(id, 'pipe_bend', { ...PIPE, pipe_bend_radius: R, pipe_bend_angle: angle }, position);
const pipe = (id: string, position: number, length: number) => part(id, 'pipe_segment', { ...PIPE, course_length: length }, position);
const worldBox = (model: ReturnType<typeof build>, id: string) => {
  const p = model.parts.find((q) => q.componentId === id)!;
  assert.equal(p.status, 'drawn', `${id}: ${p.message ?? ''}`);
  return kernel.bounds(solidToAssembly(kernel, p.solids[0]!, p.transform));
};
const near = (actual: readonly number[], expected: readonly number[], tolerance = 1e-6) =>
  actual.forEach((v, i) => close(v, expected[i]!, tolerance));

test('a run turns at a bend: the next pipe stands on its outlet, welded to it, and a second bend turns it again', () => {
  // Up 500, a 90° bend towards +X, 300 across, a second 90° bend, 500 back down: a U.
  const definition = line(pipe('P', 0, 500), bend('B1', 1), pipe('Q', 2, 300), bend('B2', 3), pipe('W', 4, 500));
  const model = build(definition);
  // Q runs along +X from the first outlet, x = R to R + 300, at the height the bend climbed to.
  const q = worldBox(model, 'Q');
  near(q.min, [R, -ro, 500 + R - ro]);
  near(q.max, [R + 300, ro, 500 + R + ro]);
  // The second bend turns towards its own +X, which the first turned to −Z: W comes back down,
  // 2R + 300 across, from z = 500 to the floor the run started on.
  const w = worldBox(model, 'W');
  near(w.min, [2 * R + 300 - ro, -ro, 0]);
  near(w.max, [2 * R + 300 + ro, ro, 500]);
  // Every part keeps its volume: Pappus on the bends, the annulus times the length on the pipes.
  const annulus = Math.PI * (ro * ro - ri * ri);
  const total = ['P', 'B1', 'Q', 'B2', 'W']
    .map((id) => model.parts.find((p) => p.componentId === id)!)
    .reduce((sum, p) => sum + kernel.volume(solidToAssembly(kernel, p.solids[0]!, p.transform)), 0);
  close(total, annulus * (1300 + 2 * R * (Math.PI / 2)), 1e-5 * total);

  // Four butt welds, each closed: centres coincide and the walls agree across the turn.
  const resolved = resolveGeometry(definition, model, kernel);
  const welds = resolved.joints.filter((j) => j.kind === 'butt_weld');
  assert.deepEqual(welds.map((j) => j.id).sort(), ['B1:upper~Q:lower', 'B2:upper~W:lower', 'P:upper~B1:lower', 'Q:upper~B2:lower']);
  for (const j of welds) assert.deepEqual(j.issues, [], j.id);
  // The outlet's port faces along the turned run, +X, and stands where the centreline ends.
  const outlet = resolved.parts.find((p) => p.componentId === 'B1')!.ports.find((p) => p.key === 'upper')!;
  near(outlet.location, [R, 0, 500 + R]);
  near(outlet.axis, [1, 0, 0]);
  // What a consumer places parts by: z0 is measured in the turn, and the turn is published.
  const placed = resolved.parts.find((p) => p.componentId === 'W')!;
  assert.equal(placed.z0, 0);
  near(placed.turn!.origin, [2 * R + 300, 0, 500]);
  // Two quarter turns about Y: the run's axis, the matrix's Z column, now points down.
  const m = placed.turn!.matrix;
  near([m[0][2], m[1][2], m[2][2]], [0, 0, -1]);
  assert.equal(resolved.parts.find((p) => p.componentId === 'P')!.turn, undefined);
  // Layer 1 is one meridian along one axis: it stops at the first bend, and says nothing past it.
  assert.ok(resolved.section.stations.every((s) => s.componentId === 'P'));
});

test('a branch on the pipe after a bend follows the turn, and is set in like any other', () => {
  const definition: AssemblyDefinition = {
    components: [
      pipe('P', 0, 500),
      bend('B', 1),
      pipe('Q', 2, 400),
      part('N', 'radial_nozzle', { nozzle_inside_diameter: 80, nozzle_thickness: 5.5, nozzle_outward_projection: 150 }, 0, 'Q'),
    ],
    placements: { N: { anchor: 'shell_side', axialOffset: 200, azimuth: 90 } },
    reversed: [],
  };
  const model = build(definition);
  const resolved = resolveGeometry(definition, model, kernel);
  const n = resolved.parts.find((p) => p.componentId === 'N')!;
  assert.equal(n.status, 'drawn', n.message);
  // 200 along Q is x = R + 200 at the bend's height; azimuth 90 is still +Y, square to the bend's plane.
  close(n.frame!.origin[0], R + 200, 1e-6);
  close(n.frame!.origin[2], 500 + R, 1e-6);
  near(n.frame!.axis, [0, 1, 0]);
  const joint = resolved.joints.find((j) => j.id === 'Q:opening:N~N:neck:host-end');
  assert.equal(joint?.kind, 'set_in_nozzle');
  assert.deepEqual(joint?.issues, []);
  // The neck stands out of the pipe along +Y, over the length it projects.
  const box = worldBox(model, 'N');
  assert.ok(box.max[1] > ro + 150 - 1 && box.min[0] > R + 200 - 60 && box.max[0] < R + 200 + 60, JSON.stringify(box));
});

test('a closed line through a bend holds the same fluid as the straight one Pappus says it unrolls to', () => {
  const head = { inside_diameter: 2 * ri, thickness: 8.18, straight_flange_length: 0 };
  const nozzle = { nozzle_inside_diameter: 50, nozzle_thickness: 5, nozzle_outward_projection: 120 };
  const vessel = (middle: ComponentDefinition): AssemblyDefinition => ({
    components: [
      part('H1', 'hemispherical_head', head, 0),
      pipe('P', 1, 400),
      middle,
      pipe('Q', 3, 400),
      part('H2', 'hemispherical_head', head, 4),
      part('N1', 'radial_nozzle', nozzle, 100, 'P'),
      part('N2', 'radial_nozzle', nozzle, 100, 'Q'),
    ],
    // Square to the bend's plane, so the two openings meet the same wall whether it turns or not.
    placements: { N1: { anchor: 'shell_side', axialOffset: 200, azimuth: 90 }, N2: { anchor: 'shell_side', axialOffset: 200, azimuth: 90 } },
    reversed: [],
  });
  const domainOf = (definition: AssemblyDefinition) => fluidDomain(definition, build(definition), kernel, { chamber: 'N1' });
  const bent = domainOf(vessel(bend('B', 2)));
  const straight = domainOf(vessel(pipe('B', 2, R * (Math.PI / 2))));
  close(bent.volume, straight.volume, 1e-5 * straight.volume);
  assert.deepEqual(bent.boundaries.filter((b) => b.type === 'opening').map((b) => b.name).sort(), ['opening:N1', 'opening:N2']);
});

test('a tee is the run with an outlet fused on at mid-length: its volume, its outlet face, and its two run welds', () => {
  // DN 200 × DN 150: an outlet of 168.3 × 7.11 on the 219.1 × 8.18 run, 400 long.
  const TEE = { ...PIPE, branch_outside_diameter: 168.3, branch_connected_thickness: 7.11, course_length: 400 };
  const definition = line(pipe('P', 0, 300), part('T', 'pipe_tee', TEE, 1), pipe('Q', 2, 300));
  const model = build(definition);
  const t = model.parts.find((p) => p.componentId === 'T')!;
  assert.equal(t.status, 'drawn', t.message);
  assert.ok(kernel.isValid(t.solids[0]!));
  const box = worldBox(model, 'T');
  // The run from 300 to 700; the outlet's face at D_o/2 + D_o,b/2 = 193.7 towards +Y.
  near(box.min, [-ro, -ro, 300]);
  near(box.max, [ro, ro + 168.3 / 2, 700]);
  // The run's annulus, plus the outlet's annulus from the run's outside surface out to the face,
  // less what of the run's wall the outlet's bore removes — bounded by the two cylinders' ends.
  const bo = 168.3 / 2;
  const bi = bo - 7.11;
  const volume = kernel.volume(t.solids[0]!);
  const run = Math.PI * (ro * ro - ri * ri) * 400;
  assert.ok(volume > run && volume < run + Math.PI * (bo * bo - bi * bi) * bo, `${volume}`);
  // Both run ends are a pipe's, welded to their neighbours without an issue.
  const joints = resolveGeometry(definition, model, kernel).joints.filter((j) => j.kind === 'butt_weld');
  assert.deepEqual(joints.map((j) => j.id).sort(), ['P:upper~T:lower', 'T:upper~Q:lower']);
  for (const j of joints) assert.deepEqual(j.issues, [], j.id);

  // Unstated, the run is 2·D_o and says so; an outlet larger than the run is refused.
  const { course_length: _l, ...unstated } = TEE;
  const plain = partOf(line(part('T', 'pipe_tee', unstated, 0)), 'T');
  close(kernel.bounds(plain.solids[0]!).max[2]!, 2 * 219.1, 1e-6);
  assert.ok(plain.notes.some((n) => n.symbol === 'course_length'));
  const wide = partOf(line(part('T', 'pipe_tee', { ...TEE, branch_outside_diameter: 273 }, 0)), 'T');
  assert.equal(wide.status, 'failed');
  assert.equal(wide.scope?.parameter, 'branch_outside_diameter');
});

test('a reducer is L_1, knuckle, cone, flare, L_2 on its mid-surface: its ends weld to both pipes, its volume is the wall swept round', () => {
  // DN 250 → DN 150, generic: 273.0 × 9.27 down to 168.3 × 7.11, at 20° with a 40 knuckle and a 30 flare.
  const RED = {
    pipe_outside_diameter: 273, thickness: 9.27, reducer_small_outside_diameter: 168.3, reducer_small_thickness: 7.11,
    half_apex_angle: 20, knuckle_radius: 40, flare_radius: 30, reducer_large_end_length: 50, reducer_small_end_length: 40,
  };
  const big = (id: string, position: number) => part(id, 'pipe_segment', { pipe_outside_diameter: 273, thickness: 9.27, course_length: 300 }, position);
  const small = (id: string, position: number) => part(id, 'pipe_segment', { pipe_outside_diameter: 168.3, thickness: 7.11, course_length: 300 }, position);
  const definition = line(big('P', 0), part('R', 'pipe_reducer', RED, 1), small('Q', 2));
  const model = build(definition);
  const red = model.parts.find((p) => p.componentId === 'R')!;
  assert.equal(red.status, 'drawn', red.message);
  assert.ok(kernel.isValid(red.solids[0]!));
  assert.deepEqual(red.notes, []);
  // The transition: r·sin α + cone·cos α + r_f·sin α, the cone running between the two arcs' ends.
  const a = (20 * Math.PI) / 180;
  const [rm1, rm2] = [(273 - 9.27) / 2, (168.3 - 7.11) / 2];
  const cone = (rm1 - 40 + 40 * Math.cos(a) - (rm2 + 30 - 30 * Math.cos(a))) / Math.sin(a);
  const height = 50 + 40 * Math.sin(a) + cone * Math.cos(a) + 30 * Math.sin(a) + 40;
  const box = kernel.bounds(red.solids[0]!);
  close(box.max[2]! - box.min[2]!, height, 1e-6);
  close(box.max[0]!, 273 / 2, 1e-6);
  const joints = resolveGeometry(definition, model, kernel).joints.filter((j) => j.kind === 'butt_weld');
  assert.deepEqual(joints.map((j) => j.id).sort(), ['P:upper~R:lower', 'R:upper~Q:lower']);
  for (const j of joints) assert.deepEqual(j.issues, [], j.id);

  // One wall all through, so the volume is 2π·∫r·t·ds over the mid-surface, to the arcs' curvature.
  const even = { ...RED, reducer_small_thickness: 9.27 };
  const uniform = partOf(line(part('R', 'pipe_reducer', even, 0)), 'R');
  const m = uniform.meridian!;
  let swept = 0;
  for (let i = 1; i < m.length; i++) swept += Math.PI * (m[i]![0] + m[i - 1]![0]) * Math.hypot(m[i]![0] - m[i - 1]![0], m[i]![1] - m[i - 1]![1]) * 9.27;
  // 9 ppm apart here: the arcs' 8-point chords and their inner/outer centroid shift.
  close(kernel.volume(uniform.solids[0]!), swept, 1e-4 * swept);
});

test('a reducer shares a stated length between its ends, draws an unstated knuckle sharp, and refuses what does not reduce', () => {
  const RED = { pipe_outside_diameter: 273, thickness: 9.27, reducer_small_outside_diameter: 168.3, reducer_small_thickness: 7.11, half_apex_angle: 30 };
  const shared = partOf(line(part('R', 'pipe_reducer', { ...RED, course_length: 300 }, 0)), 'R');
  assert.equal(shared.status, 'drawn', shared.message);
  assert.ok(kernel.isValid(shared.solids[0]!));
  const box = kernel.bounds(shared.solids[0]!);
  close(box.max[2]! - box.min[2]!, 300, 1e-6);
  // Sharp on the mid-surface, said twice; the lengths came from course_length, so nothing about them.
  assert.deepEqual(shared.notes.map((n) => n.symbol).sort(), ['flare_radius', 'knuckle_radius']);
  assert.equal(shared.junctions!.lower!.straightLength, shared.junctions!.upper!.straightLength);

  const refused = (dimensions: Record<string, number>) => partOf(line(part('R', 'pipe_reducer', { ...RED, ...dimensions }, 0)), 'R').scope?.parameter;
  assert.equal(refused({ reducer_small_outside_diameter: 273 }), 'reducer_small_outside_diameter');
  assert.equal(refused({ half_apex_angle: 60 }), 'half_apex_angle');
  assert.equal(refused({ knuckle_radius: 400, flare_radius: 400 }), 'knuckle_radius');
  assert.equal(refused({ course_length: 50 }), 'course_length');
});

test('a reinforced neck is t_n over L_1, then the connected pipe T\'_b on the same bore, and its end port says so', () => {
  const NECK = { nozzle_inside_diameter: 80, nozzle_thickness: 11, nozzle_outward_projection: 200 };
  const branchOn = (dimensions: Record<string, number>): AssemblyDefinition => ({
    components: [pipe('P', 0, 1000), part('N', 'radial_nozzle', dimensions, 0, 'P')],
    placements: { N: { anchor: 'shell_side', axialOffset: 500, azimuth: 90 } },
    reversed: [],
  });
  const volumeOf = (definition: AssemblyDefinition) => kernel.volume(build(definition).parts.find((p) => p.componentId === 'N')!.solids[0]!);
  const definition = branchOn({ ...NECK, branch_connected_thickness: 5.5, branch_reinforcement_height: 80 });
  const model = build(definition);
  const n = model.parts.find((p) => p.componentId === 'N')!;
  assert.equal(n.status, 'drawn', n.message);
  assert.ok(kernel.isValid(n.solids[0]!));
  // What is removed is the outer 5.5 mm of wall over the 120 mm beyond L_1, exactly.
  const removed = Math.PI * ((40 + 11) ** 2 - (40 + 5.5) ** 2) * 120;
  close(volumeOf(branchOn(NECK)) - kernel.volume(n.solids[0]!), removed, 1e-6 * removed);
  const end = resolveGeometry(definition, model, kernel).parts.find((p) => p.componentId === 'N')!.ports.find((p) => p.key === 'neck:outer-end')!;
  close(end.outsideRadius!, 45.5);
  close(end.thickness, 5.5);
  // T'_b alone has no height to step at: the neck is uniform, and says why.
  const alone = build(branchOn({ ...NECK, branch_connected_thickness: 5.5 })).parts.find((p) => p.componentId === 'N')!;
  assert.ok(alone.notes.some((note) => note.symbol === 'branch_reinforcement_height'));
  close(kernel.volume(alone.solids[0]!), volumeOf(branchOn(NECK)), 1e-9 * volumeOf(branchOn(NECK)));
});

test('a bend that is not drawn leaves no direction: what follows it is not drawn, and a bend tighter than its own tube is refused', () => {
  const after = build(
    line(
      pipe('P', 0, 500),
      part('B', 'pipe_bend', { ...PIPE, pipe_bend_radius: 100, pipe_bend_angle: 90 }, 1),
      pipe('Q', 2, 300)
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
