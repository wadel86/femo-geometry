// Supports and jackets: what is welded to the outside of a course without opening it.
//
// Built in the course's frame, round +X and then turned to their azimuth: a saddle at azimuth 0
// is the one a horizontal vessel stands on.
import {
  BuildError,
  NotDrawnError,
  Sym,
  assumedNote,
  note,
  optionalDimension,
  representedNote,
  requireDimension,
  scope,
  signedDimension,
  type ComponentDefinition,
  type Note,
} from '../definition.ts';
import type { GeometryKernel, Point2, Profile, Solid } from '../kernel/GeometryKernel.ts';
import { mm, radialPlate, requireWithinHost } from './placing.ts';
import type { CourseShape, MountedBuilder, MountedContext, MountedPart, Seat } from './types.ts';
import { cylinderSurface } from './walls.ts';

const DEG = Math.PI / 180;

function cylinderOf(component: ComponentDefinition, context: MountedContext, what: string): CourseShape {
  const course = context.hostSurface.course;
  if (!course || course.halfApexAngle !== 0) {
    throw new NotDrawnError(
      component,
      `${what} is drawn on a cylindrical course, and ${context.host.name} is not one`,
      scope('out_of_scope', 'host', 'a cylindrical course', course ? `a cone of ${course.halfApexAngle}°` : context.host.kind)
    );
  }
  return course;
}

const polar = (radius: number, angle: number): Point2 => [radius * Math.cos(angle), radius * Math.sin(angle)];

/** A rectangle of the XY plane, as an outline to extrude. */
const rectangle = (x0: number, x1: number, y0: number, y1: number): Profile => ({
  start: [x0, y0],
  steps: [
    { kind: 'line', to: [x1, y0] },
    { kind: 'line', to: [x1, y1] },
    { kind: 'line', to: [x0, y1] },
  ],
});

/**
 * A saddle — §4.15.3. A block bearing on the shell over the arc `θ`, `b` wide, down to a base
 * as wide as the chord it spans; and its wear plate when `t_r` is stated, over the wider arc
 * `θ + θ/12` and the width `b + 1.56·sqrt(R_m·t)` that §4.15.3.1 gives it.
 *
 * The saddle is drawn where its placement puts it. Its own `a` is what the engine reads, so a
 * saddle drawn elsewhere says so.
 */
export const saddleSupport: MountedBuilder = (component, context) => {
  const { kernel, placement, hostSurface } = context;
  const course = cylinderOf(component, context, 'a saddle');
  const theta = requireDimension(component, Sym.SADDLE_ANGLE);
  const plate = optionalDimension(component, Sym.WEAR_PLATE_THICKNESS);
  const notes: Note[] = [];

  const z = placement.axialOffset;
  const inside = course.insideRadiusAt(z);
  const outside = course.outsideRadiusAt(z);
  let width = optionalDimension(component, Sym.SADDLE_WIDTH);
  if (width === undefined) {
    width = Math.max(150, 0.12 * outside);
    notes.push(assumedNote(`Saddle width not stated — drawn ${mm(width)}`, Sym.SADDLE_WIDTH, mm(width)));
  }
  const plateWidth =
    plate === undefined ? width : width + 1.56 * Math.sqrt(((inside + outside) / 2) * course.thickness);
  requireWithinHost(component, context, plateWidth / 2);

  // a is measured from a head's tangent line, which a straight flange puts past the course's end.
  const distance = optionalDimension(component, Sym.SADDLE_DISTANCE);
  const [low, high] = context.tangentLines ?? hostSurface.offsetRange;
  if (distance !== undefined && Math.abs(z - low - distance) > 1 && Math.abs(high - z - distance) > 1) {
    notes.push(
      note(
        `Drawn at ${mm(z)}, but its a = ${mm(distance)} puts it that far from a tangent line`,
        Sym.SADDLE_DISTANCE,
        scope(
          'mismatch',
          Sym.SADDLE_DISTANCE,
          `the layout's ${mm(z - low)} or ${mm(high - z)} from the tangent lines of its course`,
          `stated ${mm(distance)}`
        )
      )
    );
  }

  // A fabricated saddle: a bearing plate wrapping the shell — or its wear plate — over θ, a web
  // across the vessel at the saddle's centre, ribs along the vessel at intervals across the
  // chord, the outer two at the horns, and a base plate. Every plate meets the next on a face,
  // none overlaps another, and the bearing plate follows the shell's own circle, so the saddle
  // needs nothing of a doubly curved surface. Its plates are the drawing's, read by no rule.
  const stated = (symbol: string, label: string, assumed: number): number => {
    const value = optionalDimension(component, symbol);
    if (value !== undefined) return value;
    notes.push(assumedNote(`${label} not stated — drawn ${mm(assumed)}`, symbol, mm(assumed)));
    return assumed;
  };
  const contact = outside + (plate ?? 0);
  const half = (theta * DEG) / 2;
  const bearing = stated(Sym.SADDLE_BEARING_PLATE_THICKNESS, 'Saddle bearing plate thickness', 12);
  const outer = contact + bearing;
  const height = stated(Sym.SADDLE_HEIGHT, 'Saddle height', contact - outside + Math.max(150, 0.25 * outside));
  const basePlate = stated(Sym.SADDLE_BASE_PLATE_THICKNESS, 'Saddle base plate thickness', 16);
  const web = stated(Sym.SADDLE_WEB_THICKNESS, 'Saddle web thickness', 12);
  const rib = stated(Sym.SADDLE_RIB_THICKNESS, 'Saddle rib thickness', 12);
  const horn = outer * Math.sin(half);
  const ribCount = Math.round(stated(Sym.SADDLE_RIB_COUNT, 'Saddle rib count', 2 + Math.floor((2 * horn) / 600)));

  // x runs from the axis out through the saddle: its base is the far side of the bottom of the shell.
  const base = outside + height;
  const baseTop = base - basePlate;
  if (baseTop <= outer) {
    throw new BuildError(
      component,
      `is ${mm(height)} high, which leaves no web under its ${mm(bearing)} bearing plate`,
      scope('out_of_scope', Sym.SADDLE_HEIGHT, `> ${mm(outer - outside + basePlate)}, the bearing and base plates`, mm(height))
    );
  }
  if (ribCount < 2 || web >= width || rib * ribCount >= 2 * horn) {
    throw new BuildError(
      component,
      `has ${ribCount} ribs of ${mm(rib)} and a ${mm(web)} web on a saddle ${mm(width)} wide and ${mm(2 * horn)} across`,
      scope('out_of_scope', 'ribs and web', `≥ 2 ribs, all fitting the ${mm(2 * horn)} chord; a web thinner than ${mm(width)}`, `${ribCount} × ${mm(rib)}, web ${mm(web)}`)
    );
  }

  const solids: Solid[] = [];
  const [hx, hy] = polar(outer, half);
  const [cx, cy] = polar(contact, half);
  // The bearing plate, on the shell's circle.
  solids.push(
    kernel.extrude(
      {
        start: [cx, -cy],
        steps: [
          { kind: 'line', to: [hx, -hy] },
          { kind: 'arc', to: [hx, hy], through: [outer, 0] },
          { kind: 'line', to: [cx, cy] },
          { kind: 'arc', to: [cx, -cy], through: [contact, 0] },
        ],
      },
      z - width / 2,
      z + width / 2
    )
  );
  // The base plate, the chord's width across.
  solids.push(kernel.extrude(rectangle(baseTop, base, -horn, horn), z - width / 2, z + width / 2));
  // The web, from the bearing plate down to the base plate, across the vessel.
  solids.push(
    kernel.extrude(
      {
        start: [hx, -hy],
        steps: [
          { kind: 'arc', to: [hx, hy], through: [outer, 0] },
          { kind: 'line', to: [baseTop, hy] },
          { kind: 'line', to: [baseTop, -hy] },
        ],
      },
      z - web / 2,
      z + web / 2
    )
  );
  // The ribs, each in two halves either side of the web, its top on the bearing plate's circle.
  const onCircle = (y: number): [number, number] => [Math.sqrt(outer * outer - y * y), y];
  for (let k = 0; k < ribCount; k++) {
    const y = -(horn - rib / 2) + (k * 2 * (horn - rib / 2)) / (ribCount - 1);
    const outline = {
      start: onCircle(y - rib / 2),
      steps: [
        { kind: 'arc' as const, to: onCircle(y + rib / 2), through: onCircle(y) },
        { kind: 'line' as const, to: [baseTop, y + rib / 2] as [number, number] },
        { kind: 'line' as const, to: [baseTop, y - rib / 2] as [number, number] },
      ],
    };
    solids.push(kernel.extrude(outline, z - width / 2, z - web / 2), kernel.extrude(outline, z + web / 2, z + width / 2));
  }

  if (plate !== undefined) {
    const halfPlate = half * (13 / 12);
    const [ix, iy] = polar(outside, halfPlate);
    const [ox, oy] = polar(outside + plate, halfPlate);
    solids.push(
      kernel.extrude(
        {
          start: [ix, -iy],
          steps: [
            { kind: 'line', to: [ox, -oy] },
            { kind: 'arc', to: [ox, oy], through: [outside + plate, 0] },
            { kind: 'line', to: [ix, iy] },
            { kind: 'arc', to: [ix, -iy], through: [outside, 0] },
          ],
        },
        z - plateWidth / 2,
        z + plateWidth / 2
      )
    );
  }

  return {
    solids: solids.map((solid) => kernel.rotateZ(solid, placement.azimuth)),
    footprint: plateWidth / 2,
    attachment: {
      axial: plateWidth,
      circumferentialDeg: plate === undefined ? theta : (theta * 13) / 12,
      thickness: plate ?? width,
    },
    notes,
  };
};

/** An annulus of the meridian half-plane, from `r0` to `r1` and `z0` to `z1`, revolved. */
function annulus(kernel: GeometryKernel, r0: number, r1: number, z0: number, z1: number): Solid {
  return kernel.revolve({
    start: [r0, z0],
    steps: [
      { kind: 'line', to: [r1, z0] },
      { kind: 'line', to: [r1, z1] },
      { kind: 'line', to: [r0, z1] },
    ],
  });
}

/**
 * A skirt — §4.15.4: a cylinder hanging from the course, from its placement downwards; or,
 * hosted on a head, welded to the head's knuckle. EN 13445-3 §16.12 names the three ways a skirt
 * meets its vessel: through a support ring welded to the shell (Geometry A, Figure 16.12-1, drawn
 * when `skirt_ring_height` is stated), on the knuckle (B, the head-hosted skirt) and lapped over
 * the shell (C, Figure 16.12-3, a course-hosted skirt whose bore is the course's outside). Its base
 * (§16.12.5.4) and its access openings (§16.12.4) are drawn when stated, on any of the three.
 */
export const skirtSupport: MountedBuilder = (component, context) => {
  if (context.hostSurface.anchor === 'head_crown') return skirtOnHead(component, context);
  if (context.hostSurface.seat) return skirtOnSeat(component, context, context.hostSurface.seat);
  const { kernel, placement } = context;
  const course = cylinderOf(component, context, 'a skirt');
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const length = requireDimension(component, Sym.COURSE_LENGTH);
  const ringHeight = optionalDimension(component, Sym.SKIRT_RING_HEIGHT);
  requireWithinHost(component, context, 0);

  const top = placement.axialOffset;
  const a = diameter / 2;
  const outer = a + thickness;
  const shell = course.outsideRadiusAt(top);
  const notes: Note[] = [];
  const solids: Solid[] = [];
  let skirtTop = top;
  let attachment = { axial: thickness, circumferentialDeg: 360, thickness };
  if (ringHeight !== undefined) {
    if (a <= shell) {
      throw new BuildError(
        component,
        `hangs from a support ring and so stands off the shell, but its ${mm(diameter)} bore does not clear the ${mm(2 * shell)} course`,
        scope('out_of_scope', Sym.INSIDE_DIAMETER, `> ${mm(2 * shell)}, the course's outside (EN 13445-3 Figure 16.12-1)`, mm(diameter))
      );
    }
    const [low] = context.hostSurface.offsetRange;
    if (top - ringHeight < low) {
      throw new BuildError(
        component,
        `has a ${mm(ringHeight)} support ring placed ${mm(top - low)} up its course`,
        scope('out_of_scope', Sym.SKIRT_RING_HEIGHT, `≤ ${mm(top - low)}, the course below the placement`, mm(ringHeight))
      );
    }
    solids.push(annulus(kernel, shell, outer, top - ringHeight, top));
    skirtTop = top - ringHeight;
    attachment = { axial: ringHeight, circumferentialDeg: 360, thickness: outer - shell };
    notes.push(
      representedNote(
        'Geometry A (EN 13445-3 Figure 16.12-1): the support ring is drawn as a plain rectangle welded to the shell over its height, the skirt standing under it; the downstand the figure forges for the skirt\'s butt weld is not drawn',
        'support ring section',
        'Figure 16.12-1',
        `a rectangle ${mm(ringHeight)} by ${mm(outer - shell)}`,
        true
      )
    );
  } else if (Math.abs(a - shell) <= 1) {
    notes.push(
      representedNote(
        'Geometry C (EN 13445-3 Figure 16.12-3): lapped over the course from its placement downwards; the fillet weld at its top is not drawn',
        'lap weld',
        "a fillet at the skirt's top",
        'the skirt touching the course',
        true
      )
    );
  } else {
    notes.push(
      representedNote(
        'Drawn from its placement on the course downwards, not welded to a knuckle',
        'skirt top',
        'cut to the surface it is welded to',
        'square, from its placement downwards'
      )
    );
  }

  const end = skirtTop - length;
  const skirt = skirtOpenings(component, kernel, annulus(kernel, a, outer, end, skirtTop), outer, end, -1, length, placement.azimuth, notes);
  return {
    solids: [skirt, ...solids, ...skirtBase(component, kernel, a, outer, end, -1, notes)],
    footprint: 0,
    standsAt: standsAt(component, end, -1),
    attachment,
    notes,
  };
};

/**
 * A skirt's access openings — EN 13445-3 §16.12.4, Figures 16.12-5 and -6: one, or two facing
 * each other, `skirt_opening_elevation` up from the skirt's free end. `away` is the direction
 * along z that leads off the skirt's end, away from the vessel.
 */
function skirtOpenings(
  component: ComponentDefinition,
  kernel: GeometryKernel,
  skirt: Solid,
  outer: number,
  end: number,
  away: 1 | -1,
  length: number,
  azimuth: number,
  notes: Note[]
): Solid {
  const diameter = optionalDimension(component, Sym.SKIRT_OPENING_DIAMETER);
  if (diameter === undefined) return skirt;
  const elevation = requireDimension(component, Sym.SKIRT_OPENING_ELEVATION);
  const stated = signedDimension(component, Sym.SKIRT_OPENING_COUNT);
  if (stated === undefined) notes.push(assumedNote('Opening count not stated — drawn as one', Sym.SKIRT_OPENING_COUNT, '1'));
  else if (stated !== 1 && stated !== 2) {
    throw new BuildError(component, `has ${stated} access openings`, scope('out_of_scope', Sym.SKIRT_OPENING_COUNT, '1, or 2 facing each other (Figures 16.12-5 and -6)', `${stated}`));
  }
  if (elevation - diameter / 2 <= 0 || elevation + diameter / 2 >= length) {
    throw new BuildError(
      component,
      `has a ${mm(diameter)} opening ${mm(elevation)} up a ${mm(length)} skirt`,
      scope('out_of_scope', Sym.SKIRT_OPENING_ELEVATION, `between ${mm(diameter / 2)} and ${mm(length - diameter / 2)}, the opening within the skirt`, mm(elevation))
    );
  }
  const phi = azimuth * DEG;
  const reach = outer + 10;
  const tool = kernel.tube(
    { origin: [0, 0, end - away * elevation], axis: [Math.cos(phi), Math.sin(phi), 0] },
    0,
    diameter / 2,
    (stated ?? 1) === 2 ? -reach : 0,
    reach
  );
  notes.push(
    representedNote(
      'The access openings are drawn as plain holes: a frame or sleeve round them is not drawn',
      'opening reinforcement',
      'a frame or sleeve, if any',
      'none',
      true
    )
  );
  return kernel.cut(skirt, [tool]);
}

/**
 * A skirt's base — EN 13445-3 §16.12.5.4, Figures 16.12-7 to 16.12-10, in the Code's letters: a base
 * plate `b_1` wide reaching `b_2` past the skirt, `e_4` thick, drilled for `n_B` anchor bolts `d_B0`
 * on a circle `b_3` out from the skirt; then, by type, gussets `h_1` high and `e_7` thick (2), chairs
 * — two support plates `b_6` apart under a top plate `b_4` by `b_5` by `e_5` — at each bolt (3), or a
 * continuous top ring `b_5` by `e_5` on support plates (4). Types 2 and 4 put one plate midway
 * between bolts when `b_6` is not stated (Version A) and a pair flanking each bolt when it is (B).
 * `away` leads off the skirt's free end `end` into the foundation; the plate lies beyond it.
 */
/**
 * Where a skirt stands, along its host's axis: the underside of its base plate when one is
 * drawn, its free end otherwise — the plane a fixed support is applied on.
 */
function standsAt(component: ComponentDefinition, end: number, away: 1 | -1): number {
  if (signedDimension(component, Sym.SKIRT_BASE_TYPE) === undefined) return end;
  return end + away * (optionalDimension(component, Sym.BASE_PLATE_THICKNESS) ?? 0);
}

function skirtBase(
  component: ComponentDefinition,
  kernel: GeometryKernel,
  inner: number,
  outer: number,
  end: number,
  away: 1 | -1,
  notes: Note[]
): Solid[] {
  const type = signedDimension(component, Sym.SKIRT_BASE_TYPE);
  if (type === undefined) return [];
  if (type !== 1 && type !== 2 && type !== 3 && type !== 4) {
    throw new BuildError(component, `has a base of type ${type}`, scope('out_of_scope', Sym.SKIRT_BASE_TYPE, '1, 2, 3 or 4 (EN 13445-3 16.12.5.4.1)', `${type}`));
  }
  const width = requireDimension(component, Sym.BASE_PLATE_WIDTH);
  const projection = requireDimension(component, Sym.BASE_PLATE_PROJECTION);
  const plateThickness = requireDimension(component, Sym.BASE_PLATE_THICKNESS);
  const bolts = requireDimension(component, Sym.ANCHOR_BOLT_COUNT);
  const bolt = requireDimension(component, Sym.ANCHOR_BOLT_DIAMETER);
  const offset = requireDimension(component, Sym.ANCHOR_BOLT_OFFSET);
  if (!Number.isInteger(bolts) || bolts < 2) {
    throw new BuildError(component, `has ${bolts} anchor bolts`, scope('out_of_scope', Sym.ANCHOR_BOLT_COUNT, 'a whole number, at least 2', `${bolts}`));
  }
  const plateOuter = outer + projection;
  const plateInner = plateOuter - width;
  if (plateInner > inner) {
    throw new BuildError(
      component,
      `has a ${mm(width)} base plate that does not reach under the skirt's wall`,
      scope('out_of_scope', Sym.BASE_PLATE_WIDTH, `≥ ${mm(projection + outer - inner)}, b_2 and the skirt's wall`, mm(width))
    );
  }
  if (offset - bolt / 2 <= 0 || offset + bolt / 2 >= projection) {
    throw new BuildError(
      component,
      `puts ${mm(bolt)} bolts ${mm(offset)} out on a plate reaching ${mm(projection)}`,
      scope('out_of_scope', Sym.ANCHOR_BOLT_OFFSET, `between ${mm(bolt / 2)} and ${mm(projection - bolt / 2)}: the hole on the plate, clear of the skirt`, mm(offset))
    );
  }

  // u runs back from the skirt's free end towards the vessel; the plate lies at u from −e_4 to 0.
  const back = (u: number) => end - away * u;
  const span = (u0: number, u1: number): [number, number] => [Math.min(back(u0), back(u1)), Math.max(back(u0), back(u1))];
  const circle = outer + offset;
  const boltAngles = Array.from({ length: bolts }, (_, k) => ((k + 0.5) * 360) / bolts);
  const holes = ([z0, z1]: readonly [number, number]) =>
    boltAngles.map((angle) =>
      kernel.tube({ origin: [circle * Math.cos(angle * DEG), circle * Math.sin(angle * DEG), 0], axis: [0, 0, 1] }, 0, bolt / 2, z0 - 1, z1 + 1)
    );
  const plateRange = span(-plateThickness, 0);
  const solids: Solid[] = [kernel.cut(annulus(kernel, plateInner, plateOuter, ...plateRange), holes(plateRange))];
  notes.push(
    representedNote(
      `Anchor bolt holes drawn at the bolts' nominal diameter, ⌀${mm(bolt)}; the clearance and the bolts are not drawn`,
      'anchor bolt holes',
      'a clearance hole for d_B0',
      `⌀${mm(bolt)}`,
      true
    )
  );
  if (type === 1) return solids;

  const height = requireDimension(component, Sym.BASE_GUSSET_HEIGHT);
  const plate = requireDimension(component, Sym.BASE_GUSSET_THICKNESS);
  const spacing = type === 3 ? requireDimension(component, Sym.BASE_GUSSET_SPACING) : optionalDimension(component, Sym.BASE_GUSSET_SPACING);
  if (spacing !== undefined && spacing - plate <= bolt) {
    throw new BuildError(
      component,
      `flanks its ${mm(bolt)} bolts with plates ${mm(spacing)} apart`,
      scope('out_of_scope', Sym.BASE_GUSSET_SPACING, `> ${mm(bolt + plate)}, d_B0 and e_7`, mm(spacing))
    );
  }
  const half = spacing === undefined ? 0 : (spacing / 2 / circle) * (180 / Math.PI);
  const plateAngles =
    spacing === undefined ? boltAngles.map((angle) => angle - 180 / bolts) : boltAngles.flatMap((angle) => [angle - half, angle + half]);
  const radialOutline = (points: readonly Point2[]): Profile => ({
    start: points[0],
    steps: points.slice(1).map((to) => ({ kind: 'line' as const, to })),
  });

  if (type === 2) {
    // A triangle with a short square edge at the plate's rim, as Figure 16.12-8 draws it.
    const gusset = radialOutline([
      [outer, back(0)],
      [plateOuter, back(0)],
      [plateOuter, back(0.25 * height)],
      [outer, back(height)],
    ]);
    solids.push(...plateAngles.map((angle) => radialPlate(kernel, gusset, plateOuter, span(0, height), plate, angle)));
    return solids;
  }

  const topWidth = requireDimension(component, Sym.TOP_PLATE_WIDTH);
  const topThickness = requireDimension(component, Sym.TOP_PLATE_THICKNESS);
  const standing = height - plateThickness - topThickness;
  if (standing <= 0) {
    throw new BuildError(
      component,
      `is ${mm(height)} high, which leaves no support plate between its ${mm(plateThickness)} and ${mm(topThickness)} plates`,
      scope('out_of_scope', Sym.BASE_GUSSET_HEIGHT, `> e_4 + e_5 = ${mm(plateThickness + topThickness)}`, mm(height))
    );
  }
  if (topWidth < offset + bolt / 2) {
    throw new BuildError(
      component,
      `has a top plate reaching ${mm(topWidth)}, short of its bolts at ${mm(offset)}`,
      scope('out_of_scope', Sym.TOP_PLATE_WIDTH, `≥ b_3 + d_B0/2 = ${mm(offset + bolt / 2)}`, mm(topWidth))
    );
  }
  const support = radialOutline([
    [outer, back(0)],
    [outer + topWidth, back(0)],
    [outer + topWidth, back(standing)],
    [outer, back(standing)],
  ]);
  solids.push(...plateAngles.map((angle) => radialPlate(kernel, support, outer + topWidth, span(0, standing), plate, angle)));
  const topRange = span(standing, standing + topThickness);
  if (type === 4) {
    solids.push(kernel.cut(annulus(kernel, outer, outer + topWidth, ...topRange), holes(topRange)));
    return solids;
  }

  const length = requireDimension(component, Sym.TOP_PLATE_LENGTH);
  if (length <= spacing! + plate) {
    throw new BuildError(
      component,
      `has a ${mm(length)} top plate over support plates ${mm(spacing!)} apart`,
      scope('out_of_scope', Sym.TOP_PLATE_LENGTH, `> b_6 + e_7 = ${mm(spacing! + plate)}`, mm(length))
    );
  }
  // Each chair's top plate, flat, cut to the skirt's outside where it meets it.
  const skirtCore = kernel.tube({ origin: [0, 0, 0], axis: [0, 0, 1] }, 0, outer, topRange[0] - 1, topRange[1] + 1);
  for (const angle of boltAngles) {
    const block = kernel.extrude(rectangle(Math.max(0, outer - length), outer + topWidth, -length / 2, length / 2), ...topRange);
    const hole = kernel.tube({ origin: [circle, 0, 0], axis: [0, 0, 1] }, 0, bolt / 2, topRange[0] - 1, topRange[1] + 1);
    solids.push(kernel.rotateZ(kernel.cut(block, [skirtCore, hole]), angle));
  }
  return solids;
}

/**
 * A skirt butt-welded to the end of a leg its host offers — a forged transition ring's outer leg,
 * flush with the shell's outside. Where it stands is the leg's end, not a placement, so the
 * placement's offset is not read. The skirt must be flush with the leg's outside; a wall thinner
 * or thicker than the leg's is drawn as stated and the joint reports the step.
 */
function skirtOnSeat(component: ComponentDefinition, context: MountedContext, seat: Seat): MountedPart {
  const { kernel, host } = context;
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const length = requireDimension(component, Sym.COURSE_LENGTH);
  const inner = diameter / 2;
  const outer = inner + thickness;
  if (Math.abs(outer - seat.outsideRadius) > 1) {
    throw new BuildError(
      component,
      `is ${mm(2 * outer)} outside where the leg of ${host.name} it butts on is ${mm(2 * seat.outsideRadius)}`,
      scope('out_of_scope', 'skirt outside diameter', `${mm(2 * seat.outsideRadius)}, flush with the leg (±1 mm)`, mm(2 * outer))
    );
  }
  if (inner >= seat.outsideRadius) {
    throw new BuildError(component, 'has no wall on the leg it butts on', scope('out_of_scope', Sym.THICKNESS, '> 0 on the leg', mm(thickness)));
  }

  const notes: Note[] = [];
  const end = seat.z - length;
  const skirt = skirtOpenings(component, kernel, annulus(kernel, inner, outer, end, seat.z), outer, end, -1, length, context.placement.azimuth, notes);
  return {
    solids: [skirt, ...skirtBase(component, kernel, inner, outer, end, -1, notes)],
    footprint: 0,
    standsAt: standsAt(component, end, -1),
    butt: {
      z: seat.z,
      insideRadius: inner,
      outsideRadius: outer,
      wall: { surface: cylinderSurface(inner + thickness / 2), thickness, meridian: [0, 1] },
    },
    anchorOffset: seat.z,
    notes,
  };
}

/**
 * A skirt welded to a head's knuckle, the usual way a tall column stands: where it meets the head
 * is not a placement but the skirt's own diameter — the circle on which the head's outside
 * reaches the skirt's mid-wall — so the placement's offset is not read. The skirt's top is cut
 * to the head's outside surface, so the two meet on the same surface and a mesher can join them;
 * the skirt runs its length from that circle, away from the vessel.
 */
function skirtOnHead(component: ComponentDefinition, context: MountedContext): MountedPart {
  const { kernel, hostSurface, host } = context;
  const diameter = requireDimension(component, Sym.INSIDE_DIAMETER);
  const thickness = requireDimension(component, Sym.THICKNESS);
  const length = requireDimension(component, Sym.COURSE_LENGTH);
  if (!context.hostSolid) {
    throw new NotDrawnError(
      component,
      `${host.name} offers no surface to cut the skirt to`,
      scope('out_of_scope', 'host', 'a drawn head', `${host.name}, no solid`)
    );
  }

  const inner = diameter / 2;
  const outer = inner + thickness;
  const middle = inner + thickness / 2;
  const [, reach] = hostSurface.offsetRange;
  // Past the head's inside radius the outside surface falls to the tangent line and below.
  const headOutside = hostSurface.frameAt(reach, 0);
  const headOutsideRadius = reach + hostSurface.wallAt(reach).thickness;
  if (outer >= headOutsideRadius) {
    throw new NotDrawnError(
      component,
      `as wide as ${host.name} or wider, the skirt meets its shell rather than its knuckle — host it on the course`,
      scope('out_of_scope', 'skirt outside radius', `< ${mm(headOutsideRadius)}, the outside radius of ${host.name}`, mm(outer))
    );
  }
  if (inner <= 0) throw new BuildError(component, 'has no inside radius', scope('out_of_scope', Sym.INSIDE_DIAMETER, '> 0', mm(diameter)));

  // The head's outside surface is stated out to its own outside radius, past the inside one.
  const weld = hostSurface.frameAt(middle, 0).origin[2];
  const lowest = Math.min(headOutside.origin[2], hostSurface.frameAt(outer, 0).origin[2]) - 1;
  const tube = kernel.tube({ origin: [0, 0, 0], axis: [0, 0, 1] }, inner, outer, lowest, weld + length);
  // In the head's frame the skirt runs up, away from the vessel, to its free end.
  const notes: Note[] = [];
  const skirt = skirtOpenings(
    component,
    kernel,
    kernel.cut(tube, [context.hostSolid, hostSurface.cavity()]),
    outer,
    weld + length,
    1,
    length,
    context.placement.azimuth,
    notes
  );
  return {
    solids: [skirt, ...skirtBase(component, kernel, inner, outer, weld + length, 1, notes)],
    footprint: 0,
    standsAt: standsAt(component, weld + length, 1),
    attachment: { axial: thickness, circumferentialDeg: 360, thickness },
    anchorOffset: middle,
    notes,
  };
}

/**
 * A lug — §4.15.5: two gussets on a base plate. No rule reads its dimensions, so the
 * `SUPPORT_LUG_*` symbols exist for the drawing alone; what is not stated is drawn to
 * proportions of the course, and said.
 */
export const lugSupport: MountedBuilder = (component, context) => {
  const { kernel, placement } = context;
  const course = cylinderOf(component, context, 'a lug');
  const z = placement.axialOffset;
  const outside = course.outsideRadiusAt(z);
  const notes: Note[] = [];
  const stated = (symbol: string, label: string, assumed: number): number => {
    const value = optionalDimension(component, symbol);
    if (value !== undefined) return value;
    notes.push(assumedNote(`${label} not stated — drawn ${mm(assumed)}`, symbol, mm(assumed)));
    return assumed;
  };

  const reach = stated(Sym.SUPPORT_LUG_PROJECTION, 'Lug projection', Math.min(400, Math.max(100, 0.24 * outside)));
  const height = stated(Sym.SUPPORT_LUG_HEIGHT, 'Lug height', 1.5 * reach);
  const gap = stated(Sym.SUPPORT_LUG_GUSSET_SPACING, 'Gusset spacing', 0.6 * reach);
  const assumedPlate = Math.min(30, Math.max(10, 0.024 * outside));
  const plate = stated(Sym.SUPPORT_LUG_GUSSET_THICKNESS, 'Gusset thickness', assumedPlate);
  const base = stated(Sym.SUPPORT_LUG_BASE_PLATE_THICKNESS, 'Base plate thickness', assumedPlate);
  if (gap <= plate) {
    throw new BuildError(
      component,
      `has gussets ${mm(plate)} thick only ${mm(gap)} apart`,
      scope('out_of_scope', Sym.SUPPORT_LUG_GUSSET_SPACING, `> ${mm(plate)}, the gusset thickness`, mm(gap))
    );
  }
  requireWithinHost(component, context, height / 2 + base);

  // Each plate's inner face IS the shell's outside surface. Drawn flat 1 mm inside it, a plate overlapped the
  // shell in a lens along its middle (959 mm3 on the reference lug) and stood off it at its edges, where the
  // surface had already fallen below the flat (1.7 mm at the gussets' outer faces): started below the surface
  // across the plates' whole width and cut by it, a plate bears on the shell and nowhere enters it.
  const half = gap / 2 + plate / 2;
  const inner = Math.sqrt(Math.max(outside * outside - half * half, 0)) - 1;
  const shell = kernel.revolve({
    start: [0, z - height / 2 - base - 1],
    steps: [
      { kind: 'line', to: [outside, z - height / 2 - base - 1] },
      { kind: 'line', to: [outside, z + height / 2 + 1] },
      { kind: 'line', to: [0, z + height / 2 + 1] },
    ],
  });
  const solids = [
    kernel.extrude(rectangle(inner, outside + reach, gap / 2 - plate / 2, gap / 2 + plate / 2), z - height / 2, z + height / 2),
    kernel.extrude(rectangle(inner, outside + reach, -gap / 2 - plate / 2, -gap / 2 + plate / 2), z - height / 2, z + height / 2),
    kernel.extrude(rectangle(inner, outside + reach, -half, half), z - height / 2 - base, z - height / 2),
  ].map((solid) => kernel.cut(solid, [shell]));
  return {
    solids: solids.map((solid) => kernel.rotateZ(solid, placement.azimuth)),
    footprint: height / 2 + base,
    attachment: {
      axial: height + base,
      circumferentialDeg: ((gap + plate) / outside) * (180 / Math.PI),
      thickness: plate,
    },
    notes,
  };
};

/**
 * A leg — §4.15.5: a pipe column welded along the side of a course and carried down past it to
 * its base plate on the foundation. One component per leg, placed by azimuth like a lug. The
 * placement's offset is the middle of the weld, so where the leg is attached — the station
 * §4.15.5.5 measures its 1.8·√(D·t) from — is the placement itself, and the layout measures it.
 * It may run past the course's lower end: only its weld has to stay on its host.
 */
export const legSupport: MountedBuilder = (component, context) => {
  if (context.hostSurface.anchor === 'head_crown') return legOnHead(component, context);
  const { kernel, placement } = context;
  const course = cylinderOf(component, context, 'a leg');
  const diameter = requireDimension(component, Sym.LEG_OUTSIDE_DIAMETER);
  const wall = requireDimension(component, Sym.LEG_THICKNESS);
  const length = requireDimension(component, Sym.LEG_LENGTH);
  const weld = requireDimension(component, Sym.LEG_ATTACHMENT_LENGTH);
  if (wall >= diameter / 2) {
    throw new BuildError(component, `has a wall of ${mm(wall)} on a ${mm(diameter)} pipe`, scope('out_of_scope', Sym.LEG_THICKNESS, `< ${mm(diameter / 2)}`, mm(wall)));
  }
  if (weld > length) {
    throw new BuildError(component, `is welded over ${mm(weld)} of a ${mm(length)} leg`, scope('out_of_scope', Sym.LEG_ATTACHMENT_LENGTH, `≤ ${mm(length)}, the leg`, mm(weld)));
  }
  requireWithinHost(component, context, weld / 2);
  const notes: Note[] = [];
  const statedBase = optionalDimension(component, Sym.SUPPORT_LUG_BASE_PLATE_THICKNESS);
  const base = statedBase ?? Math.max(12, 2 * wall);
  if (statedBase === undefined) notes.push(assumedNote(`Base plate thickness not stated — drawn ${mm(base)}`, Sym.SUPPORT_LUG_BASE_PLATE_THICKNESS, mm(base)));

  const z = placement.axialOffset;
  const outside = course.outsideRadiusAt(z);
  // Standing against the shell, touching it along one generatrix.
  const axis = outside + diameter / 2;
  const top = z + weld / 2;
  const bottom = top - length;
  const half = 0.75 * diameter;
  const solids = [
    kernel.tube({ origin: [axis, 0, 0], axis: [0, 0, 1] }, diameter / 2 - wall, diameter / 2, bottom, top),
    kernel.extrude(rectangle(axis - half, axis + half, -half, half), bottom - base, bottom),
  ];
  notes.push(
    representedNote(
      'A pipe leg touches the shell along one line; the weld either side of it is not drawn, and the attachment is taken a pipe diameter wide',
      'leg to shell weld',
      'two fillets along the line of contact',
      `a patch ${mm(weld)} by ${mm(diameter)}`,
      true
    )
  );
  return {
    solids: solids.map((solid) => kernel.rotateZ(solid, placement.azimuth)),
    footprint: weld / 2,
    attachment: { axial: weld, circumferentialDeg: (diameter / outside) * (180 / Math.PI), thickness: wall },
    notes,
  };
};

/**
 * A linear support member — RCC-M H3232 / Annexe ZVI: a strut, tie, column or beam holding a
 * vessel up, mounted on the part it carries. The engine checks it on its section's PROPERTIES
 * (A, r_x, r_y, Z_x, Z_y), never a shape, so the drawing is what A and l fix and no more: a square
 * bar of side √A, `member_length` long. A stated `member_profile` other than 0 is noted as not
 * built rather than invented from radii of gyration. On a course it touches the shell along one
 * generatrix, its top at the placement, hanging down and swung OUTWARD by `member_inclination`
 * in the plane of its azimuth; on a head it stands parallel to the axis, cut to the head's surface
 * as a leg on a head is, and an inclination there is not built.
 */
export const linearSupportMember: MountedBuilder = (component, context) => {
  const { kernel, placement, hostSurface } = context;
  const area = requireDimension(component, Sym.MEMBER_AREA);
  const length = requireDimension(component, Sym.MEMBER_LENGTH);
  const side = Math.sqrt(area);
  const notes: Note[] = [];
  const profile = signedDimension(component, Sym.MEMBER_PROFILE) ?? 0;
  if (![0, 1, 2, 3].includes(profile)) {
    throw new BuildError(component, `states profile ${profile}`, scope('out_of_scope', Sym.MEMBER_PROFILE, '0 square, 1 I/H, 2 tube, 3 angle', `${profile}`));
  }
  if (profile !== 0) {
    notes.push(
      note(
        `Profile ${['square', 'I or H', 'tube', 'angle'][profile]} not drawn — a square bar of side √A = ${mm(side)} stands for it; the engine reads A and r, not the shape`,
        Sym.MEMBER_PROFILE,
        scope('not_built', Sym.MEMBER_PROFILE, '0, a square of side √A', `${profile}`)
      )
    );
  }
  const inclination = signedDimension(component, Sym.MEMBER_INCLINATION) ?? 0;
  if (!(inclination >= 0 && inclination < 80)) {
    throw new BuildError(component, `leans ${inclination}° from vertical`, scope('out_of_scope', Sym.MEMBER_INCLINATION, '0° to 80°', `${inclination}°`));
  }
  if (!(length > 0)) {
    throw new BuildError(component, `is ${mm(length)} long`, scope('out_of_scope', Sym.MEMBER_LENGTH, '> 0', mm(length)));
  }

  if (hostSurface.anchor === 'head_crown') {
    if (!context.hostSolid) {
      throw new NotDrawnError(component, `${context.host.name} offers no surface to cut the member to`, scope('out_of_scope', 'host', 'a drawn head', `${context.host.name}, no solid`));
    }
    if (inclination > 0) {
      notes.push(note('Inclination on a head not drawn — the member stands parallel to the axis', Sym.MEMBER_INCLINATION, scope('not_built', Sym.MEMBER_INCLINATION, '0° on a head', `${inclination}°`)));
    }
    requireWithinHost(component, context, side / 2);
    const rho = placement.axialOffset;
    const weld = hostSurface.frameAt(rho, 0).origin[2];
    const reach = Math.min(rho + side, hostSurface.offsetRange[1]);
    const lowest = Math.min(weld, hostSurface.frameAt(reach, 0).origin[2]) - 1;
    const bar = kernel.extrude(rectangle(rho - side / 2, rho + side / 2, -side / 2, side / 2), lowest, weld + length);
    return {
      solids: [kernel.rotateZ(kernel.cut(bar, [context.hostSolid, hostSurface.cavity()]), placement.azimuth)],
      footprint: side / 2,
      attachment: { axial: side, circumferentialDeg: rho > side / 2 ? Math.min(360, (side / rho) * (180 / Math.PI)) : 360, thickness: side },
      notes,
    };
  }

  const course = cylinderOf(component, context, 'a linear support member');
  requireWithinHost(component, context, side / 2);
  const z = placement.axialOffset;
  const outside = course.outsideRadiusAt(z);
  const upright = kernel.extrude(rectangle(outside, outside + side, -side / 2, side / 2), z - length, z);
  // Swung about its top inner edge, the line where it meets the shell, so it stays attached there.
  const bar = inclination > 0 ? kernel.rotate(upright, -inclination, [0, 1, 0], [outside, 0, z]) : upright;
  notes.push(
    representedNote(
      'A square bar touches the shell along one line at its top; the attachment detail is not drawn',
      'member to vessel attachment',
      'a weld, a clevis or a bolted bracket',
      `a patch ${mm(side)} square`,
      true
    )
  );
  return {
    solids: [kernel.rotateZ(bar, placement.azimuth)],
    footprint: side / 2,
    attachment: { axial: side, circumferentialDeg: (side / outside) * (180 / Math.PI), thickness: side },
    notes,
  };
};

/**
 * A leg under a dished head — CODAP C9.5, the vertical vessel standing on its bottom head rather
 * than on its shell. The pipe stands parallel to the axis at the placement's distance from it,
 * its top cut to the head's outside surface as a skirt on a head is, so the two meet on one
 * surface; C9.5.2.2 wants a circular section, which a pipe is. `leg_length` runs from where it
 * meets the head at its axis to the underside of its base plate; it is welded round its end, so
 * `leg_attachment_length` means nothing here and is not read.
 */
function legOnHead(component: ComponentDefinition, context: MountedContext): MountedPart {
  const { kernel, hostSurface, host, placement } = context;
  const diameter = requireDimension(component, Sym.LEG_OUTSIDE_DIAMETER);
  const wall = requireDimension(component, Sym.LEG_THICKNESS);
  const length = requireDimension(component, Sym.LEG_LENGTH);
  if (wall >= diameter / 2) {
    throw new BuildError(component, `has a wall of ${mm(wall)} on a ${mm(diameter)} pipe`, scope('out_of_scope', Sym.LEG_THICKNESS, `< ${mm(diameter / 2)}`, mm(wall)));
  }
  if (!context.hostSolid) {
    throw new NotDrawnError(component, `${host.name} offers no surface to cut the leg to`, scope('out_of_scope', 'host', 'a drawn head', `${host.name}, no solid`));
  }
  requireWithinHost(component, context, diameter / 2);
  const notes: Note[] = [];
  const statedBase = optionalDimension(component, Sym.SUPPORT_LUG_BASE_PLATE_THICKNESS);
  const base = statedBase ?? Math.max(12, 2 * wall);
  if (statedBase === undefined) notes.push(assumedNote(`Base plate thickness not stated — drawn ${mm(base)}`, Sym.SUPPORT_LUG_BASE_PLATE_THICKNESS, mm(base)));

  const rho = placement.axialOffset;
  const weld = hostSurface.frameAt(rho, 0).origin[2];
  // The head's outside falls away from the axis, so the far side of the pipe meets it lowest.
  const lowest = Math.min(weld, hostSurface.frameAt(Math.min(rho + diameter / 2, hostSurface.offsetRange[1]), 0).origin[2]) - 1;
  const end = weld + length;
  const half = 0.75 * diameter;
  const pipe = kernel.tube({ origin: [rho, 0, 0], axis: [0, 0, 1] }, diameter / 2 - wall, diameter / 2, lowest, end);
  const solids = [
    kernel.cut(pipe, [context.hostSolid, hostSurface.cavity()]),
    kernel.extrude(rectangle(rho - half, rho + half, -half, half), end, end + base),
  ];
  return {
    solids: solids.map((solid) => kernel.rotateZ(solid, placement.azimuth)),
    footprint: diameter / 2,
    attachment: {
      axial: diameter,
      circumferentialDeg: rho > diameter / 2 ? Math.min(360, (diameter / rho) * (180 / Math.PI)) : 360,
      thickness: wall,
    },
    notes,
  };
}

/** The point where a line from `from` touches a circle, on the side `side` of the line to its centre. */
function tangentPoint(from: Point2, centre: Point2, radius: number, side: 1 | -1): Point2 {
  const dx = from[0] - centre[0];
  const dy = from[1] - centre[1];
  const distance = Math.hypot(dx, dy);
  const turn = side * Math.acos(radius / distance);
  const angle = Math.atan2(dy, dx) + turn;
  return [centre[0] + radius * Math.cos(angle), centre[1] + radius * Math.sin(angle)];
}

/**
 * A lifting lug — CODAP C9.6, Figure C9.6.2.4-1 and -2: a plate `b_1` long at the shell, its hole
 * `a_2` out from it and `a_1` along it, its sides running straight from the ends of `b_1` to touch
 * the metal round the hole, on a pad `b_3` by `b_2` when `pad_thickness` (the Code's `e_2`) is
 * stated. Its plane holds the vessel axis (orientation 0) or is square to it (90), the two cases
 * C9.6 sizes separately. On a cylindrical course: C9.6 also allows cones, spheres and the crowns of
 * heads, which are not drawn yet.
 *
 * Square to the axis, the plate is an outline extruded along it. Along the axis it lies in a plane
 * no extrusion reaches, so it is the outline REVOLVED and cut down to a slab `t` thick: in the
 * half-plane of the slab a revolved outline is the outline itself, and its base lands on the shell's
 * own circle.
 */
export const liftingLug: MountedBuilder = (component, context) => {
  const { kernel, placement } = context;
  const course = cylinderOf(component, context, 'a lifting lug');
  const b1 = requireDimension(component, Sym.LIFTING_LUG_BASE_LENGTH);
  const a2 = requireDimension(component, Sym.LIFTING_LUG_HOLE_HEIGHT);
  const hole = requireDimension(component, Sym.LIFTING_LUG_HOLE_DIAMETER);
  const t = requireDimension(component, Sym.LIFTING_LUG_THICKNESS);
  const a1 = signedDimension(component, Sym.LIFTING_LUG_HOLE_OFFSET) ?? 0;
  const notes: Note[] = [];
  const stated = (symbol: string, label: string, assumed: number): number => {
    const value = optionalDimension(component, symbol);
    if (value !== undefined) return value;
    notes.push(assumedNote(`${label} not stated — drawn ${mm(assumed)}`, symbol, mm(assumed)));
    return assumed;
  };
  const orientation = signedDimension(component, Sym.LIFTING_LUG_ORIENTATION);
  if (orientation === undefined) notes.push(assumedNote('Orientation not stated — drawn along the axis', Sym.LIFTING_LUG_ORIENTATION, '0°'));
  else if (orientation !== 0 && orientation !== 90) {
    throw new BuildError(
      component,
      `is turned ${orientation}° from the axis`,
      scope('out_of_scope', Sym.LIFTING_LUG_ORIENTATION, '0 (along the axis) or 90 (round it), the two C9.6 sizes', `${orientation}°`)
    );
  }
  const along = (orientation ?? 0) === 0;
  const radius = stated(Sym.LIFTING_LUG_TOP_RADIUS, 'Metal round the hole', hole);
  if (hole >= 2 * radius) {
    throw new BuildError(component, `has a ${mm(hole)} hole in ${mm(radius)} of metal round it`, scope('out_of_scope', Sym.LIFTING_LUG_HOLE_DIAMETER, `< ${mm(2 * radius)}`, mm(hole)));
  }
  if (a2 - hole / 2 <= 0) {
    throw new BuildError(component, `has its hole ${mm(a2)} out, under ${mm(hole / 2)} of its own radius`, scope('out_of_scope', Sym.LIFTING_LUG_HOLE_HEIGHT, `> ${mm(hole / 2)}`, mm(a2)));
  }
  const centre: Point2 = [a1, a2];
  const corners: [Point2, Point2] = [[b1 / 2, 0], [-b1 / 2, 0]];
  for (const corner of corners) {
    if (Math.hypot(corner[0] - centre[0], corner[1] - centre[1]) <= radius) {
      throw new BuildError(
        component,
        `has the end of its base inside the metal round its hole`,
        scope('out_of_scope', Sym.LIFTING_LUG_BASE_LENGTH, `ends further than ${mm(radius)} from the hole`, mm(b1))
      );
    }
  }

  const padThickness = optionalDimension(component, Sym.PAD_THICKNESS);
  const padLength = padThickness === undefined ? b1 : stated(Sym.LIFTING_LUG_PAD_LENGTH, 'Pad length b_3', 1.25 * b1);
  const padWidth = padThickness === undefined ? t : stated(Sym.LIFTING_LUG_PAD_WIDTH, 'Pad width b_2', Math.max(4 * t, 100));
  // Along the axis the base runs along it; round the axis, across it.
  const axial = along ? padLength : padWidth;
  requireWithinHost(component, context, axial / 2);

  const z = placement.axialOffset;
  const outside = course.outsideRadiusAt(z);
  const contact = outside + (padThickness ?? 0);
  // The outline in the lug's own plane: u along its base, v out from the shell. It reaches below
  // the shell's circle so that cutting it to that circle leaves no gap under the ends of `b_1`.
  const sag = contact - Math.sqrt(Math.max(0, contact * contact - (b1 / 2) ** 2)) + 1;
  const right = tangentPoint(corners[0], centre, radius, 1);
  const left = tangentPoint(corners[1], centre, radius, -1);
  const from = Math.atan2(right[1] - a2, right[0] - a1);
  let to = Math.atan2(left[1] - a2, left[0] - a1);
  if (to <= from) to += 2 * Math.PI;
  const middle = (from + to) / 2;
  const top: Point2 = [a1 + radius * Math.cos(middle), a2 + radius * Math.sin(middle)];
  type Uv = readonly [number, number];
  const outline = (map: (p: Uv) => Point2): Profile => ({
    start: map([-b1 / 2, -sag]),
    steps: [
      { kind: 'line', to: map([b1 / 2, -sag]) },
      { kind: 'line', to: map(corners[0]) },
      { kind: 'line', to: map(right) },
      { kind: 'arc', to: map(left), through: map(top) },
      { kind: 'line', to: map(corners[1]) },
    ],
  });
  const reach = a2 + radius;
  const shellCylinder = kernel.revolve({
    start: [0, z - axial - b1],
    steps: [
      { kind: 'line', to: [contact, z - axial - b1] },
      { kind: 'line', to: [contact, z + axial + b1] },
      { kind: 'line', to: [0, z + axial + b1] },
    ],
  });

  let plate: Solid;
  let pin: Solid;
  if (along) {
    // (u, v) → (r, z): u along the axis, v out from the shell.
    const revolved = kernel.revolve(outline(([u, v]) => [contact + v, z + u]));
    const slab = kernel.extrude(rectangle(contact - sag - 1, contact + reach + 1, -t / 2, t / 2), z - b1, z + b1);
    plate = kernel.intersect(revolved, slab);
    pin = kernel.tube({ origin: [contact + a2, 0, z + a1], axis: [0, 1, 0] }, 0, hole / 2, -t, t);
    notes.push(
      representedNote(
        `Along the axis the plate is its outline revolved and cut to ${mm(t)}: its sides are surfaces of revolution, off flat by at most ${mm((t / 2) ** 2 / (2 * contact))}`,
        'lug faces',
        'flat',
        'revolved about the vessel axis'
      )
    );
  } else {
    // (u, v) → (x, y): u round the course, v out from it.
    plate = kernel.extrude(outline(([u, v]) => [contact + v, u]), z - t / 2, z + t / 2);
    pin = kernel.tube({ origin: [contact + a2, a1, 0], axis: [0, 0, 1] }, 0, hole / 2, z - t, z + t);
  }
  const solids: Solid[] = [kernel.cut(plate, [shellCylinder, pin])];

  if (padThickness !== undefined) {
    // The pad wraps the course: b_3 along the lug's base, b_2 across it.
    const arcLength = along ? padWidth : padLength;
    const half = arcLength / 2 / outside;
    const [ix, iy] = polar(outside, half);
    const [ox, oy] = polar(contact, half);
    solids.push(
      kernel.extrude(
        {
          start: [ix, -iy],
          steps: [
            { kind: 'line', to: [ox, -oy] },
            { kind: 'arc', to: [ox, oy], through: [contact, 0] },
            { kind: 'line', to: [ix, iy] },
            { kind: 'arc', to: [ix, -iy], through: [outside, 0] },
          ],
        },
        z - axial / 2,
        z + axial / 2
      )
    );
  }

  return {
    solids: solids.map((solid) => kernel.rotateZ(solid, placement.azimuth)),
    footprint: axial / 2,
    attachment: {
      axial,
      circumferentialDeg: ((along ? padWidth : padLength) / outside) * (180 / Math.PI),
      thickness: padThickness ?? t,
    },
    notes,
  };
};

/**
 * A support ring under a horizontal vessel — EN 13445-3 §16.9 and CODAP C9.3.3.1.7, the engine's
 * `RING_SUPPORT` on its symbols: a flat bar `h1a` high (radially) by `e1a` thick (axially) round
 * the course, and what carries it — two posts down to the ground at ±δ/2 from the bottom, on one
 * base plate for a cradle (Figure C9.3.3.1.7-2) or each on its own on two hinges (-3). Azimuth 0
 * is the bottom, as for a saddle. C9.3.3.1.7 allows δ up to 330°, the links then bearing on
 * brackets above the ring's middle; a vertical post from there would pass through the vessel, so
 * past 180° the supports are not drawn.
 *
 * The section is one of CODAP Annexe C9.A5's three described ones — a flat bar, a tee (a flange
 * b_2a × e_2a at the far side of the web) or a channel (two webs at the flange's edges) — revolved.
 * The engine checks the ring on A_R, h_G and R_R, which the section fixes; where the assembly
 * states them, under §16.9's names or CODAP's, they must be the section drawn — two sources for one
 * number is how a drawing and its check come apart. A flat bar is also fixed BY A_R and h_G, so
 * one stated only as the engine asks is drawn. The engine reads its four ring flags as switches,
 * stated meaning yes, so they are stated as 1 or not at all.
 */
export const ringSupport: MountedBuilder = (component, context) => {
  const { kernel, placement } = context;
  const course = cylinderOf(component, context, 'a support ring');
  const notes: Note[] = [];
  // One quantity, two codes' names (§16.9 and CODAP C9.3.3 / C9.A5): either is read, both must agree.
  const either = (a: string, b: string, label: string): number | undefined => {
    const x = optionalDimension(component, a);
    const y = optionalDimension(component, b);
    if (x !== undefined && y !== undefined && Math.abs(x - y) > 1e-6 * Math.max(1, Math.abs(x))) {
      throw new BuildError(component, `states ${label} twice, ${x} and ${y}`, scope('mismatch', b, `${a} = ${x}`, `${y}`));
    }
    return x ?? y;
  };
  // The engine reads its ring flags as SWITCHES — stated is yes, whatever the value — so a stated 0
  // would be drawn one way and checked the other. Stated as 1, or not at all.
  const switchOn = (symbol: string, meaning: string): boolean => {
    const value = signedDimension(component, symbol);
    if (value === undefined) return false;
    if (value !== 1) {
      throw new BuildError(
        component,
        `states ${symbol} = ${value}; the engine reads any stated value as "${meaning}"`,
        scope('out_of_scope', symbol, '1, or not stated', `${value}`)
      );
    }
    return true;
  };
  const flangeWidth = optionalDimension(component, Sym.SUPPORT_RING_FLANGE_WIDTH);
  const flangeThickness = optionalDimension(component, Sym.SUPPORT_RING_FLANGE_THICKNESS);
  if ((flangeWidth === undefined) !== (flangeThickness === undefined)) {
    const missing = flangeWidth === undefined ? Sym.SUPPORT_RING_FLANGE_WIDTH : Sym.SUPPORT_RING_FLANGE_THICKNESS;
    throw new BuildError(component, 'states half a flange', scope('out_of_scope', missing, 'both b_2a and e_2a, or neither', 'one'));
  }
  const flanged = flangeWidth !== undefined && flangeThickness !== undefined;
  const channel = switchOn(Sym.SUPPORT_RING_CHANNEL, 'a channel');
  if (channel && !flanged) {
    throw new BuildError(component, 'is a channel with no flange', scope('out_of_scope', Sym.SUPPORT_RING_FLANGE_WIDTH, 'b_2a and e_2a for a channel', 'not stated'));
  }
  if (!switchOn(Sym.SUPPORT_RING_EXTERNAL, 'outside the shell')) {
    notes.push(assumedNote('Ring side not stated — drawn outside the shell, where the engine reads an unstated side as inside', Sym.SUPPORT_RING_EXTERNAL, 'outside'));
  }
  const statedArea = either(Sym.SUPPORT_RING_AREA, Sym.SUPPORT_SECTION_AREA, 'the ring\'s area');
  const statedCentroid = either(Sym.SUPPORT_RING_CENTROID, Sym.SUPPORT_RING_NEUTRAL_AXIS, 'the ring\'s centroid');
  // A flat bar h × t is fixed by A_R and h_G too (h = 2·h_G, t = A_R/h), so a bar stated only as the
  // engine asks is drawn; a flanged section is not fixed by them and must state its parts.
  const height =
    optionalDimension(component, Sym.SUPPORT_RING_HEIGHT) ??
    (!flanged && statedCentroid !== undefined ? 2 * statedCentroid : requireDimension(component, Sym.SUPPORT_RING_HEIGHT));
  const thickness =
    optionalDimension(component, Sym.SUPPORT_RING_WEB_THICKNESS) ??
    (!flanged && statedArea !== undefined ? statedArea / height : requireDimension(component, Sym.SUPPORT_RING_WEB_THICKNESS));
  const opening = either(Sym.SUPPORT_OPENING_ANGLE, Sym.SUPPORT_CONTACT_ANGLE, 'the supports\' angle') ?? requireDimension(component, Sym.SUPPORT_OPENING_ANGLE);
  const section = ringSection(height, thickness, flanged ? { width: flangeWidth!, thickness: flangeThickness!, channel } : null);
  if (section.problem) throw new BuildError(component, section.problem.message, scope('out_of_scope', section.problem.symbol, section.problem.limit, section.problem.value));
  const stated = (symbol: string, label: string, assumed: number): number => {
    const value = optionalDimension(component, symbol);
    if (value !== undefined) return value;
    notes.push(assumedNote(`${label} not stated — drawn ${mm(assumed)}`, symbol, mm(assumed)));
    return assumed;
  };
  if (opening < 30 || opening > 330) {
    throw new BuildError(component, `opens ${opening}° between its supports`, scope('out_of_scope', Sym.SUPPORT_OPENING_ANGLE, '30° to 330°, C9.3.3.1.7-1', `${opening}°`));
  }
  if (opening >= 180) {
    throw new NotDrawnError(
      component,
      `with ${opening}° between its supports, they bear above the ring's middle, where a post down to the ground would pass through the vessel`,
      scope('not_built', Sym.SUPPORT_OPENING_ANGLE, '< 180°, posts down to the ground', `${opening}°`)
    );
  }
  // Two hinges (§16.9) or two points (C9.3.3.6): one fact, a switch each code reads under its own
  // name. Either says it; absent, a cradle.
  // Both read, so a bad value under either name is refused whichever the other says.
  const hinges = switchOn(Sym.RING_ON_TWO_HINGES, 'carried on two hinges');
  const points = switchOn(Sym.SUPPORT_RING_TWO_POINT, 'held at two points');
  const twoLinks = hinges || points;
  if (!twoLinks) notes.push(assumedNote('Support not stated — drawn as a cradle, both posts on one base', Sym.RING_ON_TWO_HINGES, 'a cradle'));
  // How far the section reaches along the axis: the bar or the web, or a flange wider than it.
  const axial = section.axialExtent;
  requireWithinHost(component, context, axial / 2);

  const z = placement.axialOffset;
  const outside = course.outsideRadiusAt(z);
  const ring = outside + height;
  // The section the engine checks, which the one drawn fixes: each stated value, under either
  // name, must be it.
  const agrees = (symbols: readonly string[], label: string, drawn: number, tolerance: number, unit: string) => {
    for (const symbol of symbols) {
      const value = optionalDimension(component, symbol);
      if (value !== undefined && Math.abs(value - drawn) > tolerance) {
        throw new BuildError(
          component,
          `states ${label} ${value.toFixed(1)} ${unit} where the ${section.name} drawn has ${drawn.toFixed(1)}`,
          scope('mismatch', symbol, `${drawn.toFixed(1)} ${unit}, the ${section.name} drawn`, `${value} ${unit}`)
        );
      }
    }
  };
  agrees([Sym.SUPPORT_RING_AREA, Sym.SUPPORT_SECTION_AREA], 'A_R', section.area, 5e-3 * section.area, 'mm²');
  agrees([Sym.SUPPORT_RING_CENTROID, Sym.SUPPORT_RING_NEUTRAL_AXIS], 'h_G', section.centroid, 0.5, 'mm');
  agrees([Sym.SUPPORT_RING_RADIUS], 'R_R', outside + section.centroid, 0.5, 'mm');
  agrees([Sym.SUPPORT_RING_CONTACT_WIDTH, Sym.SUPPORT_RING_FOOTPRINT], 't_ring', section.footprint, 0.5, 'mm');
  const drop = stated(Sym.SUPPORT_HEIGHT, 'Support height', Math.max(150, 0.25 * outside));
  const width = stated(Sym.SUPPORT_POST_WIDTH, 'Post width', Math.max(80, 4 * thickness));
  const basePlate = stated(Sym.SUPPORT_LUG_BASE_PLATE_THICKNESS, 'Base plate thickness', 16);
  // x runs from the axis down through the bottom of the ring, as for a saddle.
  const base = ring + drop;
  const baseTop = base - basePlate;
  const half = (opening * DEG) / 2;
  const [px, py] = polar(ring, half);
  if (baseTop <= px) {
    throw new BuildError(
      component,
      `stands ${mm(drop)} under its ring, which leaves its posts no length`,
      scope('out_of_scope', Sym.SUPPORT_HEIGHT, `> ${mm(px + basePlate - ring)}`, mm(drop))
    );
  }

  const outline = section.outline;
  const solids: Solid[] = [
    kernel.revolve({
      start: [outside + outline[0]![0], z + outline[0]![1]],
      steps: outline.slice(1).map(([r, y]) => ({ kind: 'line' as const, to: [outside + r, z + y] as Point2 })),
    }),
  ];
  // Each post starts inside the ring's circle and is cut back to it, so it sits on the ring.
  const ringDisc = kernel.revolve({
    start: [0, z - axial],
    steps: [
      { kind: 'line', to: [ring, z - axial] },
      { kind: 'line', to: [ring, z + axial] },
      { kind: 'line', to: [0, z + axial] },
    ],
  });
  for (const y of [-py, py]) {
    const reachIn = Math.sqrt(Math.max(0, ring * ring - (Math.abs(y) + width / 2) ** 2)) - 1;
    const post = kernel.extrude(rectangle(Math.min(reachIn, px - 1), baseTop, y - width / 2, y + width / 2), z - axial / 2, z + axial / 2);
    solids.push(kernel.cut(post, [ringDisc]));
  }
  const foot = Math.max(width, 2 * axial);
  if (!twoLinks) {
    solids.push(kernel.extrude(rectangle(baseTop, base, -py - foot / 2, py + foot / 2), z - foot / 2, z + foot / 2));
  } else {
    for (const y of [-py, py]) solids.push(kernel.extrude(rectangle(baseTop, base, y - foot / 2, y + foot / 2), z - foot / 2, z + foot / 2));
  }

  return {
    solids: solids.map((solid) => kernel.rotateZ(solid, placement.azimuth)),
    footprint: axial / 2,
    attachment: { axial: section.footprint, circumferentialDeg: 360, thickness },
    notes,
  };
};

interface RingSection {
  readonly name: string;
  /** Closed outline in (radial from the shell's outside, axial from the ring's middle), mm. */
  readonly outline: readonly (readonly [number, number])[];
  readonly area: number;
  /** h_G: the centroid from the shell's outside surface. */
  readonly centroid: number;
  /** t_ring: the width it sits on the shell over — the web, or a channel's two webs and the gap between. */
  readonly footprint: number;
  readonly axialExtent: number;
  readonly problem?: { message: string; symbol: string; limit: string; value: string };
}

/**
 * CODAP Annexe C9.A5's three described sections, as the engine forms them: a flat bar h × e_1a
 * (C9.A5.3); a tee, its web e_1a against the shell and a flange b_2a × e_2a at the far side
 * (C9.A5.4); a channel, two webs at the flange's edges (C9.A5.5). Area and centroid are the
 * engine's own Eqs. (C9.A5.4-1/-2), with (C9.A5.5-1) read from the shell, as the engine reads it.
 */
function ringSection(h: number, e1: number, flange: { width: number; thickness: number; channel: boolean } | null): RingSection {
  if (!flange) {
    return {
      name: `${mm(h)} × ${mm(e1)} bar`,
      outline: [[0, -e1 / 2], [h, -e1 / 2], [h, e1 / 2], [0, e1 / 2]],
      area: h * e1,
      centroid: h / 2,
      footprint: e1,
      axialExtent: e1,
    };
  }
  const { width: b2, thickness: e2, channel } = flange;
  const webs = channel ? 2 : 1;
  const area = webs * (h - e2) * e1 + b2 * e2;
  // Eq. (C9.A5.4-1)'s numerator over 2·A_R: the centroid from the FAR side; h_G is h minus it.
  const fromFar = ((b2 - webs * e1) * e2 * e2 + webs * e1 * h * h) / (2 * area);
  const base = { area, centroid: h - fromFar, axialExtent: Math.max(b2, e1) };
  const problem =
    e2 >= h
      ? { message: `has a ${mm(e2)} flange on a ${mm(h)} section`, symbol: Sym.SUPPORT_RING_FLANGE_THICKNESS, limit: `< ${mm(h)}, h_1a`, value: mm(e2) }
      : b2 < webs * e1
        ? { message: `has a ${mm(b2)} flange over ${webs} web(s) of ${mm(e1)}`, symbol: Sym.SUPPORT_RING_FLANGE_WIDTH, limit: `≥ ${mm(webs * e1)}`, value: mm(b2) }
        : undefined;
  const web = h - e2;
  if (channel) {
    return {
      ...base,
      name: `${mm(h)} channel, ${mm(b2)} × ${mm(e2)} flange`,
      // A U opening towards the shell: two webs at the flange's edges.
      outline: [[0, -b2 / 2], [h, -b2 / 2], [h, b2 / 2], [0, b2 / 2], [0, b2 / 2 - e1], [web, b2 / 2 - e1], [web, -b2 / 2 + e1], [0, -b2 / 2 + e1]],
      footprint: b2,
      ...(problem ? { problem } : {}),
    };
  }
  return {
    ...base,
    name: `${mm(h)} tee, ${mm(b2)} × ${mm(e2)} flange`,
    outline: [[0, -e1 / 2], [web, -e1 / 2], [web, -b2 / 2], [h, -b2 / 2], [h, b2 / 2], [web, b2 / 2], [web, e1 / 2], [0, e1 / 2]],
    footprint: e1,
    ...(problem ? { problem } : {}),
  };
}

/**
 * A support ring on a vertical vessel — EN 13445-3 §16.13, Figures 16.13-1 and 16.13-2, the engine's
 * `VERTICAL_SUPPORT_RING`: a ring from `d_3` to `d_4` and `h` high, centred on its placement, of one
 * of Table 16.13-2's four profiles, carried on `n_s` local supports that react on the circle `d_7`.
 *
 * Integral (Figure 16.13-1 a), it is welded to the shell — `d_3` is the shell's outside diameter —
 * and a channel or an angle opens towards it, the shell closing the section. Independent (b), it
 * sits loose round the shell — the gap is what `d_3` leaves — on a bearing ring welded under it, and
 * only a box or a channel, its web against the vessel, is drawn that way, as the table has it.
 * Fixed inside (Eq. (16.13-12)), it is welded in the bore — `d_4` is the shell's inside diameter.
 * Table 16.13-2's `t_0` is a property of the section the engine computes, not a gap, and is not read.
 *
 * The supports stand for whatever carries the ring — legs, beams, brackets — which §16.13 reads
 * only as the forces F_S at the reaction circle, so they are drawn as plain posts centred on it.
 */
export const verticalSupportRing: MountedBuilder = (component, context) => {
  const { kernel, placement } = context;
  const course = cylinderOf(component, context, 'a support ring');
  const notes: Note[] = [];
  const stated = (symbol: string, label: string, assumed: number): number => {
    const value = optionalDimension(component, symbol);
    if (value !== undefined) return value;
    notes.push(assumedNote(`${label} not stated — drawn ${mm(assumed)}`, symbol, mm(assumed)));
    return assumed;
  };
  const shape = requireDimension(component, Sym.VERTICAL_RING_PROFILE);
  if (![1, 2, 3, 4].includes(shape)) {
    throw new BuildError(component, `has a profile of type ${shape}`, scope('out_of_scope', Sym.VERTICAL_RING_PROFILE, '1 solid, 2 box, 3 channel or 4 angle (Table 16.13-2)', `${shape}`));
  }
  const width = requireDimension(component, Sym.VERTICAL_RING_WIDTH);
  const height = requireDimension(component, Sym.SUPPORT_RING_HEIGHT);
  const r3 = requireDimension(component, Sym.VERTICAL_RING_INSIDE_DIAMETER) / 2;
  const r4 = requireDimension(component, Sym.VERTICAL_RING_OUTSIDE_DIAMETER) / 2;
  const r6 = requireDimension(component, Sym.VERTICAL_RING_LOAD_DIAMETER) / 2;
  const r7 = requireDimension(component, Sym.VERTICAL_RING_REACTION_DIAMETER) / 2;
  const loose = (signedDimension(component, Sym.VERTICAL_RING_INDEPENDENT) ?? 0) > 0.5;
  const inside = (signedDimension(component, Sym.VERTICAL_RING_FIXED_INSIDE) ?? 0) > 0.5;
  if (loose && inside) {
    throw new BuildError(component, 'is both independent and fixed inside the vessel', scope('out_of_scope', Sym.VERTICAL_RING_FIXED_INSIDE, 'absent for an independent ring, which sits round the vessel', 'stated'));
  }
  const z = placement.axialOffset;
  const outside = course.outsideRadiusAt(z);
  const bore = course.insideRadiusAt(z);
  // Where the ring meets the vessel is fixed by how it is attached; half a millimetre either way.
  const fit = 0.5;
  if (!(r4 > r3)) {
    throw new BuildError(component, `runs from ${mm(2 * r3)} to ${mm(2 * r4)}`, scope('out_of_scope', Sym.VERTICAL_RING_OUTSIDE_DIAMETER, `> ${mm(2 * r3)}, d_3`, mm(2 * r4)));
  }
  if (Math.abs(r4 - r3 - width) > Math.max(fit, 0.005 * width)) {
    throw new BuildError(
      component,
      `states b = ${mm(width)} where d_3 and d_4 make it ${mm(r4 - r3)}`,
      scope('out_of_scope', Sym.VERTICAL_RING_WIDTH, `${mm(r4 - r3)}, (d_4 − d_3)/2`, mm(width))
    );
  }
  if (inside && Math.abs(r4 - bore) > fit) {
    throw new BuildError(component, `is fixed inside a ${mm(2 * bore)} bore at d_4 = ${mm(2 * r4)}`, scope('out_of_scope', Sym.VERTICAL_RING_OUTSIDE_DIAMETER, `${mm(2 * bore)}, the shell's inside diameter`, mm(2 * r4)));
  }
  if (!inside && !loose && Math.abs(r3 - outside) > fit) {
    throw new BuildError(component, `is welded to a ${mm(2 * outside)} shell at d_3 = ${mm(2 * r3)}`, scope('out_of_scope', Sym.VERTICAL_RING_INSIDE_DIAMETER, `${mm(2 * outside)}, the shell's outside diameter`, mm(2 * r3)));
  }
  if (loose && !(r3 > outside + fit)) {
    throw new BuildError(component, `is loose round a ${mm(2 * outside)} shell at d_3 = ${mm(2 * r3)}`, scope('out_of_scope', Sym.VERTICAL_RING_INSIDE_DIAMETER, `> ${mm(2 * outside)}, clear of the shell`, mm(2 * r3)));
  }
  // The load comes down the vessel's wall onto the ring; the supports push back under the ring.
  const [wallIn, wallOut] = inside ? [r3, outside] : [bore, r4];
  if (r6 < wallIn - fit || r6 > wallOut + fit) {
    throw new BuildError(component, `takes its load on a ${mm(2 * r6)} circle`, scope('out_of_scope', Sym.VERTICAL_RING_LOAD_DIAMETER, `${mm(2 * wallIn)} to ${mm(2 * wallOut)}`, mm(2 * r6)));
  }
  if (r7 < r3 - fit || r7 > r4 + fit) {
    throw new BuildError(component, `is reacted on a ${mm(2 * r7)} circle, off the ring`, scope('out_of_scope', Sym.VERTICAL_RING_REACTION_DIAMETER, `${mm(2 * r3)} to ${mm(2 * r4)}, d_3 to d_4`, mm(2 * r7)));
  }

  // The plates: a web e_4 for every built-up profile, flanges e_3 and a box's outer web e_5 as the web unless stated.
  const web = shape === 1 ? 0 : requireDimension(component, Sym.VERTICAL_RING_WEB_THICKNESS);
  const flange = shape === 1 ? 0 : stated(Sym.VERTICAL_RING_FLANGE_THICKNESS, 'Flange thickness e_3', web);
  const outer = shape === 2 ? stated(Sym.VERTICAL_RING_SECOND_WEB_THICKNESS, 'Second web thickness e_5', web) : 0;
  // 16.13.4 c), as the engine reads it: a flange across the width, b/e_3 > 5; a web up the height, h/e_4 > 5.
  for (const [symbol, e, span, letter] of [
    [Sym.VERTICAL_RING_FLANGE_THICKNESS, flange, width, 'b'],
    [Sym.VERTICAL_RING_WEB_THICKNESS, web, height, 'h'],
    [Sym.VERTICAL_RING_SECOND_WEB_THICKNESS, outer, height, 'h'],
  ] as const) {
    if (e > 0 && span / e <= 5) {
      throw new BuildError(
        component,
        `is built of ${mm(e)} plate across a ${mm(span)} ${letter}`,
        scope('out_of_scope', symbol, `< ${mm(span / 5)}: ${letter}/e > 5 (EN 13445-3 16.13.4 c)`, mm(e))
      );
    }
  }
  // A loose ring sits on a bearing ring welded to the shell, as thick as its web — a solid ring has
  // none, so a tenth of its height, said.
  const bearing = !loose ? 0 : web > 0 ? web : height / 10;
  if (loose && web === 0) notes.push(assumedNote(`Bearing ring under a loose solid ring not stated — drawn ${mm(height / 10)} thick, a tenth of h`, 'bearing ring', mm(height / 10)));
  requireWithinHost(component, context, height / 2 + bearing);

  const r0 = r3;
  const r1 = r4;
  const z0 = z - height / 2;
  const z1 = z + height / 2;
  const box = annulus(kernel, r0, r1, z0, z1);
  // Which side of the section faces the shell: the inner one, unless the ring is in the bore.
  const shellInside = !inside;
  let ring: Solid;
  if (shape === 1) ring = box;
  else if (shape === 2) ring = kernel.cut(box, [annulus(kernel, r0 + web, r1 - outer, z0 + flange, z1 - flange)]);
  // A channel opens towards the shell it is welded to, its web away from it; loose, its web is against the vessel.
  else if (shape === 3) {
    const webOutward = shellInside !== loose;
    ring = kernel.cut(box, [webOutward ? annulus(kernel, r0 - 1, r1 - web, z0 + flange, z1 - flange) : annulus(kernel, r0 + web, r1 + 1, z0 + flange, z1 - flange)]);
  }
  // An angle: a leg up the shell and a flange along the bottom.
  else ring = kernel.cut(box, [shellInside ? annulus(kernel, r0 + web, r1 + 1, z0 + flange, z1 + 1) : annulus(kernel, r0 - 1, r1 - web, z0 + flange, z1 + 1)]);

  const solids: Solid[] = [ring];
  let innerEdge = r0;
  if (loose) {
    // The bearing ring the loose ring sits on, welded to the shell under it and reaching 2·e_4 under its web.
    solids.push(annulus(kernel, outside, r0 + 2 * bearing, z0 - bearing, z0));
    innerEdge = r0 + 2 * bearing;
  }
  const given = optionalDimension(component, Sym.VERTICAL_RING_SUPPORT_COUNT);
  if (given !== undefined && !(Number.isInteger(given) && given >= 2)) {
    throw new BuildError(component, `stands on ${given} supports`, scope('out_of_scope', Sym.VERTICAL_RING_SUPPORT_COUNT, 'a whole number, two or more', `${given}`));
  }
  const count = inside ? 0 : (given ?? 0);
  if (given === undefined) notes.push(representedNote('No support count stated: supported uniformly all round, so no supports are drawn', 'supports', 'n_s local supports', 'none drawn', true));
  else if (inside) notes.push(representedNote(`The ${given} supports of a ring inside the vessel are not drawn`, 'supports', `${given} supports`, 'none drawn', true));
  const drop = count > 0 ? stated(Sym.SUPPORT_HEIGHT, 'Support height', Math.max(150, 2 * height)) : 0;
  const post = count > 0 ? Math.min(stated(Sym.SUPPORT_POST_WIDTH, 'Support width', Math.max(80, width / 2)), r1 - innerEdge) : 0;
  // Centred on the reaction circle d_7, kept on the ring.
  const centre = Math.min(Math.max(r7, innerEdge + post / 2), r1 - post / 2);
  for (let k = 0; k < count; k++) {
    const block = kernel.extrude(rectangle(centre - post / 2, centre + post / 2, -post / 2, post / 2), z0 - drop, z0);
    solids.push(kernel.rotateZ(block, placement.azimuth + (k * 360) / count));
  }
  if (count > 0) {
    notes.push(
      representedNote(
        `The ${count} supports are drawn as plain posts on the reaction circle d_7: §16.13 reads them only as the forces F_S they react`,
        'ring supports',
        'legs, beams or brackets',
        `posts ${mm(post)} square`,
        true
      )
    );
  }

  return {
    solids,
    footprint: height / 2 + bearing,
    attachment: loose
      ? { axial: bearing, circumferentialDeg: 360, thickness: bearing }
      : { axial: height, circumferentialDeg: 360, thickness: shape === 1 ? width : web },
    notes,
  };
};

/**
 * A half-pipe jacket — §4.11.6. Drawn as closed turns of the half-pipe on the whole course, at
 * a pitch of a little more than its own width: the helix is not modelled, and neither is the
 * pitch, which the type does not carry.
 */
export const halfPipeJacket: MountedBuilder = (component, context) => {
  const { kernel, hostSurface } = context;
  const course = cylinderOf(component, context, 'a half-pipe jacket');
  const radius = requireDimension(component, Sym.HALF_PIPE_INSIDE_RADIUS);
  const thickness = requireDimension(component, Sym.THICKNESS);
  requireWithinHost(component, context, 0);

  const [low, high] = hostSurface.offsetRange;
  const outside = course.outsideRadiusAt(low);
  const reach = radius + thickness;
  const pitch = 2 * reach + Math.max(20, radius);
  const margin = reach + 20;
  const turns = Math.min(60, Math.floor((high - low - 2 * margin) / pitch) + 1);
  if (turns < 2) {
    throw new NotDrawnError(
      component,
      `${context.host.name} is too short for a turn of half-pipe`,
      scope('out_of_scope', 'course length', `≥ ${mm(2 * margin + pitch)}, one turn and its margins`, mm(high - low))
    );
  }

  // One continuous helix. Two circular tubes swept with their centre ON the shell's outside
  // surface, the inner taken from the outer, and what lies inside the shell's outside cylinder
  // cut away: the coil's two weld lines then lie exactly on the shell's cylinder, which no
  // profile swept with its edges on the shell would give.
  const z = low + margin;
  const rise = (turns - 1) * pitch;
  const shellOutside = kernel.revolve({
    start: [0, low - 1],
    steps: [
      { kind: 'line', to: [outside, low - 1] },
      { kind: 'line', to: [outside, high + 1] },
      { kind: 'line', to: [0, high + 1] },
    ],
  });
  // Started half a turn from azimuth 0, where every surface of revolution has its seam — the
  // shell's and the cutter's alike. Started on it, each end face's foot crossed that seam and
  // left a patch of footprint a millimetre wide.
  const tube = (tubeRadius: number) => kernel.rotateZ(kernel.helicalTube(outside, pitch, z, rise, tubeRadius), 180);
  const coil = kernel.cut(tube(reach), [tube(radius), shellOutside]);
  return {
    solids: [coil],
    footprint: 0,
    attachment: { axial: rise + 2 * reach, circumferentialDeg: 360, thickness },
    // The coil is the jacket itself now; its pitch and extent are still chosen here, the type
    // carrying neither.
    notes: [
      note(
        `Pitch and extent not stated — drawn at a ${mm(pitch)} pitch over the whole course`,
        undefined,
        scope('assumed', 'pitch and jacketed length', 'stated', `not stated — drawn ${mm(pitch)} over ${mm(high - low)}`)
      ),
    ],
  };
};
