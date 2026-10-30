// The parametric definition of an assembly — the recipe the solids are rebuilt from.
//
// The canonical schema is the Java one: component kinds are `ComponentType`, dimensions are
// keyed on `CodeSymbol`, both in the lowercase wire form `/api/assemblies` returns them in, and
// every value is in the canonical unit of its symbol — millimetres for a length, degrees for an
// angle. Nothing here restates which dimensions a kind requires; `GET /api/components/types`
// is the authority for that. This file only names the ones the builders read.

/** The kinds of component, as `ComponentType.wireValue()` spells them. */
export const Kind = {
  CYLINDRICAL_SHELL: 'cylindrical_shell',
  CONICAL_SHELL: 'conical_shell',
  SPHERICAL_SHELL: 'spherical_shell',
  HEMISPHERICAL_HEAD: 'hemispherical_head',
  TORISPHERICAL_HEAD: 'torispherical_head',
  ELLIPSOIDAL_HEAD: 'ellipsoidal_head',
  FLAT_HEAD: 'flat_head',
  INTEGRAL_FLANGE: 'integral_flange',
  LOOSE_FLANGE: 'loose_flange',
  SPHERICALLY_DISHED_COVER: 'spherically_dished_cover',
  DISHED_COVER_TYPE_B: 'dished_cover_type_b',
  DISHED_COVER_TYPE_C: 'dished_cover_type_c',
  STIFFENING_RING: 'stiffening_ring',
  LARGE_STIFFENING_RING: 'large_stiffening_ring',
  RADIAL_NOZZLE: 'radial_nozzle',
  HILLSIDE_NOZZLE: 'hillside_nozzle',
  ANGLED_NOZZLE: 'angled_nozzle',
  PERPENDICULAR_NOZZLE: 'perpendicular_nozzle',
  AXIAL_NOZZLE: 'axial_nozzle',
  SADDLE_SUPPORT: 'saddle_support',
  SKIRT_SUPPORT: 'skirt_support',
  LUG_SUPPORT: 'lug_support',
  QUICK_ACTUATING_CLOSURE: 'quick_actuating_closure',
  STAYED_SURFACE: 'stayed_surface',
  RECTANGULAR_VESSEL: 'rectangular_vessel',
  OBROUND_VESSEL: 'obround_vessel',
  HALF_PIPE_JACKET: 'half_pipe_jacket',
} as const;

/** The dimensions the builders read, as `CodeSymbol.wireValue()` spells them. */
export const Sym = {
  INSIDE_DIAMETER: 'inside_diameter',
  THICKNESS: 'thickness',
  COURSE_LENGTH: 'course_length',
  CROWN_RADIUS: 'crown_radius',
  KNUCKLE_RADIUS: 'knuckle_radius',
  HEAD_HEIGHT: 'head_height',
  SMALL_END_DIAMETER: 'small_end_diameter',
  HALF_APEX_ANGLE: 'half_apex_angle',
  NOZZLE_INSIDE_DIAMETER: 'nozzle_inside_diameter',
  NOZZLE_THICKNESS: 'nozzle_thickness',
  NOZZLE_OUTWARD_PROJECTION: 'nozzle_outward_projection',
  NOZZLE_INWARD_PROJECTION: 'nozzle_inward_projection',
  PAD_WIDTH: 'pad_width',
  PAD_THICKNESS: 'pad_thickness',
  RING_HEIGHT: 'ring_height',
  RING_THICKNESS: 'ring_thickness',
  FLANGE_BORE: 'flange_bore',
  FLANGE_OUTSIDE_DIAMETER: 'flange_outside_diameter',
  HUB_SMALL_END_THICKNESS: 'hub_small_end_thickness',
  HUB_LARGE_END_THICKNESS: 'hub_large_end_thickness',
  HUB_LENGTH: 'hub_length',
  NOZZLE_OFFSET: 'nozzle_offset',
  NOZZLE_ANGLE: 'nozzle_angle',
  SADDLE_ANGLE: 'saddle_angle',
  SADDLE_WIDTH: 'saddle_width',
  SADDLE_DISTANCE: 'saddle_distance',
  WEAR_PLATE_THICKNESS: 'wear_plate_thickness',
  FLANGE_RING_THICKNESS: 'flange_ring_thickness',
  BOLT_CIRCLE: 'bolt_circle',
  BOLT_DIAMETER: 'bolt_diameter',
  BOLT_COUNT: 'bolt_count',
  STAY_PITCH: 'stay_pitch',
  STAY_DIAMETER: 'stay_diameter',
  SHORT_SIDE: 'short_side',
  LONG_SIDE: 'long_side',
  SHORT_SIDE_THICKNESS: 'short_side_thickness',
  LONG_SIDE_THICKNESS: 'long_side_thickness',
  HALF_PIPE_INSIDE_RADIUS: 'half_pipe_inside_radius',
  OBROUND_RADIUS: 'obround_radius',
  OBROUND_FLAT_HALF_LENGTH: 'obround_flat_half_length',
  CURVED_THICKNESS: 'curved_thickness',
  FLAT_THICKNESS: 'flat_thickness',
  STAY_PLANES: 'stay_planes',
  STAY_PLATE_THICKNESS: 'stay_plate_thickness',
  STIFFENER_PITCH: 'stiffener_pitch',
  STRAIGHT_FLANGE_LENGTH: 'straight_flange_length',
  SUPPORT_LUG_HEIGHT: 'support_lug_height',
  SUPPORT_LUG_PROJECTION: 'support_lug_projection',
  SUPPORT_LUG_GUSSET_SPACING: 'support_lug_gusset_spacing',
  SUPPORT_LUG_GUSSET_THICKNESS: 'support_lug_gusset_thickness',
  SUPPORT_LUG_BASE_PLATE_THICKNESS: 'support_lug_base_plate_thickness',
  OUTER_FILLET_WELD_LEG: 'outer_fillet_weld_leg',
  PAD_FILLET_WELD_LEG: 'pad_fillet_weld_leg',
  INNER_FILLET_WELD_LEG: 'inner_fillet_weld_leg',
  NOZZLE_SPACING: 'nozzle_spacing',
  SUPPORT_TO_DISCONTINUITY: 'support_to_discontinuity',
} as const;

/**
 * Kinds that are analyses rather than parts — a classification line, a collapse or fatigue
 * assessment, an overpressure argument. They are components of the assembly, so that the rules
 * can judge them, but there is no metal to draw.
 */
export const ANALYSIS_KINDS: ReadonlySet<string> = new Set([
  'stress_classification_line',
  'plastic_collapse_analysis',
  'fatigue_assessment',
  'overpressure_protection_by_design',
]);

/**
 * An assumption the drawing had to make, naming the symbol that would have spared it when there
 * is one.
 *
 * On screen it is shown and the drawing goes ahead. Under analysis it is a refusal: a mesh of an
 * assumed length is an invented number. `analysisOnly` marks an approximation that is harmless
 * on screen — a weld drawn on the tangent line — and is not worth showing there.
 */
export interface Note {
  readonly message: string;
  /** A `CodeSymbol` wire value. */
  readonly symbol?: string;
  readonly analysisOnly?: boolean;
}

export const note = (message: string, symbol?: string): Note => (symbol ? { message, symbol } : { message });

export const analysisNote = (message: string, symbol?: string): Note =>
  symbol ? { message, symbol, analysisOnly: true } : { message, analysisOnly: true };

/** One part, as the platform stores it. */
export interface ComponentDefinition {
  readonly id: string;
  readonly name: string;
  /** A `ComponentType` wire value. */
  readonly kind: string;
  /** Order along the axis; meaningless for a mounted part. */
  readonly position: number;
  /** The part it is mounted on, null for a part of the axial run. */
  readonly hostId: string | null;
  /** Canonical values keyed on `CodeSymbol` wire values. */
  readonly dimensions: Readonly<Record<string, number>>;
}

/**
 * The surface of its host a mounted part is anchored on.
 *
 * - `shell_side` — the side of a course. `axialOffset` runs along the vessel axis from the
 *   course's lower end.
 * - `head_crown` — a head or flat end. `axialOffset` is the radial distance from the vessel axis,
 *   and the part stands parallel to that axis.
 */
export type PlacementAnchor = 'shell_side' | 'head_crown';

/**
 * Where a mounted part sits on its host, stated in the host's own parameters.
 *
 * This is the semantic anchor: never a face or an edge index, which a rebuild renumbers. A
 * change of the host's diameter keeps offset and azimuth, and the opening is derived again.
 */
export interface Placement {
  readonly anchor: PlacementAnchor;
  /** Millimetres; see {@link PlacementAnchor} for what it is measured along. */
  readonly axialOffset: number;
  /** Degrees around the vessel axis, from +X towards +Y. */
  readonly azimuth: number;
}

export interface AssemblyDefinition {
  readonly components: readonly ComponentDefinition[];
  /** Keyed on the mounted component's id. A mounted part with none gets a default placement. */
  readonly placements: Readonly<Record<string, Placement>>;
  /** Parts of the axial run drawn upside down: a cone with its small end first. */
  readonly reversed: readonly string[];
  /** The layout revision the placements were read at, carried onto what is measured from them. */
  readonly layoutRevision?: number;
}

/** Parts of the run that close it: drawn turned over when they close its bottom. */
export const RUN_KINDS_THAT_CLOSE: ReadonlySet<string> = new Set([
  Kind.HEMISPHERICAL_HEAD,
  Kind.TORISPHERICAL_HEAD,
  Kind.ELLIPSOIDAL_HEAD,
  Kind.FLAT_HEAD,
  Kind.SPHERICALLY_DISHED_COVER,
  Kind.DISHED_COVER_TYPE_B,
  Kind.DISHED_COVER_TYPE_C,
  Kind.QUICK_ACTUATING_CLOSURE,
  Kind.STAYED_SURFACE,
]);

/** Reads one dimension, or says which part lacks it. */
export function requireDimension(component: ComponentDefinition, symbol: string): number {
  const value = component.dimensions[symbol];
  if (value === undefined || !Number.isFinite(value)) {
    throw new BuildError(component, `has no ${symbol.replace(/_/g, ' ')}`);
  }
  if (value <= 0) {
    throw new BuildError(component, `has a ${symbol.replace(/_/g, ' ')} of ${value}`);
  }
  return value;
}

/** A dimension that may be zero — zero being an answer, absence the question unasked. */
export function signedDimension(component: ComponentDefinition, symbol: string): number | undefined {
  const value = component.dimensions[symbol];
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

export function optionalDimension(
  component: ComponentDefinition,
  symbol: string
): number | undefined {
  const value = component.dimensions[symbol];
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** A part whose own dimensions do not describe a solid. */
export class BuildError extends Error {
  readonly componentId: string;

  constructor(component: Pick<ComponentDefinition, 'id' | 'name'>, message: string) {
    super(`${component.name} ${message}`);
    this.name = 'BuildError';
    this.componentId = component.id;
  }
}

/**
 * Something the modeller cannot draw yet — a ring on a head, a part on a flange. Not an error in
 * the assembly: the engine may well verify it. The part is reported as not drawn.
 */
export class NotDrawnError extends Error {
  readonly componentId: string;

  constructor(component: Pick<ComponentDefinition, 'id' | 'name'>, message: string) {
    super(`${component.name}: ${message}`);
    this.name = 'NotDrawnError';
    this.componentId = component.id;
  }
}

/**
 * A semantic anchor that does not resolve — a nozzle placed beyond its course, on a host that is
 * gone or that cannot carry it. Raised loudly and naming the anchor, never resolved by guessing.
 */
export class AnchorError extends Error {
  readonly componentId: string;

  constructor(component: Pick<ComponentDefinition, 'id' | 'name'>, message: string) {
    super(`${component.name}: ${message}`);
    this.name = 'AnchorError';
    this.componentId = component.id;
  }
}
