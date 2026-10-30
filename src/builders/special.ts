// Parts of the run that are not surfaces of revolution: §4.12's noncircular vessels, and the
// stay plates that divide a vessel — noncircular or not — into chambers.
import {
  BuildError,
  Sym,
  note,
  optionalDimension,
  requireDimension,
  type ComponentDefinition,
  type Note,
} from '../definition.ts';
import type { GeometryKernel, Profile, ProfileStep, Solid } from '../kernel/GeometryKernel.ts';
import { mm } from './placing.ts';
import type { RunBuilder } from './types.ts';

const line = (x: number, y: number): ProfileStep => ({ kind: 'line', to: [x, y] });

const rectangle = (halfX: number, halfY: number): Profile => ({
  start: [-halfX, -halfY],
  steps: [line(halfX, -halfY), line(halfX, halfY), line(-halfX, halfY)],
});

/**
 * The stay plates across a section — `n_st` of them, `t_3` thick, square to the X axis and
 * evenly spaced over `±span`, each reaching `±reach` across. §4.12 Types 3, 11 and 12 read only
 * their thickness and their number; where they stand is the one arrangement those tables assume.
 */
function stayPlates(
  component: ComponentDefinition,
  kernel: GeometryKernel,
  span: number,
  reach: number,
  length: number
): { plates: Solid[]; note?: Note } {
  const thickness = optionalDimension(component, Sym.STAY_PLATE_THICKNESS);
  if (thickness === undefined) return { plates: [] };
  const planes = Math.max(1, Math.round(optionalDimension(component, Sym.STAY_PLANES) ?? 1));
  const plates = Array.from({ length: planes }, (_, k) => {
    const x = -span + ((k + 1) * 2 * span) / (planes + 1);
    return kernel.extrude(
      { start: [x - thickness / 2, -reach], steps: [line(x + thickness / 2, -reach), line(x + thickness / 2, reach), line(x - thickness / 2, reach)] },
      0,
      length
    );
  });
  // Where they stand is assumed: the tables read only how many and how thick.
  return {
    plates,
    note: note(`${planes} stay plate${planes > 1 ? 's' : ''} of ${mm(thickness)}, evenly spaced`, Sym.STAY_PLANES),
  };
}

function lengthOf(component: ComponentDefinition, fallback: number, notes: Note[]): number {
  const stated = optionalDimension(component, Sym.COURSE_LENGTH);
  if (stated !== undefined) return stated;
  notes.push(note(`Length not stated — drawn ${mm(fallback)} long`, Sym.COURSE_LENGTH));
  return fallback;
}

/**
 * §4.12 Types 1 to 4 — a rectangular vessel: inside `h` by `H`, the short sides (of length `H`)
 * in plate `t_1`, the long sides (of length `h`) in plate `t_2`, open at both ends like a
 * course. Its stiffeners, when it has them, are not drawn; its stay plates are.
 */
export const rectangularVessel: RunBuilder = (component, context) => {
  const short = requireDimension(component, Sym.SHORT_SIDE);
  const long = requireDimension(component, Sym.LONG_SIDE);
  const shortPlate = requireDimension(component, Sym.SHORT_SIDE_THICKNESS);
  const longPlate = requireDimension(component, Sym.LONG_SIDE_THICKNESS);
  if (short > long) {
    throw new BuildError(component, `has a short side (${mm(short)}) longer than its long side (${mm(long)})`);
  }
  const notes: Note[] = [];
  const length = lengthOf(component, long, notes);
  if (component.dimensions[Sym.STIFFENER_PITCH] !== undefined) {
    notes.push(note('Its stiffeners are not drawn', Sym.STIFFENER_PITCH));
  }

  const { kernel } = context;
  const outer = kernel.extrude(rectangle(long / 2 + shortPlate, short / 2 + longPlate), 0, length);
  const inner = kernel.extrude(rectangle(long / 2, short / 2), -1, length + 1);
  const { plates, note: plateNote } = stayPlates(component, kernel, long / 2, short / 2, length);
  if (plateNote) notes.push(plateNote);

  return {
    solid: kernel.cut(outer, [inner]),
    extraSolids: plates,
    height: length,
    lower: null,
    upper: null,
    landmarks: [],
    notes,
  };
};

/**
 * §4.12 Types 9 to 11 — an obround vessel: two semi-cylinders of inside radius `R` and wall
 * `t_1`, joined by two flat sides `2·L_2` long in plate `t_2`. Where the two walls differ, the
 * outside steps at the junction, as the plates do.
 */
export const obroundVessel: RunBuilder = (component, context) => {
  const radius = requireDimension(component, Sym.OBROUND_RADIUS);
  const half = requireDimension(component, Sym.OBROUND_FLAT_HALF_LENGTH);
  const curved = requireDimension(component, Sym.CURVED_THICKNESS);
  const flat = requireDimension(component, Sym.FLAT_THICKNESS);
  const notes: Note[] = [];
  const length = lengthOf(component, 2 * (radius + half), notes);
  if (component.dimensions[Sym.STIFFENER_PITCH] !== undefined) {
    notes.push(note('Its reinforcing members are not drawn', Sym.STIFFENER_PITCH));
  }

  const { kernel } = context;
  const inner: Profile = {
    start: [-half, -radius],
    steps: [
      line(half, -radius),
      { kind: 'arc', to: [half, radius], through: [half + radius, 0] },
      line(-half, radius),
      { kind: 'arc', to: [-half, -radius], through: [-half - radius, 0] },
    ],
  };

  const ro = radius + curved;
  const yf = radius + flat;
  const step = Math.abs(yf - ro) > 1e-6;
  const outer: Profile = {
    start: [-half, -yf],
    steps: [
      line(half, -yf),
      ...(step ? [line(half, -ro)] : []),
      { kind: 'arc', to: [half, ro], through: [half + ro, 0] },
      ...(step ? [line(half, yf)] : []),
      line(-half, yf),
      ...(step ? [line(-half, ro)] : []),
      { kind: 'arc', to: [-half, -ro], through: [-half - ro, 0] },
    ],
  };

  const body = kernel.cut(kernel.extrude(outer, 0, length), [kernel.extrude(inner, -1, length + 1)]);
  const { plates, note: plateNote } = stayPlates(component, kernel, half, radius, length);
  if (plateNote) notes.push(plateNote);

  return {
    solid: body,
    extraSolids: plates,
    height: length,
    lower: null,
    upper: null,
    landmarks: [],
    notes,
  };
};

/**
 * §4.12 Type 12 — the stay plate that divides a circular course into two chambers, drawn
 * across its diameter. Only called for a cylinder that states one.
 */
export function dividingPlates(
  component: ComponentDefinition,
  kernel: GeometryKernel,
  insideRadius: number,
  length: number
): { plates: Solid[]; note?: Note } {
  return stayPlates(component, kernel, 0, insideRadius, length);
}
