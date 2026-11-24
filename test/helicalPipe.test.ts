// helicalPipe is helicalTube(outer) less helicalTube(inner), built without the boolean: the same
// solid, to the kernel's own tolerance, on a small coil so the reference boolean stays quick.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kernel } from './fixtures.ts';

const close = (actual: number, expected: number, relative: number) =>
  assert.ok(Math.abs(actual - expected) <= relative * Math.abs(expected), `${actual} is not ${expected} ± ${relative * 100} %`);

test('a helical pipe is the outer tube less the inner one: volume, area, faces and ends', () => {
  const [radius, pitch, from, height, inner, outer] = [300, 70, 40, 140, 20, 26];
  const pipe = kernel.helicalPipe(radius, pitch, from, height, inner, outer);
  const reference = kernel.cut(kernel.helicalTube(radius, pitch, from, height, outer), [kernel.helicalTube(radius, pitch, from, height, inner)]);
  assert.ok(kernel.isValid(pipe));
  // Positive: sewn, the shell is never left inside out.
  assert.ok(kernel.volume(pipe) > 0);
  close(kernel.volume(pipe), kernel.volume(reference), 1e-6);
  close(kernel.surfaceArea(pipe), kernel.surfaceArea(reference), 1e-6);
  // Two swept sides and two annular ends, as the boolean leaves them.
  const faces = kernel.topology(pipe).faces;
  assert.equal(faces.length, kernel.topology(reference).faces.length);
  assert.equal(faces.filter((f) => f.surface === 'plane').length, 2);
  // An annulus swept along the helix: (π(R² − r²))·(the helix's length).
  const length = Math.hypot(2 * Math.PI * radius * (height / pitch), height);
  close(kernel.volume(pipe), Math.PI * (outer ** 2 - inner ** 2) * length, 1e-4);
  const box = kernel.bounds(pipe);
  close(box.min[2]!, from - outer * Math.cos(Math.atan(pitch / (2 * Math.PI * radius))), 1e-3);
});
