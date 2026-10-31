// Zone outlines: where each discontinuity's zone of influence runs out, drawn on the vessel.
//
// Each discontinuity is outlined OUTLINE_FACTOR = 1.25·√(R·t) beyond its footprint, on each side
// with that side's own √(R·t). Half of the 2.5 the overlap flag uses, on purpose: §5.2.2.2.b.2
// separates two regions by 1.25·√((R1+R2)(t1+t2)), which is 1.25·√(R1·t1) + 1.25·√(R2·t2) for
// two walls of the same radius, so two outlines touch exactly where the flag changes — drawing
// 2.5·√(R·t) round each would show two zones crossing well before the clause says they do.
//
// The outlines lie on the outside surface, a little proud of it so that a solid does not hide
// them. A patch — an opening or an attachment that does not go all round — is drawn in the
// tangent plane at its centre and projected back onto the vessel, which is exact on a cylinder
// round its axis and close enough elsewhere for a drawing.
import { runOrder, toAssembly, type AssemblyModel, type BuiltPart } from '../assembly/buildAssembly.ts';
import type { AssemblyDefinition } from '../definition.ts';
import type { Vec3 } from '../kernel/GeometryKernel.ts';
import { ZONE_FACTOR, type Discontinuity, type Zones } from './zones.ts';

/** How far beyond its footprint each discontinuity's outline is drawn, in √(R·t). */
export const OUTLINE_FACTOR = ZONE_FACTOR / 2;

export interface ZoneOutline {
  /** The discontinuity's id. */
  readonly id: string;
  /** Whether its zone overlaps another's. */
  readonly overlap: boolean;
  /** Closed polylines, xyz in the assembly's frame: where the zone runs out. */
  readonly zone: readonly Float32Array[];
  /** Closed polylines: the discontinuity itself — a circle, or its footprint. */
  readonly footprint: readonly Float32Array[];
}

const CIRCLE_SEGMENTS = 128;
const PATCH_SEGMENTS = 96;

/** The run's mid-surface meridian in the assembly's frame, bottom to top, with each wall's half-thickness. */
class RunProfile {
  private readonly r: number[] = [];
  private readonly z: number[] = [];
  private readonly s: number[] = [];
  /** Per segment: the outward normal and how far to stand off the mid-surface. */
  private readonly nr: number[] = [];
  private readonly nz: number[] = [];
  private readonly lift: number[] = [];
  /** Per segment: false across the joint between two parts, which no point lies on. */
  private readonly real: boolean[] = [];

  constructor(definition: AssemblyDefinition, model: AssemblyModel) {
    const parts = new Map(model.parts.map((p) => [p.componentId, p]));
    const drawn: BuiltPart[] = [];
    for (const component of runOrder(definition.components)) {
      const part = parts.get(component.id);
      if (part && part.status === 'drawn' && part.meridian && part.meridian.length >= 2) drawn.push(part);
    }
    const largest = Math.max(1, ...drawn.flatMap((p) => p.meridian!.map(([r]) => r)));
    const proud = Math.max(1.5, 0.002 * largest);
    let cursor = 0;
    for (const part of drawn) {
      const local = part.meridian!.map(([r, z]): [number, number] => [r, toAssembly([r, 0, z], part.transform)[2]]);
      // A part turned over runs its meridian downwards.
      if (part.transform.flipped) local.reverse();
      const thickness = Math.max(
        part.junctions?.lower?.wall.thickness ?? 0,
        part.junctions?.upper?.wall.thickness ?? 0,
        part.hostSurface?.wallAt(part.hostSurface.offsetRange[0]).thickness ?? 0
      );
      local.forEach(([r, z], index) => {
        if (index > 0) {
          const [pr, pz] = local[index - 1];
          cursor += Math.hypot(r - pr, z - pz);
        } else if (this.r.length > 0) {
          // The step to the next part's first point: a segment of no part, never projected onto.
          this.pushSegment(0, 0, 0, false);
        }
        if (index > 0) {
          const [pr, pz] = local[index - 1];
          const length = Math.hypot(r - pr, z - pz) || 1;
          // Bottom to top with the axis on the inside, (dz, −dr) points out of the vessel.
          this.pushSegment((z - pz) / length, -(r - pr) / length, thickness / 2 + proud, true);
        }
        this.r.push(r);
        this.z.push(z);
        this.s.push(cursor);
      });
    }
  }

  private pushSegment(nr: number, nz: number, lift: number, real: boolean): void {
    this.nr.push(nr);
    this.nz.push(nz);
    this.lift.push(lift);
    this.real.push(real);
  }

  get length(): number {
    return this.s.length > 0 ? this.s[this.s.length - 1] : 0;
  }

  get empty(): boolean {
    return this.nr.length === 0;
  }

  /** On the outside surface at a length along the run: radius, height, and the meridian's direction. */
  at(s: number): { r: number; z: number; tr: number; tz: number } {
    const clamped = Math.max(0, Math.min(this.length, s));
    let i = 0;
    while (i < this.nr.length - 1 && (this.s[i + 1] < clamped || !this.real[i])) i++;
    return this.onSegment(i, this.s[i + 1] > this.s[i] ? (clamped - this.s[i]) / (this.s[i + 1] - this.s[i]) : 0);
  }

  /** The point of the outside surface nearest a point of the meridian half-plane. */
  nearest(r: number, z: number): { r: number; z: number; tr: number; tz: number; s: number } {
    let best = { distance: Infinity, i: 0, f: 0 };
    for (let i = 0; i < this.nr.length; i++) {
      if (!this.real[i]) continue;
      const dr = this.r[i + 1] - this.r[i];
      const dz = this.z[i + 1] - this.z[i];
      const span = dr * dr + dz * dz;
      const f = span > 0 ? Math.max(0, Math.min(1, ((r - this.r[i]) * dr + (z - this.z[i]) * dz) / span)) : 0;
      const distance = Math.hypot(this.r[i] + f * dr - r, this.z[i] + f * dz - z);
      if (distance < best.distance) best = { distance, i, f };
    }
    return { ...this.onSegment(best.i, best.f), s: this.s[best.i] + best.f * (this.s[best.i + 1] - this.s[best.i]) };
  }

  private onSegment(i: number, f: number): { r: number; z: number; tr: number; tz: number } {
    const r = this.r[i] + f * (this.r[i + 1] - this.r[i]);
    const z = this.z[i] + f * (this.z[i + 1] - this.z[i]);
    return {
      r: Math.max(0, r + this.nr[i] * this.lift[i]),
      z: z + this.nz[i] * this.lift[i],
      // The meridian's direction is the normal turned back a quarter.
      tr: -this.nz[i],
      tz: this.nr[i],
    };
  }
}

function circle(profile: RunProfile, s: number): Float32Array {
  const { r, z } = profile.at(s);
  const out = new Float32Array(CIRCLE_SEGMENTS * 3);
  for (let k = 0; k < CIRCLE_SEGMENTS; k++) {
    const theta = (2 * Math.PI * k) / CIRCLE_SEGMENTS;
    out.set([r * Math.cos(theta), r * Math.sin(theta), z], k * 3);
  }
  return out;
}

/**
 * A closed curve round a patch, in the tangent plane at its centre: an ellipse for an opening, a
 * rounded rectangle for an attachment, each grown by `grow` — then projected onto the vessel.
 */
function patch(
  profile: RunProfile,
  centre: { s: number; azimuth: number },
  extent: { below: number; above: number; half: number },
  shape: 'ellipse' | 'rectangle',
  grow: number
): Float32Array {
  const base = profile.at(centre.s);
  const a = (centre.azimuth * Math.PI) / 180;
  const [ca, sa] = [Math.cos(a), Math.sin(a)];
  const origin: Vec3 = [base.r * ca, base.r * sa, base.z];
  const along: Vec3 = [base.tr * ca, base.tr * sa, base.tz];
  const round: Vec3 = [-sa, ca, 0];

  const local: [number, number][] = [];
  if (shape === 'ellipse') {
    const shift = (extent.above - extent.below) / 2;
    const semiAlong = (extent.above + extent.below) / 2 + grow;
    const semiRound = extent.half + grow;
    for (let k = 0; k < PATCH_SEGMENTS; k++) {
      const phi = (2 * Math.PI * k) / PATCH_SEGMENTS;
      local.push([shift + semiAlong * Math.cos(phi), semiRound * Math.sin(phi)]);
    }
  } else {
    // The rectangle offset by `grow`: its four sides joined by quarter circles.
    const corners: [number, number][] = [
      [extent.above, extent.half],
      [-extent.below, extent.half],
      [-extent.below, -extent.half],
      [extent.above, -extent.half],
    ];
    const perCorner = PATCH_SEGMENTS / 4;
    corners.forEach(([u, v], c) => {
      for (let k = 0; k <= perCorner; k++) {
        const phi = (Math.PI / 2) * (c + k / perCorner);
        local.push([u + grow * Math.cos(phi), v + grow * Math.sin(phi)]);
      }
    });
  }

  const out = new Float32Array(local.length * 3);
  local.forEach(([u, v], k) => {
    const q: Vec3 = [
      origin[0] + u * along[0] + v * round[0],
      origin[1] + u * along[1] + v * round[1],
      origin[2] + u * along[2] + v * round[2],
    ];
    const on = profile.nearest(Math.hypot(q[0], q[1]), q[2]);
    const azimuth = Math.atan2(q[1], q[0]);
    out.set([on.r * Math.cos(azimuth), on.r * Math.sin(azimuth), on.z], k * 3);
  });
  return out;
}

/** The outline of every discontinuity's zone of influence, and of the discontinuity itself. */
export function zoneOutlines(definition: AssemblyDefinition, model: AssemblyModel, zones: Zones): ZoneOutline[] {
  const profile = new RunProfile(definition, model);
  if (profile.empty) return [];
  const overlapping = new Set(zones.proximities.filter((p) => p.overlap).flatMap((p) => p.between));

  return zones.discontinuities
    .filter((d) => d.kind !== 'weld_seam')
    .map((d): ZoneOutline => {
      const [m0, m1] = d.meridional;
      const below = OUTLINE_FACTOR * d.sqrtRt.below;
      const above = OUTLINE_FACTOR * d.sqrtRt.above;
      const outline = { id: d.id, overlap: overlapping.has(d.id) };
      if (!d.circumferential) {
        // All round: a circle, or a band for a skirt or a ring, and a circle either side.
        const footprint = m1 - m0 > 1e-6 ? [circle(profile, m0), circle(profile, m1)] : [circle(profile, m0)];
        return { ...outline, footprint, zone: [circle(profile, m0 - below), circle(profile, m1 + above)] };
      }
      const centre = centreOf(profile, d);
      const extent = { below: centre.s - m0, above: m1 - centre.s, half: d.circumferential.halfWidth };
      const shape = d.kind === 'opening' ? 'ellipse' : 'rectangle';
      return {
        ...outline,
        footprint: [patch(profile, centre, extent, shape, 0)],
        zone: [patch(profile, centre, extent, shape, below)],
      };
    });
}

function centreOf(profile: RunProfile, d: Discontinuity): { s: number; azimuth: number } {
  const [x, y, z] = d.location;
  const { s } = profile.nearest(Math.hypot(x, y), z);
  return { s: Math.max(d.meridional[0], Math.min(d.meridional[1], s)), azimuth: d.circumferential!.azimuth };
}
