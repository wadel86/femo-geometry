// The GeometryKernel port, implemented on brepjs over OpenCascade (occt-wasm).
//
// The only file of the package that imports brepjs. Everything brepjs-specific — its drawing
// pen, its Result type, its branded shape types, its face and edge hashes — stops here.
import {
  OcctWasmAdapter,
  circle,
  compound,
  helix,
  addHoles,
  flipFaceOrientation,
  outerWire,
  sewShells,
  solid,
  sweep,
  wire,
  curveLength,
  exportSTEPConfigured,
  faceAxis,
  isValid,
  measureArea,
  curvePointAt,
  cut,
  cutAll,
  draw,
  faceCenter,
  fillet,
  fuse,
  facesOfEdge,
  getBounds,
  getCurveType,
  getEdges,
  getFaces,
  getSolids,
  sectionToFace,
  getHashCode,
  getSurfaceType,
  intersect,
  measureCurvatureAtMid,
  measureVolume,
  mesh,
  meshEdges,
  registerKernel,
  rotate,
  translate,
  unwrap,
  curveIsClosed,
  loft as loftWires,
} from 'brepjs';
import { OcctKernel, type ShapeHandle } from 'occt-wasm';
import { nameRepresentationItems } from './stepNames.ts';
import type {
  Bounds,
  CircleSection,
  CurveKind,
  EdgeGeometry,
  EdgeInfo,
  EdgeProbe,
  FaceGeometry,
  FaceInfo,
  Frame,
  GeometryKernel,
  Point2,
  Profile,
  Sheet,
  Solid,
  StepOptions,
  StepProduct,
  SurfaceKind,
  Tessellation,
  Topology,
  Vec3,
} from './GeometryKernel.ts';

/**
 * brepjs proves validity with branded phantom types (`ValidSolid`, `OrientedFace` …) that an
 * opaque port cannot carry across, so shapes are untyped inside this adapter and only here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Shape = any;

const asShape = (solid: Solid): Shape => solid as unknown as Shape;
const asSolid = (shape: Shape): Solid => shape as Solid;

/** Angular deflection of the tessellation, in radians: what keeps small fillets round. */
const ANGULAR_TOLERANCE = 0.12;

const SURFACES: Record<string, SurfaceKind> = {
  PLANE: 'plane',
  CYLINDRE: 'cylinder',
  CONE: 'cone',
  SPHERE: 'sphere',
  TORUS: 'torus',
  REVOLUTION_SURFACE: 'revolution',
};

const CURVES: Record<string, CurveKind> = {
  LINE: 'line',
  CIRCLE: 'circle',
  ELLIPSE: 'ellipse',
  BSPLINE_CURVE: 'bspline',
  BEZIER_CURVE: 'bspline',
};

export interface BrepjsKernelOptions {
  /**
   * Where the OpenCascade WASM binary is. Omitted, occt-wasm finds it next to its own module,
   * which works in Node; a bundler has to hand over the URL it emitted.
   */
  readonly wasm?: string | URL | ArrayBuffer | Uint8Array;
}

/** Loads OpenCascade (multi-megabyte — call it lazily, in a worker) and wraps it. */
export async function createBrepjsKernel(options: BrepjsKernelOptions = {}): Promise<GeometryKernel> {
  const occt = await OcctKernel.init(options.wasm === undefined ? undefined : { wasm: options.wasm });
  registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(occt));
  return new BrepjsKernel(occt);
}

class BrepjsKernel implements GeometryKernel {
  /** The kernel brepjs runs on, for what brepjs does not wrap: an XCAF assembly document. */
  private readonly occt: OcctKernel;

  constructor(occt: OcctKernel) {
    this.occt = occt;
  }

  revolve(profile: Profile): Solid {
    return asSolid(drawing(profile).sketchOnPlane('XZ').revolve([0, 0, 1]));
  }

  extrude(outline: Profile, from: number, to: number): Solid {
    const prism: Shape = drawing(outline).sketchOnPlane('XY').extrude(to - from);
    return from === 0 ? asSolid(prism) : asSolid(translate(prism, [0, 0, from]));
  }

  helicalTube(radius: number, pitch: number, from: number, height: number, tubeRadius: number): Solid {
    const spine = helix(pitch, height, radius, { at: [0, 0, from] });
    // The section square to the helix at its start, where it leaves (radius, 0, from).
    const lead = Math.hypot(2 * Math.PI * radius, pitch);
    const tangent: [number, number, number] = [0, (2 * Math.PI * radius) / lead, pitch / lead];
    const centre: [number, number, number] = [radius, 0, from];
    let section: Shape = unwrap(wire([circle(tubeRadius, { at: centre, axis: tangent })])) as Shape;
    // OpenCascade starts the circle where its own frame says, which for this tangent is the
    // section's axial point — on a surface of radius `radius`, so a coil cut along that surface
    // had its weld line within a micron of the seam and kept a sliver face between the two.
    // Turned so the seam faces the axis; Frenet's frame keeps it there all along the helix.
    const [px, py, pz] = curvePointAt(section as never, 0);
    const u: Vec3 = [px - centre[0], py - centre[1], pz - centre[2]];
    const inward: Vec3 = [-1, 0, 0];
    const cross: Vec3 = [u[1] * inward[2] - u[2] * inward[1], u[2] * inward[0] - u[0] * inward[2], u[0] * inward[1] - u[1] * inward[0]];
    const sine = cross[0] * tangent[0] + cross[1] * tangent[1] + cross[2] * tangent[2];
    const turn = (Math.atan2(sine, u[0] * inward[0] + u[1] * inward[1] + u[2] * inward[2]) * 180) / Math.PI;
    if (Math.abs(turn) > 1e-9) section = rotate(section, turn, { at: centre, axis: tangent });
    // Frenet's frame is well defined all along a helix, and a circle does not care how it turns.
    return asSolid(unwrap(sweep(section as never, spine, { frenet: true })) as Shape);
  }

  helicalPipe(radius: number, pitch: number, from: number, height: number, innerRadius: number, outerRadius: number): Solid {
    // Two tubes swept on the same helix, then their side faces and two annular ends sewn into one
    // solid: what cutting one from the other gives, without the boolean — which, between two
    // long swept surfaces that never meet, still costs seconds proving that they do not.
    const outer = this.helicalTube(radius, pitch, from, height, outerRadius) as unknown as Shape;
    const inner = this.helicalTube(radius, pitch, from, height, innerRadius) as unknown as Shape;
    const planar = (f: Shape) => {
      const type = getSurfaceType(f as never);
      return type.ok && type.value === 'PLANE';
    };
    const sides = [outer, inner].flatMap((s) => getFaces(s as never).filter((f) => !planar(f as Shape)));
    const holes = getFaces(inner as never).filter((f) => planar(f as Shape));
    const ends = getFaces(outer as never)
      .filter((f) => planar(f as Shape))
      .map((disc) => {
        const c = faceCenter(disc as never) as unknown as Vec3;
        const hole = holes.find((h) => {
          const d = faceCenter(h as never) as unknown as Vec3;
          return Math.hypot(d[0] - c[0], d[1] - c[1], d[2] - c[2]) < 1e-6 * Math.max(1, radius);
        });
        if (!hole) throw new Error('helicalPipe: an end of the inner tube is not where the outer tube ends');
        return addHoles(disc as never, [outerWire(hole as never) as never]);
      });
    const shell = unwrap(sewShells([...sides, ...ends] as never));
    let pipe = unwrap(solid([shell] as never)) as unknown as Shape;
    // Sewn, the shell may come out turned inside out: a solid of negative volume.
    const volume = measureVolume(pipe as never);
    if (volume.ok && volume.value < 0) pipe = unwrap(solid([unwrap(sewShells([...sides, ...ends].map((f) => flipFaceOrientation(f as never)) as never))] as never)) as unknown as Shape;
    return asSolid(pipe);
  }

  loft(sections: readonly CircleSection[]): Solid {
    const wires = sections.map((s) => unwrap(wire([circle(s.radius, { at: [s.centre[0], s.centre[1], s.z], axis: [0, 0, 1] })])));
    return asSolid(unwrap(loftWires(wires as never, { ruled: true })) as Shape);
  }

  tube(frame: Frame, innerRadius: number, outerRadius: number, from: number, to: number): Solid {
    const outline = draw([innerRadius, from])
      .lineTo([outerRadius, from])
      .lineTo([outerRadius, to])
      .lineTo([innerRadius, to])
      .close();
    let shape: Shape = outline.sketchOnPlane('XZ').revolve([0, 0, 1]);

    // Tilt Z onto the axis: a turn of θ about Y, then of φ about Z, lands (0,0,1) on
    // (sin θ cos φ, sin θ sin φ, cos θ).
    const [ax, ay, az] = frame.axis;
    const theta = (Math.acos(Math.max(-1, Math.min(1, az))) * 180) / Math.PI;
    const phi = (Math.atan2(ay, ax) * 180) / Math.PI;
    if (Math.abs(theta) > 1e-9) shape = rotate(shape, theta, { axis: [0, 1, 0] });
    if (Math.abs(phi) > 1e-9) shape = rotate(shape, phi, { axis: [0, 0, 1] });
    return asSolid(translate(shape, [frame.origin[0], frame.origin[1], frame.origin[2]]));
  }

  ellipticPrism(frame: Frame, across: Vec3, radiusAcross: number, radiusOther: number, from: number, to: number): Solid {
    const [a, b] = [radiusAcross, radiusOther];
    const quarter = (end: Point2) => ({ kind: 'ellipse' as const, to: end, radiusR: a, radiusZ: b, counterClockwise: true });
    const section = drawing({ start: [a, 0], steps: [quarter([0, b]), quarter([-a, 0]), quarter([0, -b]), quarter([a, 0])] });
    let shape: Shape = section.sketchOnPlane('XY').extrude(to - from);
    if (from !== 0) shape = translate(shape, [0, 0, from]);

    // The same tilt as tube(): θ about Y, then φ about Z. It carries X to X' and Y to Y'; a spin ψ
    // about Z first puts the section's X — its `radiusAcross` — where `across` lands.
    const [ax, ay, az] = frame.axis;
    const theta = Math.acos(Math.max(-1, Math.min(1, az)));
    const phi = Math.atan2(ay, ax);
    const X: Vec3 = [Math.cos(theta) * Math.cos(phi), Math.cos(theta) * Math.sin(phi), -Math.sin(theta)];
    const Y: Vec3 = [-Math.sin(phi), Math.cos(phi), 0];
    const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    const psi = (Math.atan2(dot(across, Y), dot(across, X)) * 180) / Math.PI;
    if (Math.abs(psi) > 1e-9) shape = rotate(shape, psi, { axis: [0, 0, 1] });
    if (Math.abs(theta) > 1e-12) shape = rotate(shape, (theta * 180) / Math.PI, { axis: [0, 1, 0] });
    if (Math.abs(phi) > 1e-12) shape = rotate(shape, (phi * 180) / Math.PI, { axis: [0, 0, 1] });
    return asSolid(translate(shape, [frame.origin[0], frame.origin[1], frame.origin[2]]));
  }

  cut(base: Solid, tools: readonly Solid[]): Solid {
    if (tools.length === 0) return base;
    if (tools.length === 1) return asSolid(unwrap(cut(asShape(base), asShape(tools[0]))));
    return asSolid(unwrap(cutAll(asShape(base), tools.map(asShape))));
  }

  intersect(a: Solid, b: Solid): Solid {
    return asSolid(unwrap(intersect(asShape(a), asShape(b))));
  }

  fuse(a: Solid, b: Solid): Solid {
    return asSolid(unwrap(fuse(asShape(a), asShape(b))));
  }

  fillet(solid: Solid, radiusOf: (edge: EdgeProbe) => number | null): Solid {
    const pick = (shape: Shape) =>
      getEdges(shape).map((edge: Shape) => ({
        edge,
        radius: radiusOf({
          start: toVec3(curvePointAt(edge, 0)),
          middle: toVec3(curvePointAt(edge, 0.5)),
          end: toVec3(curvePointAt(edge, 1)),
          closed: curveIsClosed(edge),
        }),
      }));
    // One radius per call: given several at once, OpenCascade rounds the edges of a saddle-shaped
    // intersection to a fraction of what was asked (a 38.1 mm crotch came out a quarter its volume).
    // A rounded edge is replaced by the fillet's own boundaries, which a selector by location does
    // not pick again, so each radius is asked for exactly once.
    const radii = [...new Set(pick(asShape(solid)).map((p: { radius: number | null }) => p.radius))]
      .filter((r): r is number => r !== null && r > 0)
      .sort((x, y) => y - x);
    let shape = asShape(solid);
    for (const radius of radii) {
      const edges = pick(shape)
        .filter((p: { radius: number | null }) => p.radius === radius)
        .map((p: { edge: Shape }) => p.edge);
      if (edges.length > 0) shape = unwrap(fillet(shape, edges, radius));
    }
    return asSolid(shape);
  }

  translate(solid: Solid, offset: Vec3): Solid {
    return asSolid(translate(asShape(solid), [offset[0], offset[1], offset[2]]));
  }

  rotateZ(solid: Solid, degrees: number): Solid {
    return Math.abs(degrees) < 1e-12 ? solid : asSolid(rotate(asShape(solid), degrees, { axis: [0, 0, 1] }));
  }

  rotate(solid: Solid, degrees: number, axis: Vec3, at: Vec3 = [0, 0, 0]): Solid {
    return Math.abs(degrees) < 1e-12 ? solid : asSolid(rotate(asShape(solid), degrees, { axis, at }));
  }

  flip(solid: Solid): Solid {
    return asSolid(rotate(asShape(solid), 180, { axis: [1, 0, 0] }));
  }

  volume(solid: Solid): number {
    return unwrap(measureVolume(asShape(solid)));
  }

  solidsOf(shape: Solid): Solid[] {
    return getSolids(asShape(shape)).map(asSolid);
  }

  section(solid: Solid, origin: Vec3, normal: Vec3): Sheet {
    const n = unit3(normal);
    // Any direction square to the normal will do for the plane's own axes.
    const seed: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const x = unit3(cross3(seed, n));
    const y = cross3(n, x);
    // A plane section is edges only; the faces are a sheet across the solid's box, kept where it is
    // inside the solid.
    const b = getBounds(asShape(solid));
    const pad = 0.1 * Math.max(b.xMax - b.xMin, b.yMax - b.yMin, b.zMax - b.zMin, 1);
    const box = this.extrude(
      {
        start: [b.xMin - pad, b.yMin - pad],
        steps: [
          { kind: 'line', to: [b.xMax + pad, b.yMin - pad] },
          { kind: 'line', to: [b.xMax + pad, b.yMax + pad] },
          { kind: 'line', to: [b.xMin - pad, b.yMax + pad] },
        ],
      },
      b.zMin - pad,
      b.zMax + pad
    );
    const sheet: Shape = unwrap(sectionToFace(asShape(box), { origin, xDir: x, yDir: y, zDir: n }));
    return unwrap(intersect(sheet, asShape(solid))) as unknown as Sheet;
  }

  clip(sheet: Sheet, solid: Solid): Sheet {
    return unwrap(intersect(sheet as unknown as Shape, asShape(solid))) as Sheet;
  }

  area(sheet: Sheet): number {
    return unwrap(measureArea(sheet as unknown as Shape));
  }

  surfaceArea(solid: Solid): number {
    return unwrap(measureArea(asShape(solid)));
  }

  sheetBounds(sheet: Sheet): Bounds {
    return boundsOf(sheet as unknown as Shape);
  }

  bounds(solid: Solid): Bounds {
    const b = getBounds(asShape(solid));
    return { min: [b.xMin, b.yMin, b.zMin], max: [b.xMax, b.yMax, b.zMax] };
  }

  tessellate(solid: Solid, tolerance: number): Tessellation {
    return tessellate(asShape(solid), tolerance);
  }

  topology(solid: Solid): Topology {
    const shape = asShape(solid);
    return {
      faces: getFaces(shape).map((face: Shape): FaceGeometry => {
        const area = measureArea(face);
        const axis = faceAxis(face);
        return {
          ...faceInfo(face, { start: 0, count: 0 }),
          area: area.ok ? area.value : NaN,
          bounds: boundsOf(face),
          axis: axis ? { origin: toVec3(axis.origin), axis: toVec3(axis.direction) } : null,
        };
      }),
      edges: getEdges(shape).map(
        (edge: Shape): EdgeGeometry => ({ ...edgeInfo(shape, edge, { start: 0, count: 0 }), bounds: boundsOf(edge) })
      ),
    };
  }

  isValid(solid: Solid): boolean {
    return isValid(asShape(solid));
  }

  exportStep(products: readonly StepProduct[], options: StepOptions = {}): string {
    const parts = products
      .map((product) => [...product.solids.map(asShape), ...(product.sheets ?? []).map((s) => s as unknown as Shape)])
      .map((shapes, index) => ({ shapes, name: products[index]!.name }))
      .filter(({ shapes }) => shapes.length > 0)
      .map(({ shapes, name }) => ({ shape: shapes.length === 1 ? shapes[0] : compound(shapes), name }));
    const step =
      options.assembly !== undefined && parts.length > 1
        ? this.assemblyStep(parts, options.assembly)
        : unwrap(exportSTEPConfigured(parts, { unit: 'mm', modelUnit: 'mm' }));
    return options.nameSolids ? nameRepresentationItems(step) : step;
  }

  /**
   * One root assembly, one component per part. Each part is added on its own first, so that a
   * component of several solids reuses it as ONE part rather than being expanded into a
   * sub-assembly of unnamed solids; the root is then grown from the first part, which moves into
   * its first component under the part's name.
   */
  private assemblyStep(parts: readonly { shape: Shape; name: string }[], assembly: string): string {
    const handle = (shape: Shape) => (shape.wrapped as { id: number }).id as ShapeHandle;
    const doc = this.occt.createXCAFDocument();
    try {
      for (const part of parts.slice(1)) doc.addShape(handle(part.shape), { name: part.name });
      const root = doc.addShape(handle(parts[0]!.shape), { name: parts[0]!.name });
      for (const part of parts.slice(1)) doc.addChild(root, handle(part.shape));
      doc.setName(root, assembly);
      // Each occurrence carries its part's name: NEXT_ASSEMBLY_USAGE_OCCURRENCE is where an
      // assembly-aware reader looks first.
      for (const component of doc.getChildren(root)) {
        const prototype = doc.getReferredLabel(component);
        if (prototype === null) continue;
        const info = doc.getLabelInfo(prototype);
        if (info.shapeHandle !== null) this.occt.release(info.shapeHandle);
        doc.setName(component, info.name);
      }
      return doc.exportSTEP();
    } finally {
      doc.close();
    }
  }
}

function unit3(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function boundsOf(shape: Shape): Bounds {
  const b = getBounds(shape);
  return { min: [b.xMin, b.yMin, b.zMin], max: [b.xMax, b.yMax, b.zMax] };
}

/** A closed outline as a brepjs drawing, in whichever plane it is then sketched on. */
function drawing(profile: Profile): Shape {
  let pen = draw([profile.start[0], profile.start[1]]);
  let from = profile.start;
  for (const step of profile.steps) {
    if (step.kind === 'line') {
      pen = pen.lineTo([step.to[0], step.to[1]]);
    } else if (step.kind === 'arc') {
      pen = pen.threePointsArcTo([step.to[0], step.to[1]], [step.through[0], step.through[1]]);
    } else if (step.kind === 'bezier') {
      pen = pen.bezierCurveTo(
        [step.to[0], step.to[1]],
        step.controls.map((p): [number, number] => [p[0], p[1]])
      );
    } else {
      // SVG arc semantics: an arc of less than half a turn, swept counter-clockwise when the
      // flag is set — in the drawing plane, whose y is the vessel axis.
      pen = pen.ellipseTo(
        [step.to[0], step.to[1]],
        step.radiusR,
        step.radiusZ,
        0,
        false,
        step.counterClockwise
      );
    }
    from = step.to;
  }
  if (from[0] !== profile.start[0] || from[1] !== profile.start[1]) {
    pen = pen.lineTo([profile.start[0], profile.start[1]]);
  }
  return pen.done();
}

function tessellate(shape: Shape, tolerance: number): Tessellation {
  const triangles = mesh(shape, { tolerance, angularTolerance: ANGULAR_TOLERANCE, cache: false });
  const lines = meshEdges(shape, { tolerance, angularTolerance: ANGULAR_TOLERANCE, cache: false });

  const trianglesByFace = new Map<number, { start: number; count: number }>();
  for (const group of triangles.faceGroups) trianglesByFace.set(group.faceId, group);

  const faces: FaceInfo[] = getFaces(shape).map((face: Shape) =>
    faceInfo(face, trianglesByFace.get(getHashCode(face)) ?? { start: 0, count: 0 })
  );

  const segmentsByEdge = new Map<number, { start: number; count: number }>();
  for (const group of lines.edgeGroups) segmentsByEdge.set(group.edgeId, group);

  const edges: EdgeInfo[] = getEdges(shape).map((edge: Shape) =>
    edgeInfo(shape, edge, segmentsByEdge.get(getHashCode(edge)) ?? { start: 0, count: 0 })
  );

  return {
    positions: triangles.vertices,
    normals: triangles.normals,
    indices: triangles.triangles,
    lines: lines.lines,
    faces,
    edges,
  };
}

function faceInfo(face: Shape, range: { start: number; count: number }): FaceInfo {
  const type = getSurfaceType(face);
  const curvature = measureCurvatureAtMid(face);
  return {
    id: getHashCode(face),
    surface: type.ok ? (SURFACES[type.value] ?? 'other') : 'other',
    radii: curvature.ok
      ? [radiusOf(curvature.value.maxCurvature), radiusOf(curvature.value.minCurvature)]
      : [Infinity, Infinity],
    center: toVec3(faceCenter(face)),
    start: range.start,
    count: range.count,
  };
}

function edgeInfo(shape: Shape, edge: Shape, range: { start: number; count: number }): EdgeInfo {
  return {
    id: getHashCode(edge),
    curve: CURVES[getCurveType(edge)] ?? 'other',
    length: curveLength(edge),
    closed: curveIsClosed(edge),
    start: toVec3(curvePointAt(edge, 0)),
    middle: toVec3(curvePointAt(edge, 0.5)),
    end: toVec3(curvePointAt(edge, 1)),
    faceIds: facesOfEdge(shape, edge).map((face: Shape) => getHashCode(face)),
    start3: range.start,
    count3: range.count,
  };
}

const radiusOf = (curvature: number): number =>
  Math.abs(curvature) < 1e-12 ? Infinity : 1 / Math.abs(curvature);

const toVec3 = (point: ArrayLike<number>): Vec3 => [point[0], point[1], point[2]];
