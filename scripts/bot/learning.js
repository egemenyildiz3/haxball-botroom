const fs = require('fs');
const path = require('path');

const VERSION = 1;
const TUNE_EVERY_TICKS = 7200;
const MIN_KICKS_TO_TUNE = 40;

const DEFAULT_STATE = {
  version: VERSION,
  adjustments: {
    kickAttemptPadding: 0,
    kickHoldTicks: 0,
    ownGoalCarryRange: 0,
    supportBehind: 0,
    teamSpacing: 0,
  },
  lifetime: {
    windows: 0,
    missedKicks: 0,
    successfulKicks: 0,
    badCarryRisk: 0,
    crowdedTicks: 0,
    positionSamples: 0,
  },
  updatedAt: null,
};

const BOUNDS = {
  kickAttemptPadding: [0, 8],
  kickHoldTicks: [0, 2],
  ownGoalCarryRange: [0, 35],
  supportBehind: [-20, 50],
  teamSpacing: [0, 45],
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const cloneDefaultState = () => JSON.parse(JSON.stringify(DEFAULT_STATE));
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);
const dist = (a, b) => len(sub(a, b));

function normalize(a) {
  const l = len(a);
  if (l < 1e-6) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function upfieldOf(view) {
  return normalize(sub(mid(view.oppGoal.p0, view.oppGoal.p1), mid(view.ownGoal.p0, view.ownGoal.p1)));
}

function readState(file, log) {
  if (!file || !fs.existsSync(file)) return cloneDefaultState();

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const state = {
      ...cloneDefaultState(),
      ...parsed,
      adjustments: {
        ...DEFAULT_STATE.adjustments,
        ...(parsed.adjustments || {}),
      },
      lifetime: {
        ...DEFAULT_STATE.lifetime,
        ...(parsed.lifetime || {}),
      },
    };
    state.adjustments = sanitizeAdjustments(state.adjustments);
    return state;
  } catch (err) {
    log(`🤖 [LEARN] Öğrenme dosyası okunamadı, sıfırdan başlanıyor: ${err.message}`);
    return cloneDefaultState();
  }
}

function sanitizeAdjustments(adjustments) {
  const clean = { ...DEFAULT_STATE.adjustments };
  for (const key of Object.keys(clean)) {
    const value = Number(adjustments && adjustments[key]);
    clean[key] = Number.isFinite(value) ? boundedValue(key, value) : clean[key];
  }
  return clean;
}

function boundedValue(key, value) {
  const [min, max] = BOUNDS[key];
  const next = clamp(value, min, max);
  return key === 'kickHoldTicks' ? Math.round(next) : next;
}

function createBotLearner(options = {}) {
  const enabled = options.enabled !== false;
  const file = options.file || null;
  const log = options.log || ((msg) => console.log(msg));
  const state = readState(file, log);
  let revision = 0;
  let tick = 0;
  let window = {
    missedKicks: 0,
    successfulKicks: 0,
    badCarryRisk: 0,
    crowdedTicks: 0,
    positionSamples: 0,
  };

  function save() {
    if (!enabled || !file) return;

    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      state.updatedAt = new Date().toISOString();
      fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
    } catch (err) {
      log(`🤖 [LEARN] Öğrenme dosyası yazılamadı: ${err.message}`);
    }
  }

  function bounded(key, value) {
    return boundedValue(key, value);
  }

  function adjust(key, delta) {
    const current = state.adjustments[key] || 0;
    const next = bounded(key, current + delta);
    if (next === current) return false;
    state.adjustments[key] = next;
    return true;
  }

  function tune() {
    const kicks = window.missedKicks + window.successfulKicks;
    const missRate = kicks > 0 ? window.missedKicks / kicks : 0;
    let changed = false;

    if (kicks >= MIN_KICKS_TO_TUNE && window.missedKicks >= 18 && missRate > 0.42) {
      changed = adjust('kickAttemptPadding', 1) || changed;
      if (window.missedKicks >= 30 && missRate > 0.62) changed = adjust('kickHoldTicks', 1) || changed;
    } else if (window.successfulKicks >= 50 && missRate < 0.18) {
      changed = adjust('kickAttemptPadding', -1) || changed;
      if (window.successfulKicks >= 80 && missRate < 0.1) changed = adjust('kickHoldTicks', -1) || changed;
    }

    if (window.badCarryRisk > 600) {
      changed = adjust('ownGoalCarryRange', 3) || changed;
    } else if (window.badCarryRisk < 80 && kicks >= MIN_KICKS_TO_TUNE) {
      changed = adjust('ownGoalCarryRange', -2) || changed;
    }

    if (window.positionSamples >= 1200 && window.crowdedTicks > 1400) {
      changed = adjust('teamSpacing', 3) || changed;
      changed = adjust('supportBehind', 3) || changed;
    } else if (window.positionSamples >= 1200 && window.crowdedTicks < 250) {
      changed = adjust('teamSpacing', -2) || changed;
      changed = adjust('supportBehind', -2) || changed;
    }

    state.lifetime.windows++;
    for (const key of Object.keys(window)) {
      state.lifetime[key] = (state.lifetime[key] || 0) + window[key];
    }

    if (changed) {
      revision++;
      log(`🤖 [LEARN] Ayarlar güncellendi: ${JSON.stringify(state.adjustments)}`);
    }

    save();
    window = { missedKicks: 0, successfulKicks: 0, badCarryRisk: 0, crowdedTicks: 0, positionSamples: 0 };
  }

  function beginTick() {
    if (!enabled) return;
    tick++;
    if (tick >= TUNE_EVERY_TICKS) {
      tick = 0;
      tune();
    }
  }

  function observe(bot, view, move, cfg) {
    if (!enabled || !view || !move) return;

    const ballSpeed = len(view.ball.speed || { x: 0, y: 0 });
    const upfield = upfieldOf(view);
    if (bot.learningPendingKick) {
      const pending = bot.learningPendingKick;
      pending.ticks--;
      const awayGain = dist(view.ball.pos, view.self.pos) - pending.beforeDist;
      const forwardSpeedGain = dot(view.ball.speed || { x: 0, y: 0 }, upfield) - pending.beforeForwardSpeed;
      const directionChanged = pending.beforeSpeed > 0.35 && ballSpeed > 0.35
        && dot(normalize(pending.beforeBallSpeed), normalize(view.ball.speed || { x: 0, y: 0 })) < 0.65;
      const goodTouch = ballSpeed >= pending.beforeSpeed + 0.45
        || awayGain >= 8
        || forwardSpeedGain >= 0.35
        || directionChanged;

      if (goodTouch) {
        window.successfulKicks++;
        bot.learningPendingKick = null;
      } else if (pending.ticks <= 0) {
        window.missedKicks++;
        bot.learningPendingKick = null;
      }
    }

    const toBall = sub(view.ball.pos, view.self.pos);
    const distToBall = len(toBall);
    const kickWatchRange = (view.self.radius || 15)
      + (view.ball.radius || 10)
      + (cfg.kickPadding || 4)
      + (cfg.kickAttemptPadding || 0)
      + 6;

    if (move.intentKick && distToBall <= kickWatchRange && !bot.learningPendingKick) {
      bot.learningPendingKick = {
        ticks: 7,
        beforeSpeed: ballSpeed,
        beforeBallSpeed: { ...(view.ball.speed || { x: 0, y: 0 }) },
        beforeForwardSpeed: dot(view.ball.speed || { x: 0, y: 0 }, upfield),
        beforeDist: distToBall,
      };
    }

    const carryForwardness = dot(normalize(toBall), upfield);
    if (move.role === 'attacker' && distToBall <= (cfg.ownGoalCarryRange || 70) + 20 && carryForwardness <= (cfg.ownGoalGuard || -0.25)) {
      window.badCarryRisk++;
    }

    if (move.role !== 'attacker') {
      window.positionSamples++;
      const crowded = (view.teammates || []).some((mate) => len(sub(view.self.pos, mate.pos)) < (cfg.teamSpacing || 135) * 0.7);
      if (crowded) window.crowdedTicks++;
    }
  }

  function apply(baseCfg) {
    if (!enabled) return baseCfg;
    const a = state.adjustments;
    return {
      ...baseCfg,
      kickAttemptPadding: (baseCfg.kickAttemptPadding || 7) + a.kickAttemptPadding,
      kickHoldTicks: Math.max(1, Math.round((baseCfg.kickHoldTicks || 2) + a.kickHoldTicks)),
      ownGoalCarryRange: (baseCfg.ownGoalCarryRange || 70) + a.ownGoalCarryRange,
      supportBehind: (baseCfg.supportBehind || 150) + a.supportBehind,
      teamSpacing: (baseCfg.teamSpacing || 135) + a.teamSpacing,
    };
  }

  return {
    apply,
    beginTick,
    observe,
    revision: () => revision,
    save,
    status: () => ({ enabled, file, adjustments: { ...state.adjustments }, lifetime: { ...state.lifetime } }),
  };
}

module.exports = { createBotLearner };
