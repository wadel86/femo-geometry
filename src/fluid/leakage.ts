// The shell-side flow areas of a single-segmental baffled bundle: what a porous model carries as
// porous jumps instead of meshing a gap of a few millimetres on a metre-scale domain.
//
// Each area twice. BOOK is Shah & Sekulić §8.5.2 and §8.5.3 as the rating computes it — Eqs.
// (8.111) to (8.129), the tube-to-baffle area in Eq. (8.129)'s thin-gap form, on the design's own
// tube count — so a rating can be checked against it term for term. DRAWN is measured on the
// parts as drawn: the exact annuli, the tubes the pattern really puts in the window or the baffle,
// the outer tube limit the rows really reach. The two differ by what the book idealises, and the
// difference is the point of carrying both. Millimetres and square millimetres throughout.
import type { BaffleSet, TubeBundle } from '../builders/types.ts';
import { clearLanes, tubePattern } from '../builders/exchangers.ts';
import type { Vec3 } from '../kernel/GeometryKernel.ts';

export interface BaffleAreas {
  /** A_o,sb: between the shell's bore and the baffle's rim, round the baffle's arc. */
  readonly shellToBaffle: number;
  /** A_o,tb: between the tubes and their holes, in one baffle. */
  readonly tubeToBaffle: number;
  /** A_o,w: the window's net flow area, its tubes taken out. */
  readonly window: number;
}

export interface BaffleLeakage {
  readonly name: string;
  /** The baffle's mid-plane along its course's axis. */
  readonly offset: number;
  readonly windowAzimuth: number;
  readonly book: BaffleAreas;
  readonly drawn: BaffleAreas & { readonly holes: number; readonly windowTubes: number };
}

export interface SpaceBypass {
  /** `inlet`, `central:<k>` or `outlet`: between which faces the space runs. */
  readonly name: string;
  readonly length: number;
  /** A_o,bp = L·(D_s − D_otl + 0.5·N_p·w_p), Eq. (8.127). */
  readonly book: number;
  /** L·(D_s − D_otl as drawn + N_p · the lanes' clear gap as drawn). */
  readonly drawn: number;
}

export interface LeakageReport {
  readonly shellDiameter: number;
  readonly cutLength: number;
  /** θ_b, Eq. (8.112), radians. */
  readonly cutAngle: number;
  /** F_w, Eq. (8.113): the fraction of the tubes in one window. */
  readonly windowFraction: number;
  /** D_otl = 2·r_o + d_o, the book's; and the extent the drawn rows reach. */
  readonly outerTubeLimit: { readonly book: number; readonly drawn: number };
  /** N_p: pass lanes parallel to the crossflow, which the window's azimuth decides. */
  readonly parallelLanes: number;
  readonly tubes: { readonly drawn: number; readonly stated: number | null; readonly difference: number | null };
  readonly baffles: readonly BaffleLeakage[];
  readonly spaces: readonly SpaceBypass[];
  readonly notes: readonly string[];
}

const DEG = Math.PI / 180;

/** Of a circle of radius ρ, the segment beyond a chord at distance c from its centre. */
function segment(rho: number, c: number): number {
  if (c >= rho) return 0;
  return rho * rho * Math.acos(c / rho) - c * Math.sqrt(rho * rho - c * c);
}

export function leakageOf(baffles: BaffleSet, bundle: TubeBundle): LeakageReport {
  const notes: string[] = [];
  const ds = baffles.shellDiameter;
  const lc = baffles.cutLength;
  const d = bundle.tubeOutsideDiameter;
  const chord = ds / 2 - lc;
  const centres: readonly Vec3[] = bundle.lanes
    ? clearLanes(tubePattern(bundle.pitch, bundle.limitRadius, bundle.layoutAngle), bundle.lanes, d)
    : tubePattern(bundle.pitch, bundle.limitRadius, bundle.layoutAngle);
  const drawnCount = centres.length;
  const stated = bundle.statedCount ?? null;
  const nt = stated ?? drawnCount;
  if (stated === null) notes.push(`No tube_count stated: the book forms use the ${drawnCount} tubes drawn`);

  // Window section, Eqs. (8.111) to (8.117).
  const thetaB = 2 * Math.acos(1 - (2 * lc) / ds);
  const dctl = 2 * bundle.limitRadius;
  const dotl = dctl + d;
  const ratio = (ds - 2 * lc) / dctl;
  const thetaCtl = ratio >= 1 ? 0 : 2 * Math.acos(ratio);
  const fw = thetaCtl / (2 * Math.PI) - Math.sin(thetaCtl) / (2 * Math.PI);
  const grossWindow = ((ds * ds) / 4) * (thetaB / 2 - (1 - (2 * lc) / ds) * Math.sin(thetaB / 2));
  const book: BaffleAreas = {
    shellToBaffle: ((Math.PI * ds * baffles.shellClearance) / 2) * (1 - thetaB / (2 * Math.PI)),
    tubeToBaffle: (Math.PI * d * baffles.tubeClearance * nt * (1 - fw)) / 2,
    window: grossWindow - (Math.PI / 4) * d * d * fw * nt,
  };

  const rim = ds / 2 - baffles.shellClearance / 2;
  const keptArea = (rho: number) => Math.PI * rho * rho - segment(rho, chord);
  const hole = (Math.PI / 4) * ((d + baffles.tubeClearance) ** 2 - d * d);
  const perBaffle = baffles.baffles.map((b, k): BaffleLeakage => {
    const toward: Vec3 = [Math.cos(b.windowAzimuth * DEG), Math.sin(b.windowAzimuth * DEG), 0];
    // A tube whose centre is beyond the cut passes through the window; the rest through holes.
    const windowTubes = centres.filter((c) => c[0] * toward[0] + c[1] * toward[1] > chord).length;
    const holes = drawnCount - windowTubes;
    return {
      name: `baffle:${k + 1}`,
      offset: b.offset,
      windowAzimuth: b.windowAzimuth,
      book,
      drawn: {
        shellToBaffle: keptArea(ds / 2) - keptArea(rim),
        tubeToBaffle: holes * hole,
        window: segment(ds / 2, chord) - windowTubes * (Math.PI / 4) * d * d,
        holes,
        windowTubes,
      },
    };
  });

  // Pass lanes parallel to the crossflow open a bypass; the crossflow runs from window to window,
  // along the window's azimuth. A lane square to it is real but carries none of this stream.
  const flow = baffles.baffles[0]?.windowAzimuth ?? 0;
  let parallel = 0;
  let laneGap = 0;
  for (const azimuth of bundle.lanes?.azimuths ?? []) {
    const s = Math.abs(Math.sin((azimuth - flow) * DEG));
    if (s < 0.02) {
      parallel++;
      const r = azimuth * DEG;
      laneGap += 2 * (Math.min(...centres.map((c) => Math.abs(-c[0] * Math.sin(r) + c[1] * Math.cos(r)))) - d / 2);
    } else if (s < 0.98) {
      notes.push(`A pass lane at ${azimuth}° runs neither along nor across the crossflow at ${flow}°: not counted in N_p`);
    }
  }
  const across: Vec3 = [-Math.sin(flow * DEG), Math.cos(flow * DEG), 0];
  const drawnLimit = 2 * Math.max(...centres.map((c) => Math.abs(c[0] * across[0] + c[1] * across[1]))) + d;
  const width = bundle.lanes?.width ?? 0;
  const spaceOf = (name: string, length: number): SpaceBypass => ({
    name,
    length,
    book: length * (ds - dotl + 0.5 * parallel * width),
    drawn: length * (ds - drawnLimit + laneGap),
  });
  const offsets = baffles.baffles.map((b) => b.offset);
  const spaces: SpaceBypass[] = [];
  if (offsets.length > 0) {
    spaces.push(spaceOf('inlet', offsets[0]! - baffles.span[0]));
    for (let k = 1; k < offsets.length; k++) spaces.push(spaceOf(`central:${k}`, offsets[k]! - offsets[k - 1]!));
    spaces.push(spaceOf('outlet', baffles.span[1] - offsets[offsets.length - 1]!));
  }

  return {
    shellDiameter: ds,
    cutLength: lc,
    cutAngle: thetaB,
    windowFraction: fw,
    outerTubeLimit: { book: dotl, drawn: drawnLimit },
    parallelLanes: parallel,
    tubes: { drawn: drawnCount, stated, difference: stated === null ? null : (drawnCount - stated) / stated },
    baffles: perBaffle,
    spaces,
    notes,
  };
}
