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
  U_TUBE_TUBESHEET: 'u_tube_tubesheet',
  FIXED_TUBESHEET: 'fixed_tubesheet',
  FLOATING_TUBESHEET_IMMERSED: 'floating_tubesheet_immersed',
  FLOATING_TUBESHEET_EXTERNALLY_SEALED: 'floating_tubesheet_externally_sealed',
  FLOATING_TUBESHEET_INTERNALLY_SEALED: 'floating_tubesheet_internally_sealed',
  U_SHAPED_BELLOWS_AS_FORMED: 'u_shaped_bellows_as_formed',
  U_SHAPED_BELLOWS_ANNEALED: 'u_shaped_bellows_annealed',
  U_SHAPED_REINFORCED_BELLOWS_AS_FORMED: 'u_shaped_reinforced_bellows_as_formed',
  U_SHAPED_REINFORCED_BELLOWS_ANNEALED: 'u_shaped_reinforced_bellows_annealed',
  TOROIDAL_BELLOWS: 'toroidal_bellows',
  FLANGED_AND_FLUED_EXPANSION_JOINT: 'flanged_and_flued_expansion_joint',
  CLAMPED_CONNECTION: 'clamped_connection',
  DISHED_COVER_TYPE_D: 'dished_cover_type_d',
  JACKET_CLOSURE: 'jacket_closure',
  OCTAGONAL_VESSEL: 'octagonal_vessel',
  PRESSURE_RELIEF_DEVICE: 'pressure_relief_device',
  // Draft kinds: drawn by the catalogue's wave 1b, with no `ComponentType` behind them yet. The
  // backend cannot store one, so they live in draft entries' specimens until it can.
  ECCENTRIC_CONICAL_SHELL: 'eccentric_conical_shell',
  LEG_SUPPORT: 'leg_support',
  PASS_PARTITION_PLATE: 'pass_partition_plate',
  TUBE_BUNDLE: 'tube_bundle',
  // CODAP 2005 Partie C parts that Part 4 does not size: C9.6's lifting lug and C9.3.3's
  // support ring. Draft kinds for the same reason as the four above.
  LIFTING_LUG: 'lifting_lug',
  SUPPORT_RING: 'support_ring',
  // EN 13445-3 §16.13: a ring round a vertical vessel, carried on local supports. A draft kind
  // for the same reason; CODAP's support_ring is a horizontal vessel's, standing on the ground.
  RING_SUPPORT: 'ring_support',
} as const;

/** The kinds above that only the catalogue's draft entries know: no `ComponentType` names them. */
export const DRAFT_KINDS: ReadonlySet<string> = new Set([
  Kind.ECCENTRIC_CONICAL_SHELL,
  Kind.LEG_SUPPORT,
  Kind.PASS_PARTITION_PLATE,
  Kind.TUBE_BUNDLE,
  Kind.LIFTING_LUG,
  Kind.SUPPORT_RING,
  Kind.RING_SUPPORT,
]);

/** The dimensions the builders read, as `CodeSymbol.wireValue()` spells them. */
export const Sym = {
  INSIDE_DIAMETER: 'inside_diameter',
  THICKNESS: 'thickness',
  COURSE_LENGTH: 'course_length',
  CROWN_RADIUS: 'crown_radius',
  KNUCKLE_RADIUS: 'knuckle_radius',
  FLARE_RADIUS: 'flare_radius',
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
  // A saddle's construction, for the drawing alone: no rule reads them.
  SADDLE_HEIGHT: 'saddle_height',
  SADDLE_BEARING_PLATE_THICKNESS: 'saddle_bearing_plate_thickness',
  SADDLE_WEB_THICKNESS: 'saddle_web_thickness',
  SADDLE_RIB_COUNT: 'saddle_rib_count',
  SADDLE_RIB_THICKNESS: 'saddle_rib_thickness',
  SADDLE_BASE_PLATE_THICKNESS: 'saddle_base_plate_thickness',
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
  // §4.18, the tubesheet and its bundle.
  TUBE_PITCH: 'tube_pitch',
  TUBE_OUTSIDE_DIAMETER: 'tube_outside_diameter',
  TUBE_THICKNESS: 'tube_thickness',
  TUBE_LIMIT_RADIUS: 'tube_limit_radius',
  TUBE_LAYOUT_ANGLE: 'tube_layout_angle',
  TUBE_LENGTH_OUTER: 'tube_length_outer',
  TUBE_HOLE_DIAMETER: 'tube_hole_diameter',
  SHELL_INSIDE_DIAMETER: 'shell_inside_diameter',
  CHANNEL_INSIDE_DIAMETER: 'channel_inside_diameter',
  SHELL_THICKNESS: 'shell_thickness',
  CHANNEL_THICKNESS: 'channel_thickness',
  /** §4.18.10's tube-to-tubesheet weld legs, Figure 4.18.13. */
  FILLET_WELD_LEG: 'fillet_weld_leg',
  GROOVE_WELD_LEG: 'groove_weld_leg',
  // Draft symbols, read only by the draft kinds above: no `CodeSymbol` names them yet.
  /** Which way an eccentric cone's tangent side faces, degrees round the axis from +X. */
  FLAT_SIDE_AZIMUTH: 'flat_side_azimuth',
  LEG_OUTSIDE_DIAMETER: 'leg_outside_diameter',
  LEG_THICKNESS: 'leg_thickness',
  /** From the top of the leg's weld to the underside of its base plate. */
  LEG_LENGTH: 'leg_length',
  /** How far down the shell the leg is welded, from its top. */
  LEG_ATTACHMENT_LENGTH: 'leg_attachment_length',
  PASS_PARTITION_THICKNESS: 'pass_partition_thickness',
  /**
   * CODAP C2.3.8's δ, on a `conical_shell`: how far apart the parallel axes of the two cylinders
   * it joins are. Absent or zero, the cone is symmetric. A `CodeSymbol` of the rules engine
   * already (`CONE_AXIS_OFFSET`), so this spelling is the engine's, not a draft one.
   */
  CONE_AXIS_OFFSET: 'cone_axis_offset',
  /** CODAP C3.2.6's r_d: the radius of a flat head's relief groove. */
  RELIEF_GROOVE_RADIUS: 'relief_groove_radius',
  /** CODAP C3.2.6's e_r: what is left of the head at the bottom of its relief groove. */
  GROOVE_REMAINING_THICKNESS: 'groove_remaining_thickness',
  // CODAP C9.6, Figure C9.6.2.4-1: a lifting lug and its pad, in the Code's own letters.
  /** b_1: the lug's length where it is welded to the shell or its pad. */
  LIFTING_LUG_BASE_LENGTH: 'lifting_lug_base_length',
  /** a_2: from the shell or pad to the centre of the hole. */
  LIFTING_LUG_HOLE_HEIGHT: 'lifting_lug_hole_height',
  /** a_1: the hole's offset from the middle of b_1, along it. Zero for a symmetric lug. */
  LIFTING_LUG_HOLE_OFFSET: 'lifting_lug_hole_offset',
  LIFTING_LUG_HOLE_DIAMETER: 'lifting_lug_hole_diameter',
  LIFTING_LUG_THICKNESS: 'lifting_lug_thickness',
  /** The radius of metal round the hole. No rule reads it; drawn as the hole's diameter if unsaid. */
  LIFTING_LUG_TOP_RADIUS: 'lifting_lug_top_radius',
  /** 0 when the lug's plane holds the vessel axis (C9.6.2.4-1), 90 when it is square to it (-2). */
  LIFTING_LUG_ORIENTATION: 'lifting_lug_orientation',
  /** b_3, along the lug's base, and b_2 across it; its thickness is `pad_thickness`, the Code's e_2. */
  LIFTING_LUG_PAD_LENGTH: 'lifting_lug_pad_length',
  LIFTING_LUG_PAD_WIDTH: 'lifting_lug_pad_width',
  // CODAP C9.3.3.1.7: a support ring and what carries it, Figures C9.3.3.1.7-2 and -3. The ring
  // itself is `ring_height` by `ring_thickness`, as a stiffening ring is.
  /** δ_a: the angle between the two supports, at the axis, symmetric about the bottom. */
  SUPPORT_OPENING_ANGLE: 'support_opening_angle',
  /** 0 for a cradle — both posts on one base — and 2 for two links, each on its own. */
  SUPPORT_RING_LINKS: 'support_ring_links',
  /** From the bottom of the ring to the underside of the base plate. */
  SUPPORT_HEIGHT: 'support_height',
  /** A post's width in the ring's plane; along the axis it is as wide as the ring. */
  SUPPORT_POST_WIDTH: 'support_post_width',
  // EN 13445-3 §21, Figures 21.2-1 to 21.2-4: a flat end stiffened by radial ribs on its outer face.
  /** n_V: how many ribs, evenly spaced; §21.1 keeps it within 3 to 24. */
  RADIAL_STIFFENER_COUNT: 'radial_stiffener_count',
  /** h: how far a rib stands off the plate. */
  RADIAL_STIFFENER_HEIGHT: 'radial_stiffener_height',
  /** e_R. */
  RADIAL_STIFFENER_THICKNESS: 'radial_stiffener_thickness',
  /** d_1: the outside diameter of the central ring or core the ribs are welded to. */
  CENTRAL_RING_DIAMETER: 'central_ring_diameter',
  /** e_C: the central ring's wall. Unstated, the centre is a solid core. */
  CENTRAL_RING_THICKNESS: 'central_ring_thickness',
  /** d_4: the plate's outside diameter, where it overhangs the shell (Figure 21.2-1 a). */
  PLATE_OUTSIDE_DIAMETER: 'plate_outside_diameter',
  /** EN 13445-3 §10.7.3's D_Y: the bore of an annular flat end, where an inner shell meets it. */
  ANNULUS_INSIDE_DIAMETER: 'annulus_inside_diameter',
  // EN 13445-3 §16.12.5, Figures 16.12-7 to 16.12-10: a skirt's base, in the Code's letters.
  /** 1 a plain base plate, 2 with gussets, 3 with chairs, 4 with a top ring. */
  SKIRT_BASE_TYPE: 'skirt_base_type',
  /** b_1: the base plate's radial width. */
  BASE_PLATE_WIDTH: 'base_plate_width',
  /** b_2: how far the base plate reaches past the skirt's outside. */
  BASE_PLATE_PROJECTION: 'base_plate_projection',
  /** e_4. */
  BASE_PLATE_THICKNESS: 'base_plate_thickness',
  /** n_B. */
  ANCHOR_BOLT_COUNT: 'anchor_bolt_count',
  /** d_B0. */
  ANCHOR_BOLT_DIAMETER: 'anchor_bolt_diameter',
  /** b_3: from the skirt's outside to the bolt circle. */
  ANCHOR_BOLT_OFFSET: 'anchor_bolt_offset',
  /** h_1: the gussets' height (Type 2), or the whole base assembly's (Types 3 and 4). */
  BASE_GUSSET_HEIGHT: 'base_gusset_height',
  /** e_7: a gusset's or support plate's thickness. */
  BASE_GUSSET_THICKNESS: 'base_gusset_thickness',
  /** b_6: the arc between the two plates flanking a bolt. Unstated on Types 2 and 4, one plate between bolts. */
  BASE_GUSSET_SPACING: 'base_gusset_spacing',
  /** b_5: the top plate's radial reach past the skirt's outside. */
  TOP_PLATE_WIDTH: 'top_plate_width',
  /** b_4: a Type 3 chair's top plate, round the circumference. */
  TOP_PLATE_LENGTH: 'top_plate_length',
  /** e_5. */
  TOP_PLATE_THICKNESS: 'top_plate_thickness',
  /** Figure 16.12-1's h: the forged ring a Geometry A skirt hangs from. */
  SKIRT_RING_HEIGHT: 'skirt_ring_height',
  // EN 13445-3 §16.12.4, Figures 16.12-5 and -6: access openings through a skirt.
  SKIRT_OPENING_DIAMETER: 'skirt_opening_diameter',
  /** 1, or 2 facing each other. */
  SKIRT_OPENING_COUNT: 'skirt_opening_count',
  /** From the skirt's free end — its base — to the opening's centre. */
  SKIRT_OPENING_ELEVATION: 'skirt_opening_elevation',
  // EN 13445-3 §16.13, Figures 16.13-1 and 16.13-2: a ring support on a vertical vessel.
  /** 0 a solid rectangle, 1 a box, 2 a U, 3 an L (Figure 16.13-2). */
  RING_SUPPORT_SECTION: 'ring_support_section',
  /** b: the ring's radial width. */
  RING_SUPPORT_WIDTH: 'ring_support_width',
  /** h: the ring's height along the axis. */
  RING_SUPPORT_HEIGHT: 'ring_support_height',
  /** e_3 = e_4 = e_5: the plates a built-up section is made of. */
  RING_SUPPORT_PLATE_THICKNESS: 'ring_support_plate_thickness',
  /** n_s: 2, 3, 4, 6 or 8, the counts Figures 16.13-3 to -6 tabulate. */
  RING_SUPPORT_COUNT: 'ring_support_count',
  /** 0 integral, welded to the vessel (Figure 16.13-1 a); 1 independent, loose round it (b). */
  RING_SUPPORT_INDEPENDENT: 'ring_support_independent',
  /** t_0: the gap between an independent ring and the vessel. */
  RING_SUPPORT_CLEARANCE: 'ring_support_clearance',
  // §4.19, bellows.
  BELLOWS_INSIDE_DIAMETER: 'bellows_inside_diameter',
  CONVOLUTION_HEIGHT: 'convolution_height',
  CONVOLUTION_PITCH: 'convolution_pitch',
  CONVOLUTION_COUNT: 'convolution_count',
  PLY_COUNT: 'ply_count',
  END_TANGENT_LENGTH: 'end_tangent_length',
  TORUS_RADIUS: 'torus_radius',
  TOROIDAL_RADIUS: 'toroidal_radius',
  TOROIDAL_WELD_SPACING: 'toroidal_weld_spacing',
  REINFORCING_RING_AREA: 'reinforcing_ring_area',
  COLLAR_THICKNESS: 'collar_thickness',
  COLLAR_LENGTH: 'collar_length',
  // §4.17, clamp connections.
  GASKET_CONTACT_DIAMETER: 'gasket_contact_diameter',
  CLAMP_TAPER_ANGLE: 'clamp_taper_angle',
  HUB_SHOULDER_THICKNESS: 'hub_shoulder_thickness',
  HUB_NECK_OUTSIDE_DIAMETER: 'hub_neck_outside_diameter',
  CLAMP_INSIDE_DIAMETER: 'clamp_inside_diameter',
  CLAMP_WIDTH: 'clamp_width',
  CLAMP_THICKNESS: 'clamp_thickness',
  // §4.11, jacket closures.
  JACKET_THICKNESS: 'jacket_thickness',
  CLOSURE_THICKNESS: 'closure_thickness',
  JACKET_INSIDE_RADIUS: 'jacket_inside_radius',
  JACKET_SPACE: 'jacket_space',
  // §4.12 Table 4.12.7, the reinforced octagon.
  OCTAGON_HALF_WIDTH: 'octagon_half_width',
  OCTAGON_HALF_HEIGHT: 'octagon_half_height',
  SHORT_STIFFENER_HALF_LENGTH: 'short_stiffener_half_length',
  SHORT_BARE_HALF_LENGTH: 'short_bare_half_length',
  LONG_STIFFENER_HALF_LENGTH: 'long_stiffener_half_length',
  LONG_BARE_HALF_LENGTH: 'long_bare_half_length',
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
  /** What it refuses, in the terms a refusal must name. */
  readonly scope?: Scope;
}

/**
 * Why something is refused for analysis. The first four leave the equipment as specified; only
 * `assumed` puts something into it that nobody specified.
 *
 * - `out_of_scope` — a parameter outside the range the entry draws.
 * - `not_built` — a feature the specification states and the entry does not build.
 * - `represented` — the same equipment, drawn as an approximation of itself.
 * - `mismatch` — two statements, or two parts, that disagree.
 * - `assumed` — a value the specification is silent on, which the drawing had to choose.
 */
export type RefusalReason = 'out_of_scope' | 'not_built' | 'represented' | 'mismatch' | 'assumed';

/**
 * What a refusal names, as the Build Directives require: the parameter that fell outside, the
 * limit, and the value seen. Each as it reads, units included.
 */
export interface Scope {
  readonly reason: RefusalReason;
  readonly parameter: string;
  readonly limit: string;
  readonly value: string;
}

export const scope = (reason: RefusalReason, parameter: string, limit: string, value: string): Scope => ({
  reason,
  parameter,
  limit,
  value,
});

// The scope is required: a refusal that names no parameter, limit and value cannot be judged.
export const note = (message: string, symbol: string | undefined, scoped: Scope): Note => ({
  message,
  ...(symbol ? { symbol } : {}),
  scope: scoped,
});

export const analysisNote = (message: string, symbol: string | undefined, scoped: Scope): Note => ({
  ...note(message, symbol, scoped),
  analysisOnly: true,
});

/** A dimension the drawing had to choose: stated nowhere, drawn at `drawn`. */
export const assumedNote = (message: string, symbol: string, drawn: string): Note =>
  note(message, symbol, scope('assumed', symbol, 'stated', `not stated — drawn ${drawn}`));

/** A feature stated and not built: the entry's scope stops short of it. */
export const notBuiltNote = (message: string, symbol: string, stated: string, entry: string, analysisOnly = false): Note =>
  (analysisOnly ? analysisNote : note)(message, symbol, scope('not_built', symbol, `not built by ${entry}`, stated));

/** The same equipment, drawn as an approximation of itself. */
export const representedNote = (message: string, parameter: string, specified: string, drawn: string, analysisOnly = false): Note =>
  (analysisOnly ? analysisNote : note)(message, undefined, scope('represented', parameter, specified, drawn));

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
  /**
   * What the fabricator specifies at a joint, keyed on its id — `<lowerId>:<port>~<upperId>:<port>`,
   * the id {@link derivePorts} gives it — or, for a joint of the run, on the two parts it joins,
   * `<idA>~<idB>` in either order: a key that survives turning a cone round, which changes its
   * ports. A joint with none is drawn at the code minimum.
   */
  readonly joints?: Readonly<Record<string, JointParameters>>;
  /**
   * How the equipment was made, declared in layers — a standards profile, the project, the
   * equipment, a joint — each overriding the one before: see `details/constructionDetails.ts`.
   * Resolved into `joints` and into the parts' dimensions by `applyConstructionDetails` before
   * anything is built; absent, nothing changes.
   */
  readonly details?: DetailLayers;
}

/** A construction detail's value: a length in millimetres, a ratio, or one of its named options. */
export type DetailValue = number | string;

/** Construction details keyed on their wire names (`Detail` in `details/constructionDetails.ts`). */
export type ConstructionDetailValues = Readonly<Record<string, DetailValue>>;

/** The layers construction details are declared in, from the least specific to the most. */
export interface DetailLayers {
  /** The entity's standards profile: what an EPC declares once for every equipment it builds. */
  readonly profile?: { readonly name: string; readonly details: ConstructionDetailValues };
  readonly project?: ConstructionDetailValues;
  readonly equipment?: ConstructionDetailValues;
  /**
   * Per joint, keyed as {@link AssemblyDefinition.joints} is: `<idA>~<idB>` for two parts of the
   * run, `<nozzleId>~<hostId>` for a nozzle in its host.
   */
  readonly joints?: Readonly<Record<string, ConstructionDetailValues>>;
}

/** §6.1.6.2: the thicker of two butt welded walls is faired "at least 3 to 1". */
export const MINIMUM_TAPER_RATIO = 3;
/**
 * Past this a taper is a transition piece, not a fairing: draw it as a cone of its own. The
 * modeller's range, not the Code's — the Code sets a floor and no ceiling.
 */
export const MAXIMUM_TAPER_RATIO = 10;

export interface JointParameters {
  /** Length over thickness step of the fairing on the thicker wall; the code minimum when unstated. */
  readonly taperRatio?: number;
  /**
   * Which surface runs on across a change of thickness, and so which side the taper is cut on:
   * inside flush (the step outside), outside flush (the step inside) or mid-wall (half each).
   * Unstated, the joint is drawn as it always was — inside flush, and only where the bores match.
   */
  readonly alignment?: AlignmentDatum;
  /** A nozzle's corner where its neck meets its host's outside surface, rounded; 0 or unstated is sharp. */
  readonly outsideCornerRadius?: number;
  /** A nozzle's corner where its bore meets its host's inside surface, rounded; 0 or unstated is sharp. */
  readonly insideCornerRadius?: number;
}

export type AlignmentDatum = 'inside_flush' | 'outside_flush' | 'mid_wall';

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
  Kind.DISHED_COVER_TYPE_D,
]);

/** Reads one dimension, or says which part lacks it. */
export function requireDimension(component: ComponentDefinition, symbol: string): number {
  const value = component.dimensions[symbol];
  if (value === undefined || !Number.isFinite(value)) {
    throw new BuildError(component, `has no ${symbol.replace(/_/g, ' ')}`, scope('out_of_scope', symbol, 'required', 'not stated'));
  }
  if (value <= 0) {
    throw new BuildError(component, `has a ${symbol.replace(/_/g, ' ')} of ${value}`, scope('out_of_scope', symbol, '> 0', `${value}`));
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
  readonly scope: Scope;

  constructor(component: Pick<ComponentDefinition, 'id' | 'name'>, message: string, scoped: Scope) {
    super(`${component.name} ${message}`);
    this.name = 'BuildError';
    this.componentId = component.id;
    this.scope = scoped;
  }
}

/**
 * Something the modeller cannot draw yet — a ring on a head, a part on a flange. Not an error in
 * the assembly: the engine may well verify it. The part is reported as not drawn.
 */
export class NotDrawnError extends Error {
  readonly componentId: string;
  readonly scope: Scope;

  constructor(component: Pick<ComponentDefinition, 'id' | 'name'>, message: string, scoped: Scope) {
    super(`${component.name}: ${message}`);
    this.name = 'NotDrawnError';
    this.componentId = component.id;
    this.scope = scoped;
  }
}

/**
 * A semantic anchor that does not resolve — a nozzle placed beyond its course, on a host that is
 * gone or that cannot carry it. Raised loudly and naming the anchor, never resolved by guessing.
 */
export class AnchorError extends Error {
  readonly componentId: string;
  readonly scope: Scope;

  constructor(component: Pick<ComponentDefinition, 'id' | 'name'>, message: string, scoped: Scope) {
    super(`${component.name}: ${message}`);
    this.name = 'AnchorError';
    this.componentId = component.id;
    this.scope = scoped;
  }
}
