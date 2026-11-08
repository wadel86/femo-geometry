// Construction details: how the equipment was MADE, beside what it IS.
//
// A part's dimensions say what it is — D, t, L, h — and the rules read them. How it was built
// moves the stress just as surely and is stated nowhere in the catalogue: the radius a nozzle's
// corner was ground to, whether the analysis model stands at its corroded dimensions and how
// they were derived, the head manufacturer's straight flange, which surface runs on across a
// change of thickness. Fabricators and EPCs specify these once, as a standard, and every
// equipment they build inherits it.
//
// So each detail is declared in layers, each overriding the one before: the entity's standards
// profile, the project, the equipment, the individual joint. What a part states itself, as one of
// its own dimensions, wins over all of them — the platform's rule everywhere else.
//
// Every detail also declares its EFFECT: which stress classification lines it moves and by how
// much, measured by varying it, as the taper was measured between E5.2.1's two passes. A detail
// that moves nothing above the model's resolution stays fixed at its default: offering a choice
// nobody can see the consequence of is noise.
import type { ConstructionDetailValues, DetailLayers, DetailValue } from '../definition.ts';

/** The details, as their wire names spell them. */
export const Detail = {
  /** §6.1.6.2's fairing at a change of thickness, length over step: 3 (the Code's floor) to 10. */
  TAPER_RATIO: 'taper_ratio',
  /** Which surface runs on across a change of thickness: `inside_flush`, `outside_flush`, `mid_wall`. */
  ALIGNMENT_DATUM: 'alignment_datum',
  /** A nozzle's corner where its neck meets the host's outside, mm; 0 is the sharp corner. */
  NOZZLE_OUTSIDE_CORNER_RADIUS: 'nozzle_outside_corner_radius',
  /** A nozzle's corner where its bore meets the host's inside, mm; 0 is the sharp corner. */
  NOZZLE_INSIDE_CORNER_RADIUS: 'nozzle_inside_corner_radius',
  /** A formed head's straight flange, mm, where the head itself states none. */
  STRAIGHT_FLANGE_LENGTH: 'straight_flange_length',
  /** `nominal` or `corroded`: the dimensions the model is built at. */
  CORRODED_MODEL: 'corroded_model',
  /** The corrosion allowance a corroded model removes, mm. */
  CORROSION_ALLOWANCE: 'corrosion_allowance',
  /** Which surfaces the allowance comes off: `inside`, `outside` or `both`. */
  CORRODED_SURFACES: 'corroded_surfaces',
  /**
   * How a formed head's corroded inside is derived: `true_shape` keeps the head's own shape on
   * the corroded diameter (a 2:1 head stays 2:1, h = ID/4); `uniform_offset` grows the nominal
   * inside surface by the allowance everywhere (an ellipse grown uniformly is no longer one).
   */
  CORRODED_HEAD_RULE: 'corroded_head_rule',
} as const;

export type DetailKey = (typeof Detail)[keyof typeof Detail];

/** Where a detail's value came from: a layer, the part itself, or nobody. */
export type DetailSource = 'default' | 'profile' | 'project' | 'equipment' | 'joint' | 'stated';

/** What a joint-scoped detail is declared on. */
export type DetailJoint = 'run' | 'nozzle' | 'head' | null;

/** One measurement of a detail's effect: what was varied, on which model, and what moved. */
export interface EffectMeasurement {
  /** The case the variation was run on, and which model of it. */
  readonly case: string;
  /** The values compared, as read: "0 → 38.1 mm outside, 0 → 19.05 mm inside". */
  readonly varied: string;
  readonly scls: readonly {
    readonly name: string;
    /** `Pm`, `PL`, `PmPb` … as the case reports it. */
    readonly quantity: string;
    readonly from: number;
    readonly to: number;
    readonly deltaPct: number;
  }[];
  /** The model's own resolution on that case: a movement below it is not a movement. */
  readonly resolutionPct: number;
  /** Where the run is on disk. */
  readonly source: string;
}

/**
 * What a detail does to the answer. `moves` is a detail worth offering; `below_resolution` is
 * held at its default, a value stated for it reported and not drawn; `not_measured` is offered
 * and says so, because its consequence has not been seen.
 */
export interface DetailEffect {
  readonly status: 'not_measured' | 'moves' | 'below_resolution';
  readonly measurements: readonly EffectMeasurement[];
  /** What the measurements add up to, in one sentence. */
  readonly summary: string;
}

export interface DetailSpec {
  readonly key: DetailKey;
  readonly label: string;
  /** Mm, a ratio, or one of `options`. */
  readonly unit: 'mm' | 'ratio' | 'option';
  readonly options?: readonly string[];
  /** Inclusive, for a number. */
  readonly range?: readonly [number, number];
  /** What the kernel does when nobody declares it: what it always did. Null has no default. */
  readonly default: DetailValue | null;
  /** Declared per joint as well as above it, and on which kind of joint. */
  readonly joint: DetailJoint;
  readonly effect: DetailEffect;
}

const NOT_MEASURED = (summary: string): DetailEffect => ({ status: 'not_measured', measurements: [], summary });

/** Every detail the kernel knows, in priority order. */
export const DETAILS: readonly DetailSpec[] = [
  {
    key: Detail.NOZZLE_OUTSIDE_CORNER_RADIUS,
    label: 'Nozzle outside corner radius',
    unit: 'mm',
    range: [0, 500],
    default: 0,
    joint: 'nozzle',
    effect: {
      status: 'moves',
      measurements: [
        {
          case: "Demo A's N1, DN 200 radial in a 16 mm shell, tetra instrument (demo_a_n1_corners)",
          varied: 'sharp → 38.1 mm outside (PTB-3 N2), inside left sharp',
          scls: [
            { name: 'shell_long_1', quantity: 'Pm', from: 59.15, to: 55.71, deltaPct: -5.83 },
            { name: 'shell_trans_1', quantity: 'Pm', from: 32.84, to: 31.81, deltaPct: -3.15 },
            { name: 'shell_trans_3', quantity: 'PmPb', from: 44.63, to: 46.2, deltaPct: 3.51 },
            { name: 'nozzle_long_1', quantity: 'PmPb', from: 15.15, to: 19.04, deltaPct: 25.72 },
            { name: 'nozzle_trans_1', quantity: 'PmPb', from: 16.48, to: 21.31, deltaPct: 29.31 },
            { name: 'reference', quantity: 'Pm', from: 41.04, to: 41.04, deltaPct: 0.0 },
          ],
          resolutionPct: 0.6,
          source: '_meshing/results/demo_a_n1_corners',
        },
      ],
      summary:
        'The first station past the corner on every family: shell Pm −2 to −6 %, shell PmPb −2 to +4 %, neck PmPb +26 to +29 % (on 15–21 MPa); the far reference unmoved. Alone it leaves the inside corner singular, so the corner itself is read only with both radii.',
    },
  },
  {
    key: Detail.NOZZLE_INSIDE_CORNER_RADIUS,
    label: 'Nozzle inside corner radius',
    unit: 'mm',
    range: [0, 500],
    default: 0,
    joint: 'nozzle',
    effect: {
      status: 'moves',
      measurements: [
        {
          case: "Demo A's N1, both PTB-3 radii against the sharp corner (demo_a_n1_corners)",
          varied: 'sharp → 38.1 mm outside + 19.05 mm inside (PTB-3 N2)',
          scls: [
            { name: 'crotch → corner_ligament', quantity: 'PmPb', from: 115.72, to: 114.48, deltaPct: -1.07 },
            { name: 'crotch → corner_ligament', quantity: 'Pm', from: 97.06, to: 76.25, deltaPct: -21.44 },
            { name: 'shell_long_1', quantity: 'Pm', from: 59.15, to: 57.95, deltaPct: -2.03 },
            { name: 'shell_trans_3', quantity: 'PmPb', from: 44.63, to: 46.75, deltaPct: 4.75 },
            { name: 'nozzle_long_1', quantity: 'PmPb', from: 15.15, to: 20.28, deltaPct: 33.88 },
            { name: 'nozzle_trans_1', quantity: 'PmPb', from: 16.48, to: 22.69, deltaPct: 37.69 },
            { name: 'reference', quantity: 'Pm', from: 41.04, to: 41.04, deltaPct: 0.0 },
          ],
          resolutionPct: 0.6,
          source: '_meshing/results/demo_a_n1_corners',
        },
      ],
      summary:
        "Measured with the outside radius, the inside-only mesh failing in NETGEN: its share is both minus outside-only — neck PmPb +8 points, shell_long_1 Pm +3.8. With both, the governing corner moves from the sharp crotch's 115.7 MPa PmPb (an ambiguous line on a singularity) to 114.5 on a structural ligament, −1.1 %, while its Pm falls 21 %.",
    },
  },
  {
    key: Detail.CORRODED_MODEL,
    label: 'Model dimensions',
    unit: 'option',
    options: ['nominal', 'corroded'],
    default: 'nominal',
    joint: null,
    effect: {
      status: 'moves',
      measurements: [
        {
          case: 'V-PTB3-E5.2.1, axisymmetric joint (ptb3_e521_details)',
          varied: 'corroded (3.175 mm inside, true shape) → nominal',
          scls: [
            { name: 'SCL5', quantity: 'PL', from: 126.2963, to: 107.2752, deltaPct: -15.06 },
            { name: 'SCL6', quantity: 'PL', from: 63.2634, to: 55.4201, deltaPct: -12.4 },
            { name: 'SCL7', quantity: 'PL', from: 70.8435, to: 60.4727, deltaPct: -14.64 },
            { name: 'SCL8', quantity: 'PL', from: 79.08, to: 66.6841, deltaPct: -15.68 },
            { name: 'SCL9', quantity: 'Pm', from: 131.2017, to: 113.5353, deltaPct: -13.47 },
          ],
          resolutionPct: 0.39,
          source: '_meshing/results/ptb3_e521_details',
        },
        {
          case: "Demo A's bottom joint D1L, axisymmetric (demo_a_d1_details)",
          varied: 'nominal → corroded (3 mm inside, true shape)',
          scls: [
            { name: 'tangent_line', quantity: 'Pm', from: 22.869, to: 28.395, deltaPct: 24.16 },
            { name: 'head_1', quantity: 'Pm', from: 45.154, to: 57.725, deltaPct: 27.84 },
            { name: 'head_1.5', quantity: 'Pm', from: 43.06, to: 56.388, deltaPct: 30.95 },
            { name: 'course_far', quantity: 'Pm', from: 40.91, to: 50.431, deltaPct: 23.27 },
          ],
          resolutionPct: 0.36,
          source: '_meshing/results/demo_a_d1_details',
        },
      ],
      summary: 'Every line: 12 to 16 % on E5.2.1, 20 to 31 % on Demo A (3 mm off a 16 mm wall). The convention as a whole; which surfaces and which head rule are their own details.',
    },
  },
  {
    key: Detail.CORROSION_ALLOWANCE,
    label: 'Corrosion allowance',
    unit: 'mm',
    range: [0, 50],
    default: null,
    joint: null,
    effect: NOT_MEASURED('Read with the corroded model, never on its own.'),
  },
  {
    key: Detail.CORRODED_SURFACES,
    label: 'Corroded surfaces',
    unit: 'option',
    options: ['inside', 'outside', 'both'],
    default: 'inside',
    joint: null,
    effect: NOT_MEASURED('Only `inside`, PTB-3\'s, has been run; outside and both are drawn and not measured.'),
  },
  {
    key: Detail.CORRODED_HEAD_RULE,
    label: 'Corroded head derivation',
    unit: 'option',
    options: ['true_shape', 'uniform_offset'],
    default: 'true_shape',
    joint: null,
    effect: {
      status: 'moves',
      measurements: [
        {
          case: 'V-PTB3-E5.2.1, axisymmetric joint (ptb3_e521_details)',
          varied: 'true shape (h = 21.0625 in) → uniform offset (h = 21.125 in)',
          scls: [
            { name: 'SCL5', quantity: 'PL', from: 126.2963, to: 125.5841, deltaPct: -0.56 },
            { name: 'SCL6', quantity: 'PL', from: 63.2634, to: 62.9924, deltaPct: -0.43 },
            { name: 'SCL7', quantity: 'PL', from: 70.8435, to: 71.0511, deltaPct: 0.29 },
            { name: 'SCL8', quantity: 'PL', from: 79.08, to: 79.2865, deltaPct: 0.26 },
          ],
          resolutionPct: 0.39,
          source: '_meshing/results/ptb3_e521_details',
        },
        {
          case: "Demo A's bottom joint D1L, corroded 3 mm (demo_a_d1_details)",
          varied: 'true shape → uniform offset',
          scls: [
            { name: 'tangent_line', quantity: 'Pm', from: 28.395, to: 28.222, deltaPct: -0.61 },
            { name: 'head_0.5', quantity: 'Pm', from: 47.837, to: 47.333, deltaPct: -1.06 },
            { name: 'head_1', quantity: 'Pm', from: 57.725, to: 57.258, deltaPct: -0.81 },
            { name: 'course_far', quantity: 'Pm', from: 50.431, to: 50.432, deltaPct: 0.0 },
          ],
          resolutionPct: 0.36,
          source: '_meshing/results/demo_a_d1_details',
        },
      ],
      summary: 'Up to 1 % on the head side of a 2:1 joint (Demo A head_0.5 −1.06 %; E5.2.1 SCL 5 −0.56 %), the course untouched; above the model\'s resolution.',
    },
  },
  {
    key: Detail.STRAIGHT_FLANGE_LENGTH,
    label: 'Straight flange on formed heads',
    unit: 'mm',
    range: [0, 500],
    default: null,
    joint: 'head',
    effect: {
      status: 'moves',
      measurements: [
        {
          case: 'V-PTB3-E5.2.1, axisymmetric joint (ptb3_e521_details)',
          varied: '76.2 → 50 mm',
          scls: [
            { name: 'SCL5', quantity: 'PL', from: 126.2963, to: 126.623, deltaPct: 0.26 },
            { name: 'SCL6', quantity: 'PL', from: 63.2634, to: 62.6632, deltaPct: -0.95 },
            { name: 'SCL7', quantity: 'PL', from: 70.8435, to: 61.5457, deltaPct: -13.12 },
            { name: 'SCL8', quantity: 'PL', from: 79.08, to: 68.4063, deltaPct: -13.5 },
          ],
          resolutionPct: 0.39,
          source: '_meshing/results/ptb3_e521_details',
        },
        {
          case: 'V-PTB3-E5.2.1, axisymmetric joint (ptb3_e521_details)',
          varied: '76.2 → 101.6 mm',
          scls: [
            { name: 'SCL6', quantity: 'PL', from: 63.2634, to: 63.7314, deltaPct: 0.74 },
            { name: 'SCL7', quantity: 'PL', from: 70.8435, to: 83.177, deltaPct: 17.41 },
            { name: 'SCL8', quantity: 'PL', from: 79.08, to: 91.1571, deltaPct: 15.27 },
          ],
          resolutionPct: 0.39,
          source: '_meshing/results/ptb3_e521_details',
        },
        {
          case: "Demo A's bottom joint D1L, head and course both 16 mm (demo_a_d1_details)",
          varied: '50 → 76.2 mm and 50 → 25 mm',
          scls: [
            { name: 'tangent_line', quantity: 'Pm', from: 22.869, to: 22.869, deltaPct: 0.0 },
            { name: 'course_far', quantity: 'Pm', from: 40.91, to: 40.877, deltaPct: -0.08 },
          ],
          resolutionPct: 0.36,
          source: '_meshing/results/demo_a_d1_details',
        },
      ],
      summary: 'It matters only where the weld is a change of wall: on E5.2.1 (head thicker, tapered) the weld\'s lines move 13 to 17 % for ±25 mm and the tangent line up to 2.7 % on P_m + P_b; on Demo A (equal walls) nothing moves above resolution, the weld being a seam in one wall.',
    },
  },
  {
    key: Detail.ALIGNMENT_DATUM,
    label: 'Alignment at a thickness change',
    unit: 'option',
    options: ['inside_flush', 'outside_flush', 'mid_wall'],
    default: 'inside_flush',
    joint: 'run',
    effect: NOT_MEASURED(
      'Drawn, not measured: the head-to-shell entry (D1) meshes equal bores only and refuses the other two datums ' +
        '(E5.2.1: "inside_diameter differs between Top head and Shell; limit: equal"). On Demo A it was run and ' +
        'moves nothing (0.000 % on every D1L line): the walls are equal, so there is no step for it to place.'
    ),
  },
  {
    key: Detail.TAPER_RATIO,
    label: 'Taper at a thickness change',
    unit: 'ratio',
    range: [3, 10],
    default: 3,
    joint: 'run',
    effect: {
      status: 'moves',
      measurements: [
        {
          case: 'V-PTB3-E5.2.1, axisymmetric joint (ptb3_e521_details)',
          varied: '4:1 → 3:1',
          scls: [
            { name: 'SCL6', quantity: 'PL', from: 63.2634, to: 63.2929, deltaPct: 0.05 },
            { name: 'SCL7', quantity: 'PL', from: 70.8435, to: 72.552, deltaPct: 2.41 },
            { name: 'SCL8', quantity: 'PL', from: 79.08, to: 78.5814, deltaPct: -0.63 },
          ],
          resolutionPct: 0.03,
          source: '_meshing/results/ptb3_e521_details',
        },
      ],
      summary: 'Moves the lines in the taper itself (SCL 7, at its top, 2.4 %; the seam 0.6 %); nothing beyond the tangent line.',
    },
  },
];

const SPECS = new Map(DETAILS.map((spec) => [spec.key, spec]));

export function detailSpec(key: DetailKey): DetailSpec {
  const spec = SPECS.get(key);
  if (!spec) throw new Error(`No construction detail ${key}`);
  return spec;
}

/** A detail's value where it applies, and the layer that gave it. */
export interface ResolvedValue {
  readonly value: DetailValue | null;
  readonly source: DetailSource;
  /** The joint key it was read under, for a joint-scoped detail declared there. */
  readonly joint?: string;
  /** Set when a declared value was not used: out of range, or the detail is held fixed. */
  readonly rejected?: { readonly value: DetailValue; readonly source: DetailSource; readonly why: string };
}

/** Whether a value is one the detail takes. */
export function validDetailValue(spec: DetailSpec, value: DetailValue): string | null {
  if (spec.unit === 'option') {
    return typeof value === 'string' && spec.options!.includes(value)
      ? null
      : `${String(value)} is not one of ${spec.options!.join(', ')}`;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${String(value)} is not a number`;
  const [low, high] = spec.range ?? [-Infinity, Infinity];
  return value >= low && value <= high ? null : `${value} is outside ${low} to ${high}`;
}

/**
 * A detail's value at a joint (any of `jointKeys`) or, with none, for the equipment: the most
 * specific layer that declares it, from the joint down to the profile, then the default.
 */
export function resolveDetail(
  layers: DetailLayers | undefined,
  key: DetailKey,
  jointKeys: readonly string[] = []
): ResolvedValue {
  const spec = detailSpec(key);
  const candidates: { value: DetailValue | undefined; source: DetailSource; joint?: string }[] = [];
  if (spec.joint !== null) {
    for (const joint of jointKeys) candidates.push({ value: layers?.joints?.[joint]?.[key], source: 'joint', joint });
  }
  candidates.push(
    { value: layers?.equipment?.[key], source: 'equipment' },
    { value: layers?.project?.[key], source: 'project' },
    { value: layers?.profile?.details?.[key], source: 'profile' }
  );

  let rejected: ResolvedValue['rejected'];
  for (const candidate of candidates) {
    if (candidate.value === undefined || candidate.value === null) continue;
    const invalid = validDetailValue(spec, candidate.value);
    if (invalid) {
      // A bad declaration does not fall through silently to a less specific one: it is said.
      rejected ??= { value: candidate.value, source: candidate.source, why: invalid };
      continue;
    }
    if (spec.effect.status === 'below_resolution' && candidate.value !== spec.default) {
      rejected ??= {
        value: candidate.value,
        source: candidate.source,
        why: `held at ${String(spec.default)}: its measured effect is below the model's resolution (${spec.effect.summary})`,
      };
      break;
    }
    return { value: candidate.value, source: candidate.source, ...(candidate.joint ? { joint: candidate.joint } : {}), ...(rejected ? { rejected } : {}) };
  }
  return { value: spec.default, source: 'default', ...(rejected ? { rejected } : {}) };
}

/** Only the details the layers set, for one layer: what a backend stores and hands back. */
export function declaredIn(values: ConstructionDetailValues | undefined): readonly DetailKey[] {
  return values ? (Object.keys(values).filter((k) => SPECS.has(k as DetailKey)) as DetailKey[]) : [];
}
