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
  runOrder,
  tessellationTolerance,
  toAssembly,
  toAssemblyVector,
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
export {
  describeGeometry,
  type EdgeDescriptor,
  type FaceDescriptor,
  type PartDescriptors,
} from './topology/descriptors.ts';
export { derivePorts, type Joint, type JointKind, type Port, type PortKind, type PortsAndJoints } from './ports/ports.ts';
export {
  ZONE_FACTOR,
  deriveZones,
  type Discontinuity,
  type DiscontinuityKind,
  type Measured,
  type MeasurementIssue,
  type Proximity,
  type Zones,
} from './ports/zones.ts';
export {
  GEOMETRY_FORMAT_VERSION,
  RefusedError,
  namingTolerance,
  refusalsOf,
  resolveGeometry,
  stepOf,
  type GeometryMode,
  type Refusal,
  type ResolveOptions,
  type ResolvedGeometry,
  type ResolvedPart,
} from './assembly/resolve.ts';
export { shortHash, stableStringify } from './hash.ts';
