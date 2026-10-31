# femo-geometry — roadmap

Two capability gaps, found by the hard demo assemblies (`demo_assemblies_hard.md`, built by
`simulation-platform/_scripts/demo_assemblies_hard.py`). Named here; **neither is started**.

## 1. Features that conform to, or sweep along, a curved surface

**What fails today.** G's reinforcing pad on a torispherical knuckle and F's helical half-pipe
failed for the same reason: the kernel builds attached features from cylinders and revolutions
only.

- A pad is a band of a *cylinder* intersected with a tube round the neck (`builders/nozzles.ts`).
  It needs `hostSurface.outsideRadius`, which only a straight cylindrical course offers, and a
  neck normal to that cylinder. On a head, a cone, or for a hillside or tilted neck it is
  "stated, not built".
- A nozzle on a head is carried parallel to the vessel axis (`head_crown`'s frame has axis
  `[0, 0, 1]`) and must sit inside the head's inside radius. "Normal to the head surface" cannot
  be expressed, and an opening reaching the knuckle's outer circle is out of scope.
- A half-pipe jacket is closed rings revolved round the axis, at a pitch the kernel chooses, over
  the whole host course (`builders/supports.ts`). There is no sweep in the kernel interface.

**What it predicts.** The same wall stops the following: wear plates on saddles anywhere other
than a cylinder, pads on any head (routine construction, not an edge case), jackets, and weld
build-up on curved surfaces.

**What it would take.** The gap has two halves, of very different cost.

- *Conforming — about 2 to 3 days, and cheapest of everything here.* Every host is a surface of
  revolution whose meridian and thickness the kernel already knows (`meridian`, `wallAt`, the
  Bézier-fitted outside of the ellipsoidal head). So the change is local:
  - a host offers a band of its own outside surface, offset by a thickness over a meridional
    range;
  - a pad becomes that band intersected with the tube round the neck, exactly as today's
    cylinder pad is;
  - `head_crown`'s frame turns its axis to the surface normal, and the anchor gains a direction;
  - the head's scope limit moves from "inside radius" to "on the head's surface".
  
  No schema change is needed: `pad_width` and `pad_thickness` exist. What remains hard is an
  opening that runs off its host onto the neighbouring part — G's 800 mm neck reaches the
  straight flange. That needs an opening cut through two parts, the same thing E's straddling
  nozzle needs.
- *Sweeping — about a week, with real risk.* OCCT can sweep a profile along a helix, and brepjs
  exposes OCCT's pipe sweep. The risk lies elsewhere:
  - fusing a long helical sweep to a cylinder is the boolean most likely to fail or be slow;
  - its tessellation is large;
  - a mesher wants a helix's welds as a continuous discontinuity, which `zones.ts` does not have
    a kind for.
  
  The type also needs a pitch and an extent (start and length on the course), a schema change
  the engine session owns, since §4.11.6 reads neither. The rings stay as the fallback, declared
  as a representation.

## 2. Placement assumes an axis of revolution

**What fails today.** I's nozzles could not be placed: the obround body has no host surface,
and the backend refuses any placement on it.
- A placement is `(anchor, axialOffset, azimuth)`: an offset along the vessel axis and an angle
  round it. That is meaningless on a flat side.
- The same assumption runs through everything downstream:
  - the run is stacked along one axis;
  - the zones' meridian path and the √(R·t) influence length are built on it, and R is infinite
    on a flat stayed panel;
  - nothing in the catalogue closes a non-circular end, so a flat head next to an obround body
    now refuses rather than floating.

**What it would take — about 2 to 3 weeks, and the most expensive of the two**, because it
changes a contract four parties read:
- the placement itself: a new anchor, `surface_uv`, naming a face semantically (`flat_side_+y`,
  `curved_end_+x`), with in-plane coordinates. It goes into `definition.ts` and the backend's
  `ComponentPlacement`, as a V85x migration of the `anchor` check.
- in the kernel: a `HostSurface` per non-revolution builder (rectangular, obround, octagonal),
  each with its frame, cavity, side test and wall. Plus closures for non-circular ends.
- in the UI: the inspector and the drag constraint, which today move a part along `(offset,
  azimuth)` only.
- in the zones: an influence length for plates, a mechanical decision rather than a geometric
  one, the plate analogue of √(R·t). Distances would be measured on a developed face rather than
  along a meridian.
- in the meshing session's consumption of placements and zones, which must be told first.

**Which is cheaper.** Conforming features, by a wide margin: no contract changes, and the pad on
a head unblocks routine construction. Then the helical sweep. Placement on a surface last, and
only after the engine and meshing sessions agree on the anchor.
