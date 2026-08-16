const MAP_BOUNDS = {
  minX: -1200,
  maxX: 1200,
  minY: -600,
  maxY: 600,
  goalMinY: -110,
  goalMaxY: 110,
};

function repairOutOfBoundsBall(room, sendMsg) {
  if (typeof room.getBallPosition !== 'function') return;

  const ballPosition = room.getBallPosition();
  if (!ballPosition) return;

  let isOutOfBounds = false;
  let newX = ballPosition.x;
  let newY = ballPosition.y;

  if (ballPosition.y < MAP_BOUNDS.minY) {
    newY = MAP_BOUNDS.minY + 20;
    isOutOfBounds = true;
  } else if (ballPosition.y > MAP_BOUNDS.maxY) {
    newY = MAP_BOUNDS.maxY - 20;
    isOutOfBounds = true;
  }

  const isInsideGoalY = ballPosition.y > MAP_BOUNDS.goalMinY && ballPosition.y < MAP_BOUNDS.goalMaxY;

  if (!isInsideGoalY) {
    if (ballPosition.x < MAP_BOUNDS.minX) {
      newX = MAP_BOUNDS.minX + 20;
      isOutOfBounds = true;
    } else if (ballPosition.x > MAP_BOUNDS.maxX) {
      newX = MAP_BOUNDS.maxX - 20;
      isOutOfBounds = true;
    }
  }

  if (isOutOfBounds && typeof room.setDiscProperties === 'function') {
    room.setDiscProperties(0, {
      x: newX,
      y: newY,
      xspeed: 0,
      yspeed: 0,
    });
    sendMsg(room, '⚠️ Dışarı çıkan top içeri çekildi.', null, 0xFFCC00, 'bold');
  }
}

module.exports = {
  MAP_BOUNDS,
  repairOutOfBoundsBall,
};
