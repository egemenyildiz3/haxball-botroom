const { saveGameResult } = require('../db');
const { getCleanName } = require('../util');
const { checkAndStartGame, lockTeams } = require('./teamBalancer');
const { desiredBotCount, isBotPlayer, sortRealPlayersFirst } = require('./botPolicy');

const ROTATION_START_DELAY_MS = 700;
const ROTATION_MOVE_DELAY_MS = 350;
const ROTATION_END_DELAY_MS = 500;

function handlePlayerBallKick(state, player) {
  if (!state.lastTouchPlayer || state.lastTouchPlayer.id !== player.id) {
    state.secondLastTouchPlayer = state.lastTouchPlayer;
    state.lastTouchPlayer = player;
  }
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

  if (state.lastTouchPlayer) {
    if (state.lastTouchPlayer.team === team) {
      let assistText = '';

      if (state.currentGame) {
        let scorer = state.currentGame.players.find((p) => p.id === state.lastTouchPlayer.id);
        if (!scorer) {
          scorer = { id: state.lastTouchPlayer.id, cleanName: getCleanName(state.lastTouchPlayer), team: state.lastTouchPlayer.team, goals: 0, assists: 0 };
          state.currentGame.players.push(scorer);
        }
        scorer.goals = (scorer.goals || 0) + 1;
      }

      if (state.secondLastTouchPlayer && state.secondLastTouchPlayer.team === team && state.secondLastTouchPlayer.id !== state.lastTouchPlayer.id) {
        assistText = ` (Asist: ${state.secondLastTouchPlayer.name})`;

        if (state.currentGame) {
          let assister = state.currentGame.players.find((p) => p.id === state.secondLastTouchPlayer.id);
          if (!assister) {
            assister = { id: state.secondLastTouchPlayer.id, cleanName: getCleanName(state.secondLastTouchPlayer), team: state.secondLastTouchPlayer.team, goals: 0, assists: 0 };
            state.currentGame.players.push(assister);
          }
          assister.assists = (assister.assists || 0) + 1;
        }
      }
      announcement = `⚽ GOL! ${state.lastTouchPlayer.name}${assistText} [${timeStr}] | KIRMIZI ${scores.red} - ${scores.blue} MAVİ`;
    } else {
      color = 0xFF5555;
      announcement = `🤡 KENDİ KALESİNE GOL! ${state.lastTouchPlayer.name} topu kendi ağlarına gönderdi [${timeStr}] | KIRMIZI ${scores.red} - ${scores.blue} MAVİ`;
    }
  } else {
    announcement = `⚽ GOL! ${team === 1 ? 'Kırmızı' : 'Mavi'} Takım gol attı [${timeStr}] | KIRMIZI ${scores.red} - ${scores.blue} MAVİ`;
  }

  console.log(`[GOAL] ${announcement}`);
  sendMsg(room, announcement, null, color, 'bold');

  state.lastTouchPlayer = null;
  state.secondLastTouchPlayer = null;
}

function handleGameStart(room, state, { sendMsg }) {
  if (typeof room.getPlayerList !== 'function') return;

  state.lastTouchPlayer = null;
  state.secondLastTouchPlayer = null;

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
    console.log('[MATCH ROTATION] Otomatik yönetim kapalı - takım dağıtımı ve yeni maç atlandı.');
    return;
  }

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

      for (let i = 0; i < availableSpecs.length; i++) {
        const p = availableSpecs[i];
        if (i < redCount) {
          try { room.setPlayerTeam(p.id, 1); } catch (e) {}
        } else if (i < redCount + blueCount) {
          try { room.setPlayerTeam(p.id, 2); } catch (e) {}
        } else {
          try { room.setPlayerTeam(p.id, 0); } catch (e) {}
        }
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

    lockTeams(room);
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
