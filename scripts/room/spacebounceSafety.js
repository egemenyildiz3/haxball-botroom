const { handleRoomReadError } = require('./runtimeHealth');

const DEFAULT_MAP_BOUNDS = {
  minX: -1200,
  maxX: 1200,
  minY: -600,
  maxY: 600,
};

const DEFAULT_SAFE_MARGIN = 80;
const RECOVERY_DELAY_MS = 2 * 1000;
const POST_GOAL_RECOVERY_GRACE_MS = 4 * 1000;
const GAME_START_RECOVERY_GRACE_MS = 2 * 1000;

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
  return ballPosition.y < bounds.minY
    || ballPosition.y > bounds.maxY
    || ballPosition.x < bounds.minX
    || ballPosition.x > bounds.maxX;
}

function fallbackT(key) {
  const messages = {
    'ball.outWarning': '⚠️ Top dışarı çıktı, 2 saniye içinde içeri çekilecek.',
    'ball.recovered': '⚠️ Dışarı çıkan top içeri çekildi.',
  };
  return messages[key] || key;
}

function isRecoveryTemporarilySuspended(state, now = Date.now()) {
  if (!state) return false;
  return (state.lastGoalAt && now - state.lastGoalAt < POST_GOAL_RECOVERY_GRACE_MS)
    || (state.lastGameStartAt && now - state.lastGameStartAt < GAME_START_RECOVERY_GRACE_MS);
}

function repairOutOfBoundsBall(room, state, sendMsg, t = fallbackT, config = {}) {
  if (typeof room.getBallPosition !== 'function') return;

  let ballPosition = null;
  try {
    ballPosition = room.getBallPosition();
  } catch (err) {
    handleRoomReadError('BALL RECOVERY', err);
    state.ballRecovery = null;
    return;
  }
  if (!ballPosition) return;

  if (isRecoveryTemporarilySuspended(state)) {
    state.ballRecovery = null;
    return;
  }

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

  try {
    room.setDiscProperties(0, {
      x,
      y,
      xspeed: 0,
      yspeed: 0,
    });
  } catch (err) {
    handleRoomReadError('BALL RECOVERY', err);
    state.ballRecovery = null;
    return;
  }
  state.ballRecovery = null;
  sendMsg(room, t('ball.recovered'), null, 0xFFCC00, 'bold');
}

module.exports = {
  DEFAULT_MAP_BOUNDS,
  DEFAULT_SAFE_MARGIN,
  RECOVERY_DELAY_MS,
  POST_GOAL_RECOVERY_GRACE_MS,
  GAME_START_RECOVERY_GRACE_MS,
  recoverySettings,
  nearestSafeCorner,
  isOutOfBoundsPosition,
  isRecoveryTemporarilySuspended,
  repairOutOfBoundsBall,
};
