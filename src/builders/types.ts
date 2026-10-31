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
  /** For a formed head: the height of its tangent line above its lower junction. */
  readonly tangentLine?: number;
  readonly idealisations?: readonly Idealisation[];
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
    /** How far into the host, along the axis from the frame's origin, the tool cuts. */
    readonly depth: number;
  };
  /** Half the part's extent along the host's offset: what must stay on the host. */
  readonly footprint: number;
  /** Repeats of the solids, parallel to `solids`: see {@link Copies}. */
  readonly copies?: Copies;
  /** For a nozzle: its neck, and its pad when one is drawn. */
  readonly neck?: Neck;
  /** For a part welded on without opening its host: the patch of wall it covers. */
  readonly attachment?: Attachment;
  /**
   * Where the part really stands on its host when its own dimensions decide it rather than its
   * placement — a skirt on a head meets the knuckle where its diameter says.
   */
  readonly anchorOffset?: number;
  readonly notes: readonly Note[];
}

export interface Neck {
  readonly insideRadius: number;
  readonly outsideRadius: number;
  /** Along the neck's axis, from where it meets the host's outside surface. */
  readonly outward: number;
  readonly inward: number;
  readonly pad?: { readonly reach: number; readonly thickness: number };
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
}

export type MountedBuilder = (component: ComponentDefinition, context: MountedContext) => MountedPart;
