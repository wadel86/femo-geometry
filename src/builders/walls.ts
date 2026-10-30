// The mid-surfaces a part's walls state at their ports: what a mesh reads `R/t` off.
import type { WallSurface } from './types.ts';

export const cylinderSurface = (meanRadius: number): WallSurface => ({
  kind: 'cylinder',
  principalRadii: [null, meanRadius],
});

export const sphereSurface = (meanRadius: number): WallSurface => ({
  kind: 'sphere',
  principalRadii: [meanRadius, meanRadius],
});

export const PLANE: WallSurface = { kind: 'plane', principalRadii: [null, null] };
