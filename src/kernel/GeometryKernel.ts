// The geometry kernel, as the builders see it.
//
// Builders depend on this port and never on brepjs directly, so the B-Rep library underneath
// stays a swap rather than a rewrite (replicad, raw opencascade.js). It is deliberately small:
// every vessel part is a surface of revolution or a tube, so a profile revolved about the
// vessel axis, a tube along an arbitrary axis and three booleans cover the whole taxonomy.

export type Vec3 = readonly [number, number, number];

/** A point of the meridian half-plane: `r` from the vessel axis, `z` along it. */
export type Point2 = readonly [number, number];

export type ProfileStep =
  | { readonly kind: 'line'; readonly to: Point2 }
  /** A circular arc to `to` passing through `through`. */
  | { readonly kind: 'arc'; readonly to: Point2; readonly through: Point2 }
  /**
   * An arc of the ellipse centred on the origin with semi-axes `radiusR` along r and `radiusZ`
   * along z, followed counter-clockwise when `counterClockwise` is set.
   */
  | {
      readonly kind: 'ellipse';
      readonly to: Point2;
      readonly radiusR: number;
      readonly radiusZ: number;
      readonly counterClockwise: boolean;
    }
  /** One Bézier to `to`, through the interior control points `controls`. */
  | { readonly kind: 'bezier'; readonly to: Point2; readonly controls: readonly Point2[] };

/** A closed outline of the meridian half-plane, closed by a straight line back to its start. */
export interface Profile {
  readonly start: Point2;
  readonly steps: readonly ProfileStep[];
}

/** A point and the direction a tube's own axis takes from it. */
export interface Frame {
  readonly origin: Vec3;
  /** Unit vector. */
  readonly axis: Vec3;
}

/** An opaque solid owned by the kernel. */
export interface Solid {
  readonly __solid: true;
}

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export type SurfaceKind = 'plane' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'revolution' | 'other';

export type CurveKind = 'line' | 'circle' | 'ellipse' | 'bspline' | 'other';

export interface FaceInfo {
  /** Valid within one tessellation only — never persisted, never exposed as a reference. */
  readonly id: number;
  readonly surface: SurfaceKind;
  /** Principal radii of curvature at the middle of the face, Infinity where it is flat. */
  readonly radii: readonly [number, number];
  readonly center: Vec3;
  /** First index into `indices` and the number of indices (3 per triangle). */
  readonly start: number;
  readonly count: number;
}

export interface EdgeInfo {
  /** Valid within one tessellation only. */
  readonly id: number;
  readonly curve: CurveKind;
  readonly length: number;
  readonly closed: boolean;
  readonly start: Vec3;
  readonly middle: Vec3;
  readonly end: Vec3;
  /**
   * The faces on either side. A seam — the line where a surface of revolution meets itself —
   * borders one face only: it is a topological artefact, not an edge of the form.
   */
  readonly faceIds: readonly number[];
  /** First vertex into `lines` (2 per segment) and the number of vertices. */
  readonly start3: number;
  readonly count3: number;
}

export interface Tessellation {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  /** Line segments, two vertices each. */
  readonly lines: Float32Array;
  readonly faces: readonly FaceInfo[];
  readonly edges: readonly EdgeInfo[];
}

/** A face with what a predicate re-evaluated elsewhere needs: its size, its box, its axis. */
export interface FaceGeometry extends FaceInfo {
  /** Square millimetres. */
  readonly area: number;
  readonly bounds: Bounds;
  /** The axis of a face of revolution — cylinder, cone, sphere, torus — null otherwise. */
  readonly axis: Frame | null;
}

export interface EdgeGeometry extends EdgeInfo {
  readonly bounds: Bounds;
}

/** The faces and edges of a solid, measured and not meshed; ids match `tessellate`'s. */
export interface Topology {
  readonly faces: readonly FaceGeometry[];
  readonly edges: readonly EdgeGeometry[];
}

/** One product of a STEP assembly: a component, named, made of separate solids. */
export interface StepProduct {
  readonly name: string;
  readonly solids: readonly Solid[];
}

export interface GeometryKernel {
  /** Revolves a profile a full turn about the vessel axis (Z). */
  revolve(profile: Profile): Solid;

  /**
   * A tube along `frame.axis`, from `from` to `to` measured along it from `frame.origin`.
   * An inner radius of zero makes it a solid cylinder.
   */
  tube(frame: Frame, innerRadius: number, outerRadius: number, from: number, to: number): Solid;

  /**
   * A prism: a closed outline of the XY plane — a section across the vessel axis, `r` read as
   * x and `z` as y — extruded along Z from `from` to `to`. What is not a solid of revolution
   * (a saddle, a lug, a rectangular box) is one of these.
   */
  extrude(outline: Profile, from: number, to: number): Solid;

  /** `base` with every tool removed, in one boolean. */
  cut(base: Solid, tools: readonly Solid[]): Solid;

  intersect(a: Solid, b: Solid): Solid;

  translate(solid: Solid, offset: Vec3): Solid;

  /** Turns a solid about the vessel axis, by degrees from +X towards +Y. */
  rotateZ(solid: Solid, degrees: number): Solid;

  /** Turns a solid upside down: a half turn about X, so z → −z and y → −y. */
  flip(solid: Solid): Solid;

  volume(solid: Solid): number;

  bounds(solid: Solid): Bounds;

  /**
   * Triangles and the exact B-Rep edges of a solid.
   *
   * @param tolerance chordal deviation in millimetres — derive it from the size of the model,
   *     never use an absolute value
   */
  tessellate(solid: Solid, tolerance: number): Tessellation;

  topology(solid: Solid): Topology;

  /** Whether the solid passes the kernel's own check: closed, oriented, self-consistent. */
  isValid(solid: Solid): boolean;

  /**
   * A STEP file, millimetres: one product per entry, its solids kept apart — never fused, so
   * whoever meshes them decides where they are joined.
   */
  exportStep(products: readonly StepProduct[]): string;
}
