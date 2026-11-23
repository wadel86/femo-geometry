// A forged boss set into a cylindrical shell: head_pole_boss's family on a course, radial. Invented
// dimensions, not any real vessel's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition, Placement } from '../src/definition.ts';
import { kernel, part } from './fixtures.ts';

const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ± ${tolerance}`);

const SHELL = { inside_diameter: 3000, thickness: 50, course_length: 2400 };
const BOSS = {
  boss_disc_diameter: 760, boss_outside_diameter: 600, boss_pipe_outside_diameter: 480, boss_bore_diameter: 400,
  boss_height: 380, boss_cone_height: 220, boss_cone_angle: 40, boss_root_radius: 30, boss_break_radius: 5, boss_neck_radius: 15,
  boss_bore_edge_radius: 12, boss_joint_angle: 5,
};
const at: Placement = { anchor: 'shell_side', axialOffset: 1200, azimuth: 30 };

function vessel(boss: Record<string, number> = BOSS, host = part('S', 'cylindrical_shell', SHELL, 0)): AssemblyDefinition {
  return { components: [host, part('B', 'shell_boss', boss, 100, host.id)], placements: { B: at }, reversed: [] };
}
const build = (definition: AssemblyDefinition) => {
  const model = new AssemblyBuilder(kernel).build(definition);
  return { model, geometry: resolveGeometry(definition, model, kernel, { mode: 'analysis' }) };
};
const bossOf = (definition: AssemblyDefinition) => build(definition).model.parts.find((p) => p.componentId === 'B')!;

test('a shell boss is one forging butt-welded into the course, its neck ending at the height stated off the axis', () => {
  const { model, geometry } = build(vessel());
  for (const p of model.parts) assert.equal(p.status, 'drawn', `${p.componentId}: ${p.message ?? ''}`);
  const boss = model.parts.find((p) => p.componentId === 'B')!;
  assert.equal(boss.solids.length, 1);
  assert.ok(kernel.isValid(boss.solids[0]!));
  const joint = geometry.joints.find((j) => j.id === 'S:opening:B~B:neck:host-end')!;
  assert.equal(joint.kind, 'butt_weld');
  assert.deepEqual(joint.issues, []);
  // The neck's end, 380 mm out from the shell's outer surface on the nozzle's radial at 30°.
  const end = geometry.parts.find((p) => p.componentId === 'B')!.ports.find((p) => p.key === 'neck:outer-end')!;
  close(Math.hypot(end.location[0], end.location[1]), 1550 + 380, 1e-6);
  close(Math.atan2(end.location[1], end.location[0]) * (180 / Math.PI), 30, 1e-9);
  close(end.insideRadius!, 200);
  close(end.outsideRadius!, 240);
});

test('the shell is cut by exactly the disc, and the joint face leans wider inward', () => {
  const { model, geometry } = build(vessel());
  const shell = geometry.parts.find((p) => p.componentId === 'S')!;
  const outside = shell.edges.find((e) => e.ref === 'S/opening/B/outside');
  const inside = shell.edges.find((e) => e.ref === 'S/opening/B/inside');
  assert.ok(outside && inside, shell.edges.map((e) => e.ref).join(', '));
  // Shell and forging share no metal: the disc is the wall the cut took away.
  const cut = model.parts.find((p) => p.componentId === 'S')!.solids[0]!;
  const forging = model.parts.find((p) => p.componentId === 'B')!.solids[0]!;
  let common = 0;
  try {
    common = kernel.volume(kernel.intersect(cut, forging));
  } catch {
    common = 0;
  }
  assert.ok(common < 1, `${common} mm³ shared`);
  // Square, the hole is narrower at the inner surface than leaning 5°.
  const square = build(vessel({ ...BOSS, boss_joint_angle: 0 })).model.parts.find((p) => p.componentId === 'S')!.solids[0]!;
  assert.ok(kernel.volume(square) > kernel.volume(cut), 'the leaning face takes more wall at the inner surface');
});

test('the root fillet adds metal and the bore edge round takes it off', () => {
  const volume = (boss: Record<string, number>) => kernel.volume(bossOf(vessel(boss)).solids[0]!);
  const base = volume(BOSS);
  assert.ok(volume({ ...BOSS, boss_root_radius: 10 }) < base, 'a smaller root fillet, less metal');
  assert.ok(volume({ ...BOSS, boss_bore_edge_radius: 30 }) < base, 'a larger bore round, less metal');
});

test('what is not stated is drawn and said: cone angle, root, break, neck fillet, bore edge, joint lean and axis angle', () => {
  const { boss_cone_angle: _a, boss_root_radius: _r, boss_break_radius: _b, boss_neck_radius: _n, boss_bore_edge_radius: _e, boss_joint_angle: _j, ...bare } = BOSS;
  const { model, geometry } = build(vessel(bare));
  assert.equal(model.parts.find((p) => p.componentId === 'B')!.status, 'drawn');
  const said = geometry.refusals.filter((r) => r.componentId === 'B').map((r) => r.parameter).sort();
  assert.deepEqual(said, ['boss_bore_edge_radius', 'boss_break_radius', 'boss_cone_angle', 'boss_joint_angle', 'boss_neck_radius', 'boss_root_radius', 'nozzle_angle']);
});

test('a square joint face can be stated: 0° is an answer and carries no assumed-value note, a negative lean is refused', () => {
  const { model, geometry } = build(vessel({ ...BOSS, boss_joint_angle: 0, nozzle_angle: 90, boss_break_radius: 0, boss_neck_radius: 0, boss_bore_edge_radius: 0 }));
  assert.equal(model.parts.find((p) => p.componentId === 'B')!.status, 'drawn');
  const said = geometry.refusals.filter((r) => r.componentId === 'B').map((r) => r.parameter);
  assert.deepEqual(said, [], `stated values still noted: ${said.join(', ')}`);
  assert.equal(bossOf(vessel({ ...BOSS, boss_joint_angle: -2 })).scope?.parameter, 'boss_joint_angle');
});

test('leant to θ in the plane of the vessel axis, it turns about where its axis leaves the shell, the datum unmoved', () => {
  for (const theta of [85, 95]) {
    const { model, geometry } = build(vessel({ ...BOSS, nozzle_angle: theta }));
    const boss = model.parts.find((p) => p.componentId === 'B')!;
    assert.equal(boss.status, 'drawn', `${theta}°: ${boss.message ?? ''}`);
    assert.ok(kernel.isValid(boss.solids[0]!));
    const joint = geometry.joints.find((j) => j.id === 'S:opening:B~B:neck:host-end')!;
    assert.deepEqual(joint.issues, [], `${theta}°`);
    // The neck's end is 380 mm along the leant axis from the shell's outside at offset 1200, azimuth 30°.
    const end = geometry.parts.find((p) => p.componentId === 'B')!.ports.find((p) => p.key === 'neck:outer-end')!;
    const t = (theta * Math.PI) / 180;
    close(end.location[2], 1200 + 380 * Math.cos(t), 1e-6);
    close(Math.hypot(end.location[0], end.location[1]), 1550 + 380 * Math.sin(t), 1e-6);
    const shell = geometry.parts.find((p) => p.componentId === 'S')!;
    assert.ok(shell.edges.some((e) => e.ref === 'S/opening/B/inside') && shell.edges.some((e) => e.ref === 'S/opening/B/outside'), `${theta}°: opening edges named`);
  }
  assert.equal(bossOf(vessel({ ...BOSS, nozzle_angle: 30 })).scope?.parameter, 'nozzle_angle');
});

test('a boss on a head, out of order diameters, a cone with no room and a face leaning past 45° are refused', () => {
  const head = part('S', 'ellipsoidal_head', { inside_diameter: 3000, head_height: 750, thickness: 50, straight_flange_length: 50 }, 0);
  assert.equal(bossOf(vessel(BOSS, head)).scope?.parameter, 'host');
  for (const [boss, parameter] of [
    [{ ...BOSS, boss_outside_diameter: 800 }, 'diameters'],
    [{ ...BOSS, boss_cone_height: 370 }, 'boss_cone_height'],
    [{ ...BOSS, boss_joint_angle: 50 }, 'boss_joint_angle'],
  ] as const) {
    const built = bossOf(vessel(boss));
    assert.equal(built.status, 'failed', JSON.stringify(boss));
    assert.equal(built.scope?.parameter, parameter, built.message);
  }
});
