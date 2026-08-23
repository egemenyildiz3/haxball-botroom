const { saveGameResult } = require('../db');
const { getCleanName } = require('../util');
const { checkAndStartGame, rememberLockedTeams, beginTeamTransitionLock, endTeamTransitionLock, validateTeamDistribution } = require('./teamBalancer');
const { desiredBotCount, desiredEvenActiveCount, isBotPlayer, sortRealPlayersFirst } = require('./botPolicy');

const ROTATION_START_DELAY_MS = 600;
const ROTATION_MOVE_DELAY_MS = 300;
const ROTATION_END_DELAY_MS = 450;
const KICKOFF_TOUCH_DELAY_MS = 4 * 1000;
const MIN_BOTS_AFTER_GAME = 4;

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

function kickoffTeamAfterGoal(scoringTeam) {
  if (scoringTeam === 1) return 2;
  if (scoringTeam === 2) return 1;
  return null;
}

function startKickoffWatch(state, team = null) {
  state.kickoffWatch = {
    team,
    startedAt: Date.now(),
    triggered: false,
  };
}

function clearKickoffWatch(state, player = null) {
  const watch = state.kickoffWatch;
  if (!watch) return;
  if (player && watch.team && player.team !== watch.team) return;
  state.kickoffWatch = null;
}

function checkKickoffWatch(room, state, deps) {
  const { botManager } = deps;
  const watch = state.kickoffWatch;
  if (!watch || watch.triggered || !state.currentGame) return;
  if (Date.now() - watch.startedAt < KICKOFF_TOUCH_DELAY_MS) return;
  if (!botManager || typeof botManager.forceClosestBotToBall !== 'function') {
    watch.triggered = true;
    console.log('[KICKOFF-WATCH] Bot manager hazır değil; santra müdahalesi atlandı.');
    return;
  }

  const teams = watch.team ? [watch.team] : [1, 2];
  for (const team of teams) {
    if (botManager.forceClosestBotToBall(team)) {
      watch.triggered = true;
      console.log(`[KICKOFF-WATCH] ${team} takımındaki en yakın bot santra için topa gönderildi.`);
      return;
    }
  }

  watch.triggered = true;
  console.log(`[KICKOFF-WATCH] Santra müdahalesi tetiklendi ama team=${teams.join(',')} için uygun bot bulunamadı.`);
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Math.round(seconds || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (minutes <= 0) return `${remainingSeconds} sn`;
  return `${minutes} dk ${remainingSeconds} sn`;
}

function handlePlayerBallKick(state, player) {
  clearKickoffWatch(state, player);

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

function fallbackT(key, vars = {}) {
  const messages = {
    'team.red': 'KIRMIZI',
    'team.blue': 'MAVİ',
    'team.redName': 'Kırmızı',
    'team.blueName': 'Mavi',
    'match.assist': `Asist: ${vars.name}`,
    'match.goal': `⚽ GOL! ${vars.scorer}${vars.assist} [${vars.time}] | ${vars.redTeam} ${vars.redScore} - ${vars.blueScore} ${vars.blueTeam}`,
    'match.ownGoal': `🤡 KENDİ KALESİNE GOL! ${vars.player} topu kendi ağlarına gönderdi [${vars.time}] | ${vars.redTeam} ${vars.redScore} - ${vars.blueScore} ${vars.blueTeam}`,
    'match.teamGoal': `⚽ GOL! ${vars.team} Takım gol attı [${vars.time}] | ${vars.redTeam} ${vars.redScore} - ${vars.blueScore} ${vars.blueTeam}`,
    'match.started': '🚀 Maç başladı! Herkese başarılar ve iyi oyunlar!',
    'match.redWon': '🔴 Kırmızı Takım Kazandı!',
    'match.blueWon': '🔵 Mavi Takım Kazandı!',
    'match.draw': '🤝 Berabere Bitti!',
    'match.finished': `🏆 MAÇ BİTTİ! ${vars.result} Skor: ${vars.redTeam} ${vars.redScore} - ${vars.blueScore} ${vars.blueTeam}`,
  };
  return messages[key] || key;
}

function scoreVars(t, scores) {
  return {
    redTeam: t('team.red'),
    blueTeam: t('team.blue'),
    redScore: scores.red,
    blueScore: scores.blue,
  };
}

function handleTeamGoal(room, state, team, { getTimestamp, sendMsg, t = fallbackT }) {
  state.ballRecovery = null;
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
  const color = team === 1 ? 0xFF6666 : 0x66A3FF;

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
      assistText = ` (${t('match.assist', { name: assistPlayer.name })})`;

      if (state.currentGame) {
        let assister = state.currentGame.players.find((p) => p.id === assistPlayer.id);
        if (!assister) {
          assister = { id: assistPlayer.id, cleanName: assistPlayer.cleanName, team: assistPlayer.team, goals: 0, assists: 0 };
          state.currentGame.players.push(assister);
        }
        assister.assists = (assister.assists || 0) + 1;
      }
    }
    announcement = t('match.goal', {
      scorer: goalScorer.name,
      assist: assistText,
      time: timeStr,
      ...scoreVars(t, scores),
    });
  } else if (ownGoalPlayer) {
    announcement = t('match.ownGoal', {
      player: ownGoalPlayer.name,
      time: timeStr,
      ...scoreVars(t, scores),
    });
  } else {
    announcement = t('match.teamGoal', {
      team: team === 1 ? t('team.redName') : t('team.blueName'),
      time: timeStr,
      ...scoreVars(t, scores),
    });
  }

  console.log(`[GOAL] ${announcement}`);
  sendMsg(room, announcement, null, color, 'bold');

  state.lastTouchPlayer = null;
  state.secondLastTouchPlayer = null;
  state.touchHistory = [];
  startKickoffWatch(state, kickoffTeamAfterGoal(team));
}

function handleGameStart(room, state, { sendMsg, t = fallbackT }) {
  if (typeof room.getPlayerList !== 'function') return;

  endTeamTransitionLock(room, state);
  state.ballRecovery = null;
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

  startKickoffWatch(state);

  console.log(`[GAME START] Maç başladı! Aktif oyuncu sayısı: ${state.currentGame.players.length}`);
  sendMsg(room, t('match.started'), null, 0x00FF7F, 'bold');
}

async function handleGameStop(room, state, deps) {
  const { db, DB_FILE, persistDatabase, sendMsg, playerJoinOrder, sleep, SPEC_PROMOTION_COUNT, botManager, t = fallbackT } = deps;

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

  console.log(`[GAME STOP] Maç bitti! Skor - Kırmızı: ${scores.red} | Mavi: ${scores.blue} (Süre: ${formatDuration(durationSeconds)})`);

  if (scores.red > 0 || scores.blue > 0) {
    saveGameResult(db, DB_FILE, scores, winnerTeam, loserTeam, state.currentGame, endedAt, durationSeconds, persistDatabase);
    const winMsg = winnerTeam === 1 ? t('match.redWon') : winnerTeam === 2 ? t('match.blueWon') : t('match.draw');
    sendMsg(room, t('match.finished', {
      result: winMsg,
      ...scoreVars(t, scores),
    }), null, 0xFFD700, 'bold');
  }

  state.currentGame = null;
  state.ballRecovery = null;
  clearKickoffWatch(state);

  if (!state.autoManageEnabled) {
    endTeamTransitionLock(room, state);
    console.log('[MATCH ROTATION] Otomatik yönetim kapalı - takım dağıtımı ve yeni maç atlandı.');
    return;
  }

  state.matchRotationPending = true;

  try {
    if (botManager && typeof botManager.ensureMinimum === 'function') {
      const result = botManager.ensureMinimum(MIN_BOTS_AFTER_GAME);
      console.log(`[MATCH ROTATION] ${result.message}`);
    }

    beginTeamTransitionLock(room, state);

    await sleep(800);
    if (!state.autoManageEnabled) {
      endTeamTransitionLock(room, state);
      return;
    }
    await sleep(ROTATION_START_DELAY_MS);
    if (!state.autoManageEnabled) {
      endTeamTransitionLock(room, state);
      return;
    }

    state.isRebalancing = true;
    state.manualPlacements.clear();

    const allPlayers = room.getPlayerList();
    const activeNonAfkPlayers = allPlayers.filter((p) => p.id !== 0 && !state.afkPlayers.has(p.id));
    const isBot = (p) => isBotPlayer(botManager, p);
    const realPlayers = activeNonAfkPlayers.filter((p) => !isBot(p));
    const botPlayers = activeNonAfkPlayers.filter(isBot);
    const targetBotCount = desiredBotCount(realPlayers.length, botPlayers.length);
    const desiredActiveCount = desiredEvenActiveCount(realPlayers.length, botPlayers.length, 8);
    const sortByPriority = sortRealPlayersFirst(botManager, playerJoinOrder);

    if (realPlayers.length <= 8) {
      console.log(`[MATCH ROTATION] Gerçek oyuncu sayısı <= 8 (${realPlayers.length}). Botlar yalnızca boşluk dolduracak şekilde yeniden dağıtılıyor...`);

      for (const p of allPlayers) {
        if (!state.autoManageEnabled) return;
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
      const redCount = Math.min(4, totalPlayers / 2);
      const blueCount = Math.min(4, totalPlayers / 2);
      const assignments = mixedTeamAssignments(availableSpecs, redCount, blueCount, isBot);

      for (const { player: p, team: targetTeam } of assignments) {
        if (!state.autoManageEnabled) return;
        try { room.setPlayerTeam(p.id, targetTeam); } catch (e) {}
        await sleep(ROTATION_MOVE_DELAY_MS);
      }
    } else {
      console.log(`[MATCH ROTATION] Aktif oyuncu sayısı > 8 (${activeNonAfkPlayers.length}). Yenilen takım spece alınıyor ve sıradaki kişiler sahaya sürülüyor...`);

      const losingPlayers = allPlayers.filter((p) => p.id !== 0 && p.team === loserTeam);
      for (const p of losingPlayers) {
        if (!state.autoManageEnabled) return;
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
        if (!state.autoManageEnabled) return;
        try { room.setPlayerTeam(p.id, loserTeam); } catch (e) {}
        await sleep(ROTATION_MOVE_DELAY_MS);
      }
    }

    if (!state.autoManageEnabled) return;
    await validateTeamDistribution(room, state, { playerJoinOrder, botManager, sleep, reason: 'match-rotation' });
    rememberLockedTeams(room, state);
    state.teamChangesLocked = true;
    await sleep(ROTATION_END_DELAY_MS);
  } finally {
    state.isRebalancing = false;
    state.matchRotationPending = false;
  }

  await sleep(300);
  if (!state.autoManageEnabled) return;
  checkAndStartGame(room, state);
}

module.exports = {
  handlePlayerBallKick,
  handleTeamGoal,
  handleGameStart,
  handleGameStop,
  checkKickoffWatch,
  formatDuration,
};
