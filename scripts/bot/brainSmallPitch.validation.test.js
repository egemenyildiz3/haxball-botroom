'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { decide } = require('./brainSmallPitch');

function makeView(selfId = 501) {
  const players = [
    { id: 500, pos: { x: -120, y: 0 }, speed: { x: 0, y: 0 }, radius: 15 },
    { id: 501, pos: { x: -220, y: -50 }, speed: { x: 0, y: 0 }, radius: 15 },
    { id: 502, pos: { x: -220, y: 50 }, speed: { x: 0, y: 0 }, radius: 15 },
  ];
  const self = players.find((player) => player.id === selfId);
  return {
    self,
    ball: {
      pos: { x: 0, y: 0 },
      speed: { x: 0, y: 0 },
      radius: 10,
      damping: 0.99,
    },
    teammates: players.filter((player) => player.id !== selfId),
    opponents: [],
    ownGoal: { p0: { x: -550, y: -80 }, p1: { x: -550, y: 80 } },
    oppGoal: { p0: { x: 550, y: -80 }, p1: { x: 550, y: 80 } },
    stadium: { width: 1100, height: 540 },
    field: { minX: -550, maxX: 550, minY: -270, maxY: 270 },
    attackerId: 500,
    botOnly: true,
  };
}

function makeSoloView(self, ball, flipped = false) {
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
      ? { p0: { x: 550, y: -80 }, p1: { x: 550, y: 80 } }
      : { p0: { x: -550, y: -80 }, p1: { x: -550, y: 80 } },
    oppGoal: flipped
      ? { p0: { x: -550, y: -80 }, p1: { x: -550, y: 80 } }
      : { p0: { x: 550, y: -80 }, p1: { x: 550, y: 80 } },
    stadium: { width: 1100, height: 540 },
    field: { minX: -550, maxX: 550, minY: -240, maxY: 240 },
    attackerId: 500,
    botOnly: true,
  };
}

test('smallPitch beyni defans rolü üretmez', () => {
  for (const id of [500, 501, 502]) {
    const move = decide(makeView(id), {}, {});
    assert.notEqual(move.role, 'defender');
  }
});

test('smallPitch destek oyuncuları farklı hedeflere açılır', () => {
  const left = decide(makeView(501), {}, {});
  const right = decide(makeView(502), {}, {});

  assert.equal(left.role, 'press');
  assert.equal(right.role, 'press');
  assert.ok(Math.abs(left.target.y - right.target.y) >= 60);
  assert.ok(left.target.x > -550 + 40, 'destek hedefi kale çizgisine gömülmemeli');
  assert.ok(right.target.x > -550 + 40, 'destek hedefi kale çizgisine gömülmemeli');
});

test('smallPitch topun yanlış tarafındayken kendi kaleye vurmaz', () => {
  const view = makeSoloView(
    { pos: { x: 24, y: 0 } },
    { pos: { x: 0, y: 0 }, speed: { x: 0, y: 0 } }
  );
  const move = decide(view, {}, {});

  assert.equal(move.kick, false);
  assert.equal(move.mode, 'reposition');
  assert.ok(move.target.x < view.ball.pos.x, 'bot güvenli vuruş tarafına geçmeli');
});

test('smallPitch güvenli temas varsa hemen vurur', () => {
  const view = makeSoloView(
    { pos: { x: -24, y: 0 } },
    { pos: { x: 0, y: 0 }, speed: { x: 0, y: 0 } }
  );
  const move = decide(view, {}, {});

  assert.equal(move.kick, true);
  assert.notEqual(move.mode, 'reposition');
});

test('smallPitch mavi takımda da kendi kaleye vuruşu engeller', () => {
  const view = makeSoloView(
    { pos: { x: -24, y: 0 } },
    { pos: { x: 0, y: 0 }, speed: { x: 0, y: 0 } },
    true
  );
  const move = decide(view, {}, {});

  assert.equal(move.kick, false);
  assert.equal(move.mode, 'reposition');
  assert.ok(move.target.x > view.ball.pos.x, 'mavi takım botu güvenli vuruş tarafına geçmeli');
});
