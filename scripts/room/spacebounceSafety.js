const DEFAULT_MAP_BOUNDS = {
  minX: -1200,
  maxX: 1200,
  minY: -600,
  maxY: 600,
  goalMinY: -110,
  goalMaxY: 110,
};

const DEFAULT_SAFE_MARGIN = 80;
const RECOVERY_DELAY_MS = 2 * 1000;

function recoverySettings(config = {}) {
  const recovery = config.ballRecovery || {};
  return {
    bounds: { ...DEFAULT_MAP_BOUNDS, ...(recovery.bounds || {}) },
    safeMargin: Number.isFinite(recovery.safeMargin) ? recovery.safeMargin : DEFAULT_SAFE_MARGIN,
  };
}

function nearestSafeCorner(pos, bounds = DEFAULT_MAP_BOUNDS, safeMargin = DEFAULT_SAFE_MARGIN) {
  const left = {
    x: bounds.minX + safeMargin,
    y: pos.y < 0 ? bounds.minY + safeMargin : bounds.maxY - safeMargin,
  };
  const right = {
    x: bounds.maxX - safeMargin,
    y: pos.y < 0 ? bounds.minY + safeMargin : bounds.maxY - safeMargin,
  };

  if (pos.x < bounds.minX) return left;
  if (pos.x > bounds.maxX) return right;

  return {
    x: pos.x < 0 ? left.x : right.x,
    y: pos.y < 0 ? bounds.minY + safeMargin : bounds.maxY - safeMargin,
  };
}

function isOutOfBoundsPosition(ballPosition, bounds = DEFAULT_MAP_BOUNDS) {
  let isOutOfBounds = ballPosition.y < bounds.minY || ballPosition.y > bounds.maxY;

  const isInsideGoalY = ballPosition.y > bounds.goalMinY && ballPosition.y < bounds.goalMaxY;

  if (!isInsideGoalY) {
    isOutOfBounds = isOutOfBounds || ballPosition.x < bounds.minX || ballPosition.x > bounds.maxX;
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

function repairOutOfBoundsBall(room, state, sendMsg, t = fallbackT, config = {}) {
  if (typeof room.getBallPosition !== 'function') return;

  const ballPosition = room.getBallPosition();
  if (!ballPosition) return;

  const { bounds, safeMargin } = recoverySettings(config);

  if (!isOutOfBoundsPosition(ballPosition, bounds)) {
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

  const { x, y } = nearestSafeCorner(ballPosition, bounds, safeMargin);

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
  DEFAULT_MAP_BOUNDS,
  DEFAULT_SAFE_MARGIN,
  RECOVERY_DELAY_MS,
  recoverySettings,
  nearestSafeCorner,
  isOutOfBoundsPosition,
  repairOutOfBoundsBall,
};
