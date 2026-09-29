/*
 * Minimal vector and quaternion math for the solver.
 *
 * Deliberately not three.js: the solver must stay free of renderer types
 * (CLAUDE.md), and this is the surface that maps onto glam if the Rust port
 * happens (SPEC.md section 10). Everything takes an out-parameter and
 * allocates nothing, so the solver can run at frame rate without churn.
 *
 * Quaternions are xyzw, matching three.js and glTF.
 */

export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

const EPS = 1e-6;

export function v3(x = 0, y = 0, z = 0): V3 {
  return [x, y, z];
}

export function quat(): Q4 {
  return [0, 0, 0, 1];
}

export function sub(out: V3, a: Readonly<V3>, b: Readonly<V3>): V3 {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}

export function cross(out: V3, a: Readonly<V3>, b: Readonly<V3>): V3 {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

export function dot(a: Readonly<V3>, b: Readonly<V3>): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function length(a: Readonly<V3>): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/** Falls back to +X on a degenerate input so callers never see NaN. */
export function normalize(out: V3, a: Readonly<V3>): V3 {
  const len = length(a);
  if (len < EPS) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  out[0] = a[0] / len;
  out[1] = a[1] / len;
  out[2] = a[2] / len;
  return out;
}

export function copyV3(out: V3, a: Readonly<V3>): V3 {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  return out;
}

/** Component of `a` perpendicular to unit vector `axis`. */
export function rejectFrom(out: V3, a: Readonly<V3>, axis: Readonly<V3>): V3 {
  const d = dot(a, axis);
  out[0] = a[0] - axis[0] * d;
  out[1] = a[1] - axis[1] * d;
  out[2] = a[2] - axis[2] * d;
  return out;
}

export function identity(out: Q4): Q4 {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[3] = 1;
  return out;
}

export function copyQ(out: Q4, a: Readonly<Q4>): Q4 {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  out[3] = a[3];
  return out;
}

/** Hamilton product: the rotation `b` followed by `a`. */
export function multiply(out: Q4, a: Readonly<Q4>, b: Readonly<Q4>): Q4 {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** Conjugate, which is the inverse for unit quaternions. */
export function invert(out: Q4, a: Readonly<Q4>): Q4 {
  out[0] = -a[0];
  out[1] = -a[1];
  out[2] = -a[2];
  out[3] = a[3];
  return out;
}

export function setAxisAngle(out: Q4, axis: Readonly<V3>, angle: number): Q4 {
  const half = angle * 0.5;
  const s = Math.sin(half);
  out[0] = axis[0] * s;
  out[1] = axis[1] * s;
  out[2] = axis[2] * s;
  out[3] = Math.cos(half);
  return out;
}

export function rotateV3(out: V3, q: Readonly<Q4>, v: Readonly<V3>): V3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 * (q.xyz x v); v' = v + qw * t + q.xyz x t
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + qy * tz - qz * ty;
  out[1] = vy + qw * ty + qz * tx - qx * tz;
  out[2] = vz + qw * tz + qx * ty - qy * tx;
  return out;
}

const tmpAxis: V3 = [0, 0, 0];

/**
 * Minimal-arc rotation taking unit `from` to unit `to`.
 *
 * This is a swing only -- rotation about the resulting axis is unconstrained,
 * which is the 2-DOF limit described in SPEC.md 5.6. Twist must be applied
 * separately where data for it exists.
 */
export function fromUnitVectors(out: Q4, from: Readonly<V3>, to: Readonly<V3>): Q4 {
  let r = dot(from, to) + 1;

  if (r < EPS) {
    // Antiparallel: any perpendicular axis is a valid 180-degree rotation.
    r = 0;
    if (Math.abs(from[0]) > Math.abs(from[2])) {
      tmpAxis[0] = -from[1];
      tmpAxis[1] = from[0];
      tmpAxis[2] = 0;
    } else {
      tmpAxis[0] = 0;
      tmpAxis[1] = -from[2];
      tmpAxis[2] = from[1];
    }
  } else {
    cross(tmpAxis, from, to);
  }

  out[0] = tmpAxis[0];
  out[1] = tmpAxis[1];
  out[2] = tmpAxis[2];
  out[3] = r;
  return normalizeQ(out, out);
}

export function normalizeQ(out: Q4, a: Readonly<Q4>): Q4 {
  const len = Math.hypot(a[0], a[1], a[2], a[3]);
  if (len < EPS) return identity(out);
  out[0] = a[0] / len;
  out[1] = a[1] / len;
  out[2] = a[2] / len;
  out[3] = a[3] / len;
  return out;
}

/**
 * Rotation matching an orthonormal basis given as its three column axes.
 *
 * The basis must be right-handed and orthonormal; callers re-orthogonalise
 * before calling, since landmark-derived axes never are exactly.
 */
export function fromBasis(out: Q4, x: Readonly<V3>, y: Readonly<V3>, z: Readonly<V3>): Q4 {
  const m00 = x[0], m10 = x[1], m20 = x[2];
  const m01 = y[0], m11 = y[1], m21 = y[2];
  const m02 = z[0], m12 = z[1], m22 = z[2];
  const trace = m00 + m11 + m22;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    out[3] = 0.25 / s;
    out[0] = (m21 - m12) * s;
    out[1] = (m02 - m20) * s;
    out[2] = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    out[3] = (m21 - m12) / s;
    out[0] = 0.25 * s;
    out[1] = (m01 + m10) / s;
    out[2] = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    out[3] = (m02 - m20) / s;
    out[0] = (m01 + m10) / s;
    out[1] = 0.25 * s;
    out[2] = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    out[3] = (m10 - m01) / s;
    out[0] = (m02 + m20) / s;
    out[1] = (m12 + m21) / s;
    out[2] = 0.25 * s;
  }
  return normalizeQ(out, out);
}

/**
 * Spherical interpolation. Used to spread one rotation across a bone chain
 * (SPEC.md 5.4) and to ease toward idle when tracking degrades.
 */
export function slerp(out: Q4, a: Readonly<Q4>, b: Readonly<Q4>, t: number): Q4 {
  let [bx, by, bz, bw] = b;
  let cosom = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;

  // Take the shorter arc.
  if (cosom < 0) {
    cosom = -cosom;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }

  let scale0: number;
  let scale1: number;
  if (1 - cosom > EPS) {
    const omega = Math.acos(cosom);
    const sinom = Math.sin(omega);
    scale0 = Math.sin((1 - t) * omega) / sinom;
    scale1 = Math.sin(t * omega) / sinom;
  } else {
    // Nearly identical: lerp avoids the division blowing up.
    scale0 = 1 - t;
    scale1 = t;
  }

  out[0] = scale0 * a[0] + scale1 * bx;
  out[1] = scale0 * a[1] + scale1 * by;
  out[2] = scale0 * a[2] + scale1 * bz;
  out[3] = scale0 * a[3] + scale1 * bw;
  return out;
}

const IDENTITY: Q4 = [0, 0, 0, 1];

/** Scales a rotation toward identity. Used for the torso split. */
export function scaleRotation(out: Q4, q: Readonly<Q4>, t: number): Q4 {
  return slerp(out, IDENTITY, q, t);
}
