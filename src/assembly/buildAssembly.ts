// Builds an assembly from its definition: stacks the axial run, places the mounted parts on
// their hosts through their semantic anchors, and cuts the openings.
//
// Rebuilds are incremental. Every part is built in its own frame and cached under a key made of
// exactly what it depends on, then put in place by a transform that costs nothing to change. So
// lengthening the bottom course moves everything above it without a single boolean, and moving
// one nozzle re-cuts its host and rebuilds that nozzle only.
import {
  ANALYSIS_KINDS,
  AnchorError,
  BuildError,
  Kind,
  NotDrawnError,
  RUN_KINDS_THAT_CLOSE,
  Sym,
  note,
  type AssemblyDefinition,
  type ComponentDefinition,
  type Note,
  type Placement,
  type PlacementAnchor,
} from '../definition.ts';
import { MOUNTED_BUILDERS } from '../builders/mounted.ts';
import { RUN_BUILDERS } from '../builders/runParts.ts';
import type {
  Attachment,
  Copies,
  HostFrame,
  HostSurface,
  Idealisation,
  Junction,
  Landmark,
  MountedPart,
  Neck,
  RunPart,
} from '../builders/types.ts';
import type { Bounds, GeometryKernel, Point2, Solid, Vec3 } from '../kernel/GeometryKernel.ts';
import { stableStringify } from '../hash.ts';

/**
 * Where a part's own frame sits in the assembly: optionally turned over (a half turn about X,
 * so z → −z and y → −y), then raised by `dz` along the axis.
 */
export interface PartTransform {
  readonly flipped: boolean;
  readonly dz: number;
}

/** `analysis` is a component that is an analysis rather than a part: nothing to draw, nothing missing. */
export type PartStatus = 'drawn' | 'not_drawn' | 'failed' | 'analysis';

/** An opening cut into a host, described in the host's frame for naming its edges. */
export interface Opening {
  readonly componentId: string;
  readonly name: string;
  readonly frame: HostFrame;
  readonly radius: number;
  /** Which surface of the host a point of the opening lies on. */
  readonly sideOf: (point: Vec3) => 'inside' | 'outside';
}

export interface BuiltPart {
  readonly componentId: string;
  readonly name: string;
  readonly kind: string;
  readonly hostId: string | null;
  readonly status: PartStatus;
  /** Why the part is not drawn, or failed — naming the anchor when that is what failed. */
  readonly message?: string;
  /** Mounted parts share their host's transform: they are built in its frame. */
  readonly transform: PartTransform;
  /** In the part's frame (the host's, for a mounted part). */
  readonly solids: readonly Solid[];
  /** Repeats of the solids, parallel to them. */
  readonly copies?: Copies;
  readonly landmarks: readonly Landmark[];
  /** The openings cut into this part. */
  readonly openings: readonly Opening[];
  /** For a mounted part: where it stands on its host, in the host's frame. */
  readonly mount?: HostFrame;
  /** For a mounted part: the placement used, stated or defaulted. */
  readonly placement?: Placement;
  /** For a mounted part: half its extent along the host's offset. */
  readonly footprint?: number;
  /** For a part that can carry mounted ones: the range their offset may take. */
  readonly hostOffsetRange?: readonly [number, number];
  /** For a part that can carry mounted ones: the surface it offers them. */
  readonly hostAnchor?: PlacementAnchor;
  /** For a part that can carry mounted ones: the surface itself, in the part's frame. */
  readonly hostSurface?: HostSurface;
  /** For a part of the run: where it meets its neighbours, in its own frame. */
  readonly junctions?: { readonly lower: Junction | null; readonly upper: Junction | null };
  /** For a part of the run: its mid-surface meridian, in its own frame. */
  readonly meridian?: readonly Point2[];
  /** For a formed head: the height of its tangent line above its lower junction. */
  readonly tangentLine?: number;
  /** Where the part is drawn as an idealisation of itself, and what that left out. */
  readonly idealisations?: readonly Idealisation[];
  /** For a mounted part: its placement in its host's frame, mirrored when the host is turned over. */
  readonly localPlacement?: Placement;
  readonly neck?: Neck;
  readonly attachment?: Attachment;
  readonly notes: readonly Note[];
}

export interface AssemblyModel {
  readonly parts: readonly BuiltPart[];
}

const CLOSURE_OR_FLAT: ReadonlySet<string> = RUN_KINDS_THAT_CLOSE;
const COURSES: ReadonlySet<string> = new Set([Kind.CYLINDRICAL_SHELL, Kind.CONICAL_SHELL]);

const IDENTITY: PartTransform = { flipped: false, dz: 0 };

/** Parts whose kind has a builder, and a sensible default place on each kind of host. */
export class AssemblyBuilder {
  private readonly kernel: GeometryKernel;
  private readonly cacheLimit: number;
  private readonly runCache = new Map<string, RunPart>();
  private readonly mountedCache = new Map<string, MountedPart>();
  private readonly piercedCache = new Map<string, Solid>();

  constructor(kernel: GeometryKernel, cacheLimit = 256) {
    this.kernel = kernel;
    this.cacheLimit = cacheLimit;
  }

  build(definition: AssemblyDefinition): AssemblyModel {
    const byId = new Map(definition.components.map((c) => [c.id, c]));
    const reversed = new Set(definition.reversed);
    const results = new Map<string, BuiltPart>();
    for (const component of definition.components) {
      if (ANALYSIS_KINDS.has(component.kind)) results.set(component.id, analysis(component));
    }
    const run = runOrder(definition.components);

    // ---------------------------------------------------------------- the axial run
    const runParts = new Map<string, { part: RunPart; key: string; transform: PartTransform }>();
    let cursor = 0;

    run.forEach((component, index) => {
      const below = run[index - 1];
      const above = run[index + 1];
      const closesBottom = CLOSURE_OR_FLAT.has(component.kind) && index === 0 && run.length > 1;

      const builder = RUN_BUILDERS[component.kind];
      if (!builder) {
        results.set(component.id, notDrawn(component));
        return;
      }

      const neighbour = closesBottom ? above : below;
      const sphere = component.kind === Kind.SPHERICAL_SHELL;
      const context = {
        neighbourOutsideRadius: outsideRadiusOf(neighbour),
        neighbourInsideDiameter: insideDiameterOf(neighbour),
        hubDown:
          component.kind === Kind.INTEGRAL_FLANGE || component.kind === Kind.LOOSE_FLANGE
            ? below !== undefined && COURSES.has(below.kind)
            : undefined,
        // Only a sphere is cut to its neighbours; nothing else's cache key carries them.
        belowInsideDiameter: sphere ? insideDiameterOf(below) : undefined,
        aboveInsideDiameter: sphere ? insideDiameterOf(above) : undefined,
      };
      const key = stableStringify({ kind: component.kind, dimensions: component.dimensions, context });

      let part: RunPart;
      try {
        part = this.remember(this.runCache, key, () => builder(component, { kernel: this.kernel, ...context }));
      } catch (error) {
        results.set(component.id, failed(component, error));
        return;
      }

      let transform: PartTransform;
      if (closesBottom) {
        transform = { flipped: true, dz: cursor };
      } else if (reversed.has(component.id) && !CLOSURE_OR_FLAT.has(component.kind)) {
        transform = { flipped: true, dz: cursor + part.height };
        cursor += part.height;
      } else {
        transform = { flipped: false, dz: cursor };
        cursor += part.height;
      }

      runParts.set(component.id, { part, key, transform });
    });

    // ---------------------------------------------------------------- mounted parts
    const openingsByHost = new Map<string, { opening: Opening; tool: Solid; key: string }[]>();
    const unplacedOnHost = new Map<string, number>();

    for (const component of definition.components) {
      if (component.hostId === null || ANALYSIS_KINDS.has(component.kind)) continue;

      const hostComponent = byId.get(component.hostId);
      const host = runParts.get(component.hostId);
      if (!hostComponent) {
        results.set(component.id, failed(component, new AnchorError(component, 'its host is not in the assembly')));
        continue;
      }
      if (!host) {
        results.set(component.id, {
          ...notDrawn(component),
          message: `${component.name}: ${hostComponent.name} is not drawn, so nothing is drawn on it`,
        });
        continue;
      }
      if (!host.part.host) {
        results.set(component.id, {
          ...notDrawn(component),
          transform: host.transform,
          message: `${component.name}: nothing is drawn on a ${hostComponent.kind.replace(/_/g, ' ')} yet`,
        });
        continue;
      }

      const builder = MOUNTED_BUILDERS[component.kind];
      if (!builder) {
        results.set(component.id, { ...notDrawn(component), transform: host.transform });
        continue;
      }

      const tangentLines = tangentLinesOf(component.hostId, host.part, host.transform, run, runParts);
      const stated = definition.placements[component.id];
      let placement = stated ?? this.defaultPlacement(host.part.host, unplacedOnHost, component, tangentLines);
      const hostSurface = host.part.host;
      // A host turned over mirrors y, so the azimuth is mirrored on the way in.
      const localOf = (p: Placement): Placement => (host.transform.flipped ? { ...p, azimuth: -p.azimuth } : p);
      const buildAt = (p: Placement) => {
        const at = localOf(p);
        const key = stableStringify({
          kind: component.kind,
          dimensions: component.dimensions,
          placement: at,
          host: host.key,
          tangentLines,
        });
        const part = this.remember(this.mountedCache, key, () =>
          builder(component, {
            kernel: this.kernel,
            host: hostComponent,
            hostSurface,
            placement: at,
            tangentLines,
            hostSolid: host.part.solid,
          })
        );
        return { part, key, local: at };
      };

      let built: ReturnType<typeof buildAt>;
      try {
        try {
          built = buildAt(placement);
        } catch (error) {
          // A default position is a guess: one the part does not fit at is retried in the
          // middle of the host. A stated one that does not fit is the user's to hear about.
          if (stated || !(error instanceof AnchorError)) throw error;
          placement = { ...placement, axialOffset: hostSurface.defaultOffset };
          built = buildAt(placement);
        }
      } catch (error) {
        results.set(
          component.id,
          error instanceof NotDrawnError
            ? { ...notDrawn(component), message: error.message, transform: host.transform, placement }
            : { ...failed(component, error), transform: host.transform, placement }
        );
        continue;
      }
      const { part: mounted, key } = built;
      // A part whose own dimensions decide where it stands reports that, not its placement.
      const local = mounted.anchorOffset === undefined ? built.local : { ...built.local, axialOffset: mounted.anchorOffset };
      if (mounted.anchorOffset !== undefined) placement = { ...placement, axialOffset: mounted.anchorOffset };

      if (mounted.opening) {
        const list = openingsByHost.get(component.hostId) ?? [];
        list.push({
          opening: {
            componentId: component.id,
            name: component.name,
            frame: mounted.opening.frame,
            radius: mounted.opening.radius,
            sideOf: host.part.host.sideOf,
          },
          tool: mounted.opening.tool,
          key,
        });
        openingsByHost.set(component.hostId, list);
      }

      results.set(component.id, {
        componentId: component.id,
        name: component.name,
        kind: component.kind,
        hostId: component.hostId,
        status: 'drawn',
        transform: host.transform,
        solids: mounted.solids,
        copies: mounted.copies,
        landmarks: [],
        openings: [],
        mount: mounted.opening?.frame ?? host.part.host.frameAt(local.axialOffset, local.azimuth),
        placement,
        localPlacement: local,
        footprint: mounted.footprint,
        neck: mounted.neck,
        attachment: mounted.attachment,
        notes: stated
          ? mounted.notes
          : [...mounted.notes, note('Not placed yet — drawn at a default position')],
      });
    }

    // ---------------------------------------------------------------- hosts, pierced
    run.forEach((component, index) => {
      const entry = runParts.get(component.id);
      if (!entry) return;

      const openings = (openingsByHost.get(component.id) ?? []).sort((a, b) => (a.key < b.key ? -1 : 1));
      const notes = [...entry.part.notes];
      let solid = entry.part.solid;
      let status: PartStatus = 'drawn';
      let message: string | undefined;

      if (openings.length > 0) {
        const key = stableStringify({ host: entry.key, openings: openings.map((o) => o.key) });
        try {
          solid = this.remember(this.piercedCache, key, () =>
            this.kernel.cut(entry.part.solid, openings.map((o) => o.tool))
          );
        } catch (error) {
          status = 'failed';
          message = `The openings could not be cut: ${errorMessage(error)}`;
        }
      }

      results.set(component.id, {
        componentId: component.id,
        name: component.name,
        kind: component.kind,
        hostId: null,
        status,
        message,
        transform: entry.transform,
        solids: [solid, ...(entry.part.extraSolids ?? [])],
        copies: entry.part.copies,
        landmarks: nameJunctions(component, entry.part.landmarks, entry.transform, run[index - 1], run[index + 1]),
        openings: openings.map((o) => o.opening),
        hostOffsetRange: entry.part.host?.offsetRange,
        hostAnchor: entry.part.host?.anchor,
        hostSurface: entry.part.host,
        junctions: { lower: entry.part.lower, upper: entry.part.upper },
        meridian: entry.part.meridian,
        tangentLine: entry.part.tangentLine,
        idealisations: entry.part.idealisations,
        notes,
      });
    });

    return {
      parts: definition.components.map(
        (component) => results.get(component.id) ?? failed(component, new Error('was not built'))
      ),
    };
  }

  /**
   * Where an unplaced part is drawn until someone places it.
   *
   * Supports go where they belong: a skirt from the course's lower end, saddles `a` from
   * either end in turn, at the bottom of a horizontal vessel. Everything else is spread over
   * the host on a golden-angle sequence, so that parts nobody has placed yet do not land on
   * top of each other.
   */
  private defaultPlacement(
    host: HostSurface,
    counter: Map<string, number>,
    component: ComponentDefinition,
    tangentLines: readonly [number, number] | undefined
  ): Placement {
    const [low, high] = host.offsetRange;
    const hostId = component.hostId as string;

    if (component.kind === Kind.SKIRT_SUPPORT) {
      // On a head the skirt's own diameter says where it meets the knuckle; the offset is unused.
      return { anchor: host.anchor, axialOffset: host.anchor === 'head_crown' ? 0 : low, azimuth: 0 };
    }
    if (component.kind === Kind.HALF_PIPE_JACKET) {
      return { anchor: 'shell_side', axialOffset: host.defaultOffset, azimuth: 0 };
    }
    if (component.kind === Kind.SADDLE_SUPPORT) {
      const key = `${hostId}/saddles`;
      const index = counter.get(key) ?? 0;
      counter.set(key, index + 1);
      // §4.15.3's a runs from the head's tangent line, past its straight flange.
      const [first, last] = tangentLines ?? [low, high];
      const distance = component.dimensions[Sym.SADDLE_DISTANCE] ?? 0.2 * (high - low);
      return {
        anchor: 'shell_side',
        axialOffset: Math.min(high, Math.max(low, index % 2 === 0 ? first + distance : last - distance)),
        azimuth: 0,
      };
    }

    const index = counter.get(hostId) ?? 0;
    counter.set(hostId, index + 1);
    const spread = (0.5 + index * 0.618034) % 1;
    const azimuth = (index * 137.5) % 360;
    if (host.anchor === 'head_crown') {
      return { anchor: 'head_crown', axialOffset: index === 0 ? 0 : spread * 0.6 * high, azimuth };
    }
    return { anchor: 'shell_side', axialOffset: low + (0.2 + 0.6 * spread) * (high - low), azimuth };
  }

  private remember<T>(cache: Map<string, T>, key: string, make: () => T): T {
    const hit = cache.get(key);
    if (hit !== undefined) {
      // Re-insert so the map's order stays least-recently-used first.
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const made = make();
    cache.set(key, made);
    while (cache.size > this.cacheLimit) {
      cache.delete(cache.keys().next().value as string);
    }
    return made;
  }
}

/**
 * Names the circles where two parts meet after the neighbour: "Tangent line, head-to-shell
 * junction with Top head (inside)".
 */
function nameJunctions(
  component: ComponentDefinition,
  landmarks: readonly Landmark[],
  transform: PartTransform,
  below: ComponentDefinition | undefined,
  above: ComponentDefinition | undefined
): Landmark[] {
  return landmarks.map((landmark) => {
    if (!landmark.junction) return landmark;
    const facesDown = transform.flipped ? landmark.junction === 'upper' : landmark.junction === 'lower';
    const neighbour = facesDown ? below : above;
    if (!neighbour) return landmark;

    const side = landmark.key.endsWith('outside') ? ' (outside)' : landmark.key.endsWith('inside') ? ' (inside)' : '';
    const headInvolved = CLOSURE_OR_FLAT.has(component.kind) || CLOSURE_OR_FLAT.has(neighbour.kind);
    const onFlange = landmark.role.startsWith('Straight flange');
    const role = headInvolved
      ? `${onFlange ? 'Straight flange end' : 'Tangent line'}, head-to-shell junction with ${neighbour.name}`
      : component.kind.endsWith('_flange') || neighbour.kind.endsWith('_flange')
        ? `Flange joint with ${neighbour.name}`
        : `Circumferential seam with ${neighbour.name}`;
    return { ...landmark, role: `${role}${side}` };
  });
}

/**
 * Where the head tangent lines nearest a course stand, in its own offset: past each end by the
 * straight flange of a formed head there, at the end itself otherwise. Undefined for a host that
 * is not a course.
 */
function tangentLinesOf(
  hostId: string,
  host: RunPart,
  transform: PartTransform,
  run: readonly ComponentDefinition[],
  runParts: ReadonlyMap<string, { part: RunPart }>
): readonly [number, number] | undefined {
  if (host.host?.anchor !== 'shell_side') return undefined;
  const [low, high] = host.host.offsetRange;
  const index = run.findIndex((c) => c.id === hostId);
  // A course turned over meets the part above it at its own low end.
  const atLow = transform.flipped ? run[index + 1] : run[index - 1];
  const atHigh = transform.flipped ? run[index - 1] : run[index + 1];
  const flange = (c: ComponentDefinition | undefined) => (c ? runParts.get(c.id)?.part.tangentLine ?? 0 : 0);
  return [low - flange(atLow), high + flange(atHigh)];
}

/** The opening a part presents: its inside diameter, or a flange's bore. */
function insideDiameterOf(component: ComponentDefinition | undefined): number | undefined {
  if (!component) return undefined;
  return component.dimensions[Sym.INSIDE_DIAMETER] ?? component.dimensions[Sym.FLANGE_BORE];
}

function outsideRadiusOf(component: ComponentDefinition | undefined): number | undefined {
  if (!component) return undefined;
  const diameter = component.dimensions[Sym.INSIDE_DIAMETER];
  const thickness = component.dimensions[Sym.THICKNESS];
  return diameter !== undefined && thickness !== undefined ? diameter / 2 + thickness : undefined;
}

/** The parts of the axial run, bottom up: what stacks, analyses left out. */
export function runOrder(components: readonly ComponentDefinition[]): ComponentDefinition[] {
  return components
    .filter((c) => c.hostId === null && !ANALYSIS_KINDS.has(c.kind))
    .slice()
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

function analysis(component: ComponentDefinition): BuiltPart {
  return {
    ...notDrawn(component),
    status: 'analysis',
    message: `${component.name} is an analysis, not a part: there is nothing to draw`,
  };
}

function notDrawn(component: ComponentDefinition): BuiltPart {
  return {
    componentId: component.id,
    name: component.name,
    kind: component.kind,
    hostId: component.hostId,
    status: 'not_drawn',
    message: `A ${component.kind.replace(/_/g, ' ')} is not drawn by the modeller yet`,
    transform: IDENTITY,
    solids: [],
    landmarks: [],
    openings: [],
    notes: [],
  };
}

function failed(component: ComponentDefinition, error: unknown): BuiltPart {
  return {
    ...notDrawn(component),
    status: 'failed',
    message:
      error instanceof BuildError || error instanceof AnchorError
        ? error.message
        : `${component.name} could not be built: ${errorMessage(error)}`,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A point of a part's frame, in the assembly's. */
export function toAssembly(point: Vec3, transform: PartTransform): Vec3 {
  return transform.flipped
    ? [point[0], -point[1], transform.dz - point[2]]
    : [point[0], point[1], transform.dz + point[2]];
}

/** A direction of a part's frame, in the assembly's. */
export function toAssemblyVector(vector: Vec3, transform: PartTransform): Vec3 {
  return transform.flipped ? [vector[0], -vector[1], -vector[2]] : [vector[0], vector[1], vector[2]];
}

/** A solid of a part's frame, moved into the assembly's. */
export function solidToAssembly(kernel: GeometryKernel, solid: Solid, transform: PartTransform): Solid {
  const turned = transform.flipped ? kernel.flip(solid) : solid;
  return transform.dz === 0 ? turned : kernel.translate(turned, [0, 0, transform.dz]);
}

/** The box around every drawn solid, in the assembly's frame. */
export function assemblyBounds(model: AssemblyModel, kernel: GeometryKernel): Bounds | null {
  let min: [number, number, number] = [Infinity, Infinity, Infinity];
  let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const part of model.parts) {
    part.solids.forEach((solid, index) => {
      const local = kernel.bounds(solid);
      const offsets: readonly Vec3[] = [[0, 0, 0], ...(part.copies?.[index] ?? [])];
      for (const offset of offsets) {
        for (const corner of [local.min, local.max]) {
          const moved: Vec3 = [corner[0] + offset[0], corner[1] + offset[1], corner[2] + offset[2]];
          const p = toAssembly(moved, part.transform);
          min = [Math.min(min[0], p[0]), Math.min(min[1], p[1]), Math.min(min[2], p[2])];
          max = [Math.max(max[0], p[0]), Math.max(max[1], p[1]), Math.max(max[2], p[2])];
        }
      }
    });
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

/**
 * Chordal tolerance of the tessellation, relative to the size of the model: a value tuned for a
 * 32 mm part facets a 5 m shell, and one tuned for the shell drowns the part in triangles.
 */
export function tessellationTolerance(bounds: Bounds | null, refinement = 1): number {
  if (!bounds) return 1;
  const diagonal = Math.hypot(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2]
  );
  return Math.max(0.01, (diagonal * 2e-4) / refinement);
}
