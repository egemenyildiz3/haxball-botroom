const { desiredBotCount, desiredEvenActiveCount, isBotPlayer } = require('./botPolicy');
const { handleRoomReadError } = require('./runtimeHealth');

const REBALANCE_START_DELAY_MS = 600;
const REBALANCE_MOVE_DELAY_MS = 300;
const REBALANCE_END_DELAY_MS = 450;
const PLAYER_REPLACES_BOT_DELAY_MS = 3 * 1000;
const PLAYER_EMPTY_SLOT_DELAY_MS = 1 * 1000;
const START_RETRY_DELAY_MS = 1000;
const START_RETRY_COUNT = 5;
const DEFAULT_MAX_TEAM_SIZE = 4;
const DEFAULT_MAX_ACTIVE_PLAYERS = 8;

const fallbackSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeGetPlayerList(room, context = 'TEAM') {
  if (!room || typeof room.getPlayerList !== 'function') return [];
  try {
    return room.getPlayerList();
  } catch (err) {
    handleRoomReadError(context, err);
    return [];
  }
}

function teamLimits(config = {}) {
  const teamManagement = config.teamManagement || {};
  const maxTeamSize = Number.isInteger(teamManagement.maxTeamSize)
    ? teamManagement.maxTeamSize
    : DEFAULT_MAX_TEAM_SIZE;
  const maxActivePlayers = Number.isInteger(teamManagement.maxActivePlayers)
    ? teamManagement.maxActivePlayers
    : Math.min(DEFAULT_MAX_ACTIVE_PLAYERS, maxTeamSize * 2);

  return {
    maxTeamSize,
    maxActivePlayers: Math.min(maxActivePlayers, maxTeamSize * 2),
  };
}

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

function isAutoEligiblePlayer(player, state, isBot = () => false) {
  return !!(
    player
    && player.id !== 0
    && !state.pendingJoinPlayers.has(player.id)
    && !state.afkPlayers.has(player.id)
    && (isBot(player) || !(player.team === 0 && state.manualPlacements.has(player.id)))
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

function pickExcessActivePlayer(heavyPlayers, redPlayers, bluePlayers, state, isBot, playerJoinOrder) {
  const candidates = heavyPlayers.filter((p) => canMoveForBotBalance(p, state));
  if (candidates.length === 0) return null;

  const redCount = redPlayers.length;
  const blueCount = bluePlayers.length;
  const redBots = botCount(redPlayers, isBot);
  const blueBots = botCount(bluePlayers, isBot);

  return candidates
    .map((player) => {
      const fromRed = player.team === 1;
      const nextRedCount = redCount - (fromRed ? 1 : 0);
      const nextBlueCount = blueCount - (fromRed ? 0 : 1);
      const nextRedBots = redBots - (fromRed && isBot(player) ? 1 : 0);
      const nextBlueBots = blueBots - (!fromRed && isBot(player) ? 1 : 0);
      const botDiff = Math.abs(nextRedBots - nextBlueBots);
      const teamDiff = Math.abs(nextRedCount - nextBlueCount);

      return {
        player,
        // Avoid creating a bot imbalance that forces another corrective move.
        score: (botDiff > 1 ? 100 : botDiff * 10)
          + teamDiff
          + (isBot(player) ? 0 : 5)
          - ((playerJoinOrder.get(player.id) ?? 0) / 100000),
      };
    })
    .sort((a, b) => a.score - b.score)[0].player;
}

function pickExtraActiveBots(players, state, isBot, targetBotCount, playerJoinOrder) {
  const selected = [];
  const mutablePlayers = [...players];

  while (mutablePlayers.filter((p) => (p.team === 1 || p.team === 2) && isBot(p)).length > targetBotCount) {
    const redPlayers = activeTeamPlayers(mutablePlayers, state, 1);
    const bluePlayers = activeTeamPlayers(mutablePlayers, state, 2);
    const redBots = redPlayers.filter(isBot);
    const blueBots = bluePlayers.filter(isBot);

    const heavyTeam = redPlayers.length > bluePlayers.length
      ? 1
      : bluePlayers.length > redPlayers.length
        ? 2
        : (redBots.length >= blueBots.length ? 1 : 2);

    const heavyBots = (heavyTeam === 1 ? redBots : blueBots)
      .filter((p) => canMoveForBotBalance(p, state))
      .sort((a, b) => (playerJoinOrder.get(b.id) ?? 0) - (playerJoinOrder.get(a.id) ?? 0));

    const fallbackBots = mutablePlayers
      .filter((p) => (p.team === 1 || p.team === 2) && isBot(p) && canMoveForBotBalance(p, state))
      .sort((a, b) => (playerJoinOrder.get(b.id) ?? 0) - (playerJoinOrder.get(a.id) ?? 0));

    const bot = heavyBots[0] || fallbackBots[0];
    if (!bot) break;

    selected.push(bot);
    const index = mutablePlayers.findIndex((p) => p.id === bot.id);
    if (index !== -1) mutablePlayers[index] = { ...mutablePlayers[index], team: 0 };
  }

  return selected;
}

async function balanceBotDistribution(room, state, isBot, sleep = fallbackSleep) {
  if (typeof room.getPlayerList !== 'function' || typeof room.setPlayerTeam !== 'function') return;

  for (let attempts = 0; attempts < 4; attempts++) {
    const players = safeGetPlayerList(room, 'BOT BALANCE');
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
    config = {},
  } = deps;

  if (typeof room.getPlayerList !== 'function' || typeof room.setPlayerTeam !== 'function') return;

  const isBot = (p) => isBotPlayer(botManager, p);
  const { maxTeamSize, maxActivePlayers } = teamLimits(config);

  for (let attempts = 0; attempts < 8; attempts++) {
    if (!state.autoManageEnabled) return;

    const players = safeGetPlayerList(room, 'TEAM VALIDATOR');
    const eligiblePlayers = players.filter((p) => isAutoEligiblePlayer(p, state, isBot));
    const realPlayers = eligiblePlayers.filter((p) => !isBot(p));
    const botPlayers = eligiblePlayers.filter(isBot);
    const targetBotCount = desiredBotCount(realPlayers.length, botPlayers.length, maxActivePlayers);
    const desiredActiveCount = desiredEvenActiveCount(realPlayers.length, botPlayers.length, maxActivePlayers);
    const redPlayers = activeTeamPlayers(players, state, 1);
    const bluePlayers = activeTeamPlayers(players, state, 2);
    const activePlayers = [...redPlayers, ...bluePlayers];
    const redCount = redPlayers.length;
    const blueCount = bluePlayers.length;
    const activeBotCount = activePlayers.filter(isBot).length;

    if (activeBotCount > targetBotCount) {
      const extraBots = pickExtraActiveBots(players, state, isBot, targetBotCount, playerJoinOrder);
      const excessBot = extraBots[0];

      if (!excessBot) break;
      try {
        console.warn(`[TEAM-VALIDATOR] ${reason}: fazla aktif bot düzeltildi, ${excessBot.name} spec'e alındı.`);
        room.setPlayerTeam(excessBot.id, 0);
        await sleep(REBALANCE_MOVE_DELAY_MS);
        continue;
      } catch (e) {
        break;
      }
    }

    if (activePlayers.length > desiredActiveCount) {
      const heavyTeam = redCount >= blueCount ? 1 : 2;
      const heavyPlayers = heavyTeam === 1 ? redPlayers : bluePlayers;
      const excessPlayer = pickExcessActivePlayer(
        heavyPlayers,
        redPlayers,
        bluePlayers,
        state,
        isBot,
        playerJoinOrder
      );

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

    const oversizedTeam = redCount > maxTeamSize ? 1 : (blueCount > maxTeamSize ? 2 : 0);
    if (oversizedTeam) {
      const fromPlayers = oversizedTeam === 1 ? redPlayers : bluePlayers;
      const toTeam = oversizedTeam === 1 ? 2 : 1;
      const toCount = oversizedTeam === 1 ? blueCount : redCount;
      const movable = pickMovable(fromPlayers, state, isBot, true);

      if (!movable) break;
      try {
        const targetTeam = toCount < maxTeamSize ? toTeam : 0;
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

      if (activePlayers.length < desiredActiveCount && toCount < maxTeamSize) {
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

      if (toCount >= maxTeamSize) {
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
    safeGetPlayerList(room, 'TEAM LOCK')
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
  if (state.matchRotationPending) return;
  if (typeof room.getPlayerList !== 'function') return;
  if (state.startGamePending) return;

  beginTeamTransitionLock(room, state);
  state.startGamePending = true;
  tryStartGame(room, state, START_RETRY_COUNT);
}

function tryStartGame(room, state, retriesLeft) {
  const activePlayers = safeGetPlayerList(room, 'START GAME').filter((p) => p.id !== 0 && (p.team === 1 || p.team === 2));

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

async function rebalanceTeams(room, state, { playerJoinOrder, botManager, sleep = fallbackSleep, sendMsg, t, config }) {
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
      await runRebalanceOnce(room, state, { playerJoinOrder, botManager, sleep, sendMsg, t, config });
    } while (state.rebalanceRequested);
  } finally {
    state.isRebalancing = false;
    state.promotionNoticePlayers.clear();
  }
}

async function runRebalanceOnce(room, state, { playerJoinOrder, botManager, sleep, sendMsg, t, config }) {
  await sleep(REBALANCE_START_DELAY_MS);
  if (!state.autoManageEnabled) return;

  let players = safeGetPlayerList(room, 'REBALANCE');

  const hostPlayer = players.find((p) => p.id === 0);
  if (hostPlayer && hostPlayer.team !== 0) {
    try { room.setPlayerTeam(0, 0); } catch (e) {}
  }

  const isBot = (p) => isBotPlayer(botManager, p);
  const { maxTeamSize, maxActivePlayers } = teamLimits(config);
  let autoEligiblePlayers = players.filter((p) => isAutoEligiblePlayer(p, state, isBot));
  let realPlayers = autoEligiblePlayers.filter((p) => !isBot(p));
  let botPlayers = autoEligiblePlayers.filter(isBot);
  let targetBotCount = desiredBotCount(realPlayers.length, botPlayers.length, maxActivePlayers);
  let activeBots = botPlayers.filter((p) => p.team === 1 || p.team === 2);
  let desiredActiveCount = desiredEvenActiveCount(realPlayers.length, botPlayers.length, maxActivePlayers);
  const activePlayers = players.filter((p) => p.id !== 0 && (p.team === 1 || p.team === 2) && !state.afkPlayers.has(p.id));
  let waitingHumans = spectatorsByType(players, state, playerJoinOrder, isBot, false);
  const joinDelay = waitingHumans.length > 0 && activeBots.length > targetBotCount
    ? PLAYER_REPLACES_BOT_DELAY_MS
    : (waitingHumans.length > 0 && activePlayers.length < desiredActiveCount ? PLAYER_EMPTY_SLOT_DELAY_MS : 0);

  if (joinDelay > 0) {
    const replacementSlots = Math.max(0, activeBots.length - targetBotCount);
    const emptySlots = Math.max(0, desiredActiveCount - activePlayers.length);
    const noticeCount = Math.max(replacementSlots, emptySlots);
    notifyPromotionCandidates(room, state, waitingHumans.slice(0, noticeCount), { sendMsg, t, config });
    await sleep(joinDelay);
    if (!state.autoManageEnabled) return;
    players = safeGetPlayerList(room, 'REBALANCE');
    autoEligiblePlayers = players.filter((p) => isAutoEligiblePlayer(p, state, isBot));
    realPlayers = autoEligiblePlayers.filter((p) => !isBot(p));
    botPlayers = autoEligiblePlayers.filter(isBot);
    targetBotCount = desiredBotCount(realPlayers.length, botPlayers.length, maxActivePlayers);
    activeBots = botPlayers.filter((p) => p.team === 1 || p.team === 2);
    desiredActiveCount = desiredEvenActiveCount(realPlayers.length, botPlayers.length, maxActivePlayers);
    waitingHumans = spectatorsByType(players, state, playerJoinOrder, isBot, false);
  }

  if (activeBots.length > targetBotCount) {
    const extraBots = pickExtraActiveBots(players, state, isBot, targetBotCount, playerJoinOrder);
    const replacementHumans = waitingHumans.slice(0, extraBots.length);

    for (const bot of extraBots) {
      if (!state.autoManageEnabled) return;
      const replacement = replacementHumans.shift();
      const replacementTeam = bot.team;

      try { room.setPlayerTeam(bot.id, 0); } catch (e) {}
      await sleep(REBALANCE_MOVE_DELAY_MS);

      if (replacement && replacementTeam !== 0) {
        if (!state.autoManageEnabled) return;
        try { room.setPlayerTeam(replacement.id, replacementTeam); } catch (e) {}
        await sleep(REBALANCE_MOVE_DELAY_MS);
      }
    }
    players = safeGetPlayerList(room, 'REBALANCE');
  }

  let redPlayers = activeTeamPlayers(players, state, 1);
  let bluePlayers = activeTeamPlayers(players, state, 2);
  const activeBotCount = [...redPlayers, ...bluePlayers].filter(isBot).length;
  const botSlotsRemaining = Math.max(0, targetBotCount - activeBotCount);
  const spectators = [
    ...spectatorsByType(players, state, playerJoinOrder, isBot, false),
    ...spectatorsByType(players, state, playerJoinOrder, isBot, true).slice(0, botSlotsRemaining),
  ];

  const maxTeamSizeForMatch = Math.min(maxTeamSize, Math.max(1, Math.ceil(desiredActiveCount / 2)));

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

  while (spectators.length > 0 && (redCount < maxTeamSizeForMatch || blueCount < maxTeamSizeForMatch)) {
    if (!state.autoManageEnabled) return;
    const targetTeam = redCount < maxTeamSizeForMatch && blueCount < maxTeamSizeForMatch
      ? (redCount <= blueCount ? 1 : 2)
      : (redCount < maxTeamSizeForMatch ? 1 : 2);

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

  players = safeGetPlayerList(room, 'REBALANCE');
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
  await validateTeamDistribution(room, state, { playerJoinOrder, botManager, sleep, reason: 'rebalance', config });
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
      && !state.pendingJoinPlayers.has(p.id)
      && !state.afkPlayers.has(p.id)
      && (isBot(p) || !state.manualPlacements.has(p.id))
      && isBot(p) === wantBot
    ))
    .sort((a, b) => (playerJoinOrder.get(a.id) ?? 0) - (playerJoinOrder.get(b.id) ?? 0));
}

function promotionNoticeConfig(config = {}) {
  const notice = config.teamManagement && config.teamManagement.promotionNotice;
  return {
    enabled: !notice || notice.enabled !== false,
    color: notice && Number.isInteger(notice.color) ? notice.color : 0x00BFFF,
  };
}

function notifyPromotionCandidates(room, state, candidates, deps = {}) {
  const { sendMsg, t = (key) => key, config = {} } = deps;
  if (!sendMsg || typeof sendMsg !== 'function') return;

  const notice = promotionNoticeConfig(config);
  if (!notice.enabled) return;

  for (const player of candidates) {
    if (!player || player.id === 0 || state.promotionNoticePlayers.has(player.id)) continue;
    state.promotionNoticePlayers.add(player.id);
    sendMsg(room, t('team.preparePromotion'), player.id, notice.color, 'bold');
  }
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
  pickExtraActiveBots,
  teamLimits,
};
