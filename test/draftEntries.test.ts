// Every draft entry is held to what it declares: its specimen builds, its part offers the ports it
// names, its joint is derived between the parts it names with nothing wrong with it, and the
// parameters it declares are exactly the ones its drawing reads.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { DECLARATIONS, DRAFT_ENTRIES } from '../src/catalogue/draftEntries.ts';
import { Kind, type AssemblyDefinition } from '../src/definition.ts';
import { applyConstructionDetails } from '../src/details/apply.ts';
import { Detail } from '../src/details/constructionDetails.ts';
import { derivePorts } from '../src/ports/ports.ts';
import { runSection } from '../src/ports/section.ts';
import { kernel } from './fixtures.ts';

/**
 * The specimen with the focus part's dimensions watched: every symbol the drawing looks up. A
 * look-up counts only when a builder or a dimension reader makes it — the cache key reads every
 * stated symbol, and would declare a symbol used that nothing draws with.
 */
const DRAWING = /\/src\/(builders\/|definition\.ts)/;
const CACHE_KEY = /\/src\/hash\.ts/;
function watched(definition: AssemblyDefinition, focus: string): { definition: AssemblyDefinition; read: Set<string> } {
  const read = new Set<string>();
  return {
    read,
    definition: {
      ...definition,
      components: definition.components.map((c) =>
        c.id !== focus
          ? c
          : {
              ...c,
              dimensions: new Proxy(c.dimensions, {
                get(target, symbol) {
                  if (typeof symbol === 'string') {
                    const stack = new Error().stack ?? '';
                    if (DRAWING.test(stack) && !CACHE_KEY.test(stack)) read.add(symbol);
                  }
                  return Reflect.get(target, symbol);
                },
              }),
            }
      ),
    },
  };
}

for (const entry of DRAFT_ENTRIES) {
  test(`${entry.status}: ${entry.id} — ${entry.title}`, () => {
    if (entry.status === 'not started') {
      assert.ok(!entry.specimen && entry.note, 'a not-started entry says why, and draws nothing');
      return;
    }
    assert.ok(entry.specimen, 'a captured entry has a specimen');
    const focus = entry.focus ?? entry.joint!.between[1];
    const { definition, read } = watched(entry.specimen, focus);
    const model = new AssemblyBuilder(kernel).build(definition);
    for (const part of model.parts) {
      assert.equal(part.status, 'drawn', `${part.componentId}: ${part.message ?? part.status}`);
      for (const solid of part.solids) assert.ok(kernel.isValid(solid), `${part.componentId} has an invalid solid`);
    }
    const { ports, joints } = derivePorts(definition, model);

    if (entry.ports) {
      const own = ports.filter((p) => p.componentId === focus).map((p) => p.key).sort();
      assert.deepEqual(own, [...entry.ports].sort(), `ports of ${focus}`);
    }
    if (entry.parameters) {
      const stated = Object.keys(entry.specimen.components.find((c) => c.id === focus)!.dimensions);
      for (const symbol of stated) assert.ok(entry.parameters.includes(symbol), `${symbol} is stated and not declared`);
      for (const symbol of entry.parameters) assert.ok(read.has(symbol), `${symbol} is declared and the drawing never reads it`);
    }
    if (entry.joint) {
      const [a, b] = entry.joint.between;
      const id = `${a}:${entry.joint.ports[0]}~${b}:${entry.joint.ports[1]}`;
      const joint = joints.find((j) => j.id === id);
      assert.ok(joint, `no joint ${id} among ${joints.map((j) => j.id).join(', ')}`);
      assert.equal(joint.kind, entry.joint.kind);
      assert.deepEqual(joint.issues, [], `${id}: ${joint.issues.join('; ')}`);
    }
  });
}

test('the first pass names every component and joint the brief lists, once', () => {
  const ids = DRAFT_ENTRIES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(DRAFT_ENTRIES.filter((e) => e.entry === 'joint').length, 17);
});

test('wave 1b leaves nothing not started, and every article it touched is an entry or a declaration', () => {
  assert.deepEqual(DRAFT_ENTRIES.filter((e) => e.status === 'not started').map((e) => e.id), []);
  assert.ok(DRAFT_ENTRIES.some((e) => e.article === '§4.8'));
  assert.ok(DECLARATIONS.some((d) => d.article === '§4.8') && DECLARATIONS.some((d) => d.article === '§4.12'));
});

// A construction detail an entry claims is one it resolves: declared corroded, its part changes.
for (const entry of DRAFT_ENTRIES.filter((e) => e.constructionDetails)) {
  test(`construction details: ${entry.id}`, () => {
    const known = new Set<string>(Object.values(Detail));
    for (const key of entry.constructionDetails!) assert.ok(known.has(key), `${key} is not a construction detail`);
    if (!entry.constructionDetails!.includes(Detail.CORRODED_MODEL)) return;
    const { details } = applyConstructionDetails({
      ...entry.specimen!,
      details: { equipment: { [Detail.CORRODED_MODEL]: 'corroded', [Detail.CORROSION_ALLOWANCE]: 3 } },
    });
    assert.ok(
      details.applied.some((a) => a.at === entry.focus && a.key === Detail.CORRODED_MODEL && a.effect),
      `corroding the specimen changes nothing on ${entry.focus}`
    );
  });
}

// The eccentric cone is the test of layer 1: a circle per station whose centre moves.
test('layer 1 describes the eccentric cone with no special case, and the run beneath it says what it cannot do', () => {
  const entry = DRAFT_ENTRIES.find((e) => e.id === 'conical_shell.eccentric')!;
  const above = { id: 'U', name: 'U', kind: Kind.CYLINDRICAL_SHELL, position: 2, hostId: null, dimensions: { inside_diameter: 1200, thickness: 20, course_length: 1000 } };
  const definition = { ...entry.specimen!, components: [...entry.specimen!.components, above] };
  const model = new AssemblyBuilder(kernel).build(definition);
  const section = runSection(definition, model);
  assert.equal(section.axisymmetric, false);
  const cone = section.stations.filter((s) => s.componentId === 'C');
  assert.deepEqual(cone[0].centre, [0, 0]);
  assert.ok(Math.abs(cone[1].centre[0] - 400) < 1e-6 && Math.abs(cone[1].centre[1]) < 1e-9, `small end centred at ${cone[1].centre}`);
  assert.ok(Math.abs(cone[1].radius - 610) < 1e-6);
  // The course above is stacked on the axis: its joint to the small end is refused, not passed.
  const joint = derivePorts(definition, model).joints.find((j) => j.id === 'C:upper~U:lower');
  assert.ok(joint?.issues.some((i) => i.startsWith('Centres are 400 mm apart')), joint?.issues.join('; '));
  assert.ok(section.assumptions.some((a) => a.rule === 'the run, stacked' && a.assumesAxisymmetry));
});

test('a tube-to-tubesheet joint with no weld is refused, and a bundle that disagrees with its plate is a mismatch', () => {
  const entry = DRAFT_ENTRIES.find((e) => e.id === 'tube')!;
  const definition = {
    ...entry.specimen!,
    components: entry.specimen!.components.map((c) => (c.id === 'B' ? { ...c, dimensions: { ...c.dimensions, tube_pitch: 32 } } : c)),
  };
  const joint = derivePorts(definition, new AssemblyBuilder(kernel).build(definition)).joints.find((j) => j.kind === 'tube_to_tubesheet')!;
  assert.ok(joint.multiplicity! > 1000);
  assert.ok(joint.issues.some((i) => i.startsWith('No strength weld stated')));
  assert.ok(joint.issues.some((i) => i.includes('tube pitch 32')));
});
