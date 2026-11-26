// An exported vessel names every part in each place a STEP reader may take a name from: the
// PRODUCT, the assembly occurrence that places it, and its shape representation and solids.
// FreeCAD read the products by name while Onshape numbered them Part 1, Part 2 … (TRESCA 3D,
// 2026-11-26). Generic dimensions, not any real vessel's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OcctKernel } from 'occt-wasm';
import { AssemblyBuilder } from '../src/assembly/buildAssembly.ts';
import { STEP_ASSEMBLY, stepOf } from '../src/assembly/resolve.ts';
import type { AssemblyDefinition } from '../src/definition.ts';
import { nameRepresentationItems } from '../src/kernel/stepNames.ts';
import { kernel, part } from './fixtures.ts';

const VESSEL: AssemblyDefinition = {
  components: [
    part('H1', 'ellipsoidal_head', { inside_diameter: 1200, head_height: 300, thickness: 12, straight_flange_length: 40 }, 0),
    part('S', 'cylindrical_shell', { inside_diameter: 1200, thickness: 12, course_length: 1500 }, 1),
    part('H2', 'ellipsoidal_head', { inside_diameter: 1200, head_height: 300, thickness: 12, straight_flange_length: 40 }, 2),
    // A neck and its pad: one part of two solids.
    part('N1', 'radial_nozzle', { nozzle_inside_diameter: 200, nozzle_thickness: 10, nozzle_outward_projection: 200, pad_width: 80, pad_thickness: 12 }, 0, 'S'),
  ],
  placements: { N1: { anchor: 'shell_side', axialOffset: 750, azimuth: 30 } },
  reversed: [],
};
const PARTS = ['H1', 'S', 'H2', 'N1'];

const step = (() => {
  const model = new AssemblyBuilder(kernel).build(VESSEL);
  return stepOf(VESSEL, model, kernel, 'analysis');
})();
/** The first argument, a name, of every entity of a type. */
const namesOf = (text: string, type: string) => [...text.matchAll(new RegExp(`\\b${type}\\('((?:[^']|'')*)'`, 'g'))].map((m) => m[1]!);

test('one root assembly, one product per part', () => {
  assert.deepEqual(namesOf(step, 'PRODUCT').sort(), [STEP_ASSEMBLY, ...PARTS].sort());
});

test('each occurrence in the assembly carries its part\'s name', () => {
  // NEXT_ASSEMBLY_USAGE_OCCURRENCE('id','name',…): the name is the second argument.
  const occurrences = [...step.matchAll(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\('[^']*','((?:[^']|'')*)'/g)].map((m) => m[1]);
  assert.deepEqual(occurrences.sort(), [...PARTS].sort());
});

test('each solid carries its part\'s name, numbered where a part has several', () => {
  assert.deepEqual(namesOf(step, 'MANIFOLD_SOLID_BREP').sort(), ['H1', 'H2', 'N1.1', 'N1.2', 'S']);
  // And every shape representation that holds geometry is named after its product.
  for (const type of ['ADVANCED_BREP_SHAPE_REPRESENTATION', 'SHAPE_REPRESENTATION']) {
    for (const name of namesOf(step, type)) assert.ok([STEP_ASSEMBLY, ...PARTS].includes(name), `${type} named "${name}"`);
  }
});

test('read back by an assembly-aware reader, the names are where they were written', async () => {
  const occt = await OcctKernel.init();
  const doc = occt.importXCAFFromSTEP(step);
  try {
    const roots = doc.getRoots();
    assert.equal(roots.length, 1);
    assert.equal(doc.getLabelInfo(roots[0]!).name, STEP_ASSEMBLY);
    const children = doc.getChildren(roots[0]!).map((component) => {
      const prototype = doc.getReferredLabel(component)!;
      return [doc.getLabelInfo(component).name, doc.getLabelInfo(prototype).name];
    });
    assert.deepEqual(children.map(([occurrence]) => occurrence).sort(), [...PARTS].sort());
    for (const [occurrence, product] of children) assert.equal(occurrence, product);
  } finally {
    doc.close();
  }
});

test('without options a STEP file is written as before: free products, unnamed solids', () => {
  const tube = kernel.tube({ origin: [0, 0, 0], axis: [0, 0, 1] }, 50, 60, 0, 100);
  const plain = kernel.exportStep([
    { name: 'A', solids: [tube] },
    { name: 'B', solids: [kernel.translate(tube, [0, 0, 200])] },
  ]);
  assert.doesNotMatch(plain, /NEXT_ASSEMBLY_USAGE_OCCURRENCE/);
  assert.deepEqual(namesOf(plain, 'MANIFOLD_SOLID_BREP'), ['', '']);
});

test('naming leaves a name already written alone, and is idempotent', () => {
  const once = nameRepresentationItems(step);
  assert.equal(once, step);
  const text = [
    'ISO-10303-21;', 'HEADER;', 'ENDSEC;', 'DATA;',
    "#1 = SHAPE_DEFINITION_REPRESENTATION(#2,#5);",
    "#2 = PRODUCT_DEFINITION_SHAPE('','',#3);",
    "#3 = PRODUCT_DEFINITION('design','',#4,#9);",
    "#4 = PRODUCT_DEFINITION_FORMATION('','',#8);",
    "#5 = ADVANCED_BREP_SHAPE_REPRESENTATION('',(#6,#7),#9);",
    "#6 = MANIFOLD_SOLID_BREP('kept',#9);",
    "#7 = MANIFOLD_SOLID_BREP('',#9);",
    "#8 = PRODUCT('It''s','It''s','',(#9));",
    "#9 = PRODUCT_CONTEXT('',#9,'mechanical');",
    'ENDSEC;', 'END-ISO-10303-21;', '',
  ].join('\n');
  const named = nameRepresentationItems(text);
  assert.match(named, /ADVANCED_BREP_SHAPE_REPRESENTATION\('It''s',/);
  assert.match(named, /#6 = MANIFOLD_SOLID_BREP\('kept',/);
  assert.match(named, /#7 = MANIFOLD_SOLID_BREP\('It''s\.2',/);
  assert.equal(nameRepresentationItems(named), named);
});
