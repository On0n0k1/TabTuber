/*
 * MediaPipe hand landmark topology (21 points per hand).
 *
 * Only the palm points are used. The avatar has mitten hands and no finger
 * bones (SPEC.md 7.1), so fingers are tracked but not rendered -- they are
 * here to give a well-conditioned palm frame, which is the thing the pose
 * model's three crude knuckle estimates cannot provide.
 */

export const HAND = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

/**
 * The rigid palm landmarks, in winding order around the palm.
 *
 * Rigid is the operative word: these five keep fixed positions relative to
 * each other whatever the fingers do. Middle joints and fingertips move with
 * finger curl, so including them would measure finger pose rather than palm
 * pose.
 *
 * Order matters -- it traces the outline of the palm, which is what makes an
 * area-weighted plane fit over consecutive pairs meaningful.
 */
export const PALM_RIM: readonly number[] = [
  HAND.WRIST,
  HAND.INDEX_MCP,
  HAND.MIDDLE_MCP,
  HAND.RING_MCP,
  HAND.PINKY_MCP,
];

/**
 * Knuckles only, averaged to give the hand's forward direction.
 *
 * Averaging four knuckles rather than taking the middle one alone costs
 * nothing and halves the noise on the one vector with any real length
 * (SPEC.md 5.6.1).
 */
export const PALM_KNUCKLES: readonly number[] = [
  HAND.INDEX_MCP,
  HAND.MIDDLE_MCP,
  HAND.RING_MCP,
  HAND.PINKY_MCP,
];

/** Standard MediaPipe hand topology, for drawing. */
export const HAND_CONNECTIONS: readonly (readonly [number, number])[] = [
  [HAND.WRIST, HAND.THUMB_CMC], [HAND.THUMB_CMC, HAND.THUMB_MCP],
  [HAND.THUMB_MCP, HAND.THUMB_IP], [HAND.THUMB_IP, HAND.THUMB_TIP],
  [HAND.WRIST, HAND.INDEX_MCP], [HAND.INDEX_MCP, HAND.INDEX_PIP],
  [HAND.INDEX_PIP, HAND.INDEX_DIP], [HAND.INDEX_DIP, HAND.INDEX_TIP],
  [HAND.INDEX_MCP, HAND.MIDDLE_MCP], [HAND.MIDDLE_MCP, HAND.MIDDLE_PIP],
  [HAND.MIDDLE_PIP, HAND.MIDDLE_DIP], [HAND.MIDDLE_DIP, HAND.MIDDLE_TIP],
  [HAND.MIDDLE_MCP, HAND.RING_MCP], [HAND.RING_MCP, HAND.RING_PIP],
  [HAND.RING_PIP, HAND.RING_DIP], [HAND.RING_DIP, HAND.RING_TIP],
  [HAND.RING_MCP, HAND.PINKY_MCP], [HAND.PINKY_MCP, HAND.PINKY_PIP],
  [HAND.PINKY_PIP, HAND.PINKY_DIP], [HAND.PINKY_DIP, HAND.PINKY_TIP],
  [HAND.WRIST, HAND.PINKY_MCP],
];

/** The thumb, drawn separately so hand orientation is unmistakable. */
export const THUMB_CONNECTIONS: readonly (readonly [number, number])[] = [
  [HAND.WRIST, HAND.THUMB_CMC], [HAND.THUMB_CMC, HAND.THUMB_MCP],
  [HAND.THUMB_MCP, HAND.THUMB_IP], [HAND.THUMB_IP, HAND.THUMB_TIP],
];
