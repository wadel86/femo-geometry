// Builders for the parts mounted on a host: stiffening rings here, nozzles and supports in their
// own files, and the registry of all of them.
//
// They work in the host's frame, from the host's own description of its surface, so a mounted
// part follows its host through every rebuild: the anchor is (offset, azimuth) on a named
// surface, never a face of the previous solid.
import { NotDrawnError, Sym, analysisNote, requireDimension } from '../definition.ts';
import {
  angledNozzle,
  axialNozzle,
  hillsideNozzle,
  perpendicularNozzle,
  radialNozzle,
} from './nozzles.ts';
import { jacketClosure, pressureReliefDevice } from './fittings.ts';
import { requireWithinHost } from './placing.ts';
import { halfPipeJacket, lugSupport, saddleSupport, skirtSupport } from './supports.ts';
import type { MountedBuilder } from './types.ts';

/**
 * A flat bar ring of height `h1` and thickness `t1` round the outside of a course. On a cone it
 * is drawn at the radius of its mid-plane; the web of a built-up section is not drawn yet.
 */
export const stiffeningRing: MountedBuilder = (component, context) => {
  const { kernel, hostSurface, placement, host } = context;
  const height = requireDimension(component, Sym.RING_HEIGHT);
  const thickness = requireDimension(component, Sym.RING_THICKNESS);
  if (!hostSurface.course) {
    throw new NotDrawnError(component, `a ring is drawn round a course, and ${host.name} is not one`);
  }
  requireWithinHost(component, context, thickness / 2);

  const z = placement.axialOffset;
  const radius = hostSurface.course.outsideRadiusAt(z);
  return {
    solids: [
      kernel.revolve({
        start: [radius, z - thickness / 2],
        steps: [
          { kind: 'line', to: [radius + height, z - thickness / 2] },
          { kind: 'line', to: [radius + height, z + thickness / 2] },
          { kind: 'line', to: [radius, z + thickness / 2] },
        ],
      }),
    ],
    footprint: thickness / 2,
    attachment: { axial: thickness, circumferentialDeg: 360, thickness },
    notes: [
      ...(hostSurface.course.halfApexAngle !== 0
        ? [analysisNote('On a cone it is drawn square to the axis at the radius of its mid-plane, its face not following the slope')]
        : []),
    ],
  };
};

/** The mounted builders, by `ComponentType` wire value. A kind absent here is not drawn yet. */
export const MOUNTED_BUILDERS: Readonly<Record<string, MountedBuilder>> = {
  radial_nozzle: radialNozzle,
  hillside_nozzle: hillsideNozzle,
  angled_nozzle: angledNozzle,
  perpendicular_nozzle: perpendicularNozzle,
  axial_nozzle: axialNozzle,
  stiffening_ring: stiffeningRing,
  large_stiffening_ring: stiffeningRing,
  saddle_support: saddleSupport,
  skirt_support: skirtSupport,
  lug_support: lugSupport,
  half_pipe_jacket: halfPipeJacket,
  jacket_closure: jacketClosure,
  pressure_relief_device: pressureReliefDevice,
};
