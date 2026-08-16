const { desiredBotCount, isBotPlayer } = require('./botPolicy');

const REBALANCE_START_DELAY_MS = 700;
const REBALANCE_MOVE_DELAY_MS = 350;
const REBALANCE_END_DELAY_MS = 500;

const fallbackSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function lockTeams(room) {
  if (typeof room.setTeamsLock === 'function') {
    try { room.setTeamsLock(true); } catch (e) {}
  }
}

function checkAndStartGame(room, state) {
  if (!state.autoManageEnabled) return;
  if (typeof room.getPlayerList !== 'function') return;

  const activePlayers = room.getPlayerList().filter((p) => p.id !== 0 && (p.team === 1 || p.team === 2));

  if (activePlayers.length >= 1 && !state.currentGame && typeof room.startGame === 'function') {
    try {
      room.startGame();
    } catch (e) {
      console.warn('Oyun hemen başlatılamadı, 1.5 saniye sonra tekrar deneniyor:', e.message);
      setTimeout(() => {
        try {
          if (!state.currentGame && typeof room.startGame === 'function') {
            room.startGame();
          }
        } catch (err) {
          console.warn('Yeniden deneme başarısız oldu:', err.message);
        }
      }, 1500);
    }
  }
}

async function rebalanceTeams(room, state, { playerJoinOrder, botManager, sleep = fallbackSleep }) {
  if (!state.autoManageEnabled) return;
  if (state.isRebalancing) {
    state.rebalanceRequested = true;
    return;
  }
  if (typeof room.getPlayerList !== 'function' || typeof room.setPlayerTeam !== 'function') return;

  state.isRebalancing = true;

  try {
    do {
      state.rebalanceRequested = false;
      await runRebalanceOnce(room, state, { playerJoinOrder, botManager, sleep });
    } while (state.rebalanceRequested);
  } finally {
    state.isRebalancing = false;
  }
}

async function runRebalanceOnce(room, state, { playerJoinOrder, botManager, sleep }) {
  await sleep(REBALANCE_START_DELAY_MS);

  let players = room.getPlayerList();

  const hostPlayer = players.find((p) => p.id === 0);
  if (hostPlayer && hostPlayer.team !== 0) {
    try { room.setPlayerTeam(0, 0); } catch (e) {}
  }

  const isBot = (p) => isBotPlayer(botManager, p);
  const nonAfkPlayers = players.filter((p) => p.id !== 0 && !state.afkPlayers.has(p.id));
  const realPlayers = nonAfkPlayers.filter((p) => !isBot(p));
  const botPlayers = nonAfkPlayers.filter(isBot);
  const targetBotCount = desiredBotCount(realPlayers.length, botPlayers.length);

  const activeBots = botPlayers.filter((p) => p.team === 1 || p.team === 2);
  if (activeBots.length > targetBotCount) {
    const extraBots = activeBots
      .sort((a, b) => (playerJoinOrder.get(b.id) ?? 0) - (playerJoinOrder.get(a.id) ?? 0))
      .slice(0, activeBots.length - targetBotCount);
    for (const bot of extraBots) {
      try { room.setPlayerTeam(bot.id, 0); } catch (e) {}
      await sleep(REBALANCE_MOVE_DELAY_MS);
    }
    players = room.getPlayerList();
  }

  let redPlayers = activeTeamPlayers(players, state, 1);
  let bluePlayers = activeTeamPlayers(players, state, 2);
  const activeBotCount = [...redPlayers, ...bluePlayers].filter(isBot).length;
  const botSlotsRemaining = Math.max(0, targetBotCount - activeBotCount);
  const spectators = [
    ...spectatorsByType(players, state, playerJoinOrder, isBot, false),
    ...spectatorsByType(players, state, playerJoinOrder, isBot, true).slice(0, botSlotsRemaining),
  ];

  const desiredActiveCount = Math.min(8, realPlayers.length + targetBotCount);
  const maxTeamSize = Math.min(4, Math.max(1, Math.ceil(desiredActiveCount / 2)));

  let redCount = redPlayers.length;
  let blueCount = bluePlayers.length;

  if (redCount === 0 && blueCount === 0 && spectators.length > 0) {
    const promote = spectators.shift();
    try {
      room.setPlayerTeam(promote.id, 1);
      redCount++;
    } catch (e) {}
    await sleep(REBALANCE_MOVE_DELAY_MS);
  }

  while (spectators.length > 0 && (redCount < maxTeamSize || blueCount < maxTeamSize)) {
    const targetTeam = redCount < maxTeamSize && blueCount < maxTeamSize
      ? (redCount <= blueCount ? 1 : 2)
      : (redCount < maxTeamSize ? 1 : 2);

    const promote = spectators.shift();
    try {
      room.setPlayerTeam(promote.id, targetTeam);
      if (targetTeam === 1) redCount++;
      else blueCount++;
    } catch (e) {
      break;
    }
    await sleep(REBALANCE_MOVE_DELAY_MS);
  }

  players = room.getPlayerList();
  redPlayers = activeTeamPlayers(players, state, 1);
  bluePlayers = activeTeamPlayers(players, state, 2);
  redCount = redPlayers.length;
  blueCount = bluePlayers.length;

  const movableRed = redPlayers.filter((p) => !state.manualPlacements.has(p.id));
  const movableBlue = bluePlayers.filter((p) => !state.manualPlacements.has(p.id));

  if (desiredActiveCount >= 2) {
    while (Math.abs(redCount - blueCount) > 1) {
      const fromRed = redCount > blueCount;
      const movePlayer = (fromRed ? movableRed : movableBlue).pop();
      if (!movePlayer) break;

      try {
        room.setPlayerTeam(movePlayer.id, fromRed ? 2 : 1);
        redCount += fromRed ? -1 : 1;
        blueCount += fromRed ? 1 : -1;
      } catch (e) {
        break;
      }
      await sleep(REBALANCE_MOVE_DELAY_MS);
    }
  }

  lockTeams(room);
  await sleep(REBALANCE_END_DELAY_MS);
}

function activeTeamPlayers(players, state, team) {
  return players.filter((p) => p.id !== 0 && p.team === team && !state.afkPlayers.has(p.id));
}

function spectatorsByType(players, state, playerJoinOrder, isBot, wantBot) {
  return players
    .filter((p) => (
      p.id !== 0
      && p.team === 0
      && !state.afkPlayers.has(p.id)
      && !state.manualPlacements.has(p.id)
      && isBot(p) === wantBot
    ))
    .sort((a, b) => (playerJoinOrder.get(a.id) ?? 0) - (playerJoinOrder.get(b.id) ?? 0));
}

module.exports = {
  checkAndStartGame,
  rebalanceTeams,
  lockTeams,
};
