// Zones of influence: where the wall stops being a plain membrane, and how close those places are.
//
// Every discontinuity — a change of slope, curvature or thickness, an opening, an attachment —
// disturbs the wall over a length of the order of √(R·t), its own attenuation length. Two of them
// interact when those lengths overlap, and that is what decides whether a skirt on a knuckle, a
// saddle near a head, a nozzle in a knuckle or two adjacent nozzles can be judged one at a time.
//
// The kernel judges nothing here. It states where each discontinuity is, its √(R·t), and the
// distance between every pair measured along the vessel's surface; the multiple of √(R·t) a
// clause applies is the clause's — §5.2.2.2.b uses 1.0 and 2.5, §4.15.5.5 1.8·√(D·t) — so the
// overlap flag states the one factor it uses rather than hiding it. Distances a rule reads are
// measured too, under their symbols, and set beside what the designer stated: a layout and a
// dimension that disagree are two models of one vessel, which is reported, never resolved.
import { Kind, Sym, type AssemblyDefinition } from '../definition.ts';
import { runOrder, toAssembly, type AssemblyModel, type BuiltPart } from '../assembly/buildAssembly.ts';
import type { Point2, Vec3 } from '../kernel/GeometryKernel.ts';
import type { Joint, Port } from './ports.ts';

/**
 * The multiple of √(R·t) the overlap flag uses: two discontinuities overlap when they are closer
 * than 2.5·√(R·t), √(R·t) taken as the mean of the two facing walls' — §5.2.2.2.b.2's separation.
 */
export const ZONE_FACTOR = 2.5;

/**
 * `weld_seam` is not a discontinuity of the membrane solution and takes part in no overlap: it
 * is there because §4.15.5.5 measures a support's distance to the nearer of a discontinuity and
 * a Category A or B seam, and the circumferential seams are known from the run.
 */
export type DiscontinuityKind = 'junction' | 'tangent_line' | 'knuckle' | 'opening' | 'attachment' | 'weld_seam';

export interface Discontinuity {
  /** `<componentId>:<key>` — stable for the same assembly. */
  readonly id: string;
  readonly kind: DiscontinuityKind;
  /** The part whose wall carries it: the host of an opening or an attachment, the lower part of a junction. */
  readonly componentId: string;
  /** Every part it involves: both sides of a junction, a host and what is mounted on it. */
  readonly componentIds: readonly string[];
  readonly location: Vec3;
  /**
   * What changes there: `slope`, `curvature` or `thickness` for a junction or a tangent line;
   * `opening` or `attachment` otherwise.
   */
  readonly causes: readonly string[];
  /**
   * Its footprint along the vessel's mid-surface meridian, in millimetres from the bottom of the
   * run — a point for a circle, a span for an opening or a patch.
   */
  readonly meridional: readonly [number, number];
  /** Round the vessel: the azimuth of its centre and its half-width on the surface; null all round. */
  readonly circumferential: { readonly azimuth: number; readonly halfWidth: number } | null;
  /**
   * √(R·t) on the side towards the bottom of the run and on the side towards the top, R being the
   * mid-surface's circumferential radius and t the wall's thickness there.
   */
  readonly sqrtRt: { readonly below: number; readonly above: number };
  /**
   * For a weld seam, its joint category: A where it joins a hemispherical head to its shell, B
   * for every other circumferential butt weld.
   */
  readonly category?: 'A' | 'B';
}

export interface Proximity {
  readonly between: readonly [string, string];
  /** Edge to edge, along the vessel's surface; zero where their footprints touch or overlap. */
  readonly distance: number;
  /** How it was measured: within one course, or across the run. */
  readonly basis: string;
  /** ZONE_FACTOR times the mean √(R·t) of the facing walls: the separation they are judged against. */
  readonly threshold: number;
  /** Whether their zones overlap: the distance is less than the threshold. */
  readonly overlap: boolean;
}

/** A distance a rule reads, measured off the layout rather than typed. */
export interface Measured {
  readonly value: number;
  readonly unit: 'mm';
  readonly basis: string;
  /** Whether a rule may read it in place of an unstated symbol; never in place of a stated one. */
  readonly fillable: boolean;
  /** The layout revision it was measured on, when the definition states one. */
  readonly layoutRevision: number | null;
}

/** A stated symbol the layout contradicts. */
export interface MeasurementIssue {
  readonly componentId: string;
  readonly symbol: string;
  readonly stated: number;
  readonly measured: number;
  readonly delta: number;
  readonly message: string;
}

export interface Zones {
  readonly zoneFactor: number;
  readonly discontinuities: readonly Discontinuity[];
  readonly proximities: readonly Proximity[];
  /** Keyed on component id, then on the symbol's wire name. */
  readonly measured: Readonly<Record<string, Readonly<Record<string, Measured>>>>;
  readonly issues: readonly MeasurementIssue[];
}

const FORMED_HEADS: ReadonlySet<string> = new Set([
  Kind.HEMISPHERICAL_HEAD,
  Kind.TORISPHERICAL_HEAD,
  Kind.ELLIPSOIDAL_HEAD,
]);

const mm = (value: number): string => `${Number(value.toPrecision(5))} mm`;

/** A polyline's cumulative lengths. */
function lengths(points: readonly Point2[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return out;
}

/** The length along a polyline to the point of it nearest `p`. */
function lengthTo(points: readonly Point2[], cumulative: readonly number[], p: Point2): number {
  let best = Infinity;
  let at = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1];
    const dx = points[i][0] - ax;
    const dz = points[i][1] - az;
    const span = dx * dx + dz * dz;
    const f = span > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / span)) : 0;
    const d = Math.hypot(ax + f * dx - p[0], az + f * dz - p[1]);
    if (d < best) {
      best = d;
      at = cumulative[i - 1] + f * Math.sqrt(span);
    }
  }
  return at;
}

/**
 * The run's mid-surface meridian, laid end to end from the bottom: where each part's own
 * meridian starts and ends along it, read in the assembly's frame.
 */
class MeridianPath {
  private readonly spans = new Map<string, { start: number; end: number; part: BuiltPart; cumulative: number[] }>();

  constructor(definition: AssemblyDefinition, model: AssemblyModel) {
    const parts = new Map(model.parts.map((p) => [p.componentId, p]));
    let cursor = 0;
    for (const component of runOrder(definition.components)) {
      const part = parts.get(component.id);
      if (!part || part.status !== 'drawn' || !part.meridian || part.meridian.length < 2) continue;
      const cumulative = lengths(part.meridian);
      const length = cumulative[cumulative.length - 1];
      this.spans.set(part.componentId, { start: cursor, end: cursor + length, part, cumulative });
      cursor += length;
    }
  }

  has(componentId: string): boolean {
    return this.spans.has(componentId);
  }

  /** Where a point of a part's own frame stands along the run's meridian. */
  at(componentId: string, point: Vec3): number | undefined {
    const span = this.spans.get(componentId);
    if (!span?.part.meridian) return undefined;
    const along = lengthTo(span.part.meridian, span.cumulative, [Math.hypot(point[0], point[1]), point[2]]);
    // A part turned over runs its meridian downwards.
    return span.part.transform.flipped ? span.end - along : span.start + along;
  }

  /** Where a part's lower or upper junction stands along it. */
  end(componentId: string, side: 'lower' | 'upper'): number | undefined {
    const span = this.spans.get(componentId);
    if (!span) return undefined;
    const atLower = span.part.transform.flipped ? span.end : span.start;
    const atUpper = span.part.transform.flipped ? span.start : span.end;
    return side === 'lower' ? atLower : atUpper;
  }
}

/** √(R·t) of a wall, R its circumferential mid-surface radius; a flat plate falls back on `fallback`. */
function sqrtRt(port: Pick<Port, 'surface' | 'thickness'>, fallback: number): number {
  const radius = port.surface.principalRadii[1] ?? fallback;
  return Math.sqrt(radius * port.thickness);
}

const azimuthOf = (p: Vec3): number => (Math.atan2(p[1], p[0]) * 180) / Math.PI;

/** Derives the discontinuities of a built assembly, how close they are, and what it measures. */
export function deriveZones(
  definition: AssemblyDefinition,
  model: AssemblyModel,
  ports: readonly Port[],
  joints: readonly Joint[]
): Zones {
  const path = new MeridianPath(definition, model);
  const parts = new Map(model.parts.map((p) => [p.componentId, p]));
  const components = new Map(definition.components.map((c) => [c.id, c]));
  const portsById = new Map(ports.map((p) => [p.id, p]));
  const discontinuities: Discontinuity[] = [];

  // ---------------------------------------------------------------- junctions of the run
  for (const joint of joints) {
    if (joint.sourceRule !== 'run adjacency') continue;
    const below = portsById.get(joint.ports[0]);
    const above = portsById.get(joint.ports[1]);
    if (!below || !above) continue;
    const causes: string[] = [];
    const meridians = below.meridian[0] * above.meridian[0] + below.meridian[1] * above.meridian[1] + below.meridian[2] * above.meridian[2];
    if (meridians > -0.9999) causes.push('slope');
    const [rb0, rb1] = below.surface.principalRadii;
    const [ra0, ra1] = above.surface.principalRadii;
    const sameRadius = (x: number | null, y: number | null) =>
      x === y || (x !== null && y !== null && Math.abs(x - y) <= 1e-6 * Math.max(x, y));
    if (below.surface.kind !== above.surface.kind || !sameRadius(rb0, ra0) || !sameRadius(rb1, ra1)) {
      causes.push('curvature');
    }
    if (Math.abs(below.thickness - above.thickness) > 1e-6) causes.push('thickness');
    const s = path.end(below.componentId, below.key === 'upper' ? 'upper' : 'lower');
    if (s === undefined) continue;

    // Every butt weld of the run is a circumferential seam, whatever the walls on either side do.
    if (joint.kind === 'butt_weld') {
      const hemispherical = [below, above].some((p) => parts.get(p.componentId)?.kind === Kind.HEMISPHERICAL_HEAD);
      discontinuities.push({
        id: `${below.componentId}:${below.key}:seam`,
        kind: 'weld_seam',
        componentId: below.componentId,
        componentIds: [below.componentId, above.componentId],
        location: below.location,
        causes: ['weld'],
        meridional: [s, s],
        circumferential: null,
        sqrtRt: { below: sqrtRt(below, below.meanRadius ?? 0), above: sqrtRt(above, above.meanRadius ?? 0) },
        category: hemispherical ? 'A' : 'B',
      });
    }
    // Two equal courses butted together are a seam and nothing more: no discontinuity.
    if (causes.length === 0) continue;
    discontinuities.push({
      id: `${below.componentId}:${below.key}`,
      kind: 'junction',
      componentId: below.componentId,
      componentIds: [below.componentId, above.componentId],
      location: below.location,
      causes,
      meridional: [s, s],
      circumferential: null,
      sqrtRt: {
        below: sqrtRt(below, below.meanRadius ?? 0),
        above: sqrtRt(above, above.meanRadius ?? 0),
      },
    });
  }

  // ---------------------------------------------------------------- inside a head
  for (const part of model.parts) {
    if (part.status !== 'drawn' || !FORMED_HEADS.has(part.kind) || !part.hostSurface || !path.has(part.componentId)) continue;
    const wall = part.hostSurface.wallAt(0);
    const t = wall.thickness;
    const circle = (key: string, kind: DiscontinuityKind, insideKey: string, outsideKey: string, causes: string[]) => {
      const inside = part.landmarks.find((l) => l.key === insideKey);
      const outside = part.landmarks.find((l) => l.key === outsideKey);
      if (!inside || !outside) return;
      const rho = (inside.diameter + outside.diameter) / 4;
      const z = (inside.z + outside.z) / 2;
      const s = path.at(part.componentId, [rho, 0, z]);
      if (s === undefined) return;
      // The circumferential radius just either side, in the part's own frame.
      const radiusOn = (r: number) => part.hostSurface!.wallAt(Math.max(0, Math.min(part.hostSurface!.offsetRange[1], r))).surface.principalRadii[1] ?? rho;
      const towardsCrown = Math.sqrt(radiusOn(rho * 0.995) * t);
      const towardsRim = Math.sqrt(Math.max(radiusOn(rho * 1.005), rho) * t);
      // Turned over, the crown side of the head lies below the circle.
      const flipped = part.transform.flipped;
      discontinuities.push({
        id: `${part.componentId}:${key}`,
        kind,
        componentId: part.componentId,
        componentIds: [part.componentId],
        location: toAssembly([0, 0, z], part.transform),
        causes,
        meridional: [s, s],
        circumferential: null,
        sqrtRt: { below: flipped ? towardsCrown : towardsRim, above: flipped ? towardsRim : towardsCrown },
      });
    };
    if ((part.tangentLine ?? 0) > 0) circle('tangent-line', 'tangent_line', 'tangent-inside', 'tangent-outside', ['curvature']);
    if (part.kind === Kind.TORISPHERICAL_HEAD) {
      circle('crown-knuckle', 'knuckle', 'crown-knuckle-inside', 'crown-knuckle-outside', ['curvature']);
    }
  }

  // ---------------------------------------------------------------- openings and attachments
  for (const part of model.parts) {
    if (part.status !== 'drawn' || !part.hostId || !part.mount || !part.localPlacement) continue;
    const host = parts.get(part.hostId);
    if (!host?.hostSurface || !path.has(host.componentId)) continue;
    const surface = host.hostSurface;
    const local = part.localPlacement;
    const origin = part.mount.origin;
    const s = path.at(host.componentId, origin);
    if (s === undefined) continue;

    // The footprint along the meridian, from the host's own surface either side of the anchor.
    const offsetHalf = part.neck
      ? Math.max(part.footprint ?? part.neck.outsideRadius, part.neck.pad?.reach ?? 0)
      : (part.attachment?.axial ?? 0) / 2;
    const [low, high] = surface.offsetRange;
    const sideAt = (offset: number) => {
      const clamped = Math.max(low, Math.min(high, offset));
      return path.at(host.componentId, surface.frameAt(clamped, local.azimuth).origin) ?? s;
    };
    const ends = [sideAt(local.axialOffset - offsetHalf), sideAt(local.axialOffset + offsetHalf)];
    const meridional: [number, number] = [Math.min(...ends, s), Math.max(...ends, s)];

    const wall = surface.wallAt(local.axialOffset);
    const radius = wall.surface.principalRadii[1];
    const component = components.get(part.componentId);
    let circumferential: Discontinuity['circumferential'];
    if (part.neck) {
      let half = Math.max(part.neck.outsideRadius, part.neck.pad?.reach ?? 0);
      const offset = component?.dimensions[Sym.NOZZLE_OFFSET];
      const course = surface.course;
      if (part.kind === Kind.HILLSIDE_NOZZLE && offset !== undefined && course) {
        // An opening off the vessel's axis spreads further round the shell than across it.
        const ro = course.outsideRadiusAt(local.axialOffset);
        const r = part.neck.outsideRadius;
        const spread = Math.asin(Math.min(1, (offset + r) / ro)) - Math.asin(Math.max(-1, (offset - r) / ro));
        half = Math.max(half, ((radius ?? ro) * spread) / 2);
      }
      circumferential = { azimuth: azimuthOf(toAssembly(origin, part.transform)), halfWidth: half };
    } else if (part.attachment && part.attachment.circumferentialDeg < 360) {
      circumferential = {
        azimuth: azimuthOf(toAssembly(origin, part.transform)),
        halfWidth: ((radius ?? 0) * part.attachment.circumferentialDeg * Math.PI) / 360,
      };
    } else {
      circumferential = null;
    }
    const root = Math.sqrt((radius ?? part.neck?.outsideRadius ?? 0) * wall.thickness);
    discontinuities.push({
      id: `${host.componentId}:${part.neck ? 'opening' : 'wall'}:${part.componentId}`,
      kind: part.neck ? 'opening' : 'attachment',
      componentId: host.componentId,
      componentIds: [host.componentId, part.componentId],
      location: toAssembly(origin, part.transform),
      causes: [part.neck ? 'opening' : 'attachment'],
      meridional,
      circumferential,
      sqrtRt: { below: root, above: root },
    });
  }

  // ---------------------------------------------------------------- how close they are
  // A seam disturbs no membrane solution, so it is never one of a pair.
  const geometric = discontinuities.filter((d) => d.kind !== 'weld_seam');
  const seams = discontinuities.filter((d) => d.kind === 'weld_seam');
  const proximities: Proximity[] = [];
  for (let i = 0; i < geometric.length; i++) {
    for (let j = i + 1; j < geometric.length; j++) {
      proximities.push(proximity(geometric[i], geometric[j]));
    }
  }
  proximities.sort((a, b) => a.distance - b.distance);

  // ---------------------------------------------------------------- what the rules read
  const measured: Record<string, Record<string, Measured>> = {};
  const layoutRevision = definition.layoutRevision ?? null;
  const record = (componentId: string, symbol: string, value: number, basis: string, fillable: boolean) => {
    (measured[componentId] ??= {})[symbol] = { value, unit: 'mm', basis, fillable, layoutRevision };
  };
  const byId = new Map(discontinuities.map((d) => [d.id, d]));

  // §4.5.13: the clear spacing between two necks' outside surfaces on the same host.
  const openings = discontinuities.filter((d) => d.kind === 'opening');
  for (const opening of openings) {
    const nozzle = parts.get(opening.componentIds[1]);
    if (!nozzle?.neck) continue;
    let best: { value: number; other: string } | undefined;
    for (const other of openings) {
      if (other === opening || other.componentId !== opening.componentId) continue;
      const neighbour = parts.get(other.componentIds[1]);
      if (!neighbour?.neck) continue;
      const value = clearSpacing(opening, nozzle, other, neighbour);
      if (!best || value < best.value) best = { value, other: neighbour.name };
    }
    if (best) {
      record(
        nozzle.componentId,
        Sym.NOZZLE_SPACING,
        best.value,
        `Chord between the outside surfaces of the necks of ${nozzle.name} and ${best.other} on the outside of their host — shorter than along the surface, so conservative`,
        true
      );
    }
  }

  // §4.15.3: a saddle's axis to the nearer head tangent line, along the vessel axis.
  const tangentLines = model.parts
    .filter((p) => p.status === 'drawn' && FORMED_HEADS.has(p.kind))
    .map((p) => toAssembly([0, 0, p.tangentLine ?? 0], p.transform)[2]);
  for (const part of model.parts) {
    if (part.kind !== Kind.SADDLE_SUPPORT || part.status !== 'drawn' || !part.mount || tangentLines.length === 0) continue;
    const z = toAssembly(part.mount.origin, part.transform)[2];
    const value = Math.min(...tangentLines.map((t) => Math.abs(z - t)));
    record(
      part.componentId,
      Sym.SADDLE_DISTANCE,
      value,
      'Along the vessel axis, from the saddle centre to the nearer head tangent line, nominal',
      true
    );
  }

  // §4.15.5.5: a lug to the nearer of a discontinuity and a Category A or B seam. The
  // circumferential seams are known; the longitudinal ones are not, so this is an upper bound.
  for (const part of model.parts) {
    if (part.kind !== Kind.LUG_SUPPORT || part.status !== 'drawn' || !part.hostId) continue;
    const own = byId.get(`${part.hostId}:wall:${part.componentId}`);
    if (!own) continue;
    const nearest = [
      ...proximities.filter((p) => p.between.includes(own.id)).map((p) => p.distance),
      ...seams.map((seam) => proximity(own, seam).distance),
    ].reduce((a, b) => Math.min(a, b), Infinity);
    if (!Number.isFinite(nearest)) continue;
    record(
      part.componentId,
      Sym.SUPPORT_TO_DISCONTINUITY,
      nearest,
      'Nearest geometric discontinuity or circumferential weld seam, edge to edge along the surface; longitudinal (Category A) seams are not modelled, so this is an upper bound',
      false
    );
  }

  // ---------------------------------------------------------------- stated against measured
  const issues: MeasurementIssue[] = [];
  for (const [componentId, symbols] of Object.entries(measured)) {
    const component = components.get(componentId);
    for (const [symbol, value] of Object.entries(symbols)) {
      const stated = component?.dimensions[symbol];
      if (stated === undefined || !Number.isFinite(stated)) continue;
      const delta = stated - value.value;
      const tolerance = Math.max(1, 0.01 * value.value);
      // An upper bound is contradicted only by a statement that the support is further away.
      const contradicts = value.fillable ? Math.abs(delta) > tolerance : delta > tolerance;
      if (!contradicts) continue;
      issues.push({
        componentId,
        symbol,
        stated,
        measured: value.value,
        delta,
        message: `${component?.name ?? componentId}: ${symbol} is stated as ${mm(stated)} but the layout measures ${mm(value.value)}${value.fillable ? '' : ' at most'}`,
      });
    }
  }

  return { zoneFactor: ZONE_FACTOR, discontinuities, proximities, measured, issues };
}

/** How far apart two discontinuities are along the vessel's surface, and whether their zones overlap. */
function proximity(a: Discontinuity, b: Discontinuity): Proximity {
  const [lower, upper] = a.meridional[0] <= b.meridional[0] ? [a, b] : [b, a];
  const gapAlong = Math.max(0, upper.meridional[0] - lower.meridional[1]);
  let gapRound = 0;
  if (a.circumferential && b.circumferential) {
    let angle = Math.abs(a.circumferential.azimuth - b.circumferential.azimuth) % 360;
    if (angle > 180) angle = 360 - angle;
    const radius = Math.min(radiusOf(a), radiusOf(b));
    gapRound = Math.max(0, (radius * angle * Math.PI) / 180 - a.circumferential.halfWidth - b.circumferential.halfWidth);
  }
  const distance = Math.hypot(gapAlong, gapRound);
  // Facing sides when one lies along the meridian from the other; the larger of each otherwise.
  // §5.2.2.2.b.2 separates two regions by 1.25·√((R1+R2)(t1+t2)) — 2.5·√(R·t) for two equal
  // walls, ONE zone between them and not one from each — so the factor applies to their mean.
  const reach =
    (gapAlong > 0
      ? lower.sqrtRt.above + upper.sqrtRt.below
      : Math.max(a.sqrtRt.below, a.sqrtRt.above) + Math.max(b.sqrtRt.below, b.sqrtRt.above)) / 2;
  const sameWall = a.componentId === b.componentId;
  const threshold = ZONE_FACTOR * reach;
  return {
    between: [a.id, b.id],
    distance,
    basis: sameWall
      ? 'Developed surface of one part: along its meridian and round it'
      : 'Mid-surface meridians summed across the run, and round the smaller of the two radii',
    threshold,
    overlap: distance < threshold,
  };
}

/** How far a discontinuity stands from the vessel axis: the radius it is measured round at. */
function radiusOf(d: Discontinuity): number {
  return Math.hypot(d.location[0], d.location[1]);
}

/**
 * The clear spacing between two necks on one host: the chord between their centres on the
 * outside surface, less each neck's extent along it — an ellipse for a neck that does not stand
 * normal to the wall, so the extent depends on the direction.
 */
function clearSpacing(a: Discontinuity, partA: BuiltPart, b: Discontinuity, partB: BuiltPart): number {
  const along = ((a.meridional[0] + a.meridional[1]) - (b.meridional[0] + b.meridional[1])) / 2;
  let angle = Math.abs((a.circumferential?.azimuth ?? 0) - (b.circumferential?.azimuth ?? 0)) % 360;
  if (angle > 180) angle = 360 - angle;
  const radius = Math.min(radiusOf(a), radiusOf(b));
  const round = 2 * radius * Math.sin((angle * Math.PI) / 360);
  const centres = Math.hypot(along, round);
  if (centres === 0) return 0;
  const extent = (part: BuiltPart) => {
    const neck = part.neck!;
    // Semi-axes of the hole on the developed surface: along the meridian and round it.
    const m = Math.max(part.footprint ?? neck.outsideRadius, neck.outsideRadius);
    const c = neck.outsideRadius;
    const cos = along / centres;
    const sin = round / centres;
    return (m * c) / Math.hypot(c * cos, m * sin);
  };
  return Math.max(0, centres - extent(partA) - extent(partB));
}
