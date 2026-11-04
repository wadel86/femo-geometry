// Every draft entry is held to what it declares: its specimen builds, its part offers the ports it
// names, its joint is derived between the parts it names with nothing wrong with it, and the
// parameters it declares are exactly the ones its drawing reads.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { DRAFT_ENTRIES } from '../src/catalogue/draftEntries.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { derivePorts } from '../src/ports/ports.ts';
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
