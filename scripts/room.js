const { getCleanName } = require('./util');
const { logVisitedUser, isUserBlacklisted } = require('./db');
const { sendMsg, handleAutoLogin, handlePlayerChat } = require('./commands');
const { createRoomState } = require('./room/state');
const { sanitizePlayer, assignPlayerInternal } = require('./room/playerIdentity');
const { repairOutOfBoundsBall } = require('./room/spacebounceSafety');
const { createAutoManager, restoreAutoManageIfNoAdmins } = require('./room/autoManager');
const { rebalanceTeams, checkAndStartGame, lockTeams } = require('./room/teamBalancer');
const { handlePlayerKicked, handlePlayerAdminChange, handlePlayerTeamChange } = require('./room/moderationGuards');
const { handlePlayerBallKick, handleTeamGoal, handleGameStart, handleGameStop, checkKickoffWatch } = require('./room/matchManager');
const { attachTerminalInput } = require('./room/terminal');
const { isProtectedBotIdentity } = require('./room/botPolicy');
const { blockDuplicateJoin } = require('./room/joinGuards');

const TEAM_COLORS = {
  red: { team: 1, angle: 60, text: 0xE3E3E3, colors: [0xC90209] },
  blue: { team: 2, angle: 60, text: 0xE3E3E3, colors: [0x0272BD] },
};
const ADMIN_REQUEST_ANNOUNCE_MS = 5 * 60 * 1000;
const ADMIN_REQUEST_ANNOUNCE_TEXT = '📮 İstek, talep, şikayet veya bug bildirmek için: !admin <açıklama>';
const INACTIVITY_KICK_MS = 30 * 1000;
const INACTIVITY_WARNING_MS = 25 * 1000;
const INACTIVITY_CHECK_MS = 1000;

process.on('uncaughtException', (err) => {
  console.error('❌ [CRITICAL ERROR] Yakalanmamış İstisna:', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [UNHANDLED REJECTION] İşlenmemiş Promise Reddi:', reason);
});

function applyTeamColors(room) {
  if (typeof room.setTeamColors !== 'function') return;

  for (const { team, angle, text, colors } of Object.values(TEAM_COLORS)) {
    try {
      room.setTeamColors(team, angle, text, colors);
    } catch (err) {
      console.warn(`[COLORS] Takım forması uygulanamadı (team=${team}):`, err.message);
    }
  }
}

function isPlayableHuman(player, state, botManager) {
  return !!(
    player
    && player.id !== 0
    && (player.team === 1 || player.team === 2)
    && !state.afkPlayers.has(player.id)
    && !(botManager && typeof botManager.isBotPlayer === 'function' && botManager.isBotPlayer(player.id))
  );
}

function markPlayerInput(state, player, botManager) {
  if (!isPlayableHuman(player, state, botManager)) return;
  state.lastInputAt.set(player.id, Date.now());
  state.inactivityWarnings.delete(player.id);
}

function getRawPlayerInput(room, playerId) {
  const rawRoom = room && room.nhInstance;
  if (!rawRoom) return null;

  const rawPlayer = typeof rawRoom.getPlayer === 'function'
    ? rawRoom.getPlayer(playerId)
    : (rawRoom.players || []).find((candidate) => candidate.id === playerId);

  return rawPlayer && typeof rawPlayer.input === 'number' ? rawPlayer.input : null;
}

function attachInactivityKick(room, state, deps) {
  const { botManager, sendMsg, getTimestamp } = deps;

  room.onPlayerActivity = function (player) {
    markPlayerInput(state, player, botManager);
  };

  setInterval(() => {
    if (!state.currentGame || typeof room.getPlayerList !== 'function') return;

    const now = Date.now();
    for (const player of room.getPlayerList()) {
      if (!isPlayableHuman(player, state, botManager)) continue;

      const currentInput = getRawPlayerInput(room, player.id);
      if (currentInput !== null && currentInput !== 0) {
        state.lastInputAt.set(player.id, now);
        state.inactivityWarnings.delete(player.id);
        continue;
      }

      if (!state.lastInputAt.has(player.id)) {
        state.lastInputAt.set(player.id, now);
        continue;
      }

      const idleMs = now - state.lastInputAt.get(player.id);
      if (idleMs >= INACTIVITY_KICK_MS) {
        const name = getCleanName(player);
        state.lastInputAt.delete(player.id);
        state.inactivityWarnings.delete(player.id);

        try {
          room.kickPlayer(player.id, 'Uzun süre hareketsiz kaldınız.', false);
          console.log(`${getTimestamp()} [INACTIVITY] ${name} input vermediği için kicklendi.`);
        } catch (err) {
          console.warn('[INACTIVITY] Oyuncu kicklenemedi:', err.message);
        }
      } else if (idleMs >= INACTIVITY_WARNING_MS && !state.inactivityWarnings.has(player.id)) {
        state.inactivityWarnings.add(player.id);
        sendMsg(room, '⚠️ 5 saniye daha hareketsiz kalırsanız atılacaksınız.', player.id, 0xFFCC00, 'bold');
      }
    }
  }, INACTIVITY_CHECK_MS);
}

function markSuperAdminAfkOnJoin(room, state, player, deps) {
  const userData = deps.loggedInPlayers.get(player.id);
  if (!userData || userData.isadmin !== 1) return false;

  state.afkPlayers.add(player.id);
  if (player.team !== 0 && typeof room.setPlayerTeam === 'function') {
    try { room.setPlayerTeam(player.id, 0); } catch (e) {}
  }

  console.log(`${deps.getTimestamp()} [AFK] Superadmin girişte otomatik AFK yapıldı: ${getCleanName(player)} (ID: ${player.id})`);
  return true;
}

async function createRoom(room, deps) {
  const {
    ROOM_NAME,
    mapData,
    SCORE_LIMIT,
    TIME_LIMIT,
    SPEC_PROMOTION_COUNT,
    playerAssignments,
    playerJoinOrder,
    loggedInPlayers,
    leavingIntentions,
    db,
    DB_FILE,
    persistDatabase,
    ADMIN_PASSWORD,
    getTimestamp,
    sleep,
    CONFIG_ADMIN_CAN_BAN = 1,
    CONFIG_ADMIN_CAN_GIVE_ADMIN = 0,
    CONFIG_ALLOW_MULTIPLE_JOIN = 0,
    botManager = null,
  } = deps;

  const state = createRoomState();
  const roomDeps = {
    db,
    DB_FILE,
    loggedInPlayers,
    playerAssignments,
    playerJoinOrder,
    leavingIntentions,
    persistDatabase,
    sendMsg,
    ADMIN_PASSWORD,
    getTimestamp,
    sleep,
    SPEC_PROMOTION_COUNT,
    CONFIG_ADMIN_CAN_BAN,
    CONFIG_ADMIN_CAN_GIVE_ADMIN,
    CONFIG_ALLOW_MULTIPLE_JOIN,
    botManager,
  };

  const autoManager = createAutoManager(room, state, roomDeps);
  attachTerminalInput(room, state, roomDeps, autoManager);
  attachInactivityKick(room, state, roomDeps);

  const originalKickPlayer = room.kickPlayer.bind(room);
  room.kickPlayer = function (id, reason, ban) {
    leavingIntentions.set(id, ban ? 'ban' : 'kick');
    originalKickPlayer(id, reason, ban);
  };

  room.onRoomLink = function (link) {
    console.log('\n========================================');
    console.log('🔗 Oda Bağlantısı:', link);
    console.log('========================================\n');
  };

  room.onGameTick = function () {
    state.lastGameTickAt = Date.now();
    checkKickoffWatch(room, state, roomDeps);
    repairOutOfBoundsBall(room, sendMsg);
  };

  room.onPlayerKicked = function (kickedPlayer, reason, ban, byPlayer) {
    handlePlayerKicked(room, state, kickedPlayer, reason, ban, byPlayer, roomDeps, sanitizePlayer);
  };

  room.onPlayerAdminChange = function (changedPlayer, byPlayer) {
    handlePlayerAdminChange(room, state, changedPlayer, byPlayer, roomDeps, sanitizePlayer);
  };

  room.onPlayerTeamChange = function (changedPlayer, byPlayer) {
    const safePlayer = sanitizePlayer(room, changedPlayer, state);
    markPlayerInput(state, safePlayer, botManager);
    handlePlayerTeamChange(room, state, safePlayer, byPlayer, roomDeps, sanitizePlayer);
  };

  room.onPlayerJoin = async function (player) {
    if (!player) return;

    if (player.auth) {
      state.playerAuths.set(String(player.id), player.auth);
    }

    const safePlayer = sanitizePlayer(room, player, state);
    const cleanedName = getCleanName(safePlayer);
    const isOwnBot = !!(botManager && botManager.isExpectedBotName(cleanedName));

    if (isOwnBot) {
      console.log(`${getTimestamp()} [BOT] Bot oyuncu olarak tanındı: ${cleanedName} (ID: ${safePlayer.id})`);
      assignPlayerInternal(room, safePlayer, state, roomDeps);
      await sleep(800);
      await handlePlayerJoin(room, sanitizePlayer(room, safePlayer, state), state, roomDeps);
      return;
    }

    const hasProtectedBotAuth = isProtectedBotIdentity(botManager, safePlayer);

    if (!hasProtectedBotAuth && isUserBlacklisted(db, cleanedName, safePlayer.auth)) {
      console.log(`${getTimestamp()} [BLACKLIST] Karalistedeki oyuncu engellendi: ${cleanedName} (ID: ${safePlayer.id}, Auth: ${safePlayer.auth || 'YOK'})`);
      try {
        room.kickPlayer(safePlayer.id, "Karalisteye alındınız.", true);
      } catch (e) {
        console.warn('Blacklist banlama hatası:', e.message);
      }
      return;
    } else if (hasProtectedBotAuth) {
      console.log(`${getTimestamp()} [BLACKLIST] Bot auth/conn imzası kara liste kontrolünden muaf tutuldu: ${cleanedName} (ID: ${safePlayer.id})`);
    }

    if (blockDuplicateJoin(room, state, safePlayer, roomDeps)) {
      return;
    }

    logVisitedUser(db, DB_FILE, cleanedName, safePlayer.auth, persistDatabase);
    assignPlayerInternal(room, safePlayer, state, roomDeps);

    await sleep(800);

    const updatedPlayer = sanitizePlayer(room, safePlayer, state);
    handleAutoLogin(room, updatedPlayer, { db, DB_FILE, loggedInPlayers, persistDatabase });
    markSuperAdminAfkOnJoin(room, state, sanitizePlayer(room, updatedPlayer, state), roomDeps);
    await handlePlayerJoin(room, updatedPlayer, state, roomDeps);
  };

  room.onPlayerLeave = function (player) {
    const safePlayer = sanitizePlayer(room, player, state);
    handlePlayerLeave(room, safePlayer, state, roomDeps);
  };

  room.onPlayerChat = function (player, msg) {
    const safePlayer = sanitizePlayer(room, player, state);
    return handlePlayerChat(room, safePlayer, msg, {
      ...roomDeps,
      afkPlayers: state.afkPlayers,
      rebalanceTeams: () => scheduleRebalance(room, state, roomDeps),
      autoManager,
      chatFilter: state.chatFilter,
      chatMuted: state.chatMuted,
      setChatMuted: (muted) => { state.chatMuted = !!muted; },
      mutedPlayers: state.mutedPlayers,
      gameActive: !!state.currentGame,
    });
  };

  room.onPlayerBallKick = function (player) {
    handlePlayerBallKick(state, sanitizePlayer(room, player, state));
  };

  room.onTeamGoal = function (team) {
    handleTeamGoal(room, state, team, { getTimestamp, sendMsg });
  };

  room.onGameStart = function () {
    if (typeof room.getPlayerList === 'function') {
      for (const player of room.getPlayerList()) {
        markPlayerInput(state, player, botManager);
      }
    }
    handleGameStart(room, state, { sendMsg, playerAssignments });
  };

  room.onGameStop = function () {
    handleGameStop(room, state, roomDeps)
      .catch((err) => console.warn('[GAME STOP] Maç sonu işlemleri başarısız:', err.message));
  };

  await sleep(600);

  if (typeof room.setCustomStadium === 'function') room.setCustomStadium(mapData);
  await sleep(200);

  if (typeof room.setScoreLimit === 'function') room.setScoreLimit(SCORE_LIMIT);
  if (typeof room.setTimeLimit === 'function') room.setTimeLimit(TIME_LIMIT);
  applyTeamColors(room);

  lockTeams(room);

  setInterval(() => {
    if (typeof room.getPlayerList === 'function') {
      const realHumanPlayers = room.getPlayerList().filter((p) => p.id !== 0);
      if (realHumanPlayers.length > 0) {
        console.log(`[STATUS] Odada şu an aktif ${realHumanPlayers.length} oyuncu bulunuyor. Zaman: ${getTimestamp()}`);
      }

      restoreAutoManageIfNoAdmins(room, state, roomDeps);
    }
  }, 2 * 60 * 1000);

  setInterval(() => {
    if (typeof room.getPlayerList !== 'function') return;
    const realHumanPlayers = room.getPlayerList().filter((p) => p.id !== 0);
    if (realHumanPlayers.length === 0) return;
    sendMsg(room, ADMIN_REQUEST_ANNOUNCE_TEXT, null, 0x00BFFF, 'bold');
  }, ADMIN_REQUEST_ANNOUNCE_MS);

  console.log(`${getTimestamp()} Oda başarıyla oluşturuldu: ${ROOM_NAME}`);
}

async function handlePlayerJoin(room, player, state, deps) {
  if (typeof room.getPlayerList !== 'function') return;

  await rebalanceTeams(room, state, deps);
  await deps.sleep(600);
  checkAndStartGame(room, state);
}

function handlePlayerLeave(room, player, state, deps) {
  const { playerAssignments, playerJoinOrder, loggedInPlayers, leavingIntentions, getTimestamp } = deps;
  const cleanedName = getCleanName(player);
  const intention = leavingIntentions.get(player.id);

  if (intention === 'ban') {
    console.log(`[BAN] Oyuncu banlandı: id=${player.id}, isim=${cleanedName}`);
    leavingIntentions.delete(player.id);
  } else if (intention === 'kick') {
    console.log(`[KICK] Oyuncu atıldı: id=${player.id}, isim=${cleanedName}`);
    leavingIntentions.delete(player.id);
  } else {
    console.log(`${getTimestamp()} [LEAVE] Oyuncu kendi ayrıldı: id=${player.id}, isim=${cleanedName}`);
  }

  if (player && typeof player.id !== 'undefined') {
    playerAssignments.delete(player.id);
    playerJoinOrder.delete(player.id);
    loggedInPlayers.delete(player.id);
    state.afkPlayers.delete(player.id);
    state.manualPlacements.delete(player.id);
    state.playerAuths.delete(String(player.id));
    state.lastInputAt.delete(player.id);
    state.inactivityWarnings.delete(player.id);
    state.chatFilter.forget(player.id);
  }

  if (typeof room.getPlayerList !== 'function') return;

  restoreAutoManageIfNoAdmins(room, state, deps, player && player.id);

  const activePlayers = room.getPlayerList().filter((p) => p.id !== 0 && (p.team === 1 || p.team === 2));

  if (activePlayers.length === 0 && typeof room.stopGame === 'function') {
    try {
      room.stopGame();
    } catch (e) {}
  }

  scheduleRebalance(room, state, deps);
}

function scheduleRebalance(room, state, deps) {
  return rebalanceTeams(room, state, deps)
    .catch((err) => console.warn('[AUTO] Takım dengeleme başarısız:', err.message));
}

module.exports = {
  createRoom,
};
