const assert = require('assert');
const {
  DEFAULT_MAP_BOUNDS,
  isOutOfBoundsPosition,
  nearestSafeCorner,
} = require('./spacebounceSafety');

const V3_BOUNDS = {
  minX: -550,
  maxX: 550,
  minY: -240,
  maxY: 240,
  goalMinY: -80,
  goalMaxY: 80,
};

function run() {
  assert.equal(isOutOfBoundsPosition({ x: 700, y: 120 }, DEFAULT_MAP_BOUNDS), false);
  assert.equal(isOutOfBoundsPosition({ x: 700, y: 120 }, V3_BOUNDS), true);
  assert.equal(isOutOfBoundsPosition({ x: 700, y: 0 }, V3_BOUNDS), false);
  assert.equal(isOutOfBoundsPosition({ x: 0, y: 260 }, V3_BOUNDS), true);

  assert.deepEqual(nearestSafeCorner({ x: 700, y: 260 }, V3_BOUNDS, 45), {
    x: 505,
    y: 195,
  });
  assert.deepEqual(nearestSafeCorner({ x: -700, y: -260 }, V3_BOUNDS, 45), {
    x: -505,
    y: -195,
  });

  console.log('spacebounceSafety validation tests passed');
}

run();
