// Applies the construction details to a definition, before anything is built.
//
// The builders read dimensions and joint parameters; the details are resolved into exactly those,
// so a builder never learns which layer a value came from. Two details change the parts' own
// dimensions — the corroded model and a head's straight flange — and two reach the builders as
// joint parameters — the alignment datum with the taper, and a nozzle's corner radii. Everything
// applied is listed, with its source, so a reader can see what the model was built at and why.
//
// A definition that declares nothing comes back unchanged, joints and all: no assembly drawn
// before the details existed is drawn again.
import {
  Kind,
  Sym,
  note,
  scope,
  type AlignmentDatum,
  type AssemblyDefinition,
  type ComponentDefinition,
  type DetailValue,
  type JointParameters,
  type Note,
} from '../definition.ts';
import { runOrder, type AssemblyModel } from '../assembly/buildAssembly.ts';
import { Detail, resolveDetail, type DetailKey, type DetailSource, type ResolvedValue } from './constructionDetails.ts';

/** One detail as it was applied: where, at what value, from which layer, and what it did. */
export interface AppliedDetail {
  readonly key: DetailKey;
  /** `equipment`, a joint key, or a component id. */
  readonly at: string;
  readonly value: DetailValue | null;
  readonly source: DetailSource;
  /** What it changed, in words: "D 2133.6 → 2139.95 mm, t 23.825 → 20.65 mm". Absent when nothing. */
  readonly effect?: string;
}

export interface ResolvedDetails {
  /** The standards profile the layers name, when they name one. */
  readonly profile: string | null;
  readonly applied: readonly AppliedDetail[];
  /** Keyed on component id: what the drawing must say about the details, refusals included. */
  readonly notes: Readonly<Record<string, readonly Note[]>>;
}

const FORMED_HEADS: ReadonlySet<string> = new Set([Kind.HEMISPHERICAL_HEAD, Kind.TORISPHERICAL_HEAD, Kind.ELLIPSOIDAL_HEAD]);

const NOZZLES: ReadonlySet<string> = new Set([
  Kind.RADIAL_NOZZLE,
  Kind.HILLSIDE_NOZZLE,
  Kind.ANGLED_NOZZLE,
  Kind.PERPENDICULAR_NOZZLE,
  Kind.AXIAL_NOZZLE,
]);

/** Outside the pressure boundary, so nothing corrodes them that a pressure model reads. */
const NOT_WETTED: ReadonlySet<string> = new Set([
  Kind.SADDLE_SUPPORT,
  Kind.SKIRT_SUPPORT,
  Kind.LUG_SUPPORT,
  Kind.STIFFENING_RING,
  Kind.LARGE_STIFFENING_RING,
  Kind.HALF_PIPE_JACKET,
  Kind.PRESSURE_RELIEF_DEVICE,
  Kind.LEG_SUPPORT,
]);

const DEG = Math.PI / 180;
const mm = (value: number): string => `${Number(value.toPrecision(6))} mm`;

/** The details resolved into the definition the builders read, and what was applied. */
export function applyConstructionDetails(definition: AssemblyDefinition): {
  definition: AssemblyDefinition;
  details: ResolvedDetails;
} {
  const layers = definition.details;
  const applied: AppliedDetail[] = [];
  const notes = new Map<string, Note[]>();
  const say = (componentId: string, n: Note) => notes.set(componentId, [...(notes.get(componentId) ?? []), n]);
  const record = (key: DetailKey, at: string, resolved: ResolvedValue, effect?: string, componentIds: readonly string[] = []) => {
    applied.push({ key, at, value: resolved.value, source: resolved.source, ...(effect ? { effect } : {}) });
    if (resolved.rejected) {
      const r = resolved.rejected;
      for (const id of componentIds) {
        say(
          id,
          note(
            `${key.replace(/_/g, ' ')} ${String(r.value)} from the ${r.source} not used: ${r.why}`,
            undefined,
            scope('out_of_scope', key, r.why, String(r.value))
          )
        );
      }
    }
  };

  let components = definition.components.map((c) => ({ ...c, dimensions: { ...c.dimensions } }));
  const byId = () => new Map(components.map((c) => [c.id, c]));

  // ------------------------------------------------------------------ the corroded model
  const model = resolveDetail(layers, Detail.CORRODED_MODEL);
  record(Detail.CORRODED_MODEL, 'equipment', model, undefined, components.map((c) => c.id));
  if (model.value === 'corroded') {
    const allowance = resolveDetail(layers, Detail.CORROSION_ALLOWANCE);
    const surfaces = resolveDetail(layers, Detail.CORRODED_SURFACES);
    const headRule = resolveDetail(layers, Detail.CORRODED_HEAD_RULE);
    record(Detail.CORROSION_ALLOWANCE, 'equipment', allowance);
    record(Detail.CORRODED_SURFACES, 'equipment', surfaces);
    record(Detail.CORRODED_HEAD_RULE, 'equipment', headRule);
    if (typeof allowance.value !== 'number') {
      for (const c of components) {
        say(
          c.id,
          note(
            'The model is declared corroded and no corrosion allowance is declared',
            undefined,
            scope('assumed', Detail.CORROSION_ALLOWANCE, 'declared at a layer', 'not declared — drawn nominal')
          )
        );
      }
    } else {
      const ca = allowance.value;
      const inside = surfaces.value === 'outside' ? 0 : ca;
      const outside = surfaces.value === 'inside' ? 0 : ca;
      components = components.map((c) => {
        const result = corrode(c, inside, outside, headRule.value === 'uniform_offset' ? 'uniform_offset' : 'true_shape');
        if (result.effect) applied.push({ key: Detail.CORRODED_MODEL, at: c.id, value: 'corroded', source: model.source, effect: result.effect });
        for (const n of result.notes) say(c.id, n);
        return result.component;
      });
    }
  }

  // ------------------------------------------------------------------ straight flanges
  const run = runOrder(components);
  const neighbours = (id: string): string[] => {
    const index = run.findIndex((c) => c.id === id);
    return [run[index - 1], run[index + 1]].filter((c): c is ComponentDefinition => c !== undefined).map((c) => c.id);
  };
  components = components.map((c) => {
    if (!FORMED_HEADS.has(c.kind)) return c;
    const stated = c.dimensions[Sym.STRAIGHT_FLANGE_LENGTH];
    if (stated !== undefined && Number.isFinite(stated)) {
      applied.push({ key: Detail.STRAIGHT_FLANGE_LENGTH, at: c.id, value: stated, source: 'stated' });
      return c;
    }
    const keys = neighbours(c.id).flatMap((n) => [`${c.id}~${n}`, `${n}~${c.id}`]);
    const resolved = resolveDetail(layers, Detail.STRAIGHT_FLANGE_LENGTH, keys);
    record(Detail.STRAIGHT_FLANGE_LENGTH, resolved.joint ?? c.id, resolved, undefined, [c.id]);
    if (typeof resolved.value !== 'number') return c;
    return { ...c, dimensions: { ...c.dimensions, [Sym.STRAIGHT_FLANGE_LENGTH]: resolved.value } };
  });

  // ------------------------------------------------------------------ joints of the run
  const joints: Record<string, JointParameters> = { ...(definition.joints ?? {}) };
  const derived = new Map<string, { diameter: number; at: string }>();
  for (let index = 0; index + 1 < run.length; index++) {
    const lower = byId().get(run[index].id)!;
    const upper = byId().get(run[index + 1].id)!;
    const key = `${lower.id}~${upper.id}`;
    const keys = [key, `${upper.id}~${lower.id}`];
    const stated = statedJoint(definition, lower.id, upper.id);

    const taper = stated?.taperRatio !== undefined
      ? ({ value: stated.taperRatio, source: 'joint', joint: key } satisfies ResolvedValue)
      : resolveDetail(layers, Detail.TAPER_RATIO, keys);
    const datum = stated?.alignment !== undefined
      ? ({ value: stated.alignment, source: 'joint', joint: key } satisfies ResolvedValue)
      : resolveDetail(layers, Detail.ALIGNMENT_DATUM, keys);
    record(Detail.TAPER_RATIO, key, taper, undefined, [lower.id, upper.id]);

    const parameters: JointParameters = {
      ...(stated ?? {}),
      ...(taper.source !== 'default' && typeof taper.value === 'number' ? { taperRatio: taper.value } : {}),
      ...(datum.source !== 'default' ? { alignment: datum.value as AlignmentDatum } : {}),
    };
    if (Object.keys(parameters).length > 0) joints[key] = parameters;

    // A declared datum on two walls stated at one bore says where the thinner one really sits.
    let datumEffect: string | undefined;
    if (datum.source !== 'default') {
      const step = alignmentStep(lower, upper, datum.value as AlignmentDatum);
      if (step.kind === 'derive') {
        const previous = derived.get(step.thinId);
        if (previous && Math.abs(previous.diameter - step.diameter) > 1e-6) {
          for (const id of [step.thinId]) {
            say(
              id,
              note(
                `Two alignment datums place ${step.thinName} at two bores: ${mm(previous.diameter)} from ${previous.at}, ${mm(step.diameter)} from ${key}`,
                Sym.INSIDE_DIAMETER,
                scope('mismatch', Detail.ALIGNMENT_DATUM, 'one inside diameter per part', `${mm(previous.diameter)} and ${mm(step.diameter)}`)
              )
            );
          }
        } else if (!previous) {
          derived.set(step.thinId, { diameter: step.diameter, at: key });
          datumEffect = `${step.thinName}: D ${mm(step.from)} → ${mm(step.diameter)}`;
        }
      } else if (step.kind === 'mismatch') {
        for (const id of [lower.id, upper.id]) {
          say(id, note(step.message, Sym.INSIDE_DIAMETER, scope('mismatch', Detail.ALIGNMENT_DATUM, String(datum.value), step.seen)));
        }
      } else if (step.kind === 'refused') {
        say(step.componentId, note(step.message, undefined, scope('not_built', Detail.ALIGNMENT_DATUM, step.limit, String(datum.value))));
      }
    }
    record(Detail.ALIGNMENT_DATUM, key, datum, datumEffect, [lower.id, upper.id]);
  }
  if (derived.size > 0) {
    components = components.map((c) => {
      const d = derived.get(c.id);
      return d ? rebore(c, d.diameter) : c;
    });
  }

  // ------------------------------------------------------------------ nozzle corners
  const corrodedInside = model.value === 'corroded' ? corrosionOf(layers).inside : 0;
  const corrodedOutside = model.value === 'corroded' ? corrosionOf(layers).outside : 0;
  for (const c of components) {
    if (!NOZZLES.has(c.kind) || c.hostId === null) continue;
    const key = `${c.id}~${c.hostId}`;
    const keys = [key, `${c.hostId}~${c.id}`];
    const outer = resolveDetail(layers, Detail.NOZZLE_OUTSIDE_CORNER_RADIUS, keys);
    const inner = resolveDetail(layers, Detail.NOZZLE_INSIDE_CORNER_RADIUS, keys);
    // A corroded surface is the nominal one moved by the allowance, a corner's radius with it:
    // the outside corner is concave, so it grows; the inside one is convex, and grows too.
    const outsideRadius = typeof outer.value === 'number' && outer.value > 0 ? outer.value + corrodedOutside : 0;
    const insideRadius = typeof inner.value === 'number' && inner.value > 0 ? inner.value + corrodedInside : 0;
    record(Detail.NOZZLE_OUTSIDE_CORNER_RADIUS, key, outer, outsideRadius > 0 && corrodedOutside > 0 ? `drawn ${mm(outsideRadius)}, corroded` : undefined, [c.id]);
    record(Detail.NOZZLE_INSIDE_CORNER_RADIUS, key, inner, insideRadius > 0 && corrodedInside > 0 ? `drawn ${mm(insideRadius)}, corroded` : undefined, [c.id]);
    if (outsideRadius > 0 || insideRadius > 0) {
      joints[key] = {
        ...(joints[key] ?? {}),
        ...(outsideRadius > 0 ? { outsideCornerRadius: outsideRadius } : {}),
        ...(insideRadius > 0 ? { insideCornerRadius: insideRadius } : {}),
      };
    }
  }

  const { details: _layers, ...rest } = definition;
  void _layers;
  const out: AssemblyDefinition = {
    ...rest,
    components,
    ...(Object.keys(joints).length > 0 ? { joints } : {}),
  };
  return {
    definition: out,
    details: {
      profile: layers?.profile?.name ?? null,
      applied,
      notes: Object.fromEntries(notes),
    },
  };
}

/**
 * The model with what the details had to say about each part added to its notes — under analysis,
 * the refusals among them refuse the export as any other note does.
 */
export function withDetailNotes(model: AssemblyModel, details: ResolvedDetails): AssemblyModel {
  if (Object.keys(details.notes).length === 0) return model;
  return {
    ...model,
    parts: model.parts.map((part) => {
      const extra = details.notes[part.componentId];
      return extra && extra.length > 0 ? { ...part, notes: [...part.notes, ...extra] } : part;
    }),
  };
}

function corrosionOf(layers: AssemblyDefinition['details']): { inside: number; outside: number } {
  const allowance = resolveDetail(layers, Detail.CORROSION_ALLOWANCE).value;
  const surfaces = resolveDetail(layers, Detail.CORRODED_SURFACES).value;
  if (typeof allowance !== 'number') return { inside: 0, outside: 0 };
  return { inside: surfaces === 'outside' ? 0 : allowance, outside: surfaces === 'inside' ? 0 : allowance };
}

function statedJoint(definition: AssemblyDefinition, a: string, b: string): JointParameters | undefined {
  return definition.joints?.[`${a}~${b}`] ?? definition.joints?.[`${b}~${a}`];
}

/**
 * A part at its corroded dimensions: `inside` taken off its inside surface, `outside` off its
 * outside. A wall loses both; a bore grows by twice the inside; a formed head's shape follows its
 * derivation rule. A kind whose corroded dimensions are not derived here is refused rather than
 * left nominal in a model declared corroded.
 */
function corrode(
  component: ComponentDefinition,
  inside: number,
  outside: number,
  rule: 'true_shape' | 'uniform_offset'
): { component: ComponentDefinition; effect?: string; notes: Note[] } {
  const d = { ...component.dimensions };
  const changes: string[] = [];
  const set = (symbol: string, value: number, label: string) => {
    changes.push(`${label} ${mm(d[symbol])} → ${mm(value)}`);
    d[symbol] = value;
  };
  const thin = (symbol: string, by: number, label = 't') => {
    if (d[symbol] === undefined || by === 0) return;
    set(symbol, d[symbol] - by, label);
  };
  const kind = component.kind;

  if (NOT_WETTED.has(kind) || inside + outside === 0) return { component, notes: [] };

  if (kind === Kind.CYLINDRICAL_SHELL || kind === Kind.HEMISPHERICAL_HEAD || kind === Kind.FLAT_HEAD) {
    if (inside > 0 && d[Sym.INSIDE_DIAMETER] !== undefined) set(Sym.INSIDE_DIAMETER, d[Sym.INSIDE_DIAMETER] + 2 * inside, 'D');
    thin(Sym.THICKNESS, inside + outside);
  } else if (kind === Kind.CONICAL_SHELL) {
    // The diameters are horizontal; the allowance comes off normal to the sloping wall.
    const alpha = d[Sym.HALF_APEX_ANGLE];
    const grow = alpha === undefined ? 2 * inside : (2 * inside) / Math.cos(alpha * DEG);
    if (inside > 0) {
      if (d[Sym.INSIDE_DIAMETER] !== undefined) set(Sym.INSIDE_DIAMETER, d[Sym.INSIDE_DIAMETER] + grow, 'D');
      if (d[Sym.SMALL_END_DIAMETER] !== undefined) set(Sym.SMALL_END_DIAMETER, d[Sym.SMALL_END_DIAMETER] + grow, 'D_s');
    }
    thin(Sym.THICKNESS, inside + outside);
  } else if (kind === Kind.ECCENTRIC_CONICAL_SHELL) {
    // Drawn with a wall t WIDE in every section, so the allowance comes off horizontally too.
    if (inside > 0) {
      if (d[Sym.INSIDE_DIAMETER] !== undefined) set(Sym.INSIDE_DIAMETER, d[Sym.INSIDE_DIAMETER] + 2 * inside, 'D');
      if (d[Sym.SMALL_END_DIAMETER] !== undefined) set(Sym.SMALL_END_DIAMETER, d[Sym.SMALL_END_DIAMETER] + 2 * inside, 'D_s');
    }
    thin(Sym.THICKNESS, inside + outside);
  } else if (kind === Kind.PASS_PARTITION_PLATE) {
    // Wholly inside the channel, the tube-side fluid on both faces: what the inside loses, twice.
    thin(Sym.PASS_PARTITION_THICKNESS, 2 * inside, 't_p');
  } else if (kind === Kind.TUBE_BUNDLE) {
    return {
      component,
      notes: [
        note(
          "The model is declared corroded, and a tube's allowance is not the vessel's — the bundle is drawn nominal",
          Sym.TUBE_THICKNESS,
          scope('not_built', Detail.CORRODED_MODEL, 'shells, formed and flat heads, nozzles, an eccentric cone, a pass partition plate', kind)
        ),
      ],
    };
  } else if (kind === Kind.ELLIPSOIDAL_HEAD || kind === Kind.TORISPHERICAL_HEAD) {
    const diameter = d[Sym.INSIDE_DIAMETER];
    if (inside > 0 && diameter !== undefined) {
      const corroded = diameter + 2 * inside;
      const scale = corroded / diameter;
      set(Sym.INSIDE_DIAMETER, corroded, 'D');
      for (const [symbol, label] of [
        [Sym.HEAD_HEIGHT, 'h'],
        [Sym.CROWN_RADIUS, 'L'],
        [Sym.KNUCKLE_RADIUS, 'r'],
      ] as const) {
        if (d[symbol] === undefined) continue;
        set(symbol, rule === 'true_shape' ? d[symbol] * scale : d[symbol] + inside, label);
      }
    }
    thin(Sym.THICKNESS, inside + outside);
  } else if (NOZZLES.has(kind)) {
    if (inside > 0 && d[Sym.NOZZLE_INSIDE_DIAMETER] !== undefined) {
      set(Sym.NOZZLE_INSIDE_DIAMETER, d[Sym.NOZZLE_INSIDE_DIAMETER] + 2 * inside, 'd');
    }
    thin(Sym.NOZZLE_THICKNESS, inside + outside, 't_n');
    thin(Sym.PAD_THICKNESS, outside, 't_e');
  } else if (d[Sym.THICKNESS] !== undefined || d[Sym.INSIDE_DIAMETER] !== undefined) {
    return {
      component,
      notes: [
        note(
          `The model is declared corroded, and a ${kind.replace(/_/g, ' ')}'s corroded dimensions are not derived — drawn nominal`,
          undefined,
          scope('not_built', Detail.CORRODED_MODEL, 'shells, formed and flat heads, nozzles', kind)
        ),
      ],
    };
  } else {
    return { component, notes: [] };
  }

  for (const symbol of [Sym.THICKNESS, Sym.NOZZLE_THICKNESS, Sym.PAD_THICKNESS, Sym.PASS_PARTITION_THICKNESS]) {
    if (d[symbol] !== undefined && !(d[symbol] > 0)) {
      return {
        component,
        notes: [
          note(
            `Corroded, the ${symbol.replace(/_/g, ' ')} would be ${mm(d[symbol])}`,
            symbol,
            scope('out_of_scope', symbol, '> 0 after the allowance', mm(d[symbol]))
          ),
        ],
      };
    }
  }
  return {
    component: { ...component, dimensions: d },
    ...(changes.length > 0 ? { effect: `corroded (${rule.replace('_', ' ')}): ${changes.join(', ')}` } : {}),
    notes: [],
  };
}

type AlignmentStep =
  | { kind: 'none' }
  | { kind: 'derive'; thinId: string; thinName: string; from: number; diameter: number }
  | { kind: 'mismatch'; message: string; seen: string }
  | { kind: 'refused'; componentId: string; message: string; limit: string };

/**
 * What a declared datum makes of two walls. Stated at one bore and of different thicknesses, the
 * thinner one's bore is derived from the thicker one's — the thicker part is the one ordered to
 * its stated size. Stated at different bores, the datum is checked against them: a datum the
 * dimensions contradict is two models of one joint.
 */
function alignmentStep(lower: ComponentDefinition, upper: ComponentDefinition, datum: AlignmentDatum): AlignmentStep {
  const D1 = lower.dimensions[Sym.INSIDE_DIAMETER];
  const D2 = upper.dimensions[Sym.INSIDE_DIAMETER];
  const t1 = lower.dimensions[Sym.THICKNESS];
  const t2 = upper.dimensions[Sym.THICKNESS];
  if ([D1, D2, t1, t2].some((v) => v === undefined || !Number.isFinite(v))) return { kind: 'none' };
  if (Math.abs(t1 - t2) < 1e-6) return { kind: 'none' };
  const tolerance = Math.max(1e-3 * Math.max(D1, D2), 1e-6);
  const [thick, thin] = t1 > t2 ? [lower, upper] : [upper, lower];
  const tT = thick.dimensions[Sym.THICKNESS];
  const tt = thin.dimensions[Sym.THICKNESS];
  const DT = thick.dimensions[Sym.INSIDE_DIAMETER];
  const want = datum === 'inside_flush' ? DT : datum === 'outside_flush' ? DT + 2 * (tT - tt) : DT + (tT - tt);

  if (Math.abs(D1 - D2) <= tolerance) {
    if (datum === 'inside_flush') return { kind: 'none' };
    if (thin.kind === Kind.CONICAL_SHELL) {
      return {
        kind: 'refused',
        componentId: thin.id,
        message: `${thin.name}'s bore is not derived from the ${datum.replace('_', ' ')} datum: a cone's two ends would part company`,
        limit: 'a course or a formed head',
      };
    }
    return { kind: 'derive', thinId: thin.id, thinName: thin.name, from: thin.dimensions[Sym.INSIDE_DIAMETER], diameter: want };
  }
  const seen = Math.abs(thin.dimensions[Sym.INSIDE_DIAMETER] - want) <= tolerance;
  return seen
    ? { kind: 'none' }
    : {
        kind: 'mismatch',
        message: `The ${datum.replace('_', ' ')} datum puts ${thin.name}'s bore at ${mm(want)}; it states ${mm(thin.dimensions[Sym.INSIDE_DIAMETER])}`,
        seen: mm(thin.dimensions[Sym.INSIDE_DIAMETER]),
      };
}

/** A course or a head re-bored to `diameter`: a formed head keeps its shape, scaled with it. */
function rebore(component: ComponentDefinition, diameter: number): ComponentDefinition {
  const d = { ...component.dimensions };
  const scale = diameter / d[Sym.INSIDE_DIAMETER];
  d[Sym.INSIDE_DIAMETER] = diameter;
  for (const symbol of [Sym.HEAD_HEIGHT, Sym.CROWN_RADIUS, Sym.KNUCKLE_RADIUS]) {
    if (d[symbol] !== undefined) d[symbol] *= scale;
  }
  return { ...component, dimensions: d };
}
