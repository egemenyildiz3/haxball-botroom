const { saveGameResult } = require('../db');
const { getCleanName } = require('../util');
const { checkAndStartGame, rememberLockedTeams, beginTeamTransitionLock, endTeamTransitionLock } = require('./teamBalancer');
const { desiredBotCount, isBotPlayer, sortRealPlayersFirst } = require('./botPolicy');

const ROTATION_START_DELAY_MS = 700;
const ROTATION_MOVE_DELAY_MS = 350;
const ROTATION_END_DELAY_MS = 500;

function shuffle(players) {
  const result = [...players];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function mixedTeamAssignments(players, redCount, blueCount, isBot) {
  const humans = shuffle(players.filter((p) => !isBot(p)));
  const bots = shuffle(players.filter(isBot));
  const mixed = [...humans, ...bots];
  const red = [];
  const blue = [];
  let preferRed = Math.random() < 0.5;

  for (const player of mixed) {
    const target = preferRed
      ? (red.length < redCount ? red : blue)
      : (blue.length < blueCount ? blue : red);

    target.push(player);
    preferRed = !preferRed;
  }

  return [
    ...red.map((player) => ({ player, team: 1 })),
    ...blue.map((player) => ({ player, team: 2 })),
  ];
}

function handlePlayerBallKick(state, player) {
  if (!Array.isArray(state.touchHistory)) state.touchHistory = [];

  if (!state.lastTouchPlayer || state.lastTouchPlayer.id !== player.id) {
    state.secondLastTouchPlayer = state.lastTouchPlayer;
    state.lastTouchPlayer = player;
    state.touchHistory.push({
      id: player.id,
      name: player.name,
      cleanName: getCleanName(player),
      team: player.team,
    });
    if (state.touchHistory.length > 20) state.touchHistory.shift();
  }
}

function goalAttribution(state, team) {
  const history = state.touchHistory || [];
  const scorerIndex = (() => {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].team === team) return i;
    }
    return -1;
  })();

  if (scorerIndex === -1) {
    return {
      scorer: null,
      assister: null,
      ownGoalPlayer: state.lastTouchPlayer && state.lastTouchPlayer.team !== team ? state.lastTouchPlayer : null,
    };
  }

  const scorer = history[scorerIndex];
  let assister = null;
  let assisterIndex = -1;

  for (let i = scorerIndex - 1; i >= 0; i--) {
    const touch = history[i];
    if (touch.team !== team) break;
    if (touch.id !== scorer.id) {
      assister = touch;
      assisterIndex = i;
      break;
    }
  }

  if (assister && history.slice(assisterIndex + 1).some((touch) => touch.team !== team)) {
    assister = null;
  }

  return { scorer, assister, ownGoalPlayer: null };
}

function handleTeamGoal(room, state, team, { getTimestamp, sendMsg }) {
  const liveScores = typeof room.getScores === 'function' ? room.getScores() : null;

  if (state.currentGame) {
    if (liveScores) {
      state.currentGame.redScore = liveScores.red;
      state.currentGame.blueScore = liveScores.blue;
    } else {
      if (team === 1) state.currentGame.redScore++;
      if (team === 2) state.currentGame.blueScore++;
    }
  }

  const scores = liveScores || {
    red: state.currentGame ? state.currentGame.redScore : 0,
    blue: state.currentGame ? state.currentGame.blueScore : 0,
    time: 0,
  };

  const totalSeconds = Math.floor(scores.time);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  const timeStr = `${minutes}:${seconds}`;

  let announcement = '';
  let color = 0x55FF55;

  const { scorer: goalScorer, assister: assistPlayer, ownGoalPlayer } = goalAttribution(state, team);

  if (goalScorer) {
    let assistText = '';

    if (state.currentGame) {
      let scorer = state.currentGame.players.find((p) => p.id === goalScorer.id);
      if (!scorer) {
        scorer = { id: goalScorer.id, cleanName: goalScorer.cleanName, team: goalScorer.team, goals: 0, assists: 0 };
        state.currentGame.players.push(scorer);
      }
      scorer.goals = (scorer.goals || 0) + 1;
    }

    if (assistPlayer) {
      assistText = ` (Asist: ${assistPlayer.name})`;

      if (state.currentGame) {
        let assister = state.currentGame.players.find((p) => p.id === assistPlayer.id);
        if (!assister) {
          assister = { id: assistPlayer.id, cleanName: assistPlayer.cleanName, team: assistPlayer.team, goals: 0, assists: 0 };
          state.currentGame.players.push(assister);
        }
        assister.assists = (assister.assists || 0) + 1;
      }
    }
    announcement = `⚽ GOL! ${goalScorer.name}${assistText} [${timeStr}] | KIRMIZI ${scores.red} - ${scores.blue} MAVİ`;
  } else if (ownGoalPlayer) {
    color = 0xFF5555;
    announcement = `🤡 KENDİ KALESİNE GOL! ${ownGoalPlayer.name} topu kendi ağlarına gönderdi [${timeStr}] | KIRMIZI ${scores.red} - ${scores.blue} MAVİ`;
  } else {
    announcement = `⚽ GOL! ${team === 1 ? 'Kırmızı' : 'Mavi'} Takım gol attı [${timeStr}] | KIRMIZI ${scores.red} - ${scores.blue} MAVİ`;
  }

  console.log(`[GOAL] ${announcement}`);
  sendMsg(room, announcement, null, color, 'bold');

  state.lastTouchPlayer = null;
  state.secondLastTouchPlayer = null;
  state.touchHistory = [];
}

function handleGameStart(room, state, { sendMsg }) {
  if (typeof room.getPlayerList !== 'function') return;

  endTeamTransitionLock(room, state);
  state.lastTouchPlayer = null;
  state.secondLastTouchPlayer = null;
  state.touchHistory = [];

  state.currentGame = {
    started_at: new Date().toISOString(),
    redScore: 0,
    blueScore: 0,
    players: room.getPlayerList().filter((p) => p.id !== 0).map((player) => ({
      id: player.id,
      cleanName: getCleanName(player),
      team: player.team,
      goals: 0,
      assists: 0,
    })),
  };

  console.log(`[GAME START] Maç başladı! Aktif oyuncu sayısı: ${state.currentGame.players.length}`);
  sendMsg(room, '🚀 Maç başladı! Herkese başarılar ve iyi oyunlar!', null, 0x00FF7F, 'bold');
}

async function handleGameStop(room, state, deps) {
  const { db, DB_FILE, persistDatabase, sendMsg, playerJoinOrder, sleep, SPEC_PROMOTION_COUNT, botManager } = deps;

  const liveScores = typeof room.getScores === 'function' ? room.getScores() : null;
  let scores = { red: 0, blue: 0, time: 0 };

  if (liveScores && (liveScores.red > 0 || liveScores.blue > 0)) {
    scores = liveScores;
  } else if (state.currentGame) {
    scores = {
      red: state.currentGame.redScore || 0,
      blue: state.currentGame.blueScore || 0,
      time: liveScores ? liveScores.time : 0,
    };
  }

  const winnerTeam = scores.red > scores.blue ? 1 : scores.blue > scores.red ? 2 : null;
  const loserTeam = winnerTeam === 1 ? 2 : (winnerTeam === 2 ? 1 : 2);
  const endedAt = new Date().toISOString();
  const durationSeconds = state.currentGame ? (new Date(endedAt) - new Date(state.currentGame.started_at)) / 1000 : 0;

  console.log(`[GAME STOP] Maç bitti! Skor - Kırmızı: ${scores.red} | Mavi: ${scores.blue} (Süre: ${Math.round(durationSeconds)}s)`);

  if (scores.red > 0 || scores.blue > 0) {
    saveGameResult(db, DB_FILE, scores, winnerTeam, loserTeam, state.currentGame, endedAt, durationSeconds, persistDatabase);
    const winMsg = winnerTeam === 1 ? '🔴 Kırmızı Takım Kazandı!' : winnerTeam === 2 ? '🔵 Mavi Takım Kazandı!' : '🤝 Berabere Bitti!';
    sendMsg(room, `🏆 MAÇ BİTTİ! ${winMsg} Skor: KIRMIZI ${scores.red} - ${scores.blue} MAVİ`, null, 0xFFD700, 'bold');
  }

  state.currentGame = null;

  if (!state.autoManageEnabled) {
    endTeamTransitionLock(room, state);
    console.log('[MATCH ROTATION] Otomatik yönetim kapalı - takım dağıtımı ve yeni maç atlandı.');
    return;
  }

  beginTeamTransitionLock(room, state);

  await sleep(2000);
  await sleep(ROTATION_START_DELAY_MS);

  state.isRebalancing = true;
  state.manualPlacements.clear();

  try {
    const allPlayers = room.getPlayerList();
    const activeNonAfkPlayers = allPlayers.filter((p) => p.id !== 0 && !state.afkPlayers.has(p.id));
    const isBot = (p) => isBotPlayer(botManager, p);
    const realPlayers = activeNonAfkPlayers.filter((p) => !isBot(p));
    const botPlayers = activeNonAfkPlayers.filter(isBot);
    const targetBotCount = desiredBotCount(realPlayers.length, botPlayers.length);
    const desiredActiveCount = Math.min(8, realPlayers.length + targetBotCount);
    const sortByPriority = sortRealPlayersFirst(botManager, playerJoinOrder);

    if (realPlayers.length <= 8) {
      console.log(`[MATCH ROTATION] Gerçek oyuncu sayısı <= 8 (${realPlayers.length}). Botlar yalnızca boşluk dolduracak şekilde yeniden dağıtılıyor...`);

      for (const p of allPlayers) {
        if (p.id !== 0 && p.team !== 0) {
          try { room.setPlayerTeam(p.id, 0); } catch (e) {}
          await sleep(ROTATION_MOVE_DELAY_MS);
        }
      }

      const resetPlayers = room.getPlayerList().filter((p) => p.id !== 0 && !state.afkPlayers.has(p.id)).sort(sortByPriority);
      const eligibleBotIds = new Set(resetPlayers.filter(isBot).slice(0, targetBotCount).map((p) => p.id));
      const availableSpecs = resetPlayers
        .filter((p) => p.id !== 0 && !state.afkPlayers.has(p.id))
        .filter((p) => !isBot(p) || eligibleBotIds.has(p.id))
        .slice(0, desiredActiveCount);

      const totalPlayers = availableSpecs.length;
      const redCount = Math.min(4, Math.ceil(totalPlayers / 2));
      const blueCount = Math.min(4, totalPlayers - redCount);
      const assignments = mixedTeamAssignments(availableSpecs, redCount, blueCount, isBot);

      for (const { player: p, team: targetTeam } of assignments) {
        try { room.setPlayerTeam(p.id, targetTeam); } catch (e) {}
        await sleep(ROTATION_MOVE_DELAY_MS);
      }
    } else {
      console.log(`[MATCH ROTATION] Aktif oyuncu sayısı > 8 (${activeNonAfkPlayers.length}). Yenilen takım spece alınıyor ve sıradaki kişiler sahaya sürülüyor...`);

      const losingPlayers = allPlayers.filter((p) => p.id !== 0 && p.team === loserTeam);
      for (const p of losingPlayers) {
        try {
          room.setPlayerTeam(p.id, 0);
          playerJoinOrder.set(p.id, state.nextJoinOrder++);
        } catch (e) {}
        await sleep(ROTATION_MOVE_DELAY_MS);
      }

      const currentSpecs = room.getPlayerList()
        .filter((p) => p.id !== 0 && p.team === 0 && !state.afkPlayers.has(p.id))
        .sort(sortByPriority)
        .filter((p) => {
          if (!isBot(p)) return true;
          const activeBots = room.getPlayerList().filter((candidate) => candidate.id !== 0 && !state.afkPlayers.has(candidate.id) && (candidate.team === 1 || candidate.team === 2) && isBot(candidate)).length;
          return activeBots < targetBotCount;
        });

      const promotionCount = SPEC_PROMOTION_COUNT || (losingPlayers.length > 0 ? losingPlayers.length : 4);
      const nextToPlay = currentSpecs.slice(0, promotionCount);

      for (const p of nextToPlay) {
        try { room.setPlayerTeam(p.id, loserTeam); } catch (e) {}
        await sleep(ROTATION_MOVE_DELAY_MS);
      }
    }

    rememberLockedTeams(room, state);
    state.teamChangesLocked = true;
    await sleep(ROTATION_END_DELAY_MS);
  } finally {
    state.isRebalancing = false;
  }

  await sleep(1000);
  checkAndStartGame(room, state);
}

module.exports = {
  handlePlayerBallKick,
  handleTeamGoal,
  handleGameStart,
  handleGameStop,
};
