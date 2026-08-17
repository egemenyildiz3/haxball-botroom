const MAP_BOUNDS = {
  minX: -1200,
  maxX: 1200,
  minY: -600,
  maxY: 600,
  goalMinY: -110,
  goalMaxY: 110,
};

const SAFE_MARGIN = 80;

function nearestSafeCorner(pos) {
  const left = {
    x: MAP_BOUNDS.minX + SAFE_MARGIN,
    y: pos.y < 0 ? MAP_BOUNDS.minY + SAFE_MARGIN : MAP_BOUNDS.maxY - SAFE_MARGIN,
  };
  const right = {
    x: MAP_BOUNDS.maxX - SAFE_MARGIN,
    y: pos.y < 0 ? MAP_BOUNDS.minY + SAFE_MARGIN : MAP_BOUNDS.maxY - SAFE_MARGIN,
  };

  if (pos.x < MAP_BOUNDS.minX) return left;
  if (pos.x > MAP_BOUNDS.maxX) return right;

  return {
    x: pos.x < 0 ? left.x : right.x,
    y: pos.y < 0 ? MAP_BOUNDS.minY + SAFE_MARGIN : MAP_BOUNDS.maxY - SAFE_MARGIN,
  };
}

function repairOutOfBoundsBall(room, sendMsg) {
  if (typeof room.getBallPosition !== 'function') return;

  const ballPosition = room.getBallPosition();
  if (!ballPosition) return;

  let isOutOfBounds = ballPosition.y < MAP_BOUNDS.minY || ballPosition.y > MAP_BOUNDS.maxY;

  const isInsideGoalY = ballPosition.y > MAP_BOUNDS.goalMinY && ballPosition.y < MAP_BOUNDS.goalMaxY;

  if (!isInsideGoalY) {
    isOutOfBounds = isOutOfBounds || ballPosition.x < MAP_BOUNDS.minX || ballPosition.x > MAP_BOUNDS.maxX;
  }

  if (isOutOfBounds && typeof room.setDiscProperties === 'function') {
    const { x, y } = nearestSafeCorner(ballPosition);

    room.setDiscProperties(0, {
      x,
      y,
      xspeed: 0,
      yspeed: 0,
    });
    sendMsg(room, '⚠️ Dışarı çıkan top içeri çekildi.', null, 0xFFCC00, 'bold');
  }
}

module.exports = {
  MAP_BOUNDS,
  SAFE_MARGIN,
  nearestSafeCorner,
  repairOutOfBoundsBall,
};
