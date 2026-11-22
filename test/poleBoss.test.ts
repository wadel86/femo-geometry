// A forged boss set into a head at its pole: a disc replacing the head wall, then a cylinder, a
// cone and a spigot for the pipe. Invented dimensions, not any real vessel's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { resolveGeometry } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition, Placement } from '../src/definition.ts';
import { kernel, part } from './fixtures.ts';

const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ± ${tolerance}`);

const HEAD = { inside_diameter: 2000, crown_radius: 1800, knuckle_radius: 340, thickness: 60, straight_flange_length: 50 };
const BOSS = {
  boss_disc_diameter: 500,
  boss_outside_diameter: 360,
  boss_pipe_outside_diameter: 220,
  boss_bore_diameter: 160,
  boss_height: 400,
  boss_cone_height: 200,
  boss_cone_angle: 45,
  boss_root_radius: 30,
  boss_break_radius: 10,
  boss_neck_radius: 15,
};
const pole: Placement = { anchor: 'head_crown', axialOffset: 0, azimuth: 0 };

function vessel(boss: Record<string, number> = BOSS, at: Placement = pole, host = 'H1'): AssemblyDefinition {
  return {
    components: [
      part('H1', 'torispherical_head', HEAD, 0),
      part('S', 'cylindrical_shell', { inside_diameter: 2000, thickness: 60, course_length: 2000 }, 1),
      part('H2', 'torispherical_head', HEAD, 2),
      part('B', 'head_pole_boss', boss, 0, host),
    ],
    placements: { B: at },
    reversed: [],
  };
}

const build = (definition: AssemblyDefinition) => {
  const model = new AssemblyBuilder(kernel).build(definition);
  return { model, geometry: resolveGeometry(definition, model, kernel, { mode: 'analysis' }) };
};

// The crown's outer sphere, in the head's own frame: centred on the axis below the tangent line.
const xc = 1000 - 340;
const zc = -Math.sqrt((1800 - 340) ** 2 - xc ** 2);
const zOut = (r: number) => 50 + zc + Math.sqrt((1800 + 60) ** 2 - r * r);

test('a boss on the bottom head stands out of the pole, its spigot where the heights put it', () => {
  const { model, geometry } = build(vessel());
  for (const p of model.parts) assert.equal(p.status, 'drawn', `${p.componentId}: ${p.message ?? ''}`);
  assert.equal(geometry.refusals.length, 0, JSON.stringify(geometry.refusals));
  const boss = model.parts.find((p) => p.componentId === 'B')!;
  const bounds = kernel.bounds(boss.solids[0]);
  // In the head's frame, crown up: the disc 250 out from the axis, the spigot's end 400 past the root.
  close(bounds.max[0], 250, 1e-3);
  close(bounds.max[2], zOut(180) + 400, 1e-3);
  // The bottom head is turned over: the boss hangs below the vessel.
  const end = geometry.parts.find((p) => p.componentId === 'B')!.ports.find((p) => p.key === 'neck:outer-end')!;
  close(end.location[2], -(zOut(180) + 400), 1e-6);
  close(end.insideRadius!, 80);
  close(end.outsideRadius!, 110);
  close(end.axis[2], -1);
});

test('the boss is butt-welded into the head all round its disc, and the head is cut for it', () => {
  const { geometry } = build(vessel());
  const joint = geometry.joints.find((j) => j.id === 'H1:opening:B~B:neck:host-end')!;
  assert.ok(joint, geometry.joints.map((j) => j.id).join(', '));
  assert.equal(joint.kind, 'butt_weld');
  const opening = geometry.discontinuities.find((d) => d.id === 'H1:opening:B')!;
  assert.equal(opening.kind, 'opening');
  const head = geometry.parts.find((p) => p.componentId === 'H1')!;
  assert.ok(head.edges.some((e) => e.ref === 'H1/opening/B/outside'));
  assert.ok(head.edges.some((e) => e.ref === 'H1/opening/B/inside'));
});

test('on the top head, crown up, the boss stands above it', () => {
  const { model } = build(vessel(BOSS, pole, 'H2'));
  const boss = model.parts.find((p) => p.componentId === 'B')!;
  assert.equal(boss.status, 'drawn', boss.message);
  assert.equal(boss.transform.flipped, false);
});

test('what is not stated is drawn and said: the cone angle, the root, the break and the neck', () => {
  const { boss_cone_angle: _a, boss_root_radius: _r, boss_break_radius: _b, boss_neck_radius: _n, ...bare } = BOSS;
  const { model, geometry } = build(vessel(bare));
  assert.equal(model.parts.find((p) => p.componentId === 'B')!.status, 'drawn');
  const said = geometry.refusals.filter((r) => r.componentId === 'B').map((r) => r.parameter).sort();
  assert.deepEqual(said, ['boss_break_radius', 'boss_cone_angle', 'boss_neck_radius', 'boss_root_radius']);
});

test('a boss off the pole, past the crown, or with no room for its spigot is refused', () => {
  const cases: [Record<string, number>, Placement, string][] = [
    [BOSS, { ...pole, axialOffset: 300 }, 'placement'],
    [{ ...BOSS, boss_disc_diameter: 1800 }, pole, 'boss_disc_diameter'],
    [{ ...BOSS, boss_cone_height: 60 }, pole, 'boss_cone_height'],
    [{ ...BOSS, boss_outside_diameter: 600 }, pole, 'diameters'],
  ];
  for (const [boss, at, parameter] of cases) {
    const built = build(vessel(boss, at)).model.parts.find((p) => p.componentId === 'B')!;
    assert.equal(built.status, 'failed', `${JSON.stringify(boss)} was drawn`);
    assert.equal(built.scope?.parameter, parameter, built.message);
  }
});
