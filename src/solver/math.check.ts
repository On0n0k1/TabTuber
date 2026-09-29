/*
 * Sanity checks for the solver math, run with `npm run check:math`.
 *
 * Node runs TypeScript directly, so this needs no test framework. It exists
 * because a sign error in a quaternion basis is invisible until it shows up
 * as an avatar bending the wrong way, by which point several layers are
 * suspect. It is also the reference the Rust port must reproduce if the
 * solver moves to wasm (SPEC.md section 10).
 *
 * Never imported by the app, so it is not part of the bundle.
 */

import * as M from "./math.ts";

let failures = 0;
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) { failures++; console.log(`FAIL  ${name} ${detail}`); }
  else console.log(`ok    ${name}`);
}

function vecNear(a: number[], b: number[], eps = 1e-6) {
  return a.every((v, i) => near(v, b[i]!, eps));
}

const q = M.quat(); const v: M.V3 = [0, 0, 0];

// 1. +X -> +Y is 90 deg about +Z
M.fromUnitVectors(q, [1, 0, 0], [0, 1, 0]);
check("fromUnitVectors X->Y", vecNear(q, [0, 0, Math.SQRT1_2, Math.SQRT1_2]), JSON.stringify(q));

// 2. and it actually maps X onto Y
M.rotateV3(v, q, [1, 0, 0]);
check("rotateV3 applies it", vecNear(v, [0, 1, 0]), JSON.stringify(v));

// 3. identity basis -> identity quat
M.fromBasis(q, [1, 0, 0], [0, 1, 0], [0, 0, 1]);
check("fromBasis identity", vecNear(q, [0, 0, 0, 1]), JSON.stringify(q));

// 4. 90 deg about +Y: X->-Z, Z->+X
M.fromBasis(q, [0, 0, -1], [0, 1, 0], [1, 0, 0]);
check("fromBasis yaw90", vecNear(q, [0, Math.SQRT1_2, 0, Math.SQRT1_2]), JSON.stringify(q));
M.rotateV3(v, q, [1, 0, 0]);
check("fromBasis yaw90 maps X->-Z", vecNear(v, [0, 0, -1]), JSON.stringify(v));

// 5. inverse roundtrip
const a = M.quat(); M.fromUnitVectors(a, M.normalize(M.v3(), [0.3, 0.5, -0.8]), M.normalize(M.v3(), [-0.2, 0.9, 0.1]));
const inv = M.quat(); M.invert(inv, a);
const r = M.quat(); M.multiply(r, a, inv);
check("q * q^-1 = identity", vecNear(r, [0, 0, 0, 1]), JSON.stringify(r));

// 6. multiply order: (a then b) == multiply(b, a) applied to vector
const qa = M.quat(); M.setAxisAngle(qa, [0, 0, 1], Math.PI / 2); // X->Y
const qb = M.quat(); M.setAxisAngle(qb, [1, 0, 0], Math.PI / 2); // Y->Z
const comp = M.quat(); M.multiply(comp, qb, qa);
M.rotateV3(v, comp, [1, 0, 0]);
check("multiply(b,a) = b after a", vecNear(v, [0, 0, 1]), JSON.stringify(v));

// 7. slerp endpoints and halfway
const half = M.quat(); M.slerp(half, [0, 0, 0, 1], qa, 0.5);
M.rotateV3(v, half, [1, 0, 0]);
check("slerp half of 90deg = 45deg", near(Math.atan2(v[1], v[0]), Math.PI / 4), JSON.stringify(v));

// 8. scaleRotation(q, 1) == q, scaleRotation(q, 0) == identity
const s1 = M.quat(); M.scaleRotation(s1, qa, 1);
const s0 = M.quat(); M.scaleRotation(s0, qa, 0);
check("scaleRotation t=1", vecNear(s1, qa));
check("scaleRotation t=0", vecNear(s0, [0, 0, 0, 1]));

// 9. antiparallel case must not produce NaN
M.fromUnitVectors(q, [1, 0, 0], [-1, 0, 0]);
M.rotateV3(v, q, [1, 0, 0]);
check("antiparallel X->-X", vecNear(v, [-1, 0, 0], 1e-5), JSON.stringify(v));

// 10. rejectFrom removes the axial component
M.rejectFrom(v, [1, 2, 3], [0, 1, 0]);
check("rejectFrom", vecNear(v, [1, 0, 3]), JSON.stringify(v));

// 11. handedness: left(+X) cross up(+Y) = forward(+Z), per coords.ts
M.cross(v, [1, 0, 0], [0, 1, 0]);
check("left x up = forward", vecNear(v, [0, 0, 1]), JSON.stringify(v));

// Throwing rather than process.exit keeps node globals out of the browser
// sources; an uncaught throw still exits nonzero for CI.
if (failures > 0) throw new Error(`${failures} math check failure(s)`);
console.log("\nALL PASS");
