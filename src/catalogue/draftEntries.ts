// The catalogue's first pass, drawn wide: one DRAFT ENTRY per component and per joint the Code's
// Part 4 articles call for. A draft entry is geometry that builds, its parameters and its ports
// declared, and a status of `captured` — not a mesh plan, not an SCL set, not a scope. The ports
// are what make it an entry rather than a picture: without them the layout engine cannot attempt
// an assembly, and finding out what will not assemble is the point of going wide.
//
// Status is the brief's scale, `not started` → `captured` → `scripted` → `validated`. This file
// only ever says `captured` or `not started`; `scripted` and `validated` are earned on the mesh
// side, by a recipe and a test run in CI, and an entry that already has one names it in `meshing`
// so nothing here demos as more than its status says.
//
// `test/draftEntries.test.ts` holds every entry to what it declares: it builds the specimen, finds
// each declared port on the part and each declared joint between the parts, and checks the
// declared parameters against what the drawing actually read.
import { Kind, Sym, type AssemblyDefinition, type ComponentDefinition, type Placement } from '../definition.ts';
import { Detail } from '../details/constructionDetails.ts';
import type { JointKind } from '../ports/ports.ts';

export type EntryStatus = 'not started' | 'captured' | 'scripted' | 'validated';

/** A joint between two parts of a specimen, by component id and the port key on each. */
export interface DeclaredJoint {
  readonly kind: JointKind;
  readonly between: readonly [string, string];
  readonly ports: readonly [string, string];
}

export interface DraftEntry {
  readonly id: string;
  /** The article the entry answers: Part 4's, unless it names another code ("CODAP C9.6"). */
  readonly article: string;
  readonly title: string;
  readonly entry: 'component' | 'joint';
  readonly status: EntryStatus;
  /** Catalogue kinds (`ComponentType` wire values) the entry draws. */
  readonly kinds: readonly string[];
  /** The smallest assembly that exercises it. Absent when not started. */
  readonly specimen?: AssemblyDefinition;
  /** The component of the specimen the entry is about. */
  readonly focus?: string;
  /** Symbols the drawing of `focus` reads — stated in the specimen or looked for. */
  readonly parameters?: readonly string[];
  /** Port keys `focus` offers, in derivePorts' terms. */
  readonly ports?: readonly string[];
  readonly joint?: DeclaredJoint;
  /** The mesh-side catalogue entry that already exists for it, whose status outranks this one. */
  readonly meshing?: string;
  /**
   * The construction details (`Detail` keys) the entry resolves into its drawing. Stated from
   * wave 1b on; the first 47 entries were captured before the field existed and do not carry it.
   */
  readonly constructionDetails?: readonly string[];
  /** What it is drawn as, what it is not, or why it has not started. */
  readonly note?: string;
}

// ---------------------------------------------------------------- specimen vocabulary

const run = (id: string, kind: string, position: number, dimensions: Record<string, number>): ComponentDefinition => ({
  id, name: id, kind, position, hostId: null, dimensions,
});
const on = (id: string, kind: string, host: string, dimensions: Record<string, number>): ComponentDefinition => ({
  id, name: id, kind, position: 100, hostId: host, dimensions,
});
const side = (axialOffset: number, azimuth = 0): Placement => ({ anchor: 'shell_side', axialOffset, azimuth });
const crown = (axialOffset = 0, azimuth = 0): Placement => ({ anchor: 'head_crown', axialOffset, azimuth });
const vessel = (
  components: ComponentDefinition[],
  placements: Record<string, Placement> = {},
  extra: Partial<AssemblyDefinition> = {}
): AssemblyDefinition => ({ components, placements, reversed: [], ...extra });

const COURSE = { inside_diameter: 1500, thickness: 16, course_length: 2000 };
const course = (id = 'S', position = 1, dimensions: Record<string, number> = COURSE) =>
  run(id, Kind.CYLINDRICAL_SHELL, position, dimensions);
const ELLIPSOIDAL = { inside_diameter: 1500, head_height: 375, thickness: 16, straight_flange_length: 50 };
const NECK = { nozzle_inside_diameter: 200, nozzle_thickness: 12, nozzle_outward_projection: 250 };

/** A course and a mounted part on it, at mid-length. */
const mountedOnCourse = (kind: string, dimensions: Record<string, number>, placement = side(1000)) =>
  vessel([course(), on('M', kind, 'S', dimensions)], { M: placement });

// §4.3.11 and §4.3.12: 2000 → 1200 at 30°, between the two cylinders it joins.
const TRANSITION = { inside_diameter: 2000, small_end_diameter: 1200, half_apex_angle: 30, thickness: 20 };
const transition = (cone: Record<string, number>, large = 20, small = 20) =>
  vessel([
    run('L', Kind.CYLINDRICAL_SHELL, 0, { inside_diameter: 2000, thickness: large, course_length: 1000 }),
    run('C', Kind.CONICAL_SHELL, 1, { ...TRANSITION, ...cone }),
    run('U', Kind.CYLINDRICAL_SHELL, 2, { inside_diameter: 1200, thickness: small, course_length: 1000 }),
  ]);
// §4.3.11's sharp corner matches its cylinders on ONE mean radius in the joint plane: on the
// inside diameter only when t_cyl = t_cone / cos α. The specimen is that case, stated as such.
const SHARP_WALL = 20 / Math.cos(Math.PI / 6);

// §4.18: a U-tube exchanger's stationary end — shell, tubesheet, channel — the plate told the
// walls on both faces, so it meets each on its own annulus (Figure 4.18.4 configuration a).
const PLATE = {
  thickness: 80, flange_outside_diameter: 1700, tube_pitch: 31.75, tube_outside_diameter: 25.4,
  tube_thickness: 2.1, tube_limit_radius: 600, tube_layout_angle: 30,
  shell_inside_diameter: 1500, shell_thickness: 16, channel_inside_diameter: 1500, channel_thickness: 16,
};
const exchanger = (kind: string, plate: Record<string, number> = {}) =>
  vessel([
    course('S', 0),
    run('T', kind, 1, { ...PLATE, ...plate }),
    course('CH', 2, { inside_diameter: 1500, thickness: 16, course_length: 800 }),
  ]);

// Wave 1b's bundle: §4.18's pattern on its own part, in the shell, ending at the tubesheet.
const BUNDLE = {
  tube_pitch: 31.75, tube_outside_diameter: 25.4, tube_thickness: 2.1, tube_limit_radius: 600, tube_layout_angle: 30,
  tube_length_outer: 2000,
};
const withBundle = (bundle: Record<string, number>) =>
  vessel([...exchanger(Kind.U_TUBE_TUBESHEET).components, on('B', Kind.TUBE_BUNDLE, 'S', bundle)], { B: side(1000) });

const CORRODED = [Detail.CORRODED_MODEL, Detail.CORROSION_ALLOWANCE, Detail.CORRODED_SURFACES];

// A short course: every turn of the helix is a sweep, and a long one takes seconds each.
const halfPipe = vessel(
  [
    course('S', 0, { inside_diameter: 1600, thickness: 14, course_length: 800 }),
    on('M', Kind.HALF_PIPE_JACKET, 'S', { half_pipe_inside_radius: 38.95, thickness: 5.5 }),
  ],
  { M: side(400) }
);

const BELLOWS = {
  bellows_inside_diameter: 1000, thickness: 1.2, ply_count: 2, convolution_height: 60, convolution_pitch: 50,
  convolution_count: 6, end_tangent_length: 30,
};

// ---------------------------------------------------------------- the entries

export const DRAFT_ENTRIES: readonly DraftEntry[] = [
  // §4.3 — shells and formed heads
  {
    id: 'cylindrical_shell', article: '§4.3.3', title: 'Cylindrical shell', entry: 'component', status: 'captured',
    kinds: [Kind.CYLINDRICAL_SHELL], specimen: vessel([course()]), focus: 'S', meshing: 'cylindrical_shell',
    parameters: [Sym.INSIDE_DIAMETER, Sym.THICKNESS, Sym.COURSE_LENGTH], ports: ['lower', 'upper'],
  },
  {
    id: 'conical_shell.concentric', article: '§4.3.4', title: 'Conical shell, concentric', entry: 'component', status: 'captured',
    kinds: [Kind.CONICAL_SHELL], specimen: vessel([run('C', Kind.CONICAL_SHELL, 0, TRANSITION)]), focus: 'C',
    parameters: [Sym.INSIDE_DIAMETER, Sym.SMALL_END_DIAMETER, Sym.HALF_APEX_ANGLE, Sym.THICKNESS, Sym.COURSE_LENGTH, Sym.KNUCKLE_RADIUS, Sym.FLARE_RADIUS],
    ports: ['lower', 'upper'],
  },
  {
    id: 'conical_shell.eccentric', article: '§4.3.4', title: 'Conical shell, eccentric', entry: 'component', status: 'captured',
    kinds: [Kind.ECCENTRIC_CONICAL_SHELL], focus: 'C',
    specimen: vessel([
      run('L', Kind.CYLINDRICAL_SHELL, 0, { inside_diameter: 2000, thickness: 20, course_length: 1000 }),
      run('C', Kind.ECCENTRIC_CONICAL_SHELL, 1, { inside_diameter: 2000, small_end_diameter: 1200, half_apex_angle: 30, thickness: 20, flat_side_azimuth: 0 }),
    ]),
    parameters: [Sym.INSIDE_DIAMETER, Sym.SMALL_END_DIAMETER, Sym.HALF_APEX_ANGLE, Sym.THICKNESS, Sym.FLAT_SIDE_AZIMUTH, Sym.KNUCKLE_RADIUS, Sym.FLARE_RADIUS],
    ports: ['lower', 'upper'],
    joint: { kind: 'butt_weld', between: ['L', 'C'], ports: ['upper', 'lower'] },
    constructionDetails: CORRODED,
    note:
      'Draft kind, no ComponentType yet. One generatrix square to the ends, facing flat_side_azimuth; α is the steep side\'s, the largest round it, which is the one §4.3.4 reads. ' +
      'Every section is a circle, lofted rather than revolved, and the part states its circles\' centres beside its meridian: layer 1 describes it with no special case (centre moves, radius changes, axisymmetric false). ' +
      'Three things below layer 1 do assume one axis, and say so in KERNEL_AXISYMMETRY: s is no generatrix\'s length off the axis; the run is stacked by height alone, so a course above the small end is not shifted and its joint is refused as "centres apart"; and a host surface for nozzles is not offered. ' +
      'Wall drawn t wide in every section (t·cos α normal to it on the steep side); knuckle and flare refused as not built',
  },
  {
    id: 'spherical_shell', article: '§4.3.5', title: 'Spherical shell', entry: 'component', status: 'captured',
    kinds: [Kind.SPHERICAL_SHELL], specimen: vessel([run('P', Kind.SPHERICAL_SHELL, 0, { inside_diameter: 2000, thickness: 20 })]), focus: 'P',
    parameters: [Sym.INSIDE_DIAMETER, Sym.THICKNESS], ports: [],
    note: 'A whole sphere has no end to join; cut to a neighbour it offers lower and upper',
  },
  {
    id: 'hemispherical_head', article: '§4.3.5', title: 'Hemispherical head', entry: 'component', status: 'captured',
    kinds: [Kind.HEMISPHERICAL_HEAD], focus: 'H', meshing: 'hemispherical_head',
    specimen: vessel([run('H', Kind.HEMISPHERICAL_HEAD, 0, { inside_diameter: 1500, thickness: 16, straight_flange_length: 50 })]),
    parameters: [Sym.INSIDE_DIAMETER, Sym.THICKNESS, Sym.STRAIGHT_FLANGE_LENGTH], ports: ['lower'],
  },
  {
    id: 'ellipsoidal_head', article: '§4.3.7', title: 'Ellipsoidal head', entry: 'component', status: 'captured',
    kinds: [Kind.ELLIPSOIDAL_HEAD], focus: 'H', meshing: 'ellipsoidal_head',
    specimen: vessel([run('H', Kind.ELLIPSOIDAL_HEAD, 0, ELLIPSOIDAL)]),
    parameters: [Sym.INSIDE_DIAMETER, Sym.HEAD_HEIGHT, Sym.THICKNESS, Sym.STRAIGHT_FLANGE_LENGTH], ports: ['lower'],
  },
  {
    id: 'torispherical_head', article: '§4.3.6', title: 'Torispherical head', entry: 'component', status: 'captured',
    kinds: [Kind.TORISPHERICAL_HEAD], focus: 'H', meshing: 'torispherical_head',
    specimen: vessel([run('H', Kind.TORISPHERICAL_HEAD, 0, { inside_diameter: 1500, crown_radius: 1200, knuckle_radius: 150, thickness: 16, straight_flange_length: 50 })]),
    parameters: [Sym.INSIDE_DIAMETER, Sym.CROWN_RADIUS, Sym.KNUCKLE_RADIUS, Sym.THICKNESS, Sym.STRAIGHT_FLANGE_LENGTH], ports: ['lower'],
  },
  {
    id: 'conical_transition.no_knuckle', article: '§4.3.11', title: 'Conical transition, no knuckle', entry: 'component', status: 'captured',
    kinds: [Kind.CONICAL_SHELL, Kind.CYLINDRICAL_SHELL], specimen: transition({}, SHARP_WALL, SHARP_WALL), focus: 'C',
    parameters: [Sym.INSIDE_DIAMETER, Sym.SMALL_END_DIAMETER, Sym.HALF_APEX_ANGLE, Sym.THICKNESS, Sym.COURSE_LENGTH, Sym.KNUCKLE_RADIUS, Sym.FLARE_RADIUS],
    ports: ['lower', 'upper'],
    note: "A sharp corner meets its cylinders on one mean radius in the joint plane: cylinders of t_cone / cos α, as here. Flush inside with any other wall it is refused as a mismatch — the mid-wall reading of demo E is the open decision",
  },
  {
    id: 'conical_transition.knuckle_and_flare', article: '§4.3.12', title: 'Conical transition, knuckle and flare', entry: 'component', status: 'captured',
    kinds: [Kind.CONICAL_SHELL, Kind.CYLINDRICAL_SHELL], specimen: transition({ knuckle_radius: 200, flare_radius: 100 }), focus: 'C',
    parameters: [Sym.INSIDE_DIAMETER, Sym.SMALL_END_DIAMETER, Sym.HALF_APEX_ANGLE, Sym.THICKNESS, Sym.COURSE_LENGTH, Sym.KNUCKLE_RADIUS, Sym.FLARE_RADIUS],
    ports: ['lower', 'upper'],
    note: 'Knuckle and flare tangent to the cone and to their cylinders, both inside radii; each end is a cylinder of D or D_S, on its own bore. No straight flange: a thicker cone cannot be faired to a thinner cylinder, and that step is refused',
  },

  // §4.4
  {
    id: 'stiffening_ring', article: '§4.4.5.2', title: 'Stiffening ring', entry: 'component', status: 'captured',
    kinds: [Kind.STIFFENING_RING, Kind.LARGE_STIFFENING_RING], focus: 'M',
    specimen: mountedOnCourse(Kind.STIFFENING_RING, { ring_height: 100, ring_thickness: 12 }),
    parameters: [Sym.RING_HEIGHT, Sym.RING_THICKNESS], ports: ['attach'],
  },

  // §4.5 — openings
  {
    id: 'radial_nozzle', article: '§4.5.5', title: 'Radial nozzle', entry: 'component', status: 'captured',
    kinds: [Kind.RADIAL_NOZZLE], focus: 'M', meshing: 'radial_nozzle', specimen: mountedOnCourse(Kind.RADIAL_NOZZLE, NECK),
    parameters: [Sym.NOZZLE_INSIDE_DIAMETER, Sym.NOZZLE_THICKNESS, Sym.NOZZLE_OUTWARD_PROJECTION, Sym.NOZZLE_INWARD_PROJECTION, Sym.PAD_WIDTH, Sym.PAD_THICKNESS],
    ports: ['neck:host-end', 'neck:outer-end'],
  },
  {
    id: 'hillside_nozzle', article: '§4.5.6', title: 'Hillside nozzle', entry: 'component', status: 'captured',
    kinds: [Kind.HILLSIDE_NOZZLE], focus: 'M', specimen: mountedOnCourse(Kind.HILLSIDE_NOZZLE, { ...NECK, nozzle_offset: 300 }),
    parameters: [Sym.NOZZLE_INSIDE_DIAMETER, Sym.NOZZLE_THICKNESS, Sym.NOZZLE_OUTWARD_PROJECTION, Sym.NOZZLE_INWARD_PROJECTION, Sym.PAD_WIDTH, Sym.PAD_THICKNESS, Sym.NOZZLE_OFFSET],
    ports: ['neck:host-end', 'neck:outer-end'],
  },
  {
    id: 'angled_nozzle', article: '§4.5.7', title: 'Nozzle at an angle to the axis', entry: 'component', status: 'captured',
    kinds: [Kind.ANGLED_NOZZLE], focus: 'M', specimen: mountedOnCourse(Kind.ANGLED_NOZZLE, { ...NECK, nozzle_angle: 30 }),
    parameters: [Sym.NOZZLE_INSIDE_DIAMETER, Sym.NOZZLE_THICKNESS, Sym.NOZZLE_OUTWARD_PROJECTION, Sym.NOZZLE_INWARD_PROJECTION, Sym.PAD_WIDTH, Sym.PAD_THICKNESS, 'nozzle_angle'],
    ports: ['neck:host-end', 'neck:outer-end'],
  },
  {
    id: 'nozzle_on_head.axial', article: '§4.5.10', title: 'Nozzle on a head, on its axis', entry: 'component', status: 'captured',
    kinds: [Kind.RADIAL_NOZZLE], focus: 'M',
    specimen: vessel([course('S', 0), run('H', Kind.ELLIPSOIDAL_HEAD, 1, ELLIPSOIDAL), on('M', Kind.RADIAL_NOZZLE, 'H', NECK)], { M: crown(0) }),
    parameters: [Sym.NOZZLE_INSIDE_DIAMETER, Sym.NOZZLE_THICKNESS, Sym.NOZZLE_OUTWARD_PROJECTION, Sym.NOZZLE_INWARD_PROJECTION, Sym.PAD_WIDTH, Sym.PAD_THICKNESS],
    ports: ['neck:host-end', 'neck:outer-end'],
  },
  {
    id: 'nozzle_on_head.off_axis', article: '§4.5.10', title: 'Nozzle on a head, off its axis', entry: 'component', status: 'captured',
    kinds: [Kind.RADIAL_NOZZLE], focus: 'M',
    specimen: vessel([course('S', 0), run('H', Kind.ELLIPSOIDAL_HEAD, 1, ELLIPSOIDAL), on('M', Kind.RADIAL_NOZZLE, 'H', NECK)], { M: crown(400, 90) }),
    parameters: [Sym.NOZZLE_INSIDE_DIAMETER, Sym.NOZZLE_THICKNESS, Sym.NOZZLE_OUTWARD_PROJECTION, Sym.NOZZLE_INWARD_PROJECTION, Sym.PAD_WIDTH, Sym.PAD_THICKNESS],
    ports: ['neck:host-end', 'neck:outer-end'],
    note: 'The neck stands parallel to the vessel axis, not normal to the head: analysis says so (represented)',
  },
  {
    id: 'reinforcing_pad', article: '§4.5.5', title: 'Reinforcing pad', entry: 'component', status: 'captured',
    kinds: [Kind.RADIAL_NOZZLE], focus: 'M', specimen: mountedOnCourse(Kind.RADIAL_NOZZLE, { ...NECK, pad_width: 100, pad_thickness: 12 }),
    parameters: [Sym.NOZZLE_INSIDE_DIAMETER, Sym.NOZZLE_THICKNESS, Sym.NOZZLE_OUTWARD_PROJECTION, Sym.NOZZLE_INWARD_PROJECTION, Sym.PAD_WIDTH, Sym.PAD_THICKNESS],
    ports: ['neck:host-end', 'neck:outer-end', 'pad'],
    note: "A nozzle's pad: a second solid on the course, or the host's own wall thickened on a head",
  },
  {
    id: 'large_opening', article: '§4.5.5', title: 'Large opening / manway', entry: 'component', status: 'captured',
    kinds: [Kind.RADIAL_NOZZLE], focus: 'M',
    specimen: mountedOnCourse(Kind.RADIAL_NOZZLE, { nozzle_inside_diameter: 600, nozzle_thickness: 16, nozzle_outward_projection: 250 }),
    parameters: [Sym.NOZZLE_INSIDE_DIAMETER, Sym.NOZZLE_THICKNESS, Sym.NOZZLE_OUTWARD_PROJECTION, Sym.NOZZLE_INWARD_PROJECTION, Sym.PAD_WIDTH, Sym.PAD_THICKNESS],
    ports: ['neck:host-end', 'neck:outer-end'],
    note: 'A radial nozzle with a large bore: no manway cover, davit or flange is drawn',
  },

  // §4.6, §4.7, §4.9
  {
    id: 'flat_head.integral', article: '§4.6.2', title: 'Flat head, integral', entry: 'component', status: 'captured',
    kinds: [Kind.FLAT_HEAD], focus: 'F', meshing: 'flat_head',
    specimen: vessel([course('S', 0), run('F', Kind.FLAT_HEAD, 1, { inside_diameter: 1500, thickness: 60 })]),
    parameters: [Sym.INSIDE_DIAMETER, Sym.THICKNESS], ports: ['lower'],
  },
  {
    id: 'flat_head.bolted', article: '§4.6.2.3', title: 'Flat head, bolted', entry: 'component', status: 'captured',
    kinds: [Kind.FLAT_HEAD, Kind.INTEGRAL_FLANGE], focus: 'F',
    specimen: vessel([
      course('S', 0),
      run('G', Kind.INTEGRAL_FLANGE, 1, { flange_bore: 1500, flange_outside_diameter: 1800, thickness: 90, hub_small_end_thickness: 16, hub_large_end_thickness: 30, hub_length: 80 }),
      run('F', Kind.FLAT_HEAD, 2, { inside_diameter: 1500, thickness: 90 }),
    ]),
    parameters: [Sym.INSIDE_DIAMETER, Sym.THICKNESS], ports: ['lower'],
    note: 'A plate on a flange; the bolts and the gasket are the rules engine\'s, not drawn',
  },
  {
    id: 'spherically_dished_cover', article: '§4.7', title: 'Spherically dished bolted cover', entry: 'component', status: 'captured',
    kinds: [Kind.SPHERICALLY_DISHED_COVER, Kind.DISHED_COVER_TYPE_B, Kind.DISHED_COVER_TYPE_C, Kind.DISHED_COVER_TYPE_D], focus: 'D',
    specimen: vessel([run('D', Kind.DISHED_COVER_TYPE_B, 0, { crown_radius: 1500, thickness: 20, flange_bore: 1500, flange_outside_diameter: 1800, flange_ring_thickness: 80 })]),
    parameters: [Sym.CROWN_RADIUS, Sym.THICKNESS, Sym.FLANGE_BORE, Sym.FLANGE_OUTSIDE_DIAMETER, Sym.FLANGE_RING_THICKNESS, Sym.BOLT_CIRCLE, Sym.BOLT_COUNT],
    ports: ['lower'],
    note: 'The dish on its bolting ring; bolt holes drawn when the bolt circle and count are stated',
  },
  {
    id: 'stayed_surface', article: '§4.9', title: 'Stay, stayed panel', entry: 'component', status: 'captured',
    kinds: [Kind.STAYED_SURFACE], focus: 'P',
    specimen: vessel([course('S', 0), run('P', Kind.STAYED_SURFACE, 1, { inside_diameter: 1500, thickness: 30, stay_pitch: 300, stay_diameter: 40 })]),
    parameters: [Sym.INSIDE_DIAMETER, Sym.THICKNESS, 'stay_pitch', 'stay_diameter'], ports: ['lower'],
  },
  {
    id: 'quick_actuating_closure', article: '§4.8', title: 'Quick-actuating closure (its door)', entry: 'component', status: 'captured',
    kinds: [Kind.QUICK_ACTUATING_CLOSURE], focus: 'Q',
    specimen: vessel([course('S', 0), run('Q', Kind.QUICK_ACTUATING_CLOSURE, 1, { inside_diameter: 1500, thickness: 40 })]),
    parameters: [Sym.INSIDE_DIAMETER, Sym.THICKNESS], ports: ['lower'],
    constructionDetails: [],
    note:
      'Opened by wave 1b\'s declaration: the kernel already drew it and the catalogue listed it nowhere. Drawn as its DOOR, a plate with a lip; the locking mechanism — what §4.8 is about — is not modelled, and §4.8.1.1 gives no calculation method, so the rules refuse it with its requirements. ' +
      'Its face against the course is reported as a mean-radius mismatch, the door\'s rim being wider than the wall: the ring that locks them is the missing mechanism. A mesh of this entry is a mesh of a plate',
  },

  // §4.11 — jackets
  {
    id: 'jacket.annular', article: '§4.11.3', title: 'Jacket, annular (closure and jacket wall)', entry: 'component', status: 'captured',
    kinds: [Kind.JACKET_CLOSURE], focus: 'M',
    specimen: mountedOnCourse(Kind.JACKET_CLOSURE, { jacket_space: 50, jacket_thickness: 10, closure_thickness: 16 }, side(300)),
    parameters: ['jacket_space', 'jacket_thickness', 'closure_thickness'], ports: ['attach'],
    note: "Table 4.11.1's eight details are drawn as the plain bar: the detail is the drawing's, not a dimension",
  },
  {
    id: 'jacket.half_pipe', article: '§4.11.6', title: 'Jacket, half-pipe', entry: 'component', status: 'captured',
    kinds: [Kind.HALF_PIPE_JACKET], focus: 'M',
    specimen: halfPipe,
    parameters: [Sym.HALF_PIPE_INSIDE_RADIUS, Sym.THICKNESS], ports: ['attach'],
    note: 'One helix on the course. The catalogue has no pitch symbol, so the pitch is always drawn assumed and analysis refuses it — deferred by the brief',
  },

  // §4.15 — supports
  {
    id: 'saddle_support', article: '§4.15.3', title: 'Saddle', entry: 'component', status: 'captured',
    kinds: [Kind.SADDLE_SUPPORT], focus: 'M', specimen: mountedOnCourse(Kind.SADDLE_SUPPORT, { saddle_angle: 120, saddle_width: 200 }, side(500, 180)),
    parameters: ['saddle_angle', 'saddle_width', 'wear_plate_thickness', 'saddle_height', 'saddle_bearing_plate_thickness', 'saddle_web_thickness', 'saddle_rib_count', 'saddle_rib_thickness', 'saddle_base_plate_thickness'],
    ports: ['attach'],
  },
  {
    id: 'skirt_support', article: '§4.15.4', title: 'Skirt', entry: 'component', status: 'captured',
    kinds: [Kind.SKIRT_SUPPORT], focus: 'M',
    specimen: vessel([run('H', Kind.ELLIPSOIDAL_HEAD, 0, ELLIPSOIDAL), course('S', 1), on('M', Kind.SKIRT_SUPPORT, 'H', { inside_diameter: 1490, thickness: 12, course_length: 1000 })], { M: crown(0) }),
    parameters: [Sym.INSIDE_DIAMETER, Sym.THICKNESS, Sym.COURSE_LENGTH], ports: ['attach'],
    note: "Welded to the head's knuckle by its own diameter; on a course it is drawn square from its placement",
  },
  {
    id: 'lug_support', article: '§4.15.5', title: 'Support lug / bracket', entry: 'component', status: 'captured',
    kinds: [Kind.LUG_SUPPORT], focus: 'M', specimen: mountedOnCourse(Kind.LUG_SUPPORT, {}, side(1500, 90)),
    parameters: ['support_lug_projection', 'support_lug_height', 'support_lug_gusset_spacing', 'support_lug_gusset_thickness', 'support_lug_base_plate_thickness'],
    ports: ['attach'],
    note: 'Two gussets on a base plate; what is not stated is drawn to the course and refused as assumed',
  },
  {
    id: 'leg_support', article: '§4.15.5', title: 'Leg', entry: 'component', status: 'captured',
    kinds: [Kind.LEG_SUPPORT], focus: 'M',
    specimen: mountedOnCourse(
      Kind.LEG_SUPPORT,
      { leg_outside_diameter: 219.1, leg_thickness: 8.18, leg_length: 1800, leg_attachment_length: 600, support_lug_base_plate_thickness: 20 },
      side(300, 45)
    ),
    parameters: [Sym.LEG_OUTSIDE_DIAMETER, Sym.LEG_THICKNESS, Sym.LEG_LENGTH, Sym.LEG_ATTACHMENT_LENGTH, Sym.SUPPORT_LUG_BASE_PLATE_THICKNESS],
    ports: ['attach'],
    joint: { kind: 'fillet_attachment', between: ['S', 'M'], ports: ['wall:M', 'attach'] },
    constructionDetails: [],
    note:
      'Draft kind: the backend\'s lug_support is "lug or leg" and the kernel draws it as a lug, so the leg is its own kind until a ComponentType says otherwise. ' +
      'A pipe column against the course, welded over leg_attachment_length and carried down past the course to its base plate. The placement\'s offset is the middle of the weld, so the attachment station IS the placement: ' +
      'the layout measures support_to_discontinuity from that patch to the nearest discontinuity or circumferential seam, as it does for a lug, and §4.15.5.5\'s 1.8·√(D·t) is judged on it. Not wetted, so no corrosion detail applies',
  },

  // §4.18 — heat exchangers
  {
    id: 'tubesheet.u_tube', article: '§4.18.7', title: 'Tubesheet, U-tube', entry: 'component', status: 'captured',
    kinds: [Kind.U_TUBE_TUBESHEET], specimen: exchanger(Kind.U_TUBE_TUBESHEET), focus: 'T',
    parameters: ['thickness', 'flange_outside_diameter', 'tube_pitch', 'tube_outside_diameter', 'tube_thickness', 'tube_limit_radius', 'tube_layout_angle', 'tube_length_outer', 'shell_inside_diameter', 'shell_thickness', 'channel_inside_diameter', 'channel_thickness'],
    ports: ['lower', 'upper'],
    note: "§4.18.6.4.b's equivalent solid plate: the holes are carried as data, not drilled; the tubes are stubs",
  },
  {
    id: 'tubesheet.fixed', article: '§4.18.8', title: 'Tubesheet, fixed', entry: 'component', status: 'captured',
    kinds: [Kind.FIXED_TUBESHEET], specimen: exchanger(Kind.FIXED_TUBESHEET), focus: 'T',
    parameters: ['thickness', 'flange_outside_diameter', 'tube_pitch', 'tube_outside_diameter', 'tube_thickness', 'tube_limit_radius', 'tube_layout_angle', 'tube_length_outer', 'shell_inside_diameter', 'shell_thickness', 'channel_inside_diameter', 'channel_thickness'],
    ports: ['lower', 'upper'],
  },
  {
    id: 'tubesheet.floating', article: '§4.18.9', title: 'Tubesheet, floating', entry: 'component', status: 'captured',
    kinds: [Kind.FLOATING_TUBESHEET_IMMERSED, Kind.FLOATING_TUBESHEET_EXTERNALLY_SEALED, Kind.FLOATING_TUBESHEET_INTERNALLY_SEALED],
    specimen: exchanger(Kind.FLOATING_TUBESHEET_IMMERSED), focus: 'T',
    parameters: ['thickness', 'flange_outside_diameter', 'tube_pitch', 'tube_outside_diameter', 'tube_thickness', 'tube_limit_radius', 'tube_layout_angle', 'tube_length_outer', 'shell_inside_diameter', 'shell_thickness', 'channel_inside_diameter', 'channel_thickness'],
    ports: ['lower', 'upper'],
  },
  {
    id: 'tube', article: '§4.18', title: 'Tube (the bundle, one entry on a pattern)', entry: 'component', status: 'captured',
    kinds: [Kind.TUBE_BUNDLE], focus: 'B', specimen: withBundle(BUNDLE),
    parameters: [Sym.TUBE_PITCH, Sym.TUBE_OUTSIDE_DIAMETER, Sym.TUBE_THICKNESS, Sym.TUBE_LIMIT_RADIUS, Sym.TUBE_LAYOUT_ANGLE, Sym.TUBE_LENGTH_OUTER, Sym.FILLET_WELD_LEG, Sym.GROOVE_WELD_LEG],
    ports: ['tube-end:lower', 'tube-end:upper'],
    constructionDetails: [],
    note:
      'Draft kind. The bundle is the entry, not the tube: see TUBE_MODEL. One tube drawn and repeated on the pattern; each end is one port carrying the pattern. ' +
      'Hosted by the shell for where it stands along the axis only — nothing welds a bundle to its shell, so there is no joint with it. ' +
      'Here the lower end meets nothing, which is a U-tube bundle\'s far end. The tubesheet still draws its own stubs, so with a bundle the last four pitches are drawn twice (the 47 are untouched). ' +
      'A corroded model leaves the tubes nominal and says so: a tube\'s allowance is not the vessel\'s',
  },
  {
    id: 'pass_partition_plate', article: '§4.18', title: 'Pass partition plate', entry: 'component', status: 'captured',
    kinds: [Kind.PASS_PARTITION_PLATE], focus: 'P',
    specimen: vessel([...exchanger(Kind.U_TUBE_TUBESHEET).components, on('P', Kind.PASS_PARTITION_PLATE, 'CH', { pass_partition_thickness: 12 })], { P: side(400, 90) }),
    parameters: [Sym.PASS_PARTITION_THICKNESS],
    ports: ['attach'],
    joint: { kind: 'fillet_attachment', between: ['CH', 'P'], ports: ['wall:P', 'attach'] },
    constructionDetails: CORRODED,
    note:
      'Draft kind. A plate across the channel\'s bore, in the plane through the axis at the placement\'s azimuth, over the channel\'s whole length. ' +
      'ATTACHES: welded to the channel along both edges, 180° apart; seated against the tubesheet in its pass partition groove (pass_partition_groove_depth, the rules\') — gasketed, so that end is a seat and has no port. ' +
      'BOUNDS: the tube-side passes — the channel and the tubesheet\'s tube-side face on either side of it are separate chambers, and it carries the pressure difference between them. ' +
      'Port model gap: a part has one attachment patch, so the second weld line carries no port. Corroded on both faces by the inside allowance',
  },
  {
    id: 'channel', article: '§4.18', title: 'Channel', entry: 'component', status: 'captured',
    kinds: [Kind.CYLINDRICAL_SHELL], specimen: exchanger(Kind.U_TUBE_TUBESHEET), focus: 'CH',
    parameters: [Sym.INSIDE_DIAMETER, Sym.THICKNESS, Sym.COURSE_LENGTH], ports: ['lower', 'upper'],
    note: 'A cylindrical course on the tubesheet\'s tube side; a bonnet or a channel cover is a head or a flat plate on it',
  },

  // §4.19 and the flexible shell element
  {
    id: 'bellows', article: '§4.19', title: 'Bellows expansion joint', entry: 'component', status: 'captured',
    kinds: [Kind.U_SHAPED_BELLOWS_AS_FORMED, Kind.U_SHAPED_BELLOWS_ANNEALED, Kind.U_SHAPED_REINFORCED_BELLOWS_AS_FORMED, Kind.U_SHAPED_REINFORCED_BELLOWS_ANNEALED, Kind.TOROIDAL_BELLOWS],
    specimen: vessel([course('S', 0, { inside_diameter: 1000, thickness: 10, course_length: 800 }), run('B', Kind.U_SHAPED_BELLOWS_AS_FORMED, 1, BELLOWS), course('U', 2, { inside_diameter: 1000, thickness: 10, course_length: 800 })]),
    focus: 'B',
    parameters: [...Object.keys(BELLOWS), Sym.TORUS_RADIUS, Sym.COLLAR_THICKNESS, Sym.COLLAR_LENGTH],
    ports: ['lower', 'upper'],
    note: 'U-shaped, reinforced or not, and toroidal; the plies drawn as one wall of their total thickness',
  },
  {
    id: 'flexible_shell_element', article: '§4.18.12', title: 'Flexible shell element (flanged and flued)', entry: 'component', status: 'captured',
    kinds: [Kind.FLANGED_AND_FLUED_EXPANSION_JOINT],
    specimen: vessel([course('S', 0), run('X', Kind.FLANGED_AND_FLUED_EXPANSION_JOINT, 1, { inside_diameter: 1500, thickness: 16 }), course('U', 2)]),
    focus: 'X', parameters: [Sym.INSIDE_DIAMETER, Sym.THICKNESS], ports: ['lower', 'upper'],
    note: "The brief's §4.20 flexible shell element is this Division's §4.18.12 flanged-and-flued joint, whose design §4.18.12.1 sends to Part 5. The catalogue carries only D and t, so its tori and plate are drawn to proportions, and said",
  },

  // CODAP 2005 Partie C — the parts it sizes and Part 4 does not. `article` names the CODAP clause.
  {
    id: 'conical_shell.offset_axes', article: 'CODAP C2.3.8', title: 'Conical shell joining two cylinders on offset axes', entry: 'component', status: 'captured',
    kinds: [Kind.CONICAL_SHELL], focus: 'C',
    specimen: vessel([
      run('L', Kind.CYLINDRICAL_SHELL, 0, { inside_diameter: 2000, thickness: 20, course_length: 1000 }),
      run('C', Kind.CONICAL_SHELL, 1, { inside_diameter: 2000, small_end_diameter: 1200, half_apex_angle: 30, thickness: 20, cone_axis_offset: 250 }),
    ]),
    parameters: [Sym.INSIDE_DIAMETER, Sym.SMALL_END_DIAMETER, Sym.HALF_APEX_ANGLE, Sym.THICKNESS, Sym.CONE_AXIS_OFFSET, Sym.KNUCKLE_RADIUS, Sym.FLARE_RADIUS],
    ports: ['lower', 'upper'],
    joint: { kind: 'butt_weld', between: ['L', 'C'], ports: ['upper', 'lower'] },
    constructionDetails: CORRODED,
    note:
      'Not a kind: a conical_shell stating cone_axis_offset, δ, which is how the rules engine carries C2.3.8 (CodeSymbol.CONE_AXIS_OFFSET). Unstated or zero it is the symmetric cone. ' +
      'α is the SYMMETRIC generatrix\'s, read as the engine reads it: L = (D − D_s)/(2·tan α), and the sides go to α_max = atan(((D − D_s)/2 + δ)/L) and its counterpart, α_max being what C2.3.8.2 runs C2.3.5 to C2.3.7 at. ' +
      'Lofted as conical_shell.eccentric is, the offset drawn towards +X since nothing carries its direction; the course above the small end still meets the stacking limit that entry records',
  },
  {
    id: 'flat_head.relief_groove', article: 'CODAP C3.2.6', title: 'Flat head with a relief groove', entry: 'component', status: 'captured',
    kinds: [Kind.FLAT_HEAD], focus: 'F',
    specimen: vessel([
      course('S', 0),
      run('F', Kind.FLAT_HEAD, 1, { inside_diameter: 1500, thickness: 60, relief_groove_radius: 10, groove_remaining_thickness: 40 }),
    ]),
    parameters: [Sym.INSIDE_DIAMETER, Sym.THICKNESS, Sym.RELIEF_GROOVE_RADIUS, Sym.GROOVE_REMAINING_THICKNESS],
    ports: ['lower'],
    joint: { kind: 'butt_weld', between: ['S', 'F'], ports: ['upper', 'lower'] },
    constructionDetails: [],
    note:
      'Figure C3.2.6: a plate e_f thick on a spigot as thick as the shell, butt-welded to it, the groove cut into the pressure face flush with the bore and leaving e_r under it. ' +
      'A FLAT_HEAD with two more symbols rather than a kind: what changes is the corner, and C3.2.4 and C3.2.5 are the same head with other corners. The spigot\'s length is undimensioned and drawn e_s',
  },
  {
    id: 'lifting_lug.longitudinal', article: 'CODAP C9.6', title: 'Lifting lug along the axis, on a pad', entry: 'component', status: 'captured',
    kinds: [Kind.LIFTING_LUG], focus: 'M',
    specimen: mountedOnCourse(Kind.LIFTING_LUG, {
      lifting_lug_base_length: 300, lifting_lug_hole_height: 140, lifting_lug_hole_offset: 30, lifting_lug_hole_diameter: 50, lifting_lug_thickness: 30,
      lifting_lug_top_radius: 60, lifting_lug_orientation: 0, pad_thickness: 16, lifting_lug_pad_length: 400, lifting_lug_pad_width: 160,
    }, side(1000, 180)),
    parameters: [
      Sym.LIFTING_LUG_BASE_LENGTH, Sym.LIFTING_LUG_HOLE_HEIGHT, Sym.LIFTING_LUG_HOLE_OFFSET, Sym.LIFTING_LUG_HOLE_DIAMETER, Sym.LIFTING_LUG_THICKNESS,
      Sym.LIFTING_LUG_TOP_RADIUS, Sym.LIFTING_LUG_ORIENTATION, Sym.PAD_THICKNESS, Sym.LIFTING_LUG_PAD_LENGTH, Sym.LIFTING_LUG_PAD_WIDTH,
    ],
    ports: ['attach'],
    joint: { kind: 'fillet_attachment', between: ['S', 'M'], ports: ['wall:M', 'attach'] },
    constructionDetails: [],
    note:
      'Draft kind: Part 4 sizes no lifting lug. Figure C9.6.2.4-1 in the Code\'s letters — b_1, a_1, a_2, and the pad b_3 by b_2 by e_2 (pad_thickness). ' +
      'The plate\'s sides run straight from the ends of b_1 to touch the metal round the hole, whose radius no rule reads. Its plane holds the axis, which no extrusion reaches, so it is drawn revolved and cut to a slab',
  },
  {
    id: 'lifting_lug.circumferential', article: 'CODAP C9.6', title: 'Lifting lug round the axis', entry: 'component', status: 'captured',
    kinds: [Kind.LIFTING_LUG], focus: 'M',
    specimen: mountedOnCourse(Kind.LIFTING_LUG, {
      lifting_lug_base_length: 300, lifting_lug_hole_height: 140, lifting_lug_hole_diameter: 50, lifting_lug_thickness: 30, lifting_lug_orientation: 90,
    }, side(1000, 180)),
    parameters: [
      Sym.LIFTING_LUG_BASE_LENGTH, Sym.LIFTING_LUG_HOLE_HEIGHT, Sym.LIFTING_LUG_HOLE_OFFSET, Sym.LIFTING_LUG_HOLE_DIAMETER, Sym.LIFTING_LUG_THICKNESS,
      Sym.LIFTING_LUG_TOP_RADIUS, Sym.LIFTING_LUG_ORIENTATION, Sym.PAD_THICKNESS,
    ],
    ports: ['attach'],
    joint: { kind: 'fillet_attachment', between: ['S', 'M'], ports: ['wall:M', 'attach'] },
    constructionDetails: [],
    note: 'Figure C9.6.2.4-2, with no pad: the plate square to the axis, extruded along it and cut to the shell\'s circle so its base follows it',
  },
  {
    id: 'support_ring.cradle', article: 'CODAP C9.3.3', title: 'Support ring on a cradle', entry: 'component', status: 'captured',
    kinds: [Kind.SUPPORT_RING], focus: 'M',
    specimen: mountedOnCourse(Kind.SUPPORT_RING, {
      ring_height: 120, ring_thickness: 20, support_opening_angle: 120, support_ring_links: 0, support_height: 600, support_post_width: 120,
      support_lug_base_plate_thickness: 20,
    }, side(1000, 0)),
    parameters: [
      Sym.RING_HEIGHT, Sym.RING_THICKNESS, Sym.SUPPORT_OPENING_ANGLE, Sym.SUPPORT_RING_LINKS, Sym.SUPPORT_HEIGHT, Sym.SUPPORT_POST_WIDTH,
      Sym.SUPPORT_LUG_BASE_PLATE_THICKNESS,
    ],
    ports: ['attach'],
    joint: { kind: 'fillet_attachment', between: ['S', 'M'], ports: ['wall:M', 'attach'] },
    constructionDetails: [],
    note:
      'Draft kind: §4.15.3 carries a horizontal drum on saddles and has nothing for a ring. Figure C9.3.3.1.7-2: the ring, and two posts at ±δ_a/2 from the bottom on one base. ' +
      'The ring is the flat bar C9.A5.3 computes; a T or built-up section is not drawn. Past δ_a = 180° the supports bear above the ring\'s middle and are refused as not built',
  },
  {
    id: 'support_ring.two_links', article: 'CODAP C9.3.3', title: 'Support ring on two links', entry: 'component', status: 'captured',
    kinds: [Kind.SUPPORT_RING], focus: 'M',
    specimen: mountedOnCourse(Kind.SUPPORT_RING, {
      ring_height: 120, ring_thickness: 20, support_opening_angle: 90, support_ring_links: 2, support_height: 800, support_post_width: 100,
      support_lug_base_plate_thickness: 20,
    }, side(1000, 0)),
    parameters: [
      Sym.RING_HEIGHT, Sym.RING_THICKNESS, Sym.SUPPORT_OPENING_ANGLE, Sym.SUPPORT_RING_LINKS, Sym.SUPPORT_HEIGHT, Sym.SUPPORT_POST_WIDTH,
      Sym.SUPPORT_LUG_BASE_PLATE_THICKNESS,
    ],
    ports: ['attach'],
    joint: { kind: 'fillet_attachment', between: ['S', 'M'], ports: ['wall:M', 'attach'] },
    constructionDetails: [],
    note: 'Figure C9.3.3.1.7-3: the same ring carried at two points, each post on its own base — the case C9.3.3.6 checks rather than C9.3.3.5',
  },
  {
    id: 'leg_support.on_head', article: 'CODAP C9.5', title: 'Leg under a dished head', entry: 'component', status: 'captured',
    kinds: [Kind.LEG_SUPPORT], focus: 'M',
    specimen: vessel(
      [
        run('H', Kind.ELLIPSOIDAL_HEAD, 0, ELLIPSOIDAL),
        course('S', 1),
        on('M', Kind.LEG_SUPPORT, 'H', { leg_outside_diameter: 168.3, leg_thickness: 7.11, leg_length: 900, support_lug_base_plate_thickness: 20 }),
      ],
      { M: crown(450, 45) }
    ),
    parameters: [Sym.LEG_OUTSIDE_DIAMETER, Sym.LEG_THICKNESS, Sym.LEG_LENGTH, Sym.SUPPORT_LUG_BASE_PLATE_THICKNESS],
    ports: ['attach'],
    joint: { kind: 'fillet_attachment', between: ['H', 'M'], ports: ['wall:M', 'attach'] },
    constructionDetails: [],
    note:
      'The §4.15.5 leg, hosted on a head instead of a course: a pipe parallel to the axis at the placement\'s distance from it, its end cut to the head\'s outside as a skirt on a head is. ' +
      'C9.5.2.4 keeps legs within 0.4·D_i of the axis on an ellipsoidal head; the drawing does not enforce that, the rule does. Welded round its end, so leg_attachment_length is not read',
  },

  // ---------------------------------------------------------------- joints
  {
    id: 'head_to_shell', article: '§4.3', title: 'Head to shell', entry: 'joint', status: 'captured', meshing: 'head_to_shell',
    kinds: [Kind.ELLIPSOIDAL_HEAD, Kind.CYLINDRICAL_SHELL],
    specimen: vessel([run('H', Kind.ELLIPSOIDAL_HEAD, 0, ELLIPSOIDAL), course('S', 1)]),
    joint: { kind: 'butt_weld', between: ['H', 'S'], ports: ['lower', 'lower'] },
  },
  {
    id: 'shell_to_shell.equal', article: '§6.1.6', title: 'Shell to shell, butt, equal thickness', entry: 'joint', status: 'captured',
    kinds: [Kind.CYLINDRICAL_SHELL], specimen: vessel([course('S', 0), course('U', 1)]),
    joint: { kind: 'butt_weld', between: ['S', 'U'], ports: ['upper', 'lower'] },
  },
  {
    id: 'shell_to_shell.unequal', article: '§6.1.6.2', title: 'Shell to shell, butt, unequal thickness', entry: 'joint', status: 'captured',
    kinds: [Kind.CYLINDRICAL_SHELL],
    specimen: vessel([course('S', 0), course('U', 1, { inside_diameter: 1500, thickness: 24, course_length: 2000 })], {}, { joints: { 'S~U': { taperRatio: 4 } } }),
    joint: { kind: 'butt_weld', between: ['S', 'U'], ports: ['upper', 'lower'] },
    note: 'The thicker wall faired at the joint\'s taper ratio, 3:1 to 10:1 (3:1 unstated)',
  },
  {
    id: 'cone_to_cylinder.large_end', article: '§4.3.11, §4.3.12', title: 'Cone to cylinder, large end', entry: 'joint', status: 'captured',
    kinds: [Kind.CONICAL_SHELL, Kind.CYLINDRICAL_SHELL], specimen: transition({ knuckle_radius: 200, flare_radius: 100 }),
    joint: { kind: 'butt_weld', between: ['L', 'C'], ports: ['upper', 'lower'] },
    note: 'Knuckled, square on the bore. Sharp (§4.3.11) the ports match only on one mean radius: see conical_transition.no_knuckle',
  },
  {
    id: 'cone_to_cylinder.small_end', article: '§4.3.11, §4.3.12', title: 'Cone to cylinder, small end', entry: 'joint', status: 'captured',
    kinds: [Kind.CONICAL_SHELL, Kind.CYLINDRICAL_SHELL], specimen: transition({ knuckle_radius: 200, flare_radius: 100 }),
    joint: { kind: 'butt_weld', between: ['C', 'U'], ports: ['upper', 'lower'] },
    note: 'Flared, square on the bore. A cone thicker than its small-end cylinder cannot be faired: no straight flange',
  },
  {
    id: 'nozzle_to_shell.radial', article: '§4.5.5', title: 'Nozzle to shell, radial', entry: 'joint', status: 'captured', meshing: 'radial_nozzle',
    kinds: [Kind.RADIAL_NOZZLE, Kind.CYLINDRICAL_SHELL], specimen: mountedOnCourse(Kind.RADIAL_NOZZLE, NECK),
    joint: { kind: 'set_in_nozzle', between: ['S', 'M'], ports: ['opening:M', 'neck:host-end'] },
  },
  {
    id: 'nozzle_to_head', article: '§4.5.10', title: 'Nozzle to head', entry: 'joint', status: 'captured',
    kinds: [Kind.RADIAL_NOZZLE, Kind.ELLIPSOIDAL_HEAD],
    specimen: vessel([course('S', 0), run('H', Kind.ELLIPSOIDAL_HEAD, 1, ELLIPSOIDAL), on('M', Kind.RADIAL_NOZZLE, 'H', NECK)], { M: crown(0) }),
    joint: { kind: 'set_in_nozzle', between: ['H', 'M'], ports: ['opening:M', 'neck:host-end'] },
  },
  {
    id: 'nozzle_to_cone', article: '§4.5.8, §4.5.9', title: 'Nozzle to cone', entry: 'joint', status: 'captured',
    kinds: [Kind.RADIAL_NOZZLE, Kind.CONICAL_SHELL],
    specimen: vessel([run('C', Kind.CONICAL_SHELL, 0, TRANSITION), on('M', Kind.RADIAL_NOZZLE, 'C', NECK)], { M: side(350) }),
    joint: { kind: 'set_in_nozzle', between: ['C', 'M'], ports: ['opening:M', 'neck:host-end'] },
  },
  {
    id: 'pad_to_shell', article: '§4.5.5', title: 'Pad to shell', entry: 'joint', status: 'captured',
    kinds: [Kind.RADIAL_NOZZLE, Kind.CYLINDRICAL_SHELL], specimen: mountedOnCourse(Kind.RADIAL_NOZZLE, { ...NECK, pad_width: 100, pad_thickness: 12 }),
    joint: { kind: 'fillet_attachment', between: ['S', 'M'], ports: ['pad:M', 'pad'] },
  },
  {
    id: 'tubesheet_to_shell', article: '§4.18.8', title: 'Tubesheet to shell', entry: 'joint', status: 'captured',
    kinds: [Kind.U_TUBE_TUBESHEET, Kind.CYLINDRICAL_SHELL], specimen: exchanger(Kind.U_TUBE_TUBESHEET),
    joint: { kind: 'butt_weld', between: ['S', 'T'], ports: ['upper', 'lower'] },
    note: "Integral, on the shell's annulus (Figure 4.18.4 a); a gasketed side states G and the face instead",
  },
  {
    id: 'tubesheet_to_channel', article: '§4.18.8', title: 'Tubesheet to channel', entry: 'joint', status: 'captured',
    kinds: [Kind.U_TUBE_TUBESHEET, Kind.CYLINDRICAL_SHELL], specimen: exchanger(Kind.U_TUBE_TUBESHEET),
    joint: { kind: 'butt_weld', between: ['T', 'CH'], ports: ['upper', 'lower'] },
  },
  {
    id: 'tube_to_tubesheet', article: '§4.18.10', title: 'Tube to tubesheet', entry: 'joint', status: 'captured',
    kinds: [Kind.TUBE_BUNDLE, Kind.U_TUBE_TUBESHEET], specimen: withBundle({ ...BUNDLE, fillet_weld_leg: 3 }),
    joint: { kind: 'tube_to_tubesheet', between: ['T', 'B'], ports: ['tube-holes:B', 'tube-end:upper'] },
    constructionDetails: [],
    note:
      'One joint per tubesheet face a bundle\'s end meets, standing for every tube: multiplicity = the tube count. The bundle\'s pattern and the plate\'s are held to each other, a difference being a mismatch. ' +
      'COVERS a strength-welded joint, told apart by the legs stated — fillet_weld_leg, groove_weld_leg or both — with an expansion beside the weld allowed and not drawn (the holes are not drilled, §4.18.6.4.b). ' +
      'REFUSES an expanded-only or seal-welded joint (no leg stated): §4.18.10.2.c gives its allowable load to Annex 4.C\'s qualification tests, which no geometry carries. The weld is not drawn and its sizing stays the rules engine\'s (§4.18.10.5)',
  },
  {
    id: 'saddle_to_shell', article: '§4.15.3', title: 'Saddle to shell', entry: 'joint', status: 'captured',
    kinds: [Kind.SADDLE_SUPPORT, Kind.CYLINDRICAL_SHELL], specimen: mountedOnCourse(Kind.SADDLE_SUPPORT, { saddle_angle: 120, saddle_width: 200 }, side(500, 180)),
    joint: { kind: 'fillet_attachment', between: ['S', 'M'], ports: ['wall:M', 'attach'] },
  },
  {
    id: 'skirt_to_head', article: '§4.15.4', title: 'Skirt to head', entry: 'joint', status: 'captured',
    kinds: [Kind.SKIRT_SUPPORT, Kind.ELLIPSOIDAL_HEAD],
    specimen: vessel([run('H', Kind.ELLIPSOIDAL_HEAD, 0, ELLIPSOIDAL), course('S', 1), on('M', Kind.SKIRT_SUPPORT, 'H', { inside_diameter: 1490, thickness: 12, course_length: 1000 })], { M: crown(0) }),
    joint: { kind: 'fillet_attachment', between: ['H', 'M'], ports: ['wall:M', 'attach'] },
  },
  {
    id: 'lug_to_shell', article: '§4.15.5', title: 'Lug to shell', entry: 'joint', status: 'captured',
    kinds: [Kind.LUG_SUPPORT, Kind.CYLINDRICAL_SHELL], specimen: mountedOnCourse(Kind.LUG_SUPPORT, {}, side(1500, 90)),
    joint: { kind: 'fillet_attachment', between: ['S', 'M'], ports: ['wall:M', 'attach'] },
  },
  {
    id: 'jacket_to_shell', article: '§4.11', title: 'Jacket to shell', entry: 'joint', status: 'captured',
    kinds: [Kind.HALF_PIPE_JACKET, Kind.JACKET_CLOSURE, Kind.CYLINDRICAL_SHELL],
    specimen: halfPipe,
    joint: { kind: 'fillet_attachment', between: ['S', 'M'], ports: ['wall:M', 'attach'] },
  },
  {
    id: 'stiffener_to_shell', article: '§4.4.5.2', title: 'Stiffener to shell', entry: 'joint', status: 'captured',
    kinds: [Kind.STIFFENING_RING, Kind.CYLINDRICAL_SHELL], specimen: mountedOnCourse(Kind.STIFFENING_RING, { ring_height: 100, ring_thickness: 12 }),
    joint: { kind: 'fillet_attachment', between: ['S', 'M'], ports: ['wall:M', 'attach'] },
  },
];

/** Declared out of this pass by the brief, and why: carried so the list says what it leaves out. */
export const OUT_OF_SCOPE = [
  {
    article: '§4.12',
    title: 'Non-circular vessels (rectangular, obround, octagonal)',
    reason: 'out of scope, declared and kept — see DECLARATIONS: the kernel draws the bodies, but with no ports a body is not an entry',
  },
  { article: '§4.13', title: 'Layered vessels', reason: 'out of scope, declared' },
  { article: '§4.16', title: 'Flanged joints', reason: 'rules engine only: PTB-3 E5.2.1 models the neck to the flange face and applies the thrust there' },
  { article: '§4.17', title: 'Clamped connections', reason: 'rules engine only' },
  {
    article: '§4.18.10',
    title: 'Tube-to-tubesheet weld sizing',
    reason: 'rules engine only (§4.18.10.5): the JOINT is drawn since wave 1b — see tube_to_tubesheet — and its weld is carried, not drawn',
  },
] as const;

/** Wave 1b's two written decisions: an article a catalogue says nothing about reads as covered. */
export const DECLARATIONS = [
  {
    article: '§4.8',
    title: 'Quick-actuating closures',
    decision: 'entry opened, captured as the door only',
    reason:
      'The kernel already drew it (builders/covers.ts) and the catalogue listed it nowhere — the silence ran both ways. Declaring out of scope a part the modeller draws would hide a drawing; opening it as captured says exactly what it is: ' +
      'a plate with a lip. The mechanism §4.8 is about — bayonet, clamp ring, swing bolts and the locking that holds them — is a manufacturer\'s design with no parameters in the catalogue, and §4.8.1.1 gives no calculation method, ' +
      'so the entry stays at captured: nothing about the closure itself would be validated by meshing its door. It moves only when a closure type names its mechanism.',
  },
  {
    article: '§4.12',
    title: 'Non-circular vessels (rectangular, obround, octagonal)',
    decision: 'the gap stays: out of scope for the geometry catalogue',
    reason:
      'The premise needs one correction: the kernel does draw all three bodies (builders/special.ts, with their stay plates). What it cannot give them is PORTS — their ends are null, because a Junction is a pair of diameters and a non-circular end has none, ' +
      'and they offer no host surface, because a placement is (offset along the axis, azimuth round it), meaningless on a flat side. So they fail the captured bar itself. Closing the gap is ROADMAP.md §2, about two to three weeks: a surface_uv anchor ' +
      'in the definition and the backend, a host surface per non-circular builder, non-circular closures, a plate influence length in place of √(R·t), and the meshing session told first — a contract four parties read, not a catalogue pass. ' +
      'Meanwhile nothing is lost by the wait: §4.12 is closed-form end to end, all twelve types, so the rules engine reaches a verdict that no geometry feeds. Layer 1 excludes non-circular sections by design. ' +
      'It closes when the engine and meshing sessions agree the anchor, and not before.',
  },
] as const;

/** Wave 1b, Part C: whether a tube is a component, answered before the tube entry was drawn. */
export const TUBE_MODEL = {
  decision: 'the bundle is one entry carrying a pattern (count, pitch, layout angle, limit radius, tube size, length)',
  bothDefensible: true,
  why:
    'Both readings are defensible. A tube per component matches §4.18.10, which sizes the joint of ONE tube, and tube buckling, which is read at one position. ' +
    'The bundle wins because every equation of §4.18 is written on the pattern, never on a tube by position — §4.18.6.4.b replaces the drilled plate by an equivalent solid one for exactly that reason — ' +
    'and §4.18.10\'s one tube is any tube, all being identical. Several hundred identical components would be several hundred rows in the backend, the layout and the UI with nothing to tell them apart, ' +
    'and the kernel already draws one tube and repeats it (`copies`). The tube count is a property of the pattern, not a list.',
  portUnit:
    'An END of the bundle: one port per end, kind tube_end, carrying the pattern, located at the pattern\'s centre with one tube\'s radii. The tubesheet answers it with one tube_holes port on its face. ' +
    'Their joint is ONE tube_to_tubesheet joint whose multiplicity is the tube count — what §4.18.10 sizes is one of them, and the count says how many there are.',
  passArrangement:
    'Not carried by the bundle: the passes are bounded by the pass partition plates, each its own entry, so the arrangement is how many plates there are and where. The pass lanes they need are not cleared from the pattern yet.',
} as const;
