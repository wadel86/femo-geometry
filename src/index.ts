// @femo/geometry — parametric B-Rep builders for design-by-rule assemblies.
//
// Kernel-agnostic: import a kernel implementation separately (`@femo/geometry/brepjs`), so that
// the multi-megabyte WASM binary is only ever loaded where it is asked for.
export * from './definition.ts';
export type * from './kernel/GeometryKernel.ts';
export type * from './builders/types.ts';
export { RUN_BUILDERS } from './builders/runParts.ts';
export { MOUNTED_BUILDERS } from './builders/mounted.ts';
export {
  AssemblyBuilder,
  assemblyBounds,
  tessellationTolerance,
  toAssembly,
  type AssemblyModel,
  type BuiltPart,
  type Opening,
  type PartStatus,
  type PartTransform,
} from './assembly/buildAssembly.ts';
export {
  tessellateModel,
  type EntityRange,
  type PartMesh,
  type SolidMesh,
} from './assembly/tessellateModel.ts';
export {
  describePart,
  type EntityDescriptor,
  type EntityDimension,
  type PartDescription,
} from './topology/describe.ts';
export { shortHash, stableStringify } from './hash.ts';
