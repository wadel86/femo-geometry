import type { AssemblyDefinition, ComponentDefinition, Placement } from '../src/definition.ts';
import { createBrepjsKernel } from '../src/kernel/brepjsKernel.ts';

export const kernel = await createBrepjsKernel();

export const part = (
  id: string,
  kind: string,
  dimensions: Record<string, number>,
  position = 0,
  hostId: string | null = null
): ComponentDefinition => ({ id, name: id, kind, position, hostId, dimensions });

/** ASME F&D proportions: crown radius = D, knuckle radius = 6 % of D. */
export const fdHead = (id: string, position: number, diameter = 5000): ComponentDefinition =>
  part(id, 'torispherical_head', {
    inside_diameter: diameter,
    crown_radius: diameter,
    knuckle_radius: 0.06 * diameter,
    thickness: 100,
  }, position);

export const nozzle = (id: string, hostId: string): ComponentDefinition =>
  part(id, 'radial_nozzle', {
    nozzle_inside_diameter: 400,
    nozzle_thickness: 20,
    nozzle_outward_projection: 300,
  }, 0, hostId);

export const shellSide = (axialOffset: number, azimuth: number): Placement => ({
  anchor: 'shell_side',
  axialOffset,
  azimuth,
});

/** The definition-of-done vessel: Ø5000 × 100 shell, two heads, three nozzles. */
export function referenceVessel(shellDiameter = 5000): AssemblyDefinition {
  return {
    components: [
      fdHead('Bottom head', 0, shellDiameter),
      part('Shell', 'cylindrical_shell', { inside_diameter: shellDiameter, thickness: 100, course_length: 8000 }, 1),
      fdHead('Top head', 2, shellDiameter),
      nozzle('N1', 'Shell'),
      nozzle('N2', 'Shell'),
      nozzle('N3', 'Shell'),
    ],
    placements: {
      N1: shellSide(2000, 0),
      N2: shellSide(4000, 90),
      N3: shellSide(6000, 200),
    },
    reversed: [],
  };
}
