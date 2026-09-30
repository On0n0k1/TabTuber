/*
 * MediaPipe BlazePose (GHUM) landmark indices and topology.
 *
 * Left/right here are the SUBJECT's left and right as MediaPipe reports them,
 * not screen sides. Mirroring is handled once in the coordinate conversion
 * (SPEC.md 5.1), never by swapping these indices.
 */

export const LM = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export type LandmarkIndex = (typeof LM)[keyof typeof LM];

/**
 * Left/right landmark pairs, used to mirror a pose.
 *
 * Mirroring cannot be done by negating x alone. That is a reflection, which
 * flips handedness, and a reflection is not a rotation -- bases built from
 * such points come out left-handed and the solver's re-orthogonalisation
 * silently turns them into a completely different rotation. Reflecting AND
 * swapping left/right identities composes to a proper rotation, which is
 * what a bilaterally symmetric body actually does in a mirror.
 */
export const MIRROR_PAIRS: readonly (readonly [number, number])[] = [
  [LM.LEFT_EYE_INNER, LM.RIGHT_EYE_INNER],
  [LM.LEFT_EYE, LM.RIGHT_EYE],
  [LM.LEFT_EYE_OUTER, LM.RIGHT_EYE_OUTER],
  [LM.LEFT_EAR, LM.RIGHT_EAR],
  [LM.MOUTH_LEFT, LM.MOUTH_RIGHT],
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_ELBOW, LM.RIGHT_ELBOW],
  [LM.LEFT_WRIST, LM.RIGHT_WRIST],
  [LM.LEFT_PINKY, LM.RIGHT_PINKY],
  [LM.LEFT_INDEX, LM.RIGHT_INDEX],
  [LM.LEFT_THUMB, LM.RIGHT_THUMB],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_KNEE, LM.RIGHT_KNEE],
  [LM.LEFT_ANKLE, LM.RIGHT_ANKLE],
  [LM.LEFT_HEEL, LM.RIGHT_HEEL],
  [LM.LEFT_FOOT_INDEX, LM.RIGHT_FOOT_INDEX],
];

/** Destination slot for each landmark when mirroring. The nose maps to itself. */
export const MIRROR_INDEX: readonly number[] = (() => {
  const map = Array.from({ length: 33 }, (_, i) => i);
  for (const [a, b] of MIRROR_PAIRS) {
    map[a] = b;
    map[b] = a;
  }
  return map;
})();

/**
 * Landmark pairs to draw as bones in the stick figure.
 *
 * Grouped so the debug view can colour by region -- an L/R swap or a mirrored
 * axis is then visible immediately rather than after a hunt (SPEC.md 7.1.2).
 */
export const CONNECTIONS = {
  torso: [
    [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
    [LM.LEFT_SHOULDER, LM.LEFT_HIP],
    [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
    [LM.LEFT_HIP, LM.RIGHT_HIP],
  ],
  head: [
    [LM.LEFT_EAR, LM.NOSE],
    [LM.RIGHT_EAR, LM.NOSE],
    [LM.LEFT_EAR, LM.RIGHT_EAR],
  ],
  leftArm: [
    [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
    [LM.LEFT_ELBOW, LM.LEFT_WRIST],
    [LM.LEFT_WRIST, LM.LEFT_INDEX],
    [LM.LEFT_WRIST, LM.LEFT_PINKY],
    [LM.LEFT_INDEX, LM.LEFT_PINKY],
  ],
  rightArm: [
    [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
    [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
    [LM.RIGHT_WRIST, LM.RIGHT_INDEX],
    [LM.RIGHT_WRIST, LM.RIGHT_PINKY],
    [LM.RIGHT_INDEX, LM.RIGHT_PINKY],
  ],
  leftLeg: [
    [LM.LEFT_HIP, LM.LEFT_KNEE],
    [LM.LEFT_KNEE, LM.LEFT_ANKLE],
    [LM.LEFT_ANKLE, LM.LEFT_HEEL],
    [LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX],
  ],
  rightLeg: [
    [LM.RIGHT_HIP, LM.RIGHT_KNEE],
    [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
    [LM.RIGHT_ANKLE, LM.RIGHT_HEEL],
    [LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX],
  ],
} as const satisfies Record<string, readonly (readonly [number, number])[]>;

export type ConnectionGroup = keyof typeof CONNECTIONS;

export const CONNECTION_GROUPS = Object.keys(CONNECTIONS) as ConnectionGroup[];

/**
 * Landmarks the solver actually reads, for the confidence calculation.
 *
 * Excludes legs and the fine facial points: legs are not driven at all in the
 * seated profile, and eye/mouth landmarks are unused without face tracking.
 * Including them would drag overall confidence down for no reason.
 */
export const SOLVER_LANDMARKS: readonly number[] = [
  LM.NOSE,
  LM.LEFT_EAR,
  LM.RIGHT_EAR,
  LM.LEFT_SHOULDER,
  LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW,
  LM.RIGHT_ELBOW,
  LM.LEFT_WRIST,
  LM.RIGHT_WRIST,
  LM.LEFT_INDEX,
  LM.RIGHT_INDEX,
  LM.LEFT_PINKY,
  LM.RIGHT_PINKY,
  LM.LEFT_HIP,
  LM.RIGHT_HIP,
];

/**
 * Landmarks the solver reads only in standing posture (SPEC.md 5.8).
 *
 * Excluded from the sitting set because a seated subject has these out of
 * frame, and the tracker reports them confidently rather than absent. Folding
 * them into confidence there would drag the whole figure down over a lower
 * body nothing is driving.
 */
export const STANDING_LANDMARKS: readonly number[] = [
  LM.LEFT_KNEE,
  LM.RIGHT_KNEE,
  LM.LEFT_ANKLE,
  LM.RIGHT_ANKLE,
];

/** Landmarks whose hallucination is the reason sitting mode exists. */
export const LEG_LANDMARKS: readonly number[] = [
  LM.LEFT_KNEE,
  LM.RIGHT_KNEE,
  LM.LEFT_ANKLE,
  LM.RIGHT_ANKLE,
  LM.LEFT_HEEL,
  LM.RIGHT_HEEL,
  LM.LEFT_FOOT_INDEX,
  LM.RIGHT_FOOT_INDEX,
];
