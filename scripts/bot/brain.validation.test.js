'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULTS,
  decide,
  defenderTarget,
  navigate,
  predictBall,
  selectAttacker,
  solveIntercept,
  solveStrikeIntercept,
} = require('./brain');
const { ballWallBounds } = require('./manager');

function makeView(self, ball, flipped = false) {
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
    teammates: [],
    opponents: [],
    ownGoal: flipped
      ? { p0: { x: 1200, y: -100 }, p1: { x: 1200, y: 100 } }
      : { p0: { x: -1200, y: -100 }, p1: { x: -1200, y: 100 } },
    oppGoal: flipped
      ? { p0: { x: -1200, y: -100 }, p1: { x: -1200, y: 100 } }
      : { p0: { x: 1200, y: -100 }, p1: { x: 1200, y: 100 } },
    stadium: { width: 2400, height: 1500 },
    field: { minX: -1300, maxX: 1300, minY: -750, maxY: 750 },
    botOnly: false,
  };
}

test('hareketli topun kesişimi oyuncunun gerçek temas merkezini içerir', () => {
  const self = { pos: { x: -200, y: 20 }, speed: { x: 0, y: 0 }, radius: 15 };
  const ball = { pos: { x: 100, y: 0 }, speed: { x: -8, y: 0 }, radius: 10 };

  const centerOnly = solveIntercept(self, ball, DEFAULTS);
  const strike = solveStrikeIntercept(self, ball, { x: 1, y: 0 }, DEFAULTS);
  const contactDistance = Math.hypot(
    strike.ballPoint.x - strike.point.x,
    strike.ballPoint.y - strike.point.y
  );

  assert.equal(centerOnly.ticks, 39);
  assert.equal(strike.ticks, 40);
  assert.equal(contactDistance, 27.5);
  assert.ok(strike.point.x < strike.ballPoint.x, 'oyuncu topun vuruş tarafında kalmalı');
});

test('topun önünde kalan hücumcu kendi kaleye doğru topun içinden geçmez', () => {
  const view = makeView({ pos: { x: 70, y: 0 } }, { pos: { x: 0, y: 0 } });
  const memory = {};
  const move = decide(view, memory, {});

  assert.equal(move.role, 'attacker');
  assert.equal(move.dirX, -1);
  assert.notEqual(move.dirY, 0, 'doğrudan topa değil, yanal ara hedefe gitmeli');
  assert.notEqual(memory.approachSide, 0, 'seçilen dolaşma tarafı tickler arasında korunmalı');
});

test('güçlü biçimde kendi kaleye gelen topu tamamen çeviremese de bloklar', () => {
  const view = makeView(
    { pos: { x: -627, y: 0 } },
    { pos: { x: -600, y: 0 }, speed: { x: -8, y: 0 } }
  );
  const move = decide(view, {}, {});

  assert.equal(move.kick, true);
  assert.equal(move.dirY, 0, 'hızlı top karşısında kusursuz nişan için yana kaçmamalı');
});

test('hızlı top yaklaşırken fren tuşunu sabit mesafeden daha erken bırakır', () => {
  const view = makeView(
    { pos: { x: -662, y: 0 } },
    { pos: { x: -600, y: 0 }, speed: { x: -12, y: 0 } }
  );
  const memory = { lastKeyDown: true, braking: true, brakeHold: 5 };
  const move = decide(view, memory, {});

  assert.equal(move.kick, false);
  assert.equal(move.braking, false);
  assert.equal(memory.lastKeyDown, false, 'temas tickinde yeni kick kaydolabilmeli');
});

test('çapraz ve hızlı gelen topu kapalı döngüde kaçırmadan karşılar', () => {
  const view = makeView(
    { pos: { x: 0, y: 0 } },
    { pos: { x: 160, y: 35 }, speed: { x: -7, y: -0.8 } }
  );
  const memory = {};
  let kickTick = null;
  let kickDistance = Infinity;

  for (let tick = 0; tick < 80; tick++) {
    const move = decide(view, memory, {});
    const dx = view.ball.pos.x - view.self.pos.x;
    const dy = view.ball.pos.y - view.self.pos.y;
    const distance = Math.hypot(dx, dy);

    if (move.kick && distance <= 29) {
      kickTick = tick;
      kickDistance = distance;
      break;
    }

    const damping = move.kick ? DEFAULTS.kickingDamping : DEFAULTS.damping;
    const accel = move.kick ? DEFAULTS.kickAccel : DEFAULTS.accel;
    view.self.speed.x = (view.self.speed.x + accel * move.dirX) * damping;
    view.self.speed.y = (view.self.speed.y + accel * move.dirY) * damping;
    view.self.pos.x += view.self.speed.x;
    view.self.pos.y += view.self.speed.y;

    view.ball.speed.x *= view.ball.damping;
    view.ball.speed.y *= view.ball.damping;
    view.ball.pos.x += view.ball.speed.x;
    view.ball.pos.y += view.ball.speed.y;
  }

  assert.notEqual(kickTick, null, 'bot hızlı top için vuruş penceresi bulmalı');
  assert.ok(kickTick <= 30, `vuruş çok geç kaldı: ${kickTick}`);
  assert.ok(kickDistance <= 29, `vuruş menzil dışında kaldı: ${kickDistance}`);
});

test('yeni temas mesafesi yakın şut isabetini bozmaz', () => {
  for (const ballY of [-80, -40, 0, 40, 80]) {
    const view = makeView(
      { pos: { x: 810, y: ballY + (ballY >= 0 ? 20 : -20) } },
      { pos: { x: 950, y: ballY } }
    );
    const memory = {};
    let previousX = view.ball.pos.x;
    let goalY = null;

    for (let tick = 0; tick < 700; tick++) {
      const move = decide(view, memory, {});
      const dx = view.ball.pos.x - view.self.pos.x;
      const dy = view.ball.pos.y - view.self.pos.y;
      const distance = Math.hypot(dx, dy);

      if (move.kick && distance <= 29) {
        view.ball.speed.x += (dx / distance) * DEFAULTS.kickStrength;
        view.ball.speed.y += (dy / distance) * DEFAULTS.kickStrength;
      }

      const damping = move.kick ? DEFAULTS.kickingDamping : DEFAULTS.damping;
      const accel = move.kick ? DEFAULTS.kickAccel : DEFAULTS.accel;
      view.self.speed.x = (view.self.speed.x + accel * move.dirX) * damping;
      view.self.speed.y = (view.self.speed.y + accel * move.dirY) * damping;
      view.self.pos.x += view.self.speed.x;
      view.self.pos.y += view.self.speed.y;

      view.ball.speed.x *= view.ball.damping;
      view.ball.speed.y *= view.ball.damping;
      view.ball.pos.x += view.ball.speed.x;
      view.ball.pos.y += view.ball.speed.y;

      if (previousX < 1200 && view.ball.pos.x >= 1200) {
        goalY = view.ball.pos.y;
        break;
      }
      previousX = view.ball.pos.x;
    }

    assert.notEqual(goalY, null, `y=${ballY}: top kale çizgisine ulaşmadı`);
    assert.ok(Math.abs(goalY) <= 100, `y=${ballY}: şut kale ağzını ıskaladı (${goalY})`);
  }
});

test('top tahmini Spacebounce üst duvarından sekmeyi hesaba katar', () => {
  const ball = {
    pos: { x: 0, y: 580 },
    speed: { x: 4, y: 20 },
    radius: 10,
    walls: {
      minY: -590,
      maxY: 590,
      minRestitution: 0.75,
      maxRestitution: 0.75,
    },
  };

  const afterBounce = predictBall(ball, 2, 0.99);
  assert.ok(afterBounce.y < 580, `sekme sonrası top aşağı dönmeli: y=${afterBounce.y}`);
  assert.ok(Math.abs(afterBounce.y - 575.15) < 0.01);
});

test('canlı stadyum düzlemleri top için ±590 merkez sınırına çevrilir', () => {
  const stadium = {
    planes: [
      { normal: { x: 0, y: 1 }, dist: -600, bCoef: 1.5, cMask: 1 | 32 },
      { normal: { x: 0, y: -1 }, dist: -600, bCoef: 1.5, cMask: 1 | 32 },
      { normal: { x: 0, y: 1 }, dist: -750, bCoef: 0.1, cMask: 2 | 4 },
      { normal: { x: 0, y: -1 }, dist: -750, bCoef: 0.1, cMask: 2 | 4 },
    ],
  };
  const walls = ballWallBounds(stadium, { radius: 10, bCoef: 0.5 }, 1);

  assert.deepEqual(walls, {
    minY: -590,
    maxY: 590,
    minRestitution: 0.75,
    maxRestitution: 0.75,
  });
});

test('en iyi kesişime sahip oyuncu bekletilmeden hücumcu olur', () => {
  const ball = { pos: { x: 0, y: 0 }, speed: { x: 0, y: 0 }, radius: 10 };
  const close = { id: 500, pos: { x: -80, y: 0 }, speed: { x: 0, y: 0 }, radius: 15 };
  const previous = { id: 501, pos: { x: -500, y: 0 }, speed: { x: 0, y: 0 }, radius: 15 };

  const selected = selectAttacker([close, previous], ball, DEFAULTS);
  assert.equal(selected.id, close.id, 'önceki hücumcu için hiçbir zorunlu bekleme olmamalı');
});

test('pozisyon oyuncusu hedef çevresinde mikroskobik yön değişimleri yapmaz', () => {
  const memory = {};
  const self = { pos: { x: 100, y: 100 }, speed: { x: 0.1, y: -0.1 } };

  const arrived = navigate(self, { x: 104, y: 97 }, DEFAULTS, memory, { strike: false });
  assert.deepEqual(arrived, { dirX: 0, dirY: 0, brake: false });
  assert.equal(memory.positionSettled, true);

  const jitter = navigate(self, { x: 89, y: 108 }, DEFAULTS, memory, { strike: false });
  assert.deepEqual(jitter, { dirX: 0, dirY: 0, brake: false });

  const wake = navigate(self, { x: 130, y: 100 }, DEFAULTS, memory, { strike: false });
  assert.equal(wake.dirX, 1);
  assert.equal(memory.positionSettled, false);
});

test('kaleye yönelen top için defans köşe yerine kale koridorunu kapatır', () => {
  const view = makeView(
    { pos: { x: -850, y: 250 } },
    { pos: { x: -400, y: 30 }, speed: { x: -8, y: 0 } }
  );
  const defense = defenderTarget(view, { ...DEFAULTS, ballDamping: 0.99 });

  assert.equal(defense.threat, true);
  assert.ok(Math.abs(defense.point.x + 1065) < 0.01);
  assert.ok(Math.abs(defense.point.y) <= 88, 'hedef kale direklerinin içinde kalmalı');
});

test('kendi bölgesindeki zararsız köşe topu defansı kale koridorundan çıkarmaz', () => {
  const view = makeView(
    { pos: { x: -850, y: 0 } },
    { pos: { x: -700, y: 520 }, speed: { x: 0, y: 0 } }
  );
  const defense = defenderTarget(view, { ...DEFAULTS, ballDamping: 0.99 });

  assert.equal(defense.threat, false);
  assert.ok(Math.abs(defense.point.y) <= DEFAULTS.defenderMaxLateral);
});

test('rakip topa baskı yaparken bot güvenli mücadele dokunuşu yapar', () => {
  const view = makeView(
    { pos: { x: -27, y: 0 } },
    { pos: { x: 0, y: 0 }, speed: { x: 0, y: 0 } }
  );
  view.opponents = [{ id: 700, pos: { x: 20, y: 5 }, speed: { x: 0, y: 0 }, radius: 15 }];
  const move = decide(view, {}, {});

  assert.equal(move.mode, 'pressure');
  assert.equal(move.contested, true);
  assert.equal(move.kick, true);
});

test('santra zorlaması top merkezine dalmak yerine güvenli vuruş rotasını korur', () => {
  const view = makeView({ pos: { x: 70, y: 0 } }, { pos: { x: 0, y: 0 } });
  view.forceBall = true;
  const move = decide(view, {}, {});

  assert.equal(move.mode, 'kickoff');
  assert.equal(move.dirX, -1);
  assert.notEqual(move.dirY, 0, 'topun önündeyken yanal dolaşma iptal edilmemeli');
});
