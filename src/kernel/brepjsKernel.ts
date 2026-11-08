// The GeometryKernel port, implemented on brepjs over OpenCascade (occt-wasm).
//
// The only file of the package that imports brepjs. Everything brepjs-specific — its drawing
// pen, its Result type, its branded shape types, its face and edge hashes — stops here.
import {
  OcctWasmAdapter,
  circle,
  compound,
  helix,
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
import { OcctKernel } from 'occt-wasm';
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
  Profile,
  Solid,
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
  return new BrepjsKernel();
}

class BrepjsKernel implements GeometryKernel {
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
    const section = unwrap(wire([circle(tubeRadius, { at: [radius, 0, from], axis: tangent })]));
    // Frenet's frame is well defined all along a helix, and a circle does not care how it turns.
    return asSolid(unwrap(sweep(section as never, spine, { frenet: true })) as Shape);
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

  flip(solid: Solid): Solid {
    return asSolid(rotate(asShape(solid), 180, { axis: [1, 0, 0] }));
  }

  volume(solid: Solid): number {
    return unwrap(measureVolume(asShape(solid)));
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

  exportStep(products: readonly StepProduct[]): string {
    const parts = products
      .filter((product) => product.solids.length > 0)
      .map((product) => ({
        shape: product.solids.length === 1 ? asShape(product.solids[0]) : compound(product.solids.map(asShape)),
        name: product.name,
      }));
    return unwrap(exportSTEPConfigured(parts, { unit: 'mm', modelUnit: 'mm' }));
  }
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
