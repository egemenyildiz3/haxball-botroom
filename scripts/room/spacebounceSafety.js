const MAP_BOUNDS = {
  minX: -1200,
  maxX: 1200,
  minY: -600,
  maxY: 600,
  goalMinY: -110,
  goalMaxY: 110,
};

const SAFE_MARGIN = 80;
const RECOVERY_DELAY_MS = 2 * 1000;

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

function isOutOfBoundsPosition(ballPosition) {
  let isOutOfBounds = ballPosition.y < MAP_BOUNDS.minY || ballPosition.y > MAP_BOUNDS.maxY;

  const isInsideGoalY = ballPosition.y > MAP_BOUNDS.goalMinY && ballPosition.y < MAP_BOUNDS.goalMaxY;

  if (!isInsideGoalY) {
    isOutOfBounds = isOutOfBounds || ballPosition.x < MAP_BOUNDS.minX || ballPosition.x > MAP_BOUNDS.maxX;
  }

  return isOutOfBounds;
}

function fallbackT(key) {
  const messages = {
    'ball.outWarning': '⚠️ Top dışarı çıktı, 2 saniye içinde içeri çekilecek.',
    'ball.recovered': '⚠️ Dışarı çıkan top içeri çekildi.',
  };
  return messages[key] || key;
}

function repairOutOfBoundsBall(room, state, sendMsg, t = fallbackT) {
  if (typeof room.getBallPosition !== 'function') return;

  const ballPosition = room.getBallPosition();
  if (!ballPosition) return;

  if (!isOutOfBoundsPosition(ballPosition)) {
    state.ballRecovery = null;
    return;
  }

  if (!state.ballRecovery) {
    state.ballRecovery = { startedAt: Date.now() };
    sendMsg(room, t('ball.outWarning'), null, 0xFFCC00, 'bold');
    return;
  }

  if (Date.now() - state.ballRecovery.startedAt < RECOVERY_DELAY_MS) return;
  if (typeof room.setDiscProperties !== 'function') return;

  const { x, y } = nearestSafeCorner(ballPosition);

  room.setDiscProperties(0, {
    x,
    y,
    xspeed: 0,
    yspeed: 0,
  });
  state.ballRecovery = null;
  sendMsg(room, t('ball.recovered'), null, 0xFFCC00, 'bold');
}

module.exports = {
  MAP_BOUNDS,
  SAFE_MARGIN,
  RECOVERY_DELAY_MS,
  nearestSafeCorner,
  isOutOfBoundsPosition,
  repairOutOfBoundsBall,
};
