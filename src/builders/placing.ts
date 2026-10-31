// What every mounted builder checks before it draws: that its anchor is on the surface its host
// offers, and that the part fits there.
import { AnchorError, scope, type ComponentDefinition } from '../definition.ts';
import type { MountedContext } from './types.ts';

export const mm = (value: number): string => `${Number(value.toPrecision(5))} mm`;

/**
 * Refuses an anchor whose part would not fit on the host where it is placed.
 *
 * @param halfExtent half the part's extent along the offset — the radius of an opening, half a
 *     ring's thickness
 */
export function requireWithinHost(
  component: ComponentDefinition,
  context: MountedContext,
  halfExtent: number
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
  if (hostSurface.anchor === 'head_crown') {
    if (offset < 0 || offset + halfExtent > high) {
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
    return;
  }
  if (offset - halfExtent < low || offset + halfExtent > high) {
    // A part has one host: it cannot run past the end of its course onto the next part.
    const [edge, limit] = offset - halfExtent < low ? [offset - halfExtent, `≥ ${mm(low)}`] : [offset + halfExtent, `≤ ${mm(high)}`];
    throw new AnchorError(
      component,
      `${mm(2 * halfExtent)} wide at ${mm(offset)} runs past ${host.name}, which is ${mm(high - low)} long`,
      scope('out_of_scope', `edge of the part along ${host.name}`, `${limit}, within its one host`, mm(edge))
    );
  }
}
