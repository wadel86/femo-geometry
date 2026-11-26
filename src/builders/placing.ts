// What every mounted builder checks before it draws: that its anchor is on the surface its host
// offers, and that the part fits there.
import { AnchorError, scope, type ComponentDefinition } from '../definition.ts';
import type { GeometryKernel, Profile, Solid } from '../kernel/GeometryKernel.ts';
import type { MountedContext } from './types.ts';

export const mm = (value: number): string => `${Number(value.toPrecision(5))} mm`;

/**
 * A plate standing in a plane that holds the vessel axis — a rib, a gusset: its outline in the
 * meridian half-plane (r, z), `thickness` across, turned to `azimuth`. No extrusion reaches that
 * plane, so the outline is revolved and cut to a slab, as a lifting lug along the axis is: its
 * edges at a constant r land exactly on the cylinder they are welded to, and its flat faces are
 * off flat by at most thickness²/(8·r).
 */
export function radialPlate(
  kernel: GeometryKernel,
  outline: Profile,
  reach: number,
  zRange: readonly [number, number],
  thickness: number,
  azimuth: number
): Solid {
  const slab = kernel.extrude(
    {
      start: [0, -thickness / 2],
      steps: [
        { kind: 'line', to: [reach + 1, -thickness / 2] },
        { kind: 'line', to: [reach + 1, thickness / 2] },
        { kind: 'line', to: [0, thickness / 2] },
      ],
    },
    Math.min(...zRange) - 1,
    Math.max(...zRange) + 1
  );
  return kernel.rotateZ(kernel.intersect(kernel.revolve(outline), slab), azimuth);
}

/**
 * How far an opening's edge must stay from its host's own boundary — a course's end, where the
 * next part's face begins, or a head's rim. An edge ON the boundary, or nearer than this, leaves
 * the hole's outline touching the face's outer one at a point: a valid solid to the kernel that
 * built it, but STEP carries no per-edge tolerance and a strict checker downstream reads two
 * wires that intersect (FreeCAD 1.1.4 on E-101's shell, 2026-11-26). Refused rather than nudged
 * (the user, 2026-11-26): a silent move is a design change nobody made. 0.1 mm is ten times the
 * largest tolerance that FreeCAD's checker needed to clear any boolean edge of the same exports.
 */
export const OPENING_CLEARANCE = 0.1;

/**
 * Refuses an opening whose edge lies on, or within {@link OPENING_CLEARANCE} of, its host's
 * boundary at `edge`, `limit` being the boundary; `toward` says which way it clears.
 */
export function requireClearOfBoundary(
  component: ComponentDefinition,
  host: string,
  edge: number,
  limit: number,
  boundary: string,
  toward: string
): void {
  const gap = Math.abs(limit - edge);
  // At the clearance itself is clear: 100 + 0.1 − 100 is a hair short of 0.1 in a double.
  if (gap >= OPENING_CLEARANCE - 1e-9) return;
  throw new AnchorError(
    component,
    `its opening's edge is ${gap < 1e-6 ? 'exactly on' : `${mm(gap)} from`} ${boundary} of ${host}: tangent, which leaves the hole's outline touching the face's — move it at least ${mm(OPENING_CLEARANCE - gap)} ${toward}`,
    scope('out_of_scope', `opening edge to ${boundary} of ${host}`, `≥ ${mm(OPENING_CLEARANCE)}, clear of it`, mm(gap))
  );
}

/**
 * Refuses an anchor whose part would not fit on the host where it is placed — and, for a part
 * that cuts an `opening` into its host, one whose edge is tangent to the host's boundary.
 *
 * @param halfExtent half the part's extent along the offset — the radius of an opening, half a
 *     ring's thickness
 */
export function requireWithinHost(
  component: ComponentDefinition,
  context: MountedContext,
  halfExtent: number,
  opening = false
): void {
  const { placement, hostSurface, host } = context;
  if (placement.anchor !== hostSurface.anchor) {
    throw new AnchorError(
      component,
      `anchored on ${placement.anchor.replace('_', ' ')}, but ${host.name} offers ${hostSurface.anchor.replace('_', ' ')}`,
      scope('mismatch', 'anchor', `${hostSurface.anchor}, what ${host.name} offers`, placement.anchor)
    );
  }

  const [low, high] = hostSurface.offsetRange;
  const offset = placement.axialOffset;
  // A part that cuts nothing may sit flush with its host's end — a ring at a course's end — and
  // the sum of its stated dimensions reaches it give or take the last bit of a double: a micron
  // is noise, never a design. An opening may not: see OPENING_CLEARANCE.
  const noise = 1e-6;
  if (hostSurface.anchor === 'head_crown') {
    if (offset < -noise || offset + halfExtent > high + noise) {
      // A head carries a part parallel to the vessel axis, inside its own inside radius: an
      // opening reaching the knuckle's outer edge or beyond is outside that scope.
      throw new AnchorError(
        component,
        `an opening of ${mm(2 * halfExtent)} at ${mm(offset)} from the axis does not fit on ${host.name}, whose inside radius is ${mm(high)}`,
        scope(
          'out_of_scope',
          'distance from the axis to the far edge of the part',
          `≤ ${mm(high)}, the inside radius of ${host.name}`,
          mm(offset + halfExtent)
        )
      );
    }
    if (opening) requireClearOfBoundary(component, host.name, offset + halfExtent, high, 'the rim', 'towards the axis');
    return;
  }
  if (offset - halfExtent < low - noise || offset + halfExtent > high + noise) {
    // A part has one host: it cannot run past the end of its course onto the next part.
    const [edge, limit] = offset - halfExtent < low - noise ? [offset - halfExtent, `≥ ${mm(low)}`] : [offset + halfExtent, `≤ ${mm(high)}`];
    throw new AnchorError(
      component,
      `${mm(2 * halfExtent)} wide at ${mm(offset)} runs past ${host.name}, which is ${mm(high - low)} long`,
      scope('out_of_scope', `edge of the part along ${host.name}`, `${limit}, within its one host`, mm(edge))
    );
  }
  if (opening) {
    requireClearOfBoundary(component, host.name, offset - halfExtent, low, 'the lower end', 'up the course');
    requireClearOfBoundary(component, host.name, offset + halfExtent, high, 'the upper end', 'down the course');
  }
}
