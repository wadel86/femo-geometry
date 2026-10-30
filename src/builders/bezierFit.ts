// A curve the kernel has no primitive for, drawn as ONE Bézier fitted to it — one edge, one face
// once revolved — with the fit's own error measured rather than assumed.
//
// The offset of an ellipse is the case in point: it is not an ellipse, a formed head's outside is
// one, and a wall drawn as the ellipse of semi-axes a + t and h + t is not t thick. Fitting the
// exact offset leaves a deviation of a fraction of a micrometre and a single smooth surface,
// where the kernel's own offset of a solid takes seconds and leaves a stray face at the pole.
import type { Point2 } from '../kernel/GeometryKernel.ts';

/** A plane curve by its point and its derivative at a parameter. */
export interface PlaneCurve {
  point(u: number): Point2;
  derivative(u: number): Point2;
}

export interface BezierFit {
  /** Every control point, the two ends included. */
  readonly controls: readonly Point2[];
  /** Largest distance from the curve to the fit, over a dense sample, in the curve's units. */
  readonly error: number;
}

const add = (a: Point2, b: Point2): Point2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Point2, b: Point2): Point2 => [a[0] - b[0], a[1] - b[1]];
const scale = (a: Point2, k: number): Point2 => [a[0] * k, a[1] * k];
const dot = (a: Point2, b: Point2): number => a[0] * b[0] + a[1] * b[1];
const unit = (a: Point2): Point2 => scale(a, 1 / Math.hypot(a[0], a[1]));

function binomials(n: number): number[] {
  const row = [1];
  for (let k = 1; k <= n; k++) row.push((row[k - 1] * (n - k + 1)) / k);
  return row;
}

function bernstein(n: number, s: number, choose: readonly number[]): number[] {
  return choose.map((c, j) => c * s ** j * (1 - s) ** (n - j));
}

/** The point and first two derivatives of a Bézier at `s`, by de Casteljau's hodographs. */
function evaluate(controls: readonly Point2[], s: number): [Point2, Point2, Point2] {
  const at = (points: readonly Point2[]): Point2 => {
    let level = points.slice();
    while (level.length > 1) {
      level = level.slice(1).map((p, i) => add(scale(level[i], 1 - s), scale(p, s)));
    }
    return level[0] ?? [0, 0];
  };
  const n = controls.length - 1;
  const first = controls.slice(1).map((p, i) => scale(sub(p, controls[i]), n));
  const second = first.slice(1).map((p, i) => scale(sub(p, first[i]), n - 1));
  return [at(controls), at(first), second.length > 0 ? at(second) : [0, 0]];
}

/** The parameter of the point of the Bézier nearest `target`, by Newton from `s`. */
function project(controls: readonly Point2[], target: Point2, s: number): number {
  for (let i = 0; i < 12; i++) {
    const [p, d1, d2] = evaluate(controls, s);
    const gap = sub(p, target);
    const slope = dot(d1, d1) + dot(gap, d2);
    if (Math.abs(slope) < 1e-300) break;
    const next = Math.min(1, Math.max(0, s - dot(gap, d1) / slope));
    if (Math.abs(next - s) < 1e-15) return next;
    s = next;
  }
  return s;
}

/** Solves a small dense system by Gaussian elimination with partial pivoting. */
function solve(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = col + 1; r < n; r++) {
      const factor = a[r][col] / a[col][col];
      for (let c = col; c <= n; c++) a[r][c] -= factor * a[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = a[r][n];
    for (let c = r + 1; c < n; c++) sum -= a[r][c] * x[c];
    x[r] = sum / a[r][r];
  }
  return x;
}

/**
 * Fits one Bézier of degree `degree` to a curve between two parameters, through its two ends
 * and tangent to it there — so a surface revolved from it meets its neighbours smoothly — by
 * least squares with parameter correction.
 */
export function fitBezier(curve: PlaneCurve, u0: number, u1: number, degree: number): BezierFit {
  const n = degree;
  const choose = binomials(n);
  const start = curve.point(u0);
  const end = curve.point(u1);
  const startTangent = unit(curve.derivative(u0));
  const endTangent = unit(curve.derivative(u1));

  const samples = Array.from({ length: 4 * n + 8 }, (_, i) => {
    const u = u0 + ((u1 - u0) * (i + 0.5)) / (4 * n + 8);
    return { target: curve.point(u), s: (u - u0) / (u1 - u0) };
  });

  // Unknowns: α and β along the end tangents (P1 = P0 + α·T0, P_{n−1} = Pn − β·T1), then the
  // interior control points P2 … P_{n−2}, x and y each.
  const interior = n - 3;
  const size = 2 + 2 * interior;
  let controls: Point2[] = [];
  for (let pass = 0; pass < 6; pass++) {
    const normal = Array.from({ length: size }, () => new Array<number>(size).fill(0));
    const rhs = new Array<number>(size).fill(0);
    for (const sample of samples) {
      const b = bernstein(n, sample.s, choose);
      // The fixed part: P0 and Pn, and the ends of P1 and P_{n−1}.
      const fixed = add(scale(start, b[0] + b[1]), scale(end, b[n] + b[n - 1]));
      const residual = sub(sample.target, fixed);
      for (const axis of [0, 1] as const) {
        const row = new Array<number>(size).fill(0);
        row[0] = b[1] * startTangent[axis];
        row[1] = -b[n - 1] * endTangent[axis];
        for (let k = 0; k < interior; k++) row[2 + 2 * k + axis] = b[2 + k];
        for (let i = 0; i < size; i++) {
          if (row[i] === 0) continue;
          rhs[i] += row[i] * residual[axis];
          for (let j = 0; j < size; j++) normal[i][j] += row[i] * row[j];
        }
      }
    }
    const x = solve(normal, rhs);
    controls = [
      start,
      add(start, scale(startTangent, x[0])),
      ...Array.from({ length: interior }, (_, k): Point2 => [x[2 + 2 * k], x[3 + 2 * k]]),
      sub(end, scale(endTangent, x[1])),
      end,
    ];
    for (const sample of samples) sample.s = project(controls, sample.target, sample.s);
  }

  let error = 0;
  for (let i = 0; i <= 200; i++) {
    const u = u0 + ((u1 - u0) * i) / 200;
    const target = curve.point(u);
    const s = project(controls, target, (u - u0) / (u1 - u0));
    const [p] = evaluate(controls, s);
    error = Math.max(error, Math.hypot(p[0] - target[0], p[1] - target[1]));
  }
  return { controls, error };
}

/**
 * The outside of a wall whose inside is the quarter ellipse x = a·cos u, z = h·sin u, offset by
 * `t` along the outward normal: the exact curve, and its parameter at a radius.
 */
export function ellipseOffset(a: number, h: number, t: number) {
  const width = (u: number) => Math.hypot(h * Math.cos(u), a * Math.sin(u));
  const curve: PlaneCurve = {
    point(u) {
      const w = width(u);
      return [a * Math.cos(u) + (t * h * Math.cos(u)) / w, h * Math.sin(u) + (t * a * Math.sin(u)) / w];
    },
    derivative(u) {
      const w = width(u);
      const dw = (Math.sin(u) * Math.cos(u) * (a * a - h * h)) / w;
      const nx = (h * Math.cos(u)) / w;
      const nz = (a * Math.sin(u)) / w;
      return [
        -a * Math.sin(u) + t * ((-h * Math.sin(u)) / w - (nx * dw) / w),
        h * Math.cos(u) + t * ((a * Math.cos(u)) / w - (nz * dw) / w),
      ];
    },
  };
  /** The parameter at which the offset curve stands `rho` from the axis; it falls monotonically. */
  const parameterAt = (rho: number): number => {
    let low = 0;
    let high = Math.PI / 2;
    for (let i = 0; i < 80; i++) {
      const middle = (low + high) / 2;
      if (curve.point(middle)[0] > rho) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  };
  return { curve, parameterAt };
}
