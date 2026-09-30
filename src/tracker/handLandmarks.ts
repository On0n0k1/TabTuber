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
 * Points defining the palm frame.
 *
 * Wrist to middle knuckle is the hand's long axis, and index-to-pinky knuckle
 * spans the palm. Those two are close to perpendicular and both span most of
 * the hand, so the cross product is well conditioned -- unlike the pose
 * model's index and pinky knuckles, which sit about 30 degrees apart and
 * produce a normal dominated by noise (SPEC.md 5.6).
 */
export const PALM = {
  ORIGIN: HAND.WRIST,
  FORWARD: HAND.MIDDLE_MCP,
  INDEX_SIDE: HAND.INDEX_MCP,
  PINKY_SIDE: HAND.PINKY_MCP,
} as const;
