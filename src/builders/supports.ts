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
import type { CourseShape, MountedBuilder, MountedContext, MountedPart } from './types.ts';

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

  const inner = outside - 1;
  const solids = [
    kernel.extrude(rectangle(inner, outside + reach, gap / 2 - plate / 2, gap / 2 + plate / 2), z - height / 2, z + height / 2),
    kernel.extrude(rectangle(inner, outside + reach, -gap / 2 - plate / 2, -gap / 2 + plate / 2), z - height / 2, z + height / 2),
    kernel.extrude(rectangle(inner, outside + reach, -gap / 2 - plate / 2, gap / 2 + plate / 2), z - height / 2 - base, z - height / 2),
  ];
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
 * A support ring — CODAP C9.3.3.1.7: a ring `ring_height` by `ring_thickness` round a horizontal
 * course, and what carries it — two posts down to the ground at ±δ_a/2 from the bottom, on one
 * base plate for a cradle (Figure C9.3.3.1.7-2) or each on its own for two links (-3). Azimuth 0
 * is the bottom, as for a saddle. C9.3.3.1.7 allows δ_a up to 330°, the links then bearing on
 * brackets above the ring's middle; a vertical post from there would pass through the vessel, so
 * past 180° the supports are not drawn.
 */
export const supportRing: MountedBuilder = (component, context) => {
  const { kernel, placement } = context;
  const course = cylinderOf(component, context, 'a support ring');
  const height = requireDimension(component, Sym.RING_HEIGHT);
  const thickness = requireDimension(component, Sym.RING_THICKNESS);
  const opening = requireDimension(component, Sym.SUPPORT_OPENING_ANGLE);
  const notes: Note[] = [];
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
  const links = signedDimension(component, Sym.SUPPORT_RING_LINKS);
  if (links === undefined) notes.push(assumedNote('Support not stated — drawn as a cradle, both posts on one base', Sym.SUPPORT_RING_LINKS, '0'));
  else if (links !== 0 && links !== 2) {
    throw new BuildError(component, `is carried by ${links} links`, scope('out_of_scope', Sym.SUPPORT_RING_LINKS, '0 (a cradle) or 2 (two links)', `${links}`));
  }
  requireWithinHost(component, context, thickness / 2);

  const z = placement.axialOffset;
  const outside = course.outsideRadiusAt(z);
  const ring = outside + height;
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

  const solids: Solid[] = [
    kernel.revolve({
      start: [outside, z - thickness / 2],
      steps: [
        { kind: 'line', to: [ring, z - thickness / 2] },
        { kind: 'line', to: [ring, z + thickness / 2] },
        { kind: 'line', to: [outside, z + thickness / 2] },
      ],
    }),
  ];
  // Each post starts inside the ring's circle and is cut back to it, so it sits on the ring.
  const ringDisc = kernel.revolve({
    start: [0, z - thickness],
    steps: [
      { kind: 'line', to: [ring, z - thickness] },
      { kind: 'line', to: [ring, z + thickness] },
      { kind: 'line', to: [0, z + thickness] },
    ],
  });
  for (const y of [-py, py]) {
    const reachIn = Math.sqrt(Math.max(0, ring * ring - (Math.abs(y) + width / 2) ** 2)) - 1;
    const post = kernel.extrude(rectangle(Math.min(reachIn, px - 1), baseTop, y - width / 2, y + width / 2), z - thickness / 2, z + thickness / 2);
    solids.push(kernel.cut(post, [ringDisc]));
  }
  const foot = Math.max(width, 2 * thickness);
  if ((links ?? 0) === 0) {
    solids.push(kernel.extrude(rectangle(baseTop, base, -py - foot / 2, py + foot / 2), z - foot / 2, z + foot / 2));
  } else {
    for (const y of [-py, py]) solids.push(kernel.extrude(rectangle(baseTop, base, y - foot / 2, y + foot / 2), z - foot / 2, z + foot / 2));
  }

  return {
    solids: solids.map((solid) => kernel.rotateZ(solid, placement.azimuth)),
    footprint: thickness / 2,
    attachment: { axial: thickness, circumferentialDeg: 360, thickness },
    notes,
  };
};

/**
 * A ring support on a vertical vessel — EN 13445-3 §16.13, Figures 16.13-1 and 16.13-2: a ring `b`
 * wide and `h` high round the course, centred on its placement, carried on `n_s` local supports.
 * Integral (Figure 16.13-1 a), it is welded to the shell and a U or an L opens towards it, the
 * shell closing the section; independent (b), it sits loose `t_0` off the shell on a bearing ring
 * welded under it, and only a box or a U — its web against the vessel — is drawn that way, which
 * is what Figure 16.13-2 tabulates. The supports stand for whatever carries the ring — legs, beams,
 * brackets — that §16.13 reads only as the forces F_S at the reaction circle, so they are drawn as
 * plain posts under its outer edge.
 */
export const ringSupport: MountedBuilder = (component, context) => {
  const { kernel, placement } = context;
  const course = cylinderOf(component, context, 'a ring support');
  const notes: Note[] = [];
  const stated = (symbol: string, label: string, assumed: number): number => {
    const value = optionalDimension(component, symbol);
    if (value !== undefined) return value;
    notes.push(assumedNote(`${label} not stated — drawn ${mm(assumed)}`, symbol, mm(assumed)));
    return assumed;
  };
  const section = signedDimension(component, Sym.RING_SUPPORT_SECTION);
  if (section === undefined) notes.push(assumedNote('Section not stated — drawn solid', Sym.RING_SUPPORT_SECTION, '0, a solid rectangle'));
  else if (section !== 0 && section !== 1 && section !== 2 && section !== 3) {
    throw new BuildError(component, `has a section of type ${section}`, scope('out_of_scope', Sym.RING_SUPPORT_SECTION, '0 solid, 1 box, 2 U or 3 L (Figure 16.13-2)', `${section}`));
  }
  const shape = section ?? 0;
  const width = requireDimension(component, Sym.RING_SUPPORT_WIDTH);
  const height = requireDimension(component, Sym.RING_SUPPORT_HEIGHT);
  const count = requireDimension(component, Sym.RING_SUPPORT_COUNT);
  if (![2, 3, 4, 6, 8].includes(count)) {
    throw new BuildError(component, `stands on ${count} supports`, scope('out_of_scope', Sym.RING_SUPPORT_COUNT, '2, 3, 4, 6 or 8, the counts Figures 16.13-3 to 16.13-6 give', `${count}`));
  }
  const loose = signedDimension(component, Sym.RING_SUPPORT_INDEPENDENT) ?? 0;
  if (loose !== 0 && loose !== 1) {
    throw new BuildError(component, `is neither integral nor independent (${loose})`, scope('out_of_scope', Sym.RING_SUPPORT_INDEPENDENT, '0 integral or 1 independent', `${loose}`));
  }
  if (loose === 1 && shape !== 1 && shape !== 2) {
    throw new BuildError(
      component,
      'is independent with a section Figure 16.13-2 draws integral only',
      scope('out_of_scope', Sym.RING_SUPPORT_SECTION, '1 box or 2 U, the independent sections of Figure 16.13-2', `${shape}`)
    );
  }
  const plate = shape === 0 ? undefined : requireDimension(component, Sym.RING_SUPPORT_PLATE_THICKNESS);
  if (plate !== undefined && (width / plate <= 5 || height / plate <= 5)) {
    throw new BuildError(
      component,
      `is built of ${mm(plate)} plate into a ${mm(width)} by ${mm(height)} section`,
      scope('out_of_scope', Sym.RING_SUPPORT_PLATE_THICKNESS, `< ${mm(Math.min(width, height) / 5)}: b/e > 5 and h/e > 5 (EN 13445-3 16.13.4 c)`, mm(plate))
    );
  }
  const clearance = loose === 1 ? stated(Sym.RING_SUPPORT_CLEARANCE, 'Clearance t_0', 2) : 0;
  const bearing = plate ?? 0;
  requireWithinHost(component, context, height / 2 + bearing);

  const z = placement.axialOffset;
  const shell = course.outsideRadiusAt(z);
  const r0 = shell + clearance;
  const r1 = r0 + width;
  const z0 = z - height / 2;
  const z1 = z + height / 2;
  const box = annulus(kernel, r0, r1, z0, z1);
  const e = plate ?? 0;
  let ring: Solid;
  if (shape === 0) ring = box;
  else if (shape === 1) ring = kernel.cut(box, [annulus(kernel, r0 + e, r1 - e, z0 + e, z1 - e)]);
  // A U opens towards the shell when it is welded to it, away from it when it is loose.
  else if (shape === 2) ring = kernel.cut(box, [loose === 1 ? annulus(kernel, r0 + e, r1 + 1, z0 + e, z1 - e) : annulus(kernel, r0 - 1, r1 - e, z0 + e, z1 - e)]);
  // An L: a leg up the shell and a flange along the bottom.
  else ring = kernel.cut(box, [annulus(kernel, r0 + e, r1 + 1, z0 + e, z1 + 1)]);

  const solids: Solid[] = [ring];
  let inner = r0;
  if (loose === 1) {
    // The bearing ring the loose ring sits on, welded to the shell under it and reaching 2·e under its web.
    solids.push(annulus(kernel, shell, r0 + 2 * bearing, z0 - bearing, z0));
    inner = r0 + 2 * bearing;
  }
  const drop = stated(Sym.SUPPORT_HEIGHT, 'Support height', Math.max(150, 2 * height));
  const post = Math.min(stated(Sym.SUPPORT_POST_WIDTH, 'Support width', Math.max(80, width / 2)), r1 - inner);
  for (let k = 0; k < count; k++) {
    const block = kernel.extrude(rectangle(r1 - post, r1, -post / 2, post / 2), z0 - drop, z0);
    solids.push(kernel.rotateZ(block, placement.azimuth + (k * 360) / count));
  }
  notes.push(
    representedNote(
      `The ${count} supports are drawn as plain posts under the ring's outer edge: §16.13 reads them only as the forces F_S they react`,
      'ring supports',
      'legs, beams or brackets',
      `posts ${mm(post)} square`,
      true
    )
  );

  return {
    solids,
    footprint: height / 2 + bearing,
    attachment: loose === 1 ? { axial: bearing, circumferentialDeg: 360, thickness: bearing } : { axial: height, circumferentialDeg: 360, thickness: plate ?? width },
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
  const coil = kernel.cut(kernel.helicalTube(outside, pitch, z, rise, reach), [
    kernel.helicalTube(outside, pitch, z, rise, radius),
    shellOutside,
  ]);
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
