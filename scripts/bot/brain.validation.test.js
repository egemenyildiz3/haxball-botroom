const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULTS,
  decide,
  selectAttacker,
  solveStrikeIntercept,
} = require('./brain');

function makeView(self, ball, extra = {}) {
  return {
    self: {
      id: 500,
      pos: { ...self.pos },
      speed: { ...(self.speed || { x: 0, y: 0 }) },
      radius: 15,
    },
    ball: {
      pos: { ...ball.pos },
      speed: { ...(ball.speed || { x: 0, y: 0 }) },
      radius: 10,
      damping: 0.99,
    },
    teammates: extra.teammates || [],
    opponents: extra.opponents || [],
    ownGoal: { p0: { x: -1200, y: -100 }, p1: { x: -1200, y: 100 } },
    oppGoal: { p0: { x: 1200, y: -100 }, p1: { x: 1200, y: 100 } },
    stadium: { width: 2400, height: 1500 },
    field: { minX: -1300, maxX: 1300, minY: -750, maxY: 750 },
    botOnly: false,
    forceBall: false,
  };
}

test('selectAttacker topa en erken yetişen oyuncuyu seçer', () => {
  const squad = [
    { id: 1, pos: { x: -300, y: 0 }, speed: { x: 0, y: 0 }, radius: 15 },
    { id: 2, pos: { x: -50, y: 0 }, speed: { x: 0, y: 0 }, radius: 15 },
  ];
  const choice = selectAttacker(squad, { pos: { x: 0, y: 0 }, speed: { x: 0, y: 0 }, radius: 10 }, DEFAULTS);

  assert.equal(choice.id, 2);
});

test('yakın ve güvenli topta vuruş üretir', () => {
  const view = makeView(
    { pos: { x: 0, y: 0 } },
    { pos: { x: 27, y: 0 }, speed: { x: 0, y: 0 } }
  );
  const move = decide(view, {}, {});

  assert.equal(move.role, 'attacker');
  assert.equal(move.kick, true);
});

test('solveStrikeIntercept temas merkezini topun arkasına koyar', () => {
  const self = { pos: { x: -200, y: 20 }, speed: { x: 0, y: 0 }, radius: 15 };
  const ball = { pos: { x: 100, y: 0 }, speed: { x: -8, y: 0 }, radius: 10 };
  const strike = solveStrikeIntercept(self, ball, { x: 1, y: 0 }, DEFAULTS);

  assert.ok(strike.point.x < strike.ballPoint.x);
});
