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
/** A circle square to Z: what {@link GeometryKernel.loft} joins. */
export interface CircleSection {
  readonly z: number;
  /** In the XY plane. */
  readonly centre: Point2;
  readonly radius: number;
}

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

/** An opaque sheet owned by the kernel: one face or several, with no volume — a baffle's plane. */
export interface Sheet {
  readonly __sheet: true;
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

/** An edge as a fillet's selector sees it: where it runs, and whether it closes on itself. */
export interface EdgeProbe {
  readonly start: Vec3;
  readonly middle: Vec3;
  readonly end: Vec3;
  readonly closed: boolean;
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
  /** Faces with no volume, written beside the solids: a fluid domain's baffles. */
  readonly sheets?: readonly Sheet[];
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
   * A solid cylinder of elliptical section along `frame.axis`, from `from` to `to` measured along
   * it: semi-axis `radiusAcross` along `across` (a unit vector square to the axis), `radiusOther`
   * square to both. What a pad round a neck that leans on its host is cut from.
   */
  ellipticPrism(frame: Frame, across: Vec3, radiusAcross: number, radiusOther: number, from: number, to: number): Solid;

  /**
   * A prism: a closed outline of the XY plane — a section across the vessel axis, `r` read as
   * x and `z` as y — extruded along Z from `from` to `to`. What is not a solid of revolution
   * (a saddle, a lug, a rectangular box) is one of these.
   */
  extrude(outline: Profile, from: number, to: number): Solid;

  /**
   * A solid tube of circular section `tubeRadius`, its centre swept along a right-handed helix
   * about Z of radius `radius` and pitch `pitch`, from `(radius, 0, from)` up `height`. Circular,
   * so its section is the same however the sweep turns it: what a half-pipe coil is cut from.
   * The seam of its side surface runs along the side facing the axis, at radius
   * `radius − tubeRadius`, so a cut along the surface of radius `radius` never meets it.
   */
  helicalTube(radius: number, pitch: number, from: number, height: number, tubeRadius: number): Solid;

  /**
   * A hollow pipe of annular section, `innerRadius` to `outerRadius`, open at both ends: what
   * `helicalTube(outer)` less `helicalTube(inner)` is, on the same helix, with the same seams —
   * built without that boolean, which between two long swept surfaces that never meet still
   * costs seconds.
   */
  helicalPipe(radius: number, pitch: number, from: number, height: number, innerRadius: number, outerRadius: number): Solid;

  /**
   * A solid through circles square to Z, joined by ruled faces from each to the next: every
   * section is a circle, but the centres need not lie on one axis — an eccentric cone. The point
   * at angle θ of one circle is ruled to the point at θ of the next. Optional: a kernel without
   * it does not draw such a part, and says so.
   */
  loft?(sections: readonly CircleSection[]): Solid;

  /** `base` with every tool removed, in one boolean. */
  cut(base: Solid, tools: readonly Solid[]): Solid;

  intersect(a: Solid, b: Solid): Solid;

  /** The union of two solids, as one solid: what a corner is rounded on before it is split again. */
  fuse(a: Solid, b: Solid): Solid;

  /**
   * The solid with some of its edges rounded. `radiusOf` is asked once per edge and returns the
   * radius to round it to, or null to leave it sharp; an edge is offered by where it runs, never
   * by an index a rebuild would renumber.
   */
  fillet(solid: Solid, radiusOf: (edge: EdgeProbe) => number | null): Solid;

  translate(solid: Solid, offset: Vec3): Solid;

  /** Turns a solid about the vessel axis, by degrees from +X towards +Y. */
  rotateZ(solid: Solid, degrees: number): Solid;

  /** Turns a solid by degrees, right-handed, about the line through `at` along `axis`. */
  rotate(solid: Solid, degrees: number, axis: Vec3, at?: Vec3): Solid;

  /** Turns a solid upside down: a half turn about X, so z → −z and y → −y. */
  flip(solid: Solid): Solid;

  volume(solid: Solid): number;

  bounds(solid: Solid): Bounds;

  /** The separate solids a shape holds: what a cut leaves when it parts a body in pieces. */
  solidsOf(shape: Solid): Solid[];

  /** The faces where the plane through `origin`, square to `normal`, cuts a solid. */
  section(solid: Solid, origin: Vec3, normal: Vec3): Sheet;

  /** The part of a sheet inside a solid. */
  clip(sheet: Sheet, solid: Solid): Sheet;

  area(sheet: Sheet): number;

  /** The area of every face of a solid together. */
  surfaceArea(solid: Solid): number;

  sheetBounds(sheet: Sheet): Bounds;

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
