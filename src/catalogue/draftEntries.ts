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
  /** The Part 4 article the entry answers. */
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

const notStarted = (id: string, article: string, title: string, entry: DraftEntry['entry'], note: string): DraftEntry => ({
  id, article, title, entry, status: 'not started', kinds: [], note,
});

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
  notStarted('conical_shell.eccentric', '§4.3.4', 'Conical shell, eccentric', 'component',
    'No catalogue kind, and the run is drawn about one axis: an eccentric cone is the placement without an axis of revolution in ROADMAP.md'),
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
  notStarted('leg_support', '§4.15.5', 'Leg', 'component',
    'The catalogue has one kind for "lug, leg or bracket" and the kernel draws it as a lug; a leg down to the foundation needs its own length and section'),

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
  notStarted('tube', '§4.18', 'Tube', 'component',
    'Drawn only as stubs inside the tubesheet part, the outer ring of the pattern: no tube has a solid or a port of its own'),
  notStarted('pass_partition_plate', '§4.18', 'Pass partition plate', 'component',
    'No catalogue kind; the tubesheet carries pass_partition_groove_depth for the rules and nothing for the drawing'),
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
  notStarted('tube_to_tubesheet', '§4.18.10', 'Tube to tubesheet', 'joint',
    'The joint kind is reserved and never emitted: the tubes are stubs of the plate, with no port to join'),
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
  { article: '§4.12', title: 'Non-circular vessels (obround, rectangular)', reason: 'out of scope, declared' },
  { article: '§4.13', title: 'Layered vessels', reason: 'out of scope, declared' },
  { article: '§4.16', title: 'Flanged joints', reason: 'rules engine only: PTB-3 E5.2.1 models the neck to the flange face and applies the thrust there' },
  { article: '§4.17', title: 'Clamped connections', reason: 'rules engine only' },
  { article: '§4.18.10', title: 'Tube-to-tubesheet welds', reason: 'rules engine only' },
] as const;
