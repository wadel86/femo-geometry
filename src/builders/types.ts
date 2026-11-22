import type { ComponentDefinition, Note, Placement, PlacementAnchor } from '../definition.ts';
import type { Frame, GeometryKernel, Point2, Solid, Vec3 } from '../kernel/GeometryKernel.ts';

export type WallSurfaceKind = 'plane' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'ellipsoid';

/**
 * The mid-surface of a wall at a point: what a mesh sizes against, `R/t` and `√(R·t)` being
 * read off it. Radii are meridional then circumferential for a wall of revolution — along its
 * axis then round it for a neck — null where the surface is straight that way.
 */
export interface WallSurface {
  readonly kind: WallSurfaceKind;
  readonly principalRadii: readonly [number | null, number | null];
}

/** The wall at a point: its mid-surface, its thickness normal to it, and its meridian. */
export interface WallAt {
  readonly surface: WallSurface;
  readonly thickness: number;
  /** Unit tangent of the meridian, as (dr, dz) in the part's frame. */
  readonly meridian: Point2;
}

/** The opening a part of the axial run presents to its neighbour. */
export interface Junction {
  readonly insideDiameter: number;
  readonly outsideDiameter: number;
  /** A bolted or gasketed face, rather than the end of a wall that is welded. */
  readonly face?: boolean;
  /**
   * How far from the end the wall stays the cylinder it ends in, where that is not the part's
   * whole length or a head's straight flange: no taper may run further. Zero on a knuckle or a
   * flare, which leave the cylinder at the very end.
   */
  readonly straightLength?: number;
  /** Where the end's circles are centred, in the XY plane of the part's frame; absent, on the axis. */
  readonly centre?: Point2;
  /**
   * The wall where it ends. Its meridian points away from the part; for a face, its thickness
   * is the width across it.
   */
  readonly wall: WallAt;
}

/**
 * A circle on the vessel axis that means something: a tangent line, the end of a course.
 *
 * Builders state them from the parameters, so an edge of the rebuilt solid is named by matching
 * it against these — never by its index.
 */
export interface Landmark {
  /** Stable within the part: `lower-inside`, `crown-knuckle-outside`. */
  readonly key: string;
  readonly z: number;
  readonly diameter: number;
  readonly role: string;
  /** Set on the circles where the part meets a neighbour, which the assembly then names. */
  readonly junction?: 'lower' | 'upper';
  /** Set on a circle that is not centred on the axis: an eccentric cone's small end. */
  readonly centre?: Point2;
}

/** Where a mounted part stands on its host, in the host's frame. */
export interface HostFrame extends Frame {
  /** Wall thickness along `axis`, from the outside surface inwards. */
  readonly wall: number;
}

/** What a part offers the parts mounted on it. */
export interface HostSurface {
  readonly anchor: PlacementAnchor;
  /** The range `axialOffset` may take, before the size of what is mounted is accounted for. */
  readonly offsetRange: readonly [number, number];
  readonly defaultOffset: number;
  /** A point on the outside surface and the direction a mounted part leaves it in. */
  frameAt(axialOffset: number, azimuth: number): HostFrame;
  /** The volume the part encloses, extended past its ends, to trim what projects inwards. */
  cavity(): Solid;
  /**
   * Which of its two surfaces a point of its wall lies on — how an opening's two edges are told
   * apart whatever angle the nozzle cuts them at.
   */
  sideOf(point: readonly [number, number, number]): 'inside' | 'outside';
  /** The wall at an offset, its meridian pointing towards increasing offset. */
  wallAt(axialOffset: number): WallAt;
  /** Set on a straight cylindrical course, the only host a reinforcing pad is drawn on today. */
  readonly outsideRadius?: number;
  /** Set on a course — a cylinder or a cone — for what is shaped by its section. */
  readonly course?: CourseShape;
  /**
   * Set on a part with a leg a skirt butts on rather than being welded to its side: a forged
   * transition ring's outer leg. Its end, in the part's frame.
   */
  readonly seat?: Seat;
}

/**
 * Where one wall becomes two — a transition ring's crotch — as the zones read it: the apex, the
 * point of the run's meridian there, and the walls either side along the run.
 */
export interface Crotch {
  readonly apexZ: number;
  readonly meridianPoint: Point2;
  /** The wall below the crotch along the run (the head side) and above it, as (mean radius, thickness). */
  readonly below: { readonly radius: number; readonly thickness: number };
  readonly above: { readonly radius: number; readonly thickness: number };
}

/** The end of a leg that a mounted part is butt-welded to: a ring face at a height. */
export interface Seat {
  readonly z: number;
  readonly insideRadius: number;
  readonly outsideRadius: number;
  /** The leg's wall at its end, its meridian pointing away from the part. */
  readonly wall: WallAt;
}

/**
 * The section of a course at a height: what a ring is wrapped round, what a saddle bears on,
 * and what a nozzle that is not normal to the wall has to be aimed through.
 */
export interface CourseShape {
  /** Half-apex angle in degrees; 0 for a cylinder. Positive narrows upwards. */
  readonly halfApexAngle: number;
  /** Wall thickness, normal to the wall. */
  readonly thickness: number;
  insideRadiusAt(axialOffset: number): number;
  outsideRadiusAt(axialOffset: number): number;
}

export interface RunPart {
  /** The body: what openings are cut into. */
  readonly solid: Solid;
  /** What else the part is drawn with — a cover's dish, a plate's stays. Never pierced. */
  readonly extraSolids?: readonly Solid[];
  /** Repeats of the solids, parallel to `[solid, ...extraSolids]`: see {@link Copies}. */
  readonly copies?: Copies;
  /** Extent along the axis, from the lower junction to the upper one. */
  readonly height: number;
  /** Null where the part is closed: the crown of a head, the pole of a sphere. */
  readonly lower: Junction | null;
  readonly upper: Junction | null;
  readonly landmarks: readonly Landmark[];
  readonly host?: HostSurface;
  /**
   * The wall's mid-surface meridian, in the part's frame (r, z), from its lower junction —
   * or its lower pole — onwards: what a distance along the vessel's surface is measured on.
   */
  readonly meridian: readonly Point2[];
  /**
   * Parallel to `meridian`: where the circle through each of its points is centred, in the XY
   * plane of the part's frame. Absent, every one is on the axis — the part is revolved. Stated by
   * a part whose sections are circles that do not share an axis: an eccentric cone.
   */
  readonly centres?: readonly Point2[];
  /** For a formed head: the height of its tangent line above its lower junction. */
  readonly tangentLine?: number;
  /**
   * For a head drawn from a seam rather than its tangent line: how far along the full head's
   * mid-surface meridian, from the tangent line, its own meridian begins — so a distance along
   * the vessel can be measured on ONE s across the ring's part of the knuckle and the head's.
   */
  readonly meridianStart?: number;
  /** For a transition ring: its crotch. */
  readonly crotch?: Crotch;
  /** For a transition ring carrying a head's knuckle: the head's tangent line, inside the ring. */
  readonly carriedTangentLine?: { readonly z: number; readonly meridianPoint: Point2; readonly radius: number; readonly thickness: number };
  readonly idealisations?: readonly Idealisation[];
  /** How the part stands in a fluid domain; absent, a wall. */
  readonly fluid?: FluidIdealisation;
  /** Assumptions the drawing had to make, which the user should see. */
  readonly notes: readonly Note[];
}

/**
 * A part drawn as an idealisation of itself rather than as built — a tubesheet as a solid plate,
 * a bellows' plies as one wall. Which idealisation an analysis uses is the analysis plan's
 * choice, not the kernel's, so the drawing says what it did and carries what it left out as
 * data, from which the real geometry can be drawn when a plan asks for it.
 */
export interface Idealisation {
  readonly kind: 'equivalent_solid_plate' | 'plies_as_one_wall';
  readonly message: string;
  /** What the idealisation left out, in the part's own frame and millimetres. */
  readonly data: Readonly<Record<string, number | string>>;
}

/**
 * How a part stands in a fluid domain — declared by the part, so the derivation needs to know
 * nothing about what a bundle or a baffle is. Every solid here is in the part's own frame (a
 * mounted part's: its host's). Absent, the part is a wall: all its solids bound the fluid.
 *
 * - `wall` — subtracted from the domain; `exclude` lists solids that are not wall, by index
 *   into the part's solids (a tubesheet's tube stubs, which belong to the bundle).
 * - `porous` — not subtracted: its ENVELOPE becomes a named cell zone with a principal axis,
 *   carved into sub-zones of their own (a bundle's pass lanes), with an optional `bypass`
 *   region whose part outside the envelope is a zone of free fluid (the bundle-to-shell annulus).
 * - `baffle` — a zero-thickness internal face per baffle: where a plane cuts the domain, clipped
 *   to a region (the side of the cut the plate stands on).
 * - `none` — not in the fluid at all.
 */
export type FluidIdealisation =
  | { readonly role: 'wall'; readonly exclude?: readonly number[] }
  | {
      readonly role: 'porous';
      readonly name: string;
      readonly envelope: Solid;
      readonly axis: Vec3;
      readonly subZones?: readonly { readonly name: string; readonly solid: Solid }[];
      readonly bypass?: { readonly name: string; readonly solid: Solid };
    }
  | {
      readonly role: 'baffle';
      readonly faces: readonly { readonly name: string; readonly origin: Vec3; readonly normal: Vec3; readonly region: Solid }[];
    }
  | { readonly role: 'none' };

export interface RunContext {
  readonly kernel: GeometryKernel;
  /** Outside radius of the neighbour a flat end closes, when it has one. */
  readonly neighbourOutsideRadius?: number;
  /** Inside diameter of that neighbour: the opening a cover with no diameter of its own closes. */
  readonly neighbourInsideDiameter?: number;
  /** For a flange: whether its hub points down, towards the course below it. */
  readonly hubDown?: boolean;
  /** For a sphere: the openings of its neighbours below and above, which it is cut to meet. */
  readonly belowInsideDiameter?: number;
  readonly aboveInsideDiameter?: number;
  /** For an annular flat end: the outside radius of the course standing in its bore. */
  readonly aboveOutsideRadius?: number;
  /**
   * For a torispherical head closing the bottom under a transition ring that carries its straight
   * flange and part of its knuckle: the seam's meridional distance from the tangent line, along
   * the head's mid-surface. The head is drawn from the seam on.
   */
  readonly seamDistance?: number;
  /** For a transition ring: the torispherical head below it, whose flange and knuckle it may carry. */
  readonly headBelow?: TorisphereShape;
}

/** A torispherical head's own statement of its shape, as a neighbour reads it. */
export interface TorisphereShape {
  readonly insideDiameter: number;
  readonly crownRadius: number;
  readonly knuckleRadius: number;
  readonly thickness: number;
}

export type RunBuilder = (component: ComponentDefinition, context: RunContext) => RunPart;

export interface MountedPart {
  /** In the host's frame. A nozzle with a pad carries two. */
  readonly solids: readonly Solid[];
  /** The tool its opening is cut into the host with, in the host's frame; none for a ring. */
  readonly opening?: {
    readonly tool: Solid;
    readonly frame: HostFrame;
    readonly radius: number;
    /**
     * For a hole whose wall is not parallel to its axis — a boss's joint face, a cone through the
     * sphere's centre — its radius on the host's inside surface; `radius` is then the outside one.
     */
    readonly insideRadius?: number;
    /** How far into the host, along the axis from the frame's origin, the tool cuts. */
    readonly depth: number;
  };
  /** Half the part's extent along the host's offset: what must stay on the host. */
  readonly footprint: number;
  /**
   * Metal the part gives its host, in the host's frame, drawn as one more solid of the host after
   * the opening is cut: a nozzle's rounded corner, outside the radius it is split at.
   */
  readonly hostAddition?: Solid;
  /** Repeats of the solids, parallel to `solids`: see {@link Copies}. */
  readonly copies?: Copies;
  /** For a nozzle: its neck, and its pad when one is drawn. */
  readonly neck?: Neck;
  /** For a part welded on without opening its host: the patch of wall it covers. */
  readonly attachment?: Attachment;
  /**
   * For a part butt-welded to its host's {@link Seat} rather than fillet-welded to its side: its
   * own end there, in the host's frame — a skirt on a transition ring's outer leg.
   */
  readonly butt?: Seat;
  /**
   * For a support standing on the ground — a skirt: the plane it stands on, along its host's
   * axis in the host's frame. The face there is named 'Skirt base', for a fixed support.
   */
  readonly standsAt?: number;
  /** For a tube bundle: the pattern its tubes repeat, and where they end. */
  readonly bundle?: TubeBundle;
  /** For segmental baffles: where they stand and how they are cut. */
  readonly baffles?: BaffleSet;
  /**
   * Where the part really stands on its host when its own dimensions decide it rather than its
   * placement — a skirt on a head meets the knuckle where its diameter says.
   */
  readonly anchorOffset?: number;
  /** How the part stands in a fluid domain; absent, a wall. */
  readonly fluid?: FluidIdealisation;
  readonly notes: readonly Note[];
}

export interface Neck {
  readonly insideRadius: number;
  readonly outsideRadius: number;
  /** Along the neck's axis, from where it meets the host's outside surface. */
  readonly outward: number;
  readonly inward: number;
  readonly pad?: { readonly reach: number; readonly thickness: number };
  /**
   * Set on a forging that replaces a patch of its host's wall rather than passing through it: the
   * joint to the host is then a butt weld at `outsideRadius`, not a set-in nozzle's.
   */
  readonly insert?: true;
  /** The radii at the outer end, where they differ from the neck's: a boss's spigot, for its pipe. */
  readonly end?: { readonly insideRadius: number; readonly outsideRadius: number };
}

/**
 * A tube bundle is one part carrying a pattern, not several hundred parts: every tube is the same
 * tube, and §4.18 reads the pattern — pitch, layout, limit radius — never a tube by position. Its
 * ends are what the tubesheets join, all tubes of an end at once.
 */
export interface TubeBundle {
  readonly count: number;
  readonly pitch: number;
  readonly layoutAngle: number;
  readonly limitRadius: number;
  readonly tubeOutsideDiameter: number;
  readonly tubeThickness: number;
  /** Where the tubes end, along the host's axis in its frame: lower then upper. */
  readonly ends: readonly [number, number];
  /** The pass lanes cleared from the pattern: their clear width and the azimuth each runs at. */
  readonly lanes?: { readonly width: number; readonly azimuths: readonly number[] };
  /** The design's own tube count, where it states one beside the drawn pattern (`N_t`). */
  readonly statedCount?: number;
}

/**
 * A set of single-segmental baffles across a shell's bore: where each stands and which way its
 * window faces, and the clearances that are drawn on the shell side but not the tube side.
 */
export interface BaffleSet {
  /** The shell's inside diameter D_s the cut is measured from. */
  readonly shellDiameter: number;
  /** l_c, from the shell's inside wall. */
  readonly cutLength: number;
  readonly thickness: number;
  readonly shellClearance: number;
  readonly tubeClearance: number;
  /** Each baffle's mid-plane along the host's axis, and the azimuth its window faces. */
  readonly baffles: readonly { readonly offset: number; readonly windowAzimuth: number }[];
  /** L_b,c, the central spacing. */
  readonly spacing: number;
  /** The course's own extent along its axis: where the end spaces are measured to. */
  readonly span: readonly [number, number];
}

export interface Attachment {
  /** Along the host's offset. */
  readonly axial: number;
  readonly circumferentialDeg: number;
  /** Of the part's own plate where it meets the wall. */
  readonly thickness: number;
}

/**
 * Identical solids a part is drawn with many times — the stays of a plate, the turns of a
 * jacket. Each is built and tessellated once and drawn again at every translation listed here,
 * parallel to the part's solids; an absent entry means the solid is drawn once, where it is.
 */
export type Copies = readonly (readonly Vec3[] | undefined)[];

export interface MountedContext {
  readonly kernel: GeometryKernel;
  readonly host: ComponentDefinition;
  readonly hostSurface: HostSurface;
  readonly placement: Placement;
  /**
   * Where the nearest head tangent lines stand, in the host's offset: below its low end and
   * above its high end by a neighbouring head's straight flange, or at the course's own ends
   * where no formed head is next to it. What a saddle's `a` is measured to.
   */
  readonly tangentLines?: readonly [number, number];
  /** The host's own solid, for a part that is cut to its outside surface: a skirt on a head. */
  readonly hostSolid?: Solid;
  /**
   * The host built again by its own builder, its wall `extra` thicker outward, its inside
   * unchanged: what a layer laid on the host — a pad — is cut from, so that layer's inner face is
   * the host's own outside surface whatever its curvature. Undefined for a host whose wall is
   * not one `thickness`.
   */
  readonly thickenedHost?: (extra: number) => Solid;
  /**
   * A nozzle's corner radii, a construction detail: where the neck meets the host's outside
   * surface (the crotch, rounded by added metal) and where its bore meets the inside (rounded by
   * metal taken away). Undefined, both corners are sharp, as the catalogue nozzle always was.
   */
  readonly corner?: { readonly outside: number; readonly inside: number };
}

export type MountedBuilder = (component: ComponentDefinition, context: MountedContext) => MountedPart;
