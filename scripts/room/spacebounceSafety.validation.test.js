const assert = require('assert');
const {
  DEFAULT_MAP_BOUNDS,
  isOutOfBoundsPosition,
  isRecoveryTemporarilySuspended,
  nearestSafeCorner,
  repairOutOfBoundsBall,
} = require('./spacebounceSafety');

const V3_BOUNDS = {
  minX: -550,
  maxX: 550,
  minY: -240,
  maxY: 240,
};

function run() {
  assert.equal(isOutOfBoundsPosition({ x: 700, y: 120 }, DEFAULT_MAP_BOUNDS), false);
  assert.equal(isOutOfBoundsPosition({ x: 700, y: 120 }, V3_BOUNDS), true);
  assert.equal(isOutOfBoundsPosition({ x: 700, y: 0 }, V3_BOUNDS), true);
  assert.equal(isOutOfBoundsPosition({ x: 1250, y: 0 }, DEFAULT_MAP_BOUNDS), true);
  assert.equal(isOutOfBoundsPosition({ x: 0, y: 260 }, V3_BOUNDS), true);

  assert.deepEqual(nearestSafeCorner({ x: 700, y: 260 }, V3_BOUNDS, 45), {
    x: 505,
    y: 195,
  });
  assert.deepEqual(nearestSafeCorner({ x: -700, y: -260 }, V3_BOUNDS, 45), {
    x: -505,
    y: -195,
  });

  const now = Date.now();
  assert.equal(isRecoveryTemporarilySuspended({ lastGoalAt: now }, now), true);
  assert.equal(isRecoveryTemporarilySuspended({ lastGameStartAt: now }, now), true);

  let moved = false;
  const state = { lastGoalAt: Date.now(), ballRecovery: { startedAt: Date.now() - 5000 } };
  repairOutOfBoundsBall({
    getBallPosition: () => ({ x: 1300, y: 0 }),
    setDiscProperties: () => { moved = true; },
  }, state, () => {});
  assert.equal(moved, false);
  assert.equal(state.ballRecovery, null);

  console.log('spacebounceSafety validation tests passed');
}

run();
