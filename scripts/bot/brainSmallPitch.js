'use strict';

const balanced = require('./brain');

const {
  DEFAULTS,
  configFromPhysics,
  navigate,
  selectAttacker,
  solveStrikeIntercept,
} = balanced;

const SMALL_DEFAULTS = {
  cruiseSpeed: 8,
  strikeSpeed: 10,
  strikeImpactSpeed: 1.6,
  predictTicks: 55,
  supportSpread: 95,
  kickPadding: 6,
  releaseTicks: 2,
  preKickReleaseMargin: 14,
  approachDetourRange: 115,
  approachSideOffset: 42,
  approachBehindOffset: 7,
  shootingRange: 520,
  preciseAimRange: 360,
  clearConeCos: -0.2,
  ownGoalGuard: 0.03,
  goalMargin: 0.08,
  unsafeCarrySideOffset: 54,
  safeClearDepth: 0.38,
  safeClearLateral: 0.36,
};

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function normalize(a) {
  const l = Math.hypot(a.x, a.y);
  if (l < 1e-6) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

function fieldOf(view) {
  const f = view.field;
  if (f && Number.isFinite(f.maxX) && Number.isFinite(f.maxY) && f.maxX > f.minX) return f;
  const halfX = Math.max(Math.abs(view.ownGoal.p0.x), Math.abs(view.oppGoal.p0.x)) || 550;
  const halfY = view.stadium && view.stadium.height ? view.stadium.height / 2 : halfX * 0.5;
  return { minX: -halfX, maxX: halfX, minY: -halfY, maxY: halfY };
}

function upfieldOf(view) {
  return normalize(sub(mid(view.oppGoal.p0, view.oppGoal.p1), mid(view.ownGoal.p0, view.ownGoal.p1)));
}

function sideAxisOf(upfield) {
  return { x: -upfield.y, y: upfield.x };
}

function aimPoint(view, cfg) {
  const goal = view.oppGoal;
  const center = mid(goal.p0, goal.p1);
  const postAxis = normalize(sub(goal.p1, goal.p0));
  const inset = Math.max(8, cfg.postInset || DEFAULTS.postInset);
  const postA = add(goal.p0, scale(postAxis, inset));
  const postB = sub(goal.p1, scale(postAxis, inset));

  let nearestOpponent = null;
  let nearestDistance = Infinity;
  for (const opponent of view.opponents || []) {
    const d = len(sub(opponent.pos, center));
    if (d < nearestDistance) {
      nearestDistance = d;
      nearestOpponent = opponent;
    }
  }

  if (!nearestOpponent) return center;
  return len(sub(postA, nearestOpponent.pos)) > len(sub(postB, nearestOpponent.pos)) ? postA : postB;
}

function rayHitsSegment(origin, dir, p0, p1) {
  const seg = sub(p1, p0);
  const denom = dir.x * seg.y - dir.y * seg.x;
  if (Math.abs(denom) < 1e-9) return null;

  const diff = sub(p0, origin);
  const t = (diff.x * seg.y - diff.y * seg.x) / denom;
  const s = (diff.x * dir.y - diff.y * dir.x) / denom;

  if (t <= 0 || s < 0 || s > 1) return null;
  return { s, distance: t };
}

function ballDepthRatio(view) {
  const ownCenter = mid(view.ownGoal.p0, view.ownGoal.p1);
  const oppCenter = mid(view.oppGoal.p0, view.oppGoal.p1);
  const upfield = upfieldOf(view);
  const pitchLength = len(sub(oppCenter, ownCenter)) || (fieldOf(view).maxX - fieldOf(view).minX);
  return clamp(dot(sub(view.ball.pos, ownCenter), upfield) / pitchLength, 0, 1);
}

function safePlayPoint(view, cfg) {
  const depth = ballDepthRatio(view);
  if (depth >= 0.58) return aimPoint(view, cfg);

  const field = fieldOf(view);
  const upfield = upfieldOf(view);
  const sideAxis = sideAxisOf(upfield);
  const side = Math.abs(view.ball.pos.y) < 8
    ? (view.self.id % 2 === 0 ? 1 : -1)
    : Math.sign(view.ball.pos.y);
  const pitchLength = field.maxX - field.minX;
  const fieldHeight = field.maxY - field.minY;

  return {
    x: clamp(
      view.ball.pos.x + upfield.x * pitchLength * cfg.safeClearDepth,
      field.minX * 0.92,
      field.maxX * 0.92
    ),
    y: clamp(
      view.ball.pos.y + sideAxis.y * side * fieldHeight * cfg.safeClearLateral,
      field.minY * 0.82,
      field.maxY * 0.82
    ),
  };
}

function supportSlot(view) {
  const supportIds = [view.self, ...view.teammates]
    .filter((player) => player.id !== view.attackerId)
    .map((player) => player.id)
    .sort((a, b) => a - b);
  const index = supportIds.indexOf(view.self.id);

  if (supportIds.length <= 1) {
    return view.ball.pos.y >= view.self.pos.y ? -0.75 : 0.75;
  }
  return index - (supportIds.length - 1) / 2;
}

function smallSupportTarget(view, cfg) {
  const ownCenter = mid(view.ownGoal.p0, view.ownGoal.p1);
  const oppCenter = mid(view.oppGoal.p0, view.oppGoal.p1);
  const upfield = upfieldOf(view);
  const sideAxis = sideAxisOf(upfield);
  const field = fieldOf(view);
  const pitchLength = len(sub(oppCenter, ownCenter)) || (field.maxX - field.minX);
  const minDepth = pitchLength * 0.12;
  const maxDepth = pitchLength * 0.9;
  const ballDepth = clamp(dot(sub(view.ball.pos, ownCenter), upfield), minDepth, maxDepth);
  const slot = supportSlot(view);
  const spacing = Math.min(cfg.supportSpread, Math.max(42, (field.maxY - field.minY) * 0.2));
  const behind = Math.min(75, Math.max(36, pitchLength * 0.09));
  const desiredDepth = clamp(ballDepth - behind, minDepth, maxDepth);
  const lateral = clamp(
    dot(sub(view.ball.pos, ownCenter), sideAxis) + slot * spacing,
    field.minY * 0.8,
    field.maxY * 0.8
  );

  return add(add(ownCenter, scale(upfield, desiredDepth)), scale(sideAxis, lateral));
}

function unsafeCarryTarget(view, desiredDirection, cfg, memory) {
  const field = fieldOf(view);
  const direction = normalize(desiredDirection);
  const sideAxis = sideAxisOf(direction);
  const ballToSelf = sub(view.self.pos, view.ball.pos);
  const lateral = dot(ballToSelf, sideAxis);

  if (!memory.unsafeCarrySide) {
    if (Math.abs(lateral) > 5) {
      memory.unsafeCarrySide = Math.sign(lateral);
    } else {
      const plusSpace = field.maxY - view.ball.pos.y;
      const minusSpace = view.ball.pos.y - field.minY;
      memory.unsafeCarrySide = plusSpace >= minusSpace ? 1 : -1;
    }
  }

  const contactDistance = (view.self.radius || 15) + (view.ball.radius || 10) + cfg.approachBehindOffset;
  const behind = sub(view.ball.pos, scale(direction, contactDistance));
  const waypoint = add(behind, scale(sideAxis, memory.unsafeCarrySide * cfg.unsafeCarrySideOffset));

  return {
    x: clamp(waypoint.x, field.minX * 0.94, field.maxX * 0.94),
    y: clamp(waypoint.y, field.minY * 0.86, field.maxY * 0.86),
  };
}

function kickIntent(view, cfg) {
  const upfield = upfieldOf(view);
  const target = safePlayPoint(view, cfg);
  const toAim = normalize(sub(target, view.ball.pos));
  const toBall = sub(view.ball.pos, view.self.pos);
  const distToBall = len(toBall);
  const kickRange = (view.self.radius || 15) + (view.ball.radius || 10) + cfg.kickPadding;
  if (distToBall > kickRange) {
    return { canKick: false, inKickRange: false, kickRange, direction: toAim, forwardness: 0 };
  }

  const kickDir = normalize(toBall);
  const ballVelocity = view.ball.speed || { x: 0, y: 0 };
  const resultVelocity = add(ballVelocity, scale(kickDir, cfg.kickStrength));
  const resultDir = normalize(resultVelocity);
  const forwardness = dot(resultDir, upfield);
  const ownGoalHit = rayHitsSegment(view.ball.pos, resultDir, view.ownGoal.p0, view.ownGoal.p1);

  return {
    canKick: forwardness >= cfg.ownGoalGuard && !ownGoalHit,
    inKickRange: true,
    kickRange,
    direction: toAim,
    forwardness,
    ownGoalHit: !!ownGoalHit,
  };
}

function releaseAwareKick(memory, wantsKick, cfg) {
  if (!wantsKick) {
    memory.kickCooldown = 0;
    return false;
  }
  if (memory.kickCooldown > 0) {
    memory.kickCooldown--;
    return false;
  }
  if (memory.lastKeyDown) return false;
  memory.kickCooldown = cfg.releaseTicks;
  return true;
}

function decide(view, memory = {}, config = {}) {
  const cfg = { ...DEFAULTS, ...SMALL_DEFAULTS, ...(config || {}) };
  const idle = { dirX: 0, dirY: 0, kick: false, role: 'idle', braking: false, mode: 'idle' };

  if (!view || !view.self || !view.ball || !view.ownGoal || !view.oppGoal) return idle;
  if (!view.self.pos || !view.ball.pos) return idle;

  const ballDamping = Number.isFinite(view.ball.damping) ? view.ball.damping : cfg.ballDamping;
  const activeCfg = { ...cfg, ballDamping };
  const squad = [view.self, ...(view.teammates || [])];
  const attackerId = squad.some((player) => player.id === view.attackerId)
    ? view.attackerId
    : selectAttacker(squad, view.ball, activeCfg).id;
  const role = view.forceBall || attackerId === view.self.id ? 'attacker' : 'press';

  let target;
  let mode;
  let nav;
  let interceptTicks = 0;
  const playPoint = safePlayPoint(view, activeCfg);
  const playDirection = normalize(sub(playPoint, view.ball.pos));
  const earlyIntent = kickIntent(view, activeCfg);

  if (role === 'attacker') {
    const strikePlan = solveStrikeIntercept(view.self, view.ball, playDirection, activeCfg);
    target = strikePlan.point;
    interceptTicks = strikePlan.ticks;
    if (earlyIntent.inKickRange && !earlyIntent.canKick) {
      target = unsafeCarryTarget(view, playDirection, activeCfg, memory);
    } else {
      memory.unsafeCarrySide = 0;
    }
    nav = navigate(view.self, target, activeCfg, memory, { strike: true, arrivalTicks: strikePlan.ticks });
    mode = earlyIntent.inKickRange && !earlyIntent.canKick
      ? 'reposition'
      : (view.forceBall ? 'kickoff' : 'strike');
  } else {
    target = smallSupportTarget({ ...view, attackerId }, activeCfg);
    const ballDistance = len(sub(view.ball.pos, view.self.pos));
    const chaseDistance = Math.max(70, Math.min(115, activeCfg.supportSpread));
    const teammateCloser = (view.teammates || []).some((mate) =>
      mate.id === attackerId || len(sub(mate.pos, view.ball.pos)) + 18 < ballDistance
    );

    if (!teammateCloser && ballDistance < chaseDistance) {
      const strikePlan = solveStrikeIntercept(view.self, view.ball, playDirection, activeCfg);
      target = strikePlan.point;
      interceptTicks = strikePlan.ticks;
      if (earlyIntent.inKickRange && !earlyIntent.canKick) {
        target = unsafeCarryTarget(view, playDirection, activeCfg, memory);
      } else {
        memory.unsafeCarrySide = 0;
      }
      nav = navigate(view.self, target, activeCfg, memory, { strike: true, arrivalTicks: strikePlan.ticks });
      mode = earlyIntent.inKickRange && !earlyIntent.canKick ? 'reposition' : 'press-strike';
    } else {
      memory.unsafeCarrySide = 0;
      nav = navigate(view.self, target, activeCfg, memory, { strike: false });
      mode = 'press';
    }
  }

  const intent = earlyIntent;
  const shot = releaseAwareKick(memory, intent.canKick, activeCfg);
  const braking = nav.brake && !intent.inKickRange && !intent.canKick;
  const keyDown = shot || braking;
  memory.braking = braking;
  memory.lastKeyDown = keyDown;

  return {
    dirX: nav.dirX,
    dirY: nav.dirY,
    kick: keyDown,
    role,
    braking,
    mode,
    target,
    interceptTicks,
  };
}

function makePersonality(seed, base) {
  const traits = balanced.makePersonality(seed, { ...SMALL_DEFAULTS, ...(base || {}) });
  if (Number.isFinite(traits.defenderNear)) delete traits.defenderNear;
  if (Number.isFinite(traits.defenderFar)) delete traits.defenderFar;
  return traits;
}

function describePersonality(traits, base) {
  const cfg = { ...SMALL_DEFAULTS, ...(base || {}) };
  const impact = traits.strikeImpactSpeed || cfg.strikeImpactSpeed;
  const style = impact > cfg.strikeImpactSpeed * 1.08 ? 'pres' : impact < cfg.strikeImpactSpeed * 0.92 ? 'kontrollü' : 'aktif';
  const aim = (traits.goalMargin || cfg.goalMargin) > cfg.goalMargin ? 'seçici' : 'çabuk şut';
  return `${style}/${aim}`;
}

module.exports = {
  DEFAULTS: { ...DEFAULTS, ...SMALL_DEFAULTS },
  decide,
  makePersonality,
  describePersonality,
  configFromPhysics,
  selectAttacker,
};
