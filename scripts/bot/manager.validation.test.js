const assert = require('assert');
const { createBotManager } = require('./manager');

function createRawRoom() {
  const raw = {
    players: [],
    stadium: {
      playerPhysics: {},
    },
    getPlayer(id) {
      return this.players.find((player) => player.id === id) || null;
    },
    fakePlayerJoin(id, name, flag, avatar, conn, auth) {
      this.players.push({
        id,
        name,
        flag,
        avatar,
        conn,
        auth,
        team: { id: 0 },
      });
    },
    fakePlayerLeave(id) {
      this.players = this.players.filter((player) => player.id !== id);
    },
    fakeSendPlayerInput() {},
  };
  return raw;
}

function attach(manager, raw) {
  manager.attach(raw, { Utils: { keyState: () => 0 }, CollisionFlags: { ball: 1 } });
}

function testPrunesIdCollisionAndRespawns() {
  const logs = [];
  const manager = createBotManager({
    botName: 'SpaceBot',
    botNames: ['Salah'],
    maxBots: 1,
    log: (message) => logs.push(message),
  });
  const raw = createRawRoom();

  attach(manager, raw);

  const started = manager.start(1);
  assert.equal(started.ok, true);
  assert.equal(raw.players[0].id, 65000);
  assert.equal(manager.isBotPlayer(65000), true);

  raw.players = [{
    id: 65000,
    name: 'Real Human',
    auth: 'real-auth',
    conn: 'real-conn',
    team: { id: 0 },
  }];

  assert.equal(manager.isBotPlayer(900000), false);

  const ensured = manager.ensureMinimum(1);
  assert.equal(ensured.ok, true);
  assert.equal(ensured.pruned, 1);
  assert.equal(ensured.started, 1);
  assert.equal(manager.isBotPlayer(64999), true);
  assert(logs.some((line) => line.includes('gerçek/farklı oyuncuya ait')));
}

function testRemoveDoesNotKickRealPlayerOnOldBotId() {
  const logs = [];
  const manager = createBotManager({
    botName: 'SpaceBot',
    botNames: ['Salah'],
    maxBots: 1,
    log: (message) => logs.push(message),
  });
  const raw = createRawRoom();

  attach(manager, raw);

  assert.equal(manager.start(1).ok, true);
  raw.players = [{
    id: 65000,
    name: 'Real Human',
    auth: 'real-auth',
    conn: 'real-conn',
    team: { id: 0 },
  }];

  const stopped = manager.stopLast();
  assert.equal(stopped.ok, true);
  assert.equal(raw.getPlayer(65000).name, 'Real Human');
  assert(logs.some((line) => line.includes('oyuncuya dokunulmadı')));
}

function run() {
  testPrunesIdCollisionAndRespawns();
  testRemoveDoesNotKickRealPlayerOnOldBotId();
  console.log('bot manager validation tests passed');
}

run();
