const { desiredBotCount, desiredEvenActiveCount, isBotPlayer } = require('./botPolicy');

const REBALANCE_START_DELAY_MS = 500;
const REBALANCE_MOVE_DELAY_MS = 250;
const REBALANCE_END_DELAY_MS = 350;
const PLAYER_REPLACES_BOT_DELAY_MS = 3 * 1000;
const PLAYER_EMPTY_SLOT_DELAY_MS = 1 * 1000;
const START_RETRY_DELAY_MS = 1000;
const START_RETRY_COUNT = 5;
const MAX_TEAM_SIZE = 4;
const MAX_ACTIVE_PLAYERS = 8;

const fallbackSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function lockTeams(room) {
  if (typeof room.setTeamsLock === 'function') {
    try { room.setTeamsLock(true); } catch (e) {}
  }
}

function botCount(players, isBot) {
  return players.filter(isBot).length;
}

function canMoveForBotBalance(player, state) {
  return player && !state.manualPlacements.has(player.id);
}

function isAutoEligiblePlayer(player, state) {
  return !!(
    player
    && player.id !== 0
    && !state.afkPlayers.has(player.id)
    && !(player.team === 0 && state.manualPlacements.has(player.id))
  );
}

function pickMovable(players, state, isBot, preferBot = false) {
  const ordered = [...players];
  if (preferBot) {
    ordered.sort((a, b) => Number(isBot(b)) - Number(isBot(a)));
  }
  return ordered.find((p) => canMoveForBotBalance(p, state)) || ordered[0] || null;
}

function pickBenchCandidate(players, state, isBot) {
  return pickMovable(players, state, isBot, true);
}

async function balanceBotDistribution(room, state, isBot, sleep = fallbackSleep) {
  if (typeof room.getPlayerList !== 'function' || typeof room.setPlayerTeam !== 'function') return;

  for (let attempts = 0; attempts < 4; attempts++) {
    const players = room.getPlayerList();
    const redPlayers = activeTeamPlayers(players, state, 1);
    const bluePlayers = activeTeamPlayers(players, state, 2);
    const redBots = botCount(redPlayers, isBot);
    const blueBots = botCount(bluePlayers, isBot);
    const diff = redBots - blueBots;

    if (Math.abs(diff) <= 1) return;

    const botHeavyTeam = diff > 0 ? 1 : 2;
    const botLightTeam = diff > 0 ? 2 : 1;
    const heavyPlayers = botHeavyTeam === 1 ? redPlayers : bluePlayers;
    const lightPlayers = botLightTeam === 1 ? redPlayers : bluePlayers;

    const movableBot = heavyPlayers.find((p) => isBot(p) && canMoveForBotBalance(p, state));
    if (!movableBot) return;

    const movableHuman = lightPlayers.find((p) => !isBot(p) && canMoveForBotBalance(p, state));
    if (movableHuman) {
      try {
        room.setPlayerTeam(movableBot.id, botLightTeam);
        await sleep(REBALANCE_MOVE_DELAY_MS);
        room.setPlayerTeam(movableHuman.id, botHeavyTeam);
        await sleep(REBALANCE_MOVE_DELAY_MS);
      } catch (e) {
        return;
      }
      continue;
    }

    const heavyAfterMove = heavyPlayers.length - 1;
    const lightAfterMove = lightPlayers.length + 1;
    if (Math.abs(heavyAfterMove - lightAfterMove) > 1) return;

    try {
      room.setPlayerTeam(movableBot.id, botLightTeam);
      await sleep(REBALANCE_MOVE_DELAY_MS);
    } catch (e) {
      return;
    }
  }
}

async function validateTeamDistribution(room, state, deps = {}) {
  if (!state.autoManageEnabled) return;

  const {
    botManager,
    playerJoinOrder = new Map(),
    sleep = fallbackSleep,
    reason = 'unknown',
  } = deps;

  if (typeof room.getPlayerList !== 'function' || typeof room.setPlayerTeam !== 'function') return;

  const isBot = (p) => isBotPlayer(botManager, p);

  for (let attempts = 0; attempts < 8; attempts++) {
    if (!state.autoManageEnabled) return;

    const players = room.getPlayerList();
    const eligiblePlayers = players.filter((p) => isAutoEligiblePlayer(p, state));
    const realPlayers = eligiblePlayers.filter((p) => !isBot(p));
    const botPlayers = eligiblePlayers.filter(isBot);
    const targetBotCount = desiredBotCount(realPlayers.length, botPlayers.length, MAX_ACTIVE_PLAYERS);
    const desiredActiveCount = desiredEvenActiveCount(realPlayers.length, botPlayers.length, MAX_ACTIVE_PLAYERS);
    const redPlayers = activeTeamPlayers(players, state, 1);
    const bluePlayers = activeTeamPlayers(players, state, 2);
    const activePlayers = [...redPlayers, ...bluePlayers];
    const redCount = redPlayers.length;
    const blueCount = bluePlayers.length;

    if (activePlayers.length > desiredActiveCount) {
      const heavyTeam = redCount >= blueCount ? 1 : 2;
      const heavyPlayers = heavyTeam === 1 ? redPlayers : bluePlayers;
      const excessBot = activePlayers
        .filter((p) => isBot(p) && canMoveForBotBalance(p, state))
        .sort((a, b) => (playerJoinOrder.get(b.id) ?? 0) - (playerJoinOrder.get(a.id) ?? 0))[0];
      const excessPlayer = excessBot || pickMovable(heavyPlayers, state, isBot, true);

      if (!excessPlayer) break;
      try {
        console.warn(`[TEAM-VALIDATOR] ${reason}: fazla aktif oyuncu düzeltildi, ${excessPlayer.name} spec'e alındı.`);
        room.setPlayerTeam(excessPlayer.id, 0);
        await sleep(REBALANCE_MOVE_DELAY_MS);
        continue;
      } catch (e) {
        break;
      }
    }

    const oversizedTeam = redCount > MAX_TEAM_SIZE ? 1 : (blueCount > MAX_TEAM_SIZE ? 2 : 0);
    if (oversizedTeam) {
      const fromPlayers = oversizedTeam === 1 ? redPlayers : bluePlayers;
      const toTeam = oversizedTeam === 1 ? 2 : 1;
      const toCount = oversizedTeam === 1 ? blueCount : redCount;
      const movable = pickMovable(fromPlayers, state, isBot, true);

      if (!movable) break;
      try {
        const targetTeam = toCount < MAX_TEAM_SIZE ? toTeam : 0;
        console.warn(`[TEAM-VALIDATOR] ${reason}: takım kapasitesi düzeltildi, ${movable.name} team=${targetTeam}.`);
        room.setPlayerTeam(movable.id, targetTeam);
        await sleep(REBALANCE_MOVE_DELAY_MS);
        continue;
      } catch (e) {
        break;
      }
    }

    if (desiredActiveCount >= 2 && redCount !== blueCount) {
      const fromRed = redCount > blueCount;
      const targetTeam = fromRed ? 2 : 1;
      const toCount = fromRed ? blueCount : redCount;

      if (activePlayers.length < desiredActiveCount && toCount < MAX_TEAM_SIZE) {
        const activeBotCount = activePlayers.filter(isBot).length;
        const botSlotsRemaining = Math.max(0, targetBotCount - activeBotCount);
        const promotable = spectatorsByType(players, state, playerJoinOrder, isBot, false)[0]
          || spectatorsByType(players, state, playerJoinOrder, isBot, true).slice(0, botSlotsRemaining)[0];

        if (promotable) {
          try {
            console.warn(`[TEAM-VALIDATOR] ${reason}: eksik takım tamamlandı, ${promotable.name} team=${targetTeam}.`);
            room.setPlayerTeam(promotable.id, targetTeam);
            await sleep(REBALANCE_MOVE_DELAY_MS);
            continue;
          } catch (e) {
            break;
          }
        }
      }

      const fromPlayers = fromRed ? redPlayers : bluePlayers;

      if (Math.abs(redCount - blueCount) === 1) {
        const benchPlayer = pickBenchCandidate(fromPlayers, state, isBot);
        if (!benchPlayer) break;

        try {
          console.warn(`[TEAM-VALIDATOR] ${reason}: tek sayılı aktif oyuncu düzeltildi, ${benchPlayer.name} spec'e alındı.`);
          room.setPlayerTeam(benchPlayer.id, 0);
          await sleep(REBALANCE_MOVE_DELAY_MS);
          continue;
        } catch (e) {
          break;
        }
      }

      if (toCount >= MAX_TEAM_SIZE) {
        const benchPlayer = pickBenchCandidate(fromPlayers, state, isBot);
        if (!benchPlayer) break;

        try {
          console.warn(`[TEAM-VALIDATOR] ${reason}: dolu takım dengesi düzeltildi, ${benchPlayer.name} spec'e alındı.`);
          room.setPlayerTeam(benchPlayer.id, 0);
          await sleep(REBALANCE_MOVE_DELAY_MS);
          continue;
        } catch (e) {
          break;
        }
      }

      const movable = pickMovable(fromPlayers, state, isBot, true);
      if (!movable) break;

      try {
        console.warn(`[TEAM-VALIDATOR] ${reason}: takım sayısı düzeltildi, ${movable.name} team=${targetTeam}.`);
        room.setPlayerTeam(movable.id, targetTeam);
        await sleep(REBALANCE_MOVE_DELAY_MS);
        continue;
      } catch (e) {
        break;
      }
    }

    await balanceBotDistribution(room, state, isBot, sleep);
    return;
  }

  if (!state.autoManageEnabled) return;
  await balanceBotDistribution(room, state, isBot, sleep);
}

function rememberLockedTeams(room, state) {
  if (typeof room.getPlayerList !== 'function') return;
  state.lockedTeams = new Map(
    room.getPlayerList()
      .filter((p) => p.id !== 0)
      .map((p) => [p.id, p.team])
  );
}

function beginTeamTransitionLock(room, state) {
  rememberLockedTeams(room, state);
  state.teamChangesLocked = true;
}

function endTeamTransitionLock(room, state) {
  state.teamChangesLocked = false;
  state.lockedTeams.clear();
}

function checkAndStartGame(room, state) {
  if (!state.autoManageEnabled) return;
  if (typeof room.getPlayerList !== 'function') return;
  if (state.startGamePending) return;

  beginTeamTransitionLock(room, state);
  state.startGamePending = true;
  tryStartGame(room, state, START_RETRY_COUNT);
}

function tryStartGame(room, state, retriesLeft) {
  const activePlayers = room.getPlayerList().filter((p) => p.id !== 0 && (p.team === 1 || p.team === 2));

  if (activePlayers.length >= 1 && !state.currentGame && typeof room.startGame === 'function') {
    try {
      room.startGame();
      state.startGamePending = false;
      return;
    } catch (e) {
      if (retriesLeft <= 0) {
        state.startGamePending = false;
        endTeamTransitionLock(room, state);
        console.warn('Oyun başlatılamadı, yeniden deneme hakkı bitti:', e.message);
        return;
      }
      console.warn(`Oyun başlatılamadı, tekrar denenecek (${retriesLeft}):`, e.message);
    }
  }

  if (retriesLeft <= 0 || state.currentGame || activePlayers.length === 0) {
    state.startGamePending = false;
    if (!state.currentGame) endTeamTransitionLock(room, state);
    return;
  }

  setTimeout(() => tryStartGame(room, state, retriesLeft - 1), START_RETRY_DELAY_MS);
}

async function rebalanceTeams(room, state, { playerJoinOrder, botManager, sleep = fallbackSleep }) {
  if (!state.autoManageEnabled) return;
  if (state.isRebalancing) {
    state.rebalanceRequested = true;
    return;
  }
  if (typeof room.getPlayerList !== 'function' || typeof room.setPlayerTeam !== 'function') return;

  state.isRebalancing = true;
  beginTeamTransitionLock(room, state);

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
  if (!state.autoManageEnabled) return;

  let players = room.getPlayerList();

  const hostPlayer = players.find((p) => p.id === 0);
  if (hostPlayer && hostPlayer.team !== 0) {
    try { room.setPlayerTeam(0, 0); } catch (e) {}
  }

  const isBot = (p) => isBotPlayer(botManager, p);
  let autoEligiblePlayers = players.filter((p) => isAutoEligiblePlayer(p, state));
  let realPlayers = autoEligiblePlayers.filter((p) => !isBot(p));
  let botPlayers = autoEligiblePlayers.filter(isBot);
  let targetBotCount = desiredBotCount(realPlayers.length, botPlayers.length);
  let activeBots = botPlayers.filter((p) => p.team === 1 || p.team === 2);
  let desiredActiveCount = desiredEvenActiveCount(realPlayers.length, botPlayers.length, MAX_ACTIVE_PLAYERS);
  const activePlayers = players.filter((p) => p.id !== 0 && (p.team === 1 || p.team === 2) && !state.afkPlayers.has(p.id));
  const waitingHumans = spectatorsByType(players, state, playerJoinOrder, isBot, false);
  const joinDelay = waitingHumans.length > 0 && activeBots.length > targetBotCount
    ? PLAYER_REPLACES_BOT_DELAY_MS
    : (waitingHumans.length > 0 && activePlayers.length < desiredActiveCount ? PLAYER_EMPTY_SLOT_DELAY_MS : 0);

  if (joinDelay > 0) {
    await sleep(joinDelay);
    if (!state.autoManageEnabled) return;
    players = room.getPlayerList();
    autoEligiblePlayers = players.filter((p) => isAutoEligiblePlayer(p, state));
    realPlayers = autoEligiblePlayers.filter((p) => !isBot(p));
    botPlayers = autoEligiblePlayers.filter(isBot);
    targetBotCount = desiredBotCount(realPlayers.length, botPlayers.length);
    activeBots = botPlayers.filter((p) => p.team === 1 || p.team === 2);
    desiredActiveCount = desiredEvenActiveCount(realPlayers.length, botPlayers.length, MAX_ACTIVE_PLAYERS);
  }

  if (activeBots.length > targetBotCount) {
    const extraBots = activeBots
      .sort((a, b) => (playerJoinOrder.get(b.id) ?? 0) - (playerJoinOrder.get(a.id) ?? 0))
      .slice(0, activeBots.length - targetBotCount);
    for (const bot of extraBots) {
      if (!state.autoManageEnabled) return;
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

  const maxTeamSize = Math.min(MAX_TEAM_SIZE, Math.max(1, Math.ceil(desiredActiveCount / 2)));

  let redCount = redPlayers.length;
  let blueCount = bluePlayers.length;

  if (redCount === 0 && blueCount === 0 && spectators.length > 0) {
    if (!state.autoManageEnabled) return;
    const promote = spectators.shift();
    try {
      room.setPlayerTeam(promote.id, 1);
      redCount++;
    } catch (e) {}
    await sleep(REBALANCE_MOVE_DELAY_MS);
  }

  while (spectators.length > 0 && (redCount < maxTeamSize || blueCount < maxTeamSize)) {
    if (!state.autoManageEnabled) return;
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
      if (!state.autoManageEnabled) return;
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

  if (!state.autoManageEnabled) return;
  await validateTeamDistribution(room, state, { playerJoinOrder, botManager, sleep, reason: 'rebalance' });
  rememberLockedTeams(room, state);
  state.teamChangesLocked = true;
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
  rememberLockedTeams,
  beginTeamTransitionLock,
  endTeamTransitionLock,
  balanceBotDistribution,
  validateTeamDistribution,
};
