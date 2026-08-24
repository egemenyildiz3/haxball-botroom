const assert = require('assert/strict');
const { checkAndStartGame, validateTeamDistribution, pickExtraActiveBots, rebalanceTeams } = require('./teamBalancer');

function makeState() {
  return {
    autoManageEnabled: true,
    afkPlayers: new Set(),
    manualPlacements: new Map(),
    isRebalancing: false,
    rebalanceRequested: false,
    promotionNoticePlayers: new Set(),
    teamChangesLocked: false,
    lockedTeams: new Map(),
  };
}

function makePlayer(id, team, bot = false) {
  return {
    id,
    team,
    name: bot ? `SpaceBot Test ${id}` : `Player ${id}`,
  };
}

function makeRoom(players) {
  return {
    players,
    moves: [],
    getPlayerList() {
      return this.players;
    },
    setPlayerTeam(id, team) {
      const player = this.players.find((p) => p.id === id);
      if (!player) throw new Error(`player ${id} not found`);
      player.team = team;
      this.moves.push({ id, team });
    },
  };
}

function makeBotManager(botIds) {
  return {
    isBotPlayer(id) {
      return botIds.has(id);
    },
  };
}

function teamCounts(players) {
  return {
    red: players.filter((p) => p.team === 1).length,
    blue: players.filter((p) => p.team === 2).length,
    spec: players.filter((p) => p.team === 0).length,
  };
}

function botCounts(players, botIds) {
  return {
    red: players.filter((p) => p.team === 1 && botIds.has(p.id)).length,
    blue: players.filter((p) => p.team === 2 && botIds.has(p.id)).length,
  };
}

async function validate(players, botIds = new Set()) {
  const room = makeRoom(players);
  await validateTeamDistribution(room, makeState(), {
    botManager: makeBotManager(botIds),
    playerJoinOrder: new Map(players.map((p, index) => [p.id, index + 1])),
    sleep: async () => {},
    reason: 'test',
  });
  return room;
}

async function testPromotesSpectatorToFixOddTeams() {
  const players = [
    makePlayer(1, 1),
    makePlayer(2, 1),
    makePlayer(3, 1),
    makePlayer(4, 2),
    makePlayer(5, 2),
    makePlayer(6, 0),
  ];

  const room = await validate(players);
  assert.deepEqual(teamCounts(room.players), { red: 3, blue: 3, spec: 0 });
}

async function testBenchesHeavyTeamWhenNoPromotionExists() {
  const players = [
    makePlayer(1, 1),
    makePlayer(2, 1),
    makePlayer(3, 1),
    makePlayer(4, 2),
    makePlayer(5, 2),
  ];

  const room = await validate(players);
  assert.deepEqual(teamCounts(room.players), { red: 2, blue: 2, spec: 1 });
}

async function testMovesHeavyTeamPlayerWhenEvenButUnequal() {
  const players = [
    makePlayer(1, 1),
    makePlayer(2, 1),
    makePlayer(3, 1),
    makePlayer(4, 1),
    makePlayer(5, 2),
    makePlayer(6, 2),
  ];

  const room = await validate(players);
  assert.deepEqual(teamCounts(room.players), { red: 3, blue: 3, spec: 0 });
}

async function testSwapsHumansAndBotsToFixBotDistribution() {
  const botIds = new Set([501, 502, 503, 504]);
  const players = [
    makePlayer(501, 1, true),
    makePlayer(502, 1, true),
    makePlayer(503, 1, true),
    makePlayer(1, 1),
    makePlayer(504, 2, true),
    makePlayer(2, 2),
    makePlayer(3, 2),
    makePlayer(4, 2),
  ];

  const room = await validate(players, botIds);
  assert.deepEqual(teamCounts(room.players), { red: 4, blue: 4, spec: 0 });
  assert.deepEqual(botCounts(room.players, botIds), { red: 2, blue: 2 });
}

async function testBenchesBotFromHeavyTeamAfterLeave() {
  const botIds = new Set([501, 502, 503]);
  const players = [
    makePlayer(1, 1),
    makePlayer(2, 1),
    makePlayer(3, 2),
    makePlayer(4, 2),
    makePlayer(502, 2, true),
    makePlayer(503, 2, true),
    // This red bot is intentionally last in join order; old logic picked it
    // globally even though Blue was the heavy team.
    makePlayer(501, 1, true),
  ];

  const room = await validate(players, botIds);
  assert.deepEqual(teamCounts(room.players), { red: 3, blue: 3, spec: 1 });
  assert.equal(room.players.find((p) => p.id === 501).team, 1);
  assert.ok([502, 503].includes(room.moves[0].id));
  assert.equal(room.moves[0].team, 0);
}

async function testAvoidsFollowUpBotSwapWhenBenchingExtraPlayer() {
  const botIds = new Set([501, 502, 503]);
  const players = [
    makePlayer(1, 1),
    makePlayer(2, 1),
    makePlayer(501, 1, true),
    makePlayer(502, 2, true),
    makePlayer(503, 2, true),
  ];

  const room = await validate(players, botIds);
  assert.deepEqual(teamCounts(room.players), { red: 2, blue: 2, spec: 1 });
  assert.deepEqual(botCounts(room.players, botIds), { red: 1, blue: 1 });
  assert.equal(room.players.find((p) => p.id === 501).team, 0);
}

async function testSpectatorHumanReplacesBotWhenTeamsAlreadyEven() {
  const botIds = new Set([501, 502, 503, 504]);
  const players = [
    makePlayer(1, 1),
    makePlayer(501, 1, true),
    makePlayer(502, 1, true),
    makePlayer(2, 2),
    makePlayer(503, 2, true),
    makePlayer(504, 2, true),
    makePlayer(3, 0),
  ];

  const room = await validate(players, botIds);
  assert.deepEqual(teamCounts(room.players), { red: 3, blue: 3, spec: 1 });
  assert.equal(room.players.find((p) => p.id === 3).team !== 0, true);
  assert.equal(room.players.filter((p) => p.team !== 0 && botIds.has(p.id)).length, 3);
}

async function testPromotionNoticeBeforeHumanReplacesBot() {
  const botIds = new Set([501, 502, 503, 504]);
  const players = [
    makePlayer(1, 1),
    makePlayer(501, 1, true),
    makePlayer(502, 1, true),
    makePlayer(2, 2),
    makePlayer(503, 2, true),
    makePlayer(504, 2, true),
    makePlayer(3, 0),
  ];
  const room = makeRoom(players);
  const messages = [];

  await rebalanceTeams(room, makeState(), {
    botManager: makeBotManager(botIds),
    playerJoinOrder: new Map(players.map((p, index) => [p.id, index + 1])),
    sleep: async () => {},
    sendMsg: (targetRoom, text, targetId, color, style) => messages.push({ text, targetId, color, style }),
    t: (key) => (key === 'team.preparePromotion' ? 'GET READY' : key),
    config: {
      teamManagement: {
        promotionNotice: {
          enabled: true,
          color: 0x00BFFF,
        },
      },
    },
  });

  assert.deepEqual(messages, [{ text: 'GET READY', targetId: 3, color: 0x00BFFF, style: 'bold' }]);
  assert.equal(room.players.find((p) => p.id === 3).team !== 0, true);
}

async function testManuallyBenchedBotCanStillFillMissingTeamSlot() {
  const botIds = new Set([501, 502, 503, 504]);
  const players = [
    makePlayer(1, 1),
    makePlayer(2, 1),
    makePlayer(3, 1),
    makePlayer(501, 1, true),
    makePlayer(4, 2),
    makePlayer(5, 2),
    makePlayer(502, 2, true),
    makePlayer(503, 0, true),
    makePlayer(504, 0, true),
  ];
  const state = makeState();
  state.manualPlacements.set(503, 0);
  state.manualPlacements.set(504, 0);

  const room = makeRoom(players);
  await rebalanceTeams(room, state, {
    botManager: makeBotManager(botIds),
    playerJoinOrder: new Map(players.map((p, index) => [p.id, index + 1])),
    sleep: async () => {},
  });

  assert.deepEqual(teamCounts(room.players), { red: 4, blue: 4, spec: 1 });
  assert.equal([503, 504].some((id) => room.players.find((p) => p.id === id).team === 2), true);
}

function testDoesNotStartGameDuringMatchRotation() {
  const state = makeState();
  state.matchRotationPending = true;
  state.startGamePending = false;
  state.currentGame = null;

  const room = makeRoom([
    makePlayer(1, 1),
    makePlayer(2, 2),
  ]);
  let starts = 0;
  room.startGame = () => { starts++; };

  checkAndStartGame(room, state);
  assert.equal(starts, 0);
  assert.equal(state.startGamePending, false);
}

function testExtraBotComesFromHeavyTeam() {
  const botIds = new Set([501, 502, 503, 504]);
  const state = makeState();
  const players = [
    makePlayer(1, 1),
    makePlayer(501, 1, true),
    makePlayer(502, 1, true),
    makePlayer(503, 2, true),
    makePlayer(504, 2, true),
  ];
  const isBot = (p) => botIds.has(p.id);
  const joinOrder = new Map([
    [1, 1],
    [501, 2],
    [502, 3],
    [503, 4],
    [504, 5],
  ]);

  const [bench] = pickExtraActiveBots(players, state, isBot, 3, joinOrder);
  assert.ok(bench);
  assert.equal(bench.team, 1);
}

async function run() {
  await testPromotesSpectatorToFixOddTeams();
  await testBenchesHeavyTeamWhenNoPromotionExists();
  await testMovesHeavyTeamPlayerWhenEvenButUnequal();
  await testSwapsHumansAndBotsToFixBotDistribution();
  await testBenchesBotFromHeavyTeamAfterLeave();
  await testAvoidsFollowUpBotSwapWhenBenchingExtraPlayer();
  await testSpectatorHumanReplacesBotWhenTeamsAlreadyEven();
  await testPromotionNoticeBeforeHumanReplacesBot();
  await testManuallyBenchedBotCanStillFillMissingTeamSlot();
  testDoesNotStartGameDuringMatchRotation();
  testExtraBotComesFromHeavyTeam();
  console.log('teamBalancer validation tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
