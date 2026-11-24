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
  /**
   * A Y-shaped forging in the run: its upper leg continues the course above, its inner leg
   * carries the head below, its outer leg is the top of a skirt, flush with the shell's outside.
   */
  FORGED_TRANSITION_RING: 'forged_transition_ring',
  /** A forged boss set into a head at its pole, replacing a patch of the wall (EPR accumulator). */
  HEAD_POLE_BOSS: 'head_pole_boss',
  /**
   * EN 13445-3 §16.13: a ring round a VERTICAL vessel, carried on local supports — the engine's
   * `VERTICAL_SUPPORT_RING`. Not its `RING_SUPPORT`, which is §16.9's ring under a horizontal one.
   */
  VERTICAL_SUPPORT_RING: 'vertical_support_ring',
  /**
   * EN 13445-3 §16.9 and CODAP C9.3.3: a ring round a HORIZONTAL vessel, on a cradle or two links —
   * the engine's `RING_SUPPORT`, on its symbols. Was the draft kind `support_ring` until 2026-11-24.
   */
  RING_SUPPORT: 'ring_support',
  /**
   * A forged boss set into a cylindrical shell, radial or tilted — a manhole forging carrying its
   * own reinforcement: head_pole_boss's family on a course. The engine's `SHELL_BOSS`, catalogued
   * on develop (TRESCA DBR, 2026-11-24) on the same symbols.
   */
  SHELL_BOSS: 'shell_boss',
  // Catalogued on develop f88499d (TRESCA DBR, 2026-11-24) on the kernel's names: RCC-M B/C/D
  // 3600's straight pipe and bend, both stated on their OUTSIDE diameter, which C3641.1's t_m
  // reads; and H3232 / Annexe ZVI's linear support member — a strut, tie, column or beam holding a
  // vessel up, mounted on the part it carries.
  PIPE_SEGMENT: 'pipe_segment',
  PIPE_BEND: 'pipe_bend',
  LINEAR_SUPPORT_MEMBER: 'linear_support_member',
  // Draft kinds: drawn by the catalogue's wave 1b, with no `ComponentType` behind them yet. The
  // backend cannot store one, so they live in draft entries' specimens until it can.
  ECCENTRIC_CONICAL_SHELL: 'eccentric_conical_shell',
  LEG_SUPPORT: 'leg_support',
  PASS_PARTITION_PLATE: 'pass_partition_plate',
  TUBE_BUNDLE: 'tube_bundle',
  // CODAP 2005 Partie C's C9.6 lifting lug, which Part 4 does not size. A draft kind for the same
  // reason as the four above.
  LIFTING_LUG: 'lifting_lug',
  // A shell-and-tube exchanger's single-segmental baffles, the whole set as one part. No ASME
  // VIII-2 clause sizes a baffle; whether it becomes a `ComponentType` is TRESCA DBR's call.
  SEGMENTAL_BAFFLES: 'segmental_baffles',
  // RCC-M C3540: a valve body in the line, judged on its pressure series and bore rather than a
  // stress formula, and C3431–C3434's radially split volute pump casing. Catalogued on develop
  // (TRESCA DBR, merged 2026-11-25).
  VALVE_BODY: 'valve_body',
  PUMP_CASING: 'pump_casing',
  // RCC-M B3683.9: a butt-welding tee in the run. Catalogued on develop (TRESCA DBR 9da807f,
  // merged in e59258b).
  PIPE_TEE: 'pipe_tee',
  // RCC-M B3683.6: a concentric butt-welding reducer in the run. Catalogued on develop (TRESCA
  // DBR fd8c01b, in 3ac0e1d).
  PIPE_REDUCER: 'pipe_reducer',
} as const;

/** The kinds above that only the catalogue's draft entries know: no `ComponentType` names them. */
export const DRAFT_KINDS: ReadonlySet<string> = new Set([
  Kind.ECCENTRIC_CONICAL_SHELL,
  Kind.LEG_SUPPORT,
  Kind.PASS_PARTITION_PLATE,
  Kind.TUBE_BUNDLE,
  Kind.LIFTING_LUG,
  Kind.SEGMENTAL_BAFFLES,
]);

/** The dimensions the builders read, as `CodeSymbol.wireValue()` spells them. */
export const Sym = {
  INSIDE_DIAMETER: 'inside_diameter',
  THICKNESS: 'thickness',
  COURSE_LENGTH: 'course_length',
  CROWN_RADIUS: 'crown_radius',
  KNUCKLE_RADIUS: 'knuckle_radius',
  FLARE_RADIUS: 'flare_radius',
  /** §4.3.12's t_k and t_f: a knuckle or flare formed from plate other than the cone's own. */
  KNUCKLE_THICKNESS: 'knuckle_thickness',
  FLARE_THICKNESS: 'flare_thickness',
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
  // A tube bundle's pass lanes: rows left out of the pattern where a pass partition plate stands
  // in the channel, each a straight lane through the axis.
  /**
   * N_t as the design states it, beside the pattern drawn — a count from Taborek's Eq. (8.109) is
   * an estimate, not a layout. The engine's `TUBE_COUNT` wire value.
   */
  TUBE_COUNT: 'tube_count',
  /** w_p: the clear gap across a lane, tube edge to tube edge. */
  PASS_LANE_WIDTH: 'pass_lane_width',
  /** Which way the first lane runs, degrees round the axis from +X; absent, 0. */
  PASS_LANE_AZIMUTH: 'pass_lane_azimuth',
  /** How many lanes, equally spaced through the axis; absent, 1. Two make a four-pass quadrant. */
  PASS_LANE_COUNT: 'pass_lane_count',
  // Single-segmental baffles, in Shah & Sekulić's letters (§8.5.2).
  /** l_c: the window's height, from the shell's inside wall to the cut. */
  BAFFLE_CUT_LENGTH: 'baffle_cut_length',
  BAFFLE_THICKNESS: 'baffle_thickness',
  /** L_b,c: the central spacing, mid-plane to mid-plane. */
  BAFFLE_SPACING: 'baffle_spacing',
  /** L_b,i: from the course's low end to the first baffle's mid-plane; absent, L_b,c. */
  BAFFLE_INLET_SPACING: 'baffle_inlet_spacing',
  /** L_b,o: from the last baffle's mid-plane to the course's high end, at least; absent, L_b,i. */
  BAFFLE_OUTLET_SPACING: 'baffle_outlet_spacing',
  /** N_b; absent, Eq. (8.126)'s count rounded down: the baffles that fit. */
  BAFFLE_COUNT: 'baffle_count',
  /** δ_sb: the diametral clearance between the shell's bore and a baffle. */
  SHELL_BAFFLE_CLEARANCE: 'shell_baffle_clearance',
  /** δ_tb: the diametral clearance between a tube and its hole in a baffle. */
  TUBE_BAFFLE_CLEARANCE: 'tube_baffle_clearance',
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
  // §16.9's ring on a horizontal vessel (the engine's RING_SUPPORT), on the engine's symbols. Its
  // radial height is SUPPORT_RING_HEIGHT (h1a), shared with §16.13's ring where it runs axially.
  /** e1a: the web's thickness along the axis — a flat bar's whole thickness. */
  SUPPORT_RING_WEB_THICKNESS: 'support_ring_web_thickness',
  /** t_ring: the ring's contact width on the shell — a flat bar's thickness. */
  SUPPORT_RING_CONTACT_WIDTH: 'support_ring_contact_width',
  /** A_R: the ring's cross-sectional area, without the shell. */
  SUPPORT_RING_AREA: 'support_ring_area',
  /** h_G: the ring's neutral axis from the shell's outside surface. */
  SUPPORT_RING_CENTROID: 'support_ring_centroid',
  /** R_R: the ring's neutral axis from the vessel axis. */
  SUPPORT_RING_RADIUS: 'support_ring_radius',
  /**
   * EN 13445-3 §16.9: the ring is carried on two hinges (two links). A SWITCH, as the engine reads
   * it: stated means yes, whatever the value — so it is stated as 1 or not at all.
   */
  RING_ON_TWO_HINGES: 'ring_on_two_hinges',
  /** CODAP C9.3.3.6's reading of the same fact: the ring is held at exactly two points. A switch. */
  SUPPORT_RING_TWO_POINT: 'support_ring_two_point',
  /** b_2a, e_2a: a tee's or channel's flange, at the side away from the shell (CODAP C9.A5.4/.5). */
  SUPPORT_RING_FLANGE_WIDTH: 'support_ring_flange_width',
  SUPPORT_RING_FLANGE_THICKNESS: 'support_ring_flange_thickness',
  /** The flanged section is a channel — two webs at the flange's edges — rather than a tee. A switch. */
  SUPPORT_RING_CHANNEL: 'support_ring_channel',
  /** The ring is outside the shell. A switch; the engine reads its absence as a ring inside. */
  SUPPORT_RING_EXTERNAL: 'support_ring_external',
  /** CODAP's names for quantities §16.9 names above: δ_a, A_R, h_G and the footprint on the shell. */
  SUPPORT_CONTACT_ANGLE: 'support_contact_angle',
  SUPPORT_SECTION_AREA: 'support_section_area',
  SUPPORT_RING_NEUTRAL_AXIS: 'support_ring_neutral_axis',
  SUPPORT_RING_FOOTPRINT: 'support_ring_footprint',
  /** D_o: a pipe's outside diameter — what RCC-M C3641.1 sizes it on, the wall `t_n` inward. */
  PIPE_OUTSIDE_DIAMETER: 'pipe_outside_diameter',
  /** R: a pipe bend's radius to its centreline (C3642.1's K = R/r_i). */
  PIPE_BEND_RADIUS: 'pipe_bend_radius',
  /** α: the angle a pipe bend turns through, in degrees. */
  PIPE_BEND_ANGLE: 'pipe_bend_angle',
  // RCC-M B3683.8 and B3683.9's branches, on TRESCA DBR's names (feat/rccm-b3683-class1-branches).
  /** A butt-welding tee's branch outlet outside diameter. */
  BRANCH_OUTSIDE_DIAMETER: 'branch_outside_diameter',
  /** T'_b: the connected branch pipe's wall — a tee's outlet, or the pipe beyond a reinforced neck. */
  BRANCH_CONNECTED_THICKNESS: 'branch_connected_thickness',
  /** L_1: the height of a nozzle's reinforced neck, Figure B3643.3.a sketches (a) and (b). */
  BRANCH_REINFORCEMENT_HEIGHT: 'branch_reinforcement_height',
  // RCC-M B3683.6's concentric reducer: the large end is the pipe's D_o and thickness.
  /** D_2: the reducer's small end outside diameter. */
  REDUCER_SMALL_OUTSIDE_DIAMETER: 'reducer_small_outside_diameter',
  /** t_2: the reducer's small end wall. */
  REDUCER_SMALL_THICKNESS: 'reducer_small_thickness',
  /** L_1, L_2: the cylindrical lengths at the large and small ends, B3683.6 b). */
  REDUCER_LARGE_END_LENGTH: 'reducer_large_end_length',
  REDUCER_SMALL_END_LENGTH: 'reducer_small_end_length',
  // RCC-M H3232 / Annexe ZVI's linear support member, on TRESCA DBR's names: the engine reads the
  // section's PROPERTIES, so the kernel draws what A and l fix and nothing it would have to invent.
  /** A: the member's cross-sectional area, mm². */
  MEMBER_AREA: 'member_area',
  /** l: the member's length, mm. */
  MEMBER_LENGTH: 'member_length',
  /** r_x, r_y: the section's radii of gyration — read by the engine, not by the drawing. */
  MEMBER_RADIUS_OF_GYRATION_X: 'member_radius_of_gyration_x',
  MEMBER_RADIUS_OF_GYRATION_Y: 'member_radius_of_gyration_y',
  /** 0 square from A (the only one drawn), 1 I/H, 2 tube, 3 angle. The engine reads none of them. */
  MEMBER_PROFILE: 'member_profile',
  /** Degrees from vertical, swung outward in the plane of the member's azimuth. */
  MEMBER_INCLINATION: 'member_inclination',
  // RCC-M C3431–C3434's volute casing, on TRESCA DBR's names. The engine reads A1, A2 and K and the
  // wall; the four drawing dimensions below are read by no check, so a drawing can move no verdict.
  /**
   * A1, A2: Figure C3431.1.3's two spans, both in PLAN and from the centre — A1 to the outer wall at
   * the tongue, A2 the larger reach across the far side (about 180°). Neither is axial.
   */
  PUMP_VOLUTE_A1: 'pump_volute_a1',
  PUMP_VOLUTE_A2: 'pump_volute_a2',
  /** The volute's base circle diameter: where the scroll begins, outside the impeller. */
  PUMP_BASE_CIRCLE_DIAMETER: 'pump_base_circle_diameter',
  /** The casing's width along the shaft. */
  PUMP_CASING_WIDTH: 'pump_casing_width',
  /** The axial suction bore and the tangential discharge bore. */
  PUMP_SUCTION_BORE: 'pump_suction_bore',
  PUMP_DISCHARGE_BORE: 'pump_discharge_bore',
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
  // EN 13445-3 §16.13, Figures 16.13-1 and 16.13-2: a support ring on a vertical vessel, in the
  // engine's `VERTICAL_RING_*` symbols.
  /** Table 16.13-2's profile: 1 a solid rectangle, 2 a box, 3 a channel (U), 4 an angle (L). */
  VERTICAL_RING_PROFILE: 'vertical_ring_profile',
  /** b: the ring's radial width, which d_3 and d_4 must agree with. */
  VERTICAL_RING_WIDTH: 'vertical_ring_width',
  /** h: the section's full height along the axis — shared with §16.9's ring (`h1a`). */
  SUPPORT_RING_HEIGHT: 'support_ring_height',
  /** d_3: the ring's inside diameter. */
  VERTICAL_RING_INSIDE_DIAMETER: 'vertical_ring_inside_diameter',
  /** d_4: the ring's outside diameter. */
  VERTICAL_RING_OUTSIDE_DIAMETER: 'vertical_ring_outside_diameter',
  /** d_6: the circle the vessel's load comes down on. */
  VERTICAL_RING_LOAD_DIAMETER: 'vertical_ring_load_diameter',
  /** d_7: the circle the supports react on: where the posts are drawn. */
  VERTICAL_RING_REACTION_DIAMETER: 'vertical_ring_reaction_diameter',
  /** e_3: the flanges of a box, a channel or an angle. */
  VERTICAL_RING_FLANGE_THICKNESS: 'vertical_ring_flange_thickness',
  /** e_4: the web — a box's web against the vessel. */
  VERTICAL_RING_WEB_THICKNESS: 'vertical_ring_web_thickness',
  /** e_5: a box's outer web. */
  VERTICAL_RING_SECOND_WEB_THICKNESS: 'vertical_ring_second_web_thickness',
  /** n_s; absent, the ring is supported uniformly all round. */
  VERTICAL_RING_SUPPORT_COUNT: 'vertical_ring_support_count',
  /** Above one half: independent of the vessel, loose round it (Figure 16.13-1 b). */
  VERTICAL_RING_INDEPENDENT: 'vertical_ring_independent',
  /** Above one half: fixed to the INSIDE of the vessel, Eq. (16.13-12)'s case. */
  VERTICAL_RING_FIXED_INSIDE: 'vertical_ring_fixed_inside',
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
  // A forged transition ring. Heights run up from its bottom face, the end of its outer leg,
  // where a skirt butts on; `inside_diameter` and `thickness` are its upper leg's.
  /** From the bottom face to the top, where the course above butts on. */
  TRANSITION_RING_HEIGHT: 'transition_ring_height',
  /** The inner leg's wall: the leg the head butts on, its bore the upper leg's. */
  HEAD_LEG_THICKNESS: 'head_leg_thickness',
  /** The outer leg's wall: the leg the skirt butts on, flush with the upper leg's outside. */
  SKIRT_LEG_THICKNESS: 'skirt_leg_thickness',
  /** The radius rounding the top of the slot between the two legs. */
  CROTCH_RADIUS: 'crotch_radius',
  /** From the bottom face to the crotch's apex, the top of the slot. */
  CROTCH_HEIGHT: 'crotch_height',
  /** From the bottom face to the inner leg's end, the head's butt weld. Absent, zero. */
  HEAD_JOINT_HEIGHT: 'head_joint_height',
  /**
   * From the bottom face to the head's tangent line, when the ring carries the head's straight
   * flange and part of its knuckle. Stated with `head_seam_distance`, it switches the ring to that.
   */
  TANGENT_LINE_HEIGHT: 'tangent_line_height',
  /** s: from the head's tangent line to the seam, along the head's mid-surface, on its knuckle. */
  HEAD_SEAM_DISTANCE: 'head_seam_distance',
  // A forged boss set into a head at its pole. Heights run from the spigot's end back to the head.
  /** The disc that replaces the head wall: its diameter, where it is butt-welded into the plate. */
  BOSS_DISC_DIAMETER: 'boss_disc_diameter',
  /** The cylinder standing out of the disc. */
  BOSS_OUTSIDE_DIAMETER: 'boss_outside_diameter',
  /** The spigot the pipe butt-welds onto, at the boss's end. */
  BOSS_PIPE_OUTSIDE_DIAMETER: 'boss_pipe_outside_diameter',
  /** The pipe's bore, straight through the boss and the disc. */
  BOSS_BORE_DIAMETER: 'boss_bore_diameter',
  /** From the spigot's end to the head's outer surface at the cylinder's root. */
  BOSS_HEIGHT: 'boss_height',
  /** From the spigot's end to the cylinder-to-cone break. */
  BOSS_CONE_HEIGHT: 'boss_cone_height',
  /** The cone's half-angle from the axis, in degrees; absent, 45. */
  BOSS_CONE_ANGLE: 'boss_cone_angle',
  /** The fillet joining the cylinder to the head; absent, half the head's wall. */
  BOSS_ROOT_RADIUS: 'boss_root_radius',
  /** The small radius where the cylinder turns into the cone; absent, sharp. */
  BOSS_BREAK_RADIUS: 'boss_break_radius',
  /** The fillet from the cone into the spigot; absent, sharp. */
  BOSS_NECK_RADIUS: 'boss_neck_radius',
  /** The round on the bore's edge at the head's inner surface; absent, sharp. */
  BOSS_BORE_EDGE_RADIUS: 'boss_bore_edge_radius',
  /**
   * A shell boss's joint face: its lean from the nozzle axis, degrees — 0 a cylinder, positive
   * wider at the inner surface. Absent, 0.
   */
  BOSS_JOINT_ANGLE: 'boss_joint_angle',
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
 * - `head_normal` — a formed head, for a nozzle radial to the head itself: the part stands NORMAL
 *   to the head's surface. `axialOffset` is the radial distance from the vessel axis at which the
 *   part's axis crosses the head's INSIDE surface — the station a head's drawing dimensions —
 *   anywhere on the crown or a torisphere's knuckle. A host offers it where it offers `head_crown`
 *   and can say what is normal to it; only a radial nozzle stands on it.
 */
export type PlacementAnchor = 'shell_side' | 'head_crown' | 'head_normal';

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

/**
 * An edge radius that is sharp unless stated. A stated 0 is a sharp edge declared, not a question
 * unasked, so only absence earns the assumed-value note; a negative radius is refused.
 */
export function sharpUnlessStated(component: ComponentDefinition, notes: Note[], symbol: string, what: string): number {
  const value = signedDimension(component, symbol);
  if (value === undefined) {
    notes.push(assumedNote(`${what} not stated — drawn sharp`, symbol, 'sharp'));
    return 0;
  }
  if (value < 0) throw new BuildError(component, `has a ${what.toLowerCase()} of ${value} mm`, scope('out_of_scope', symbol, '≥ 0 mm, 0 for sharp', `${value} mm`));
  return value;
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
