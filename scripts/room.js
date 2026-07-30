const readline = require('readline');
const { getCleanName } = require('./util');
const { saveGameResult, logVisitedUser, isUserBlacklisted } = require('./db');
const { sendMsg, checkDuplicateLogin, handleAutoLogin, handlePlayerChat } = require('./commands');

let lastTouchPlayer = null;
let secondLastTouchPlayer = null;
let currentGame = null;
let nextJoinNumber = 100;
let nextJoinOrder = 1;

// Oyuncuların katılırken sahip olduğu auth kodlarını hafızada tutan harita
const playerAuths = new Map();

// AFK olan oyuncuların ID'lerini tutan küme (Host player ID 0 permanently stays here)
const afkPlayers = new Set([0]);

// Takım dengeleme işlemleri sırasında sonsuz olay döngüsünü engellemek için bayrak
let isRebalancing = false;

/**
 * Oyuncu nesnesini Puppeteer / Haxball API uyumlu hale getirir ve auth/conn alanlarını korur.
 */
function sanitizePlayer(room, player) {
  if (!player || typeof player.id === 'undefined') return player;
  
  const realPlayer = (typeof room.getPlayer === 'function') ? (room.getPlayer(player.id) || player) : player;
  const cachedAuth = playerAuths.get(String(player.id)) || playerAuths.get(Number(player.id)) || '';

  return {
    ...realPlayer,
    auth: player.auth || cachedAuth || realPlayer.auth || '',
    conn: player.conn || realPlayer.conn || '',
    name: realPlayer.name || player.name || '',
    id: realPlayer.id ?? player.id,
    team: realPlayer.team ?? player.team ?? 0,
    admin: realPlayer.admin ?? player.admin ?? false
  };
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
    // ENV CONFIGS
    CONFIG_ADMIN_CAN_BAN = 1,
    CONFIG_ADMIN_CAN_GIVE_ADMIN = 0,
    CONFIG_ALLOW_MULTIPLE_JOIN = 0,
  } = deps;

  // ---------------------------------------------------------------------
  // TERMINAL INPUT & COMMAND ROUTER
  // ---------------------------------------------------------------------
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const hostPlayer = { id: 0, name: 'Host-admin', admin: true, team: 0 };

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;

    // 1. Console Slash Commands (e.g. /clear_bans, /start, /stop)
    if (text.startsWith('/')) {
      const cmd = text.toLowerCase();
      if (cmd === '/clear_bans' || cmd === '/clearbans') {
        try {
          if (typeof room.clearBans === 'function') {
            room.clearBans();
            console.log('⚡ [CONSOLE]: Tüm banlar kaldırıldı.');
          } else {
            console.warn('⚡ [CONSOLE]: room.clearBans() metodu bulunamadı.');
          }
        } catch (e) {
          console.warn('Banlar kaldırılamadı:', e.message);
        }
      } else if (cmd === '/start') {
        try {
          room.startGame();
          console.log('⚡ [CONSOLE]: Oyun başlatıldı.');
        } catch (e) {
          console.warn('Oyun başlatılamadı:', e.message);
        }
      } else if (cmd === '/stop') {
        try {
          room.stopGame();
          console.log('⚡ [CONSOLE]: Oyun durduruldu.');
        } catch (e) {
          console.warn('Oyun durdurulamadı:', e.message);
        }
      } else {
        console.log(`⚠️ Bilinmeyen konsol komutu: ${text}`);
      }
      return;
    }

    // 2. Bot Commands (Starting with !)
    if (text.startsWith('!')) {
      console.log(`⚡ [CONSOLE CMD]: ${text}`);
      handlePlayerChat(room, hostPlayer, text, {
        db,
        DB_FILE,
        loggedInPlayers,
        playerAssignments,
        persistDatabase,
        ADMIN_PASSWORD,
        afkPlayers,
        rebalanceTeams: () => rebalanceTeams(room, { playerAssignments, playerJoinOrder, loggedInPlayers }),
        CONFIG_ADMIN_CAN_BAN,
        CONFIG_ADMIN_CAN_GIVE_ADMIN,
      });
      return;
    }

    // 3. Regular Chat Message
    try {
      room.sendChat(text);
      console.log(`💬 [TERMINAL CHAT]: ${text}`);
    } catch (err) {
      console.warn('Sohbet mesajı gönderilemedi:', err.message);
    }
  });

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

  // ---------------------------------------------------------------------
  // NATIVE KICK / BAN INTERCEPTION & OWNER PROTECTION
  // ---------------------------------------------------------------------
  room.onPlayerKicked = function (kickedPlayer, reason, ban, byPlayer) {
    // Ignore actions triggered by system or Host player (ID 0)
    if (!byPlayer || byPlayer.id === 0) return;

    const safeKicked = sanitizePlayer(room, kickedPlayer);
    const safeBy = sanitizePlayer(room, byPlayer);
    const kickedClean = getCleanName(safeKicked);
    const byClean = getCleanName(safeBy);

    // 1. ODA SAHİBİ / SUPER ADMIN KORUMASI: Bir admin kurucuyu banlamaya/atmaya çalışırsa
    const isOwnerKicked = loggedInPlayers.has(safeKicked.id) && loggedInPlayers.get(safeKicked.id).isadmin === 1;

    if (isOwnerKicked) {
      console.warn(`[SECURITY] ${byClean} (ID: ${safeBy.id}), Super Admin ${kickedClean}'ı atmaya çalıştı!`);
      
      // Banı derhal kaldır
      if (safeKicked.auth) room.clearBan(safeKicked.auth);

      // Saldırgan adminin yetkisini al ve odadan banla
      try {
        room.setPlayerAdmin(safeBy.id, false);
        room.kickPlayer(safeBy.id, "Kurucuya yetki uygulamaya çalıştığınız için banlandınız!", true);
      } catch (e) {}

      sendMsg(room, `🛡️ ${byClean}, Super-Admin'i atmaya çalıştığı için cezalandırıldı!`, null, 0xFF5555, 'bold');
      return;
    }

    // 2. CONFIG_ADMIN_CAN_BAN = 0 KONTROLÜ
    if (ban && Number(CONFIG_ADMIN_CAN_BAN) === 0) {
      console.warn(`[SECURITY] ${byClean} ban atmaya çalıştı fakat CONFIG_ADMIN_CAN_BAN=0!`);
      
      // Banı kaldır
      if (safeKicked.auth) room.clearBan(safeKicked.auth);

      // Uyarı mesajı ve adminliğini al
      try {
        room.setPlayerAdmin(safeBy.id, false);
      } catch (e) {}

      sendMsg(room, `⚠️ Adminlerin ban yetkisi kapalıdır! ${kickedClean} üzerindeki ban kaldırıldı.`, null, 0xFF5555, 'bold');
    }
  };

  // ---------------------------------------------------------------------
  // NATIVE ADMIN GIVE INTERCEPTION
  // ---------------------------------------------------------------------
  room.onPlayerAdminChange = function (changedPlayer, byPlayer) {
    if (isRebalancing) return;

    // Ignore action if it was executed by Host player avatar (ID 0)
    if (byPlayer && byPlayer.id === 0) return;

    const safePlayer = sanitizePlayer(room, changedPlayer);

    // Eğer yetki değişikliğini başka bir oyuncu yaptıysa ve admin verdiyse
    if (byPlayer && safePlayer.admin) {
      const safeBy = sanitizePlayer(room, byPlayer);

      // CONFIG_ADMIN_CAN_GIVE_ADMIN = 0 ise
      if (Number(CONFIG_ADMIN_CAN_GIVE_ADMIN) === 0) {
        // Yetki veren Super Admin değilse engelle
        const isBySuperAdmin = loggedInPlayers.has(safeBy.id) && loggedInPlayers.get(safeBy.id).isadmin === 1;

        if (!isBySuperAdmin) {
          console.warn(`[SECURITY] ${getCleanName(safeBy)} yetki vermeye çalıştı fakat CONFIG_ADMIN_CAN_GIVE_ADMIN=0!`);
          
          try {
            // Adminliğini geri al
            room.setPlayerAdmin(safePlayer.id, false);
          } catch (e) {}

          sendMsg(room, `⚠️ Adminlerin başkasına yetki verme yetkisi kapalıdır!`, safeBy.id, 0xFF5555, 'bold');
          return;
        }
      }
    }

    // Host or AFK Control (Keep Host permanently in Spec)
    if ((afkPlayers.has(safePlayer.id) || safePlayer.id === 0) && safePlayer.team !== 0) {
      try {
        room.setPlayerTeam(safePlayer.id, 0);
        if (safePlayer.id !== 0) {
          sendMsg(room, '💤 AFK modundasınız. Sahaya girmek için sohbetten !afk yazmalısınız.', safePlayer.id, 0xFF5555, 'bold');
        }
      } catch (e) {}
    }

    rebalanceTeams(room, { playerAssignments, playerJoinOrder, loggedInPlayers });
  };

  room.onPlayerJoin = async function (player) {
    if (!player) return;

    if (player.auth) {
      playerAuths.set(String(player.id), player.auth);
    }

    const safePlayer = sanitizePlayer(room, player);
    const cleanedName = getCleanName(safePlayer);

    // ---------------------------------------------------------------------
    // BLACKLIST (KARALİSTE) KONTROLÜ
    // ---------------------------------------------------------------------
    if (isUserBlacklisted(db, cleanedName, safePlayer.auth)) {
      console.log(`${getTimestamp()} [BLACKLIST] Karlistedeki oyuncu engellendi: ${cleanedName} (ID: ${safePlayer.id}, Auth: ${safePlayer.auth || 'YOK'})`);
      try {
        room.kickPlayer(safePlayer.id, "Karalisteye alındınız.", true);
      } catch (e) {
        console.warn('Blacklist banlama hatası:', e.message);
      }
      return;
    }

    // Çift Giriş Kontrolü
    if (Number(CONFIG_ALLOW_MULTIPLE_JOIN) !== 1) {
      const existingPlayers = typeof room.getPlayerList === 'function' ? room.getPlayerList() : [];
      const isDuplicate = existingPlayers.some((p) => {
        if (p.id === safePlayer.id) return false;

        const pClean = getCleanName(p);
        const pAuth = p.auth || playerAuths.get(String(p.id)) || playerAuths.get(Number(p.id)) || '';
        const pConn = p.conn || '';

        const nameMatch = pClean.toLowerCase() === cleanedName.toLowerCase();
        const authMatch = safePlayer.auth && pAuth && safePlayer.auth === pAuth;
        const connMatch = safePlayer.conn && pConn && safePlayer.conn === pConn;

        return nameMatch || authMatch || connMatch;
      });

      if (isDuplicate) {
        console.log(`${getTimestamp()} [DUPLICATE] Çift giriş tespit edildi, atılıyor: id=${safePlayer.id}, isim=${cleanedName}`);
        try {
          sendMsg(room, `⚠️ ${cleanedName}, zaten odada bir oturumunuz açık!`, safePlayer.id, 0xFF5555, 'bold');
          room.kickPlayer(safePlayer.id, "Zaten odadasınız! (Duplicate join)", false);
        } catch (e) {}
        return;
      }
    }

    if (checkDuplicateLogin(room, safePlayer, { loggedInPlayers, CONFIG_ALLOW_MULTIPLE_JOIN })) {
      return;
    }

    logVisitedUser(db, DB_FILE, cleanedName, persistDatabase);
    assignPlayerInternal(room, safePlayer, { playerAssignments, playerJoinOrder, getTimestamp });

    await sleep(800);

    const updatedPlayer = sanitizePlayer(room, safePlayer);
    handleAutoLogin(room, updatedPlayer, { db, DB_FILE, loggedInPlayers, persistDatabase });
    await handlePlayerJoin(room, updatedPlayer, { playerAssignments, playerJoinOrder, loggedInPlayers, db, DB_FILE, persistDatabase, getTimestamp, sleep });
  };

  room.onPlayerLeave = function (player) {
    const safePlayer = sanitizePlayer(room, player);
    handlePlayerLeave(room, safePlayer, { playerAssignments, playerJoinOrder, loggedInPlayers, leavingIntentions, getTimestamp });
  };

  room.onPlayerChat = function (player, msg) {
    const safePlayer = sanitizePlayer(room, player);
    return handlePlayerChat(room, safePlayer, msg, {
      db,
      DB_FILE,
      loggedInPlayers,
      playerAssignments,
      persistDatabase,
      ADMIN_PASSWORD,
      afkPlayers,
      rebalanceTeams: () => rebalanceTeams(room, { playerAssignments, playerJoinOrder, loggedInPlayers }),
      CONFIG_ADMIN_CAN_BAN,
      CONFIG_ADMIN_CAN_GIVE_ADMIN,
    });
  };

  room.onPlayerBallKick = function (player) {
    const safePlayer = sanitizePlayer(room, player);
    if (!lastTouchPlayer || lastTouchPlayer.id !== safePlayer.id) {
      secondLastTouchPlayer = lastTouchPlayer;
      lastTouchPlayer = safePlayer;
    }
  };

  room.onTeamGoal = function (team) {
    handleTeamGoal(room, team, { getTimestamp, db, persistDatabase, playerAssignments, playerJoinOrder, loggedInPlayers });
  };

  room.onGameStart = function () {
    handleGameStart(room, { getTimestamp, sendMsg, playerAssignments });
  };

  room.onGameStop = function () {
    handleGameStop(room, { db, DB_FILE, persistDatabase, getTimestamp, sendMsg, playerAssignments, playerJoinOrder, loggedInPlayers, sleep, SPEC_PROMOTION_COUNT });
  };

  await sleep(600);

  if (typeof room.setCustomStadium === 'function') room.setCustomStadium(mapData);
  await sleep(200);

  if (typeof room.setScoreLimit === 'function') room.setScoreLimit(SCORE_LIMIT);
  if (typeof room.setTimeLimit === 'function') room.setTimeLimit(TIME_LIMIT);

  lockTeams(room);

  setInterval(() => {
    if (typeof room.getPlayerList === 'function') {
      const players = room.getPlayerList();
      if (players.length > 0) {
        console.log(`${getTimestamp()} [STATUS] Odada şu an aktif ${players.length} oyuncu bulunuyor.`);
      }
    }
  }, 2 * 60 * 1000);

  console.log(`${getTimestamp()} Oda başarıyla oluşturuldu: ${ROOM_NAME}`);
}

function assignPlayerInternal(room, player, { playerAssignments, playerJoinOrder, getTimestamp }) {
  const cleanedName = getCleanName(player);
  const assignedId = String(nextJoinNumber).padStart(3, '0');
  nextJoinNumber = nextJoinNumber === 999 ? 100 : nextJoinNumber + 1;

  const taggedName = `[${assignedId}] ${cleanedName}`;
  playerAssignments.set(player.id, taggedName);
  playerJoinOrder.set(player.id, nextJoinOrder++);

  if (typeof room.setPlayerTeam === 'function') {
    try { room.setPlayerTeam(player.id, 0); } catch (e) {}
  }

  if (typeof room.setPlayerAvatar === 'function') {
    try { room.setPlayerAvatar(player.id, 11); } catch (e) {}
  }

  console.log(`${getTimestamp()} [JOIN] Oyuncu katıldı: id=${player.id}, isim=${cleanedName} (Atanan Etiket: ${taggedName})`);
}

function handleTeamGoal(room, team, { getTimestamp }) {
  const liveScores = typeof room.getScores === 'function' ? room.getScores() : null;

  if (currentGame) {
    if (liveScores) {
      currentGame.redScore = liveScores.red;
      currentGame.blueScore = liveScores.blue;
    } else {
      if (team === 1) currentGame.redScore++;
      if (team === 2) currentGame.blueScore++;
    }
  }

  const scores = liveScores || {
    red: currentGame ? currentGame.redScore : 0,
    blue: currentGame ? currentGame.blueScore : 0,
    time: 0
  };

  const totalSeconds = Math.floor(scores.time);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  const timeStr = `${minutes}:${seconds}`;

  let announcement = '';
  let color = 0x55FF55;

  if (lastTouchPlayer) {
    if (lastTouchPlayer.team === team) {
      let assistText = '';
      
      if (currentGame) {
        const scorer = currentGame.players.find(p => p.id === lastTouchPlayer.id);
        if (scorer) scorer.goals = (scorer.goals || 0) + 1;
      }

      if (secondLastTouchPlayer && secondLastTouchPlayer.team === team && secondLastTouchPlayer.id !== lastTouchPlayer.id) {
        assistText = ` (Asist: ${secondLastTouchPlayer.name})`;
        
        if (currentGame) {
          const assister = currentGame.players.find(p => p.id === secondLastTouchPlayer.id);
          if (assister) assister.assists = (assister.assists || 0) + 1;
        }
      }
      announcement = `⚽ GOL! ${lastTouchPlayer.name}${assistText} [${timeStr}] | KIRMIZI ${scores.red} - ${scores.blue} MAVİ`;
    } else {
      color = 0xFF5555;
      announcement = `🤡 KENDİ KALESİNE GOL! ${lastTouchPlayer.name} topu kendi ağlarına gönderdi [${timeStr}] | KIRMIZI ${scores.red} - ${scores.blue} MAVİ`;
    }
  } else {
    announcement = `⚽ GOL! ${team === 1 ? 'Kırmızı' : 'Mavi'} Takım gol attı [${timeStr}] | KIRMIZI ${scores.red} - ${scores.blue} MAVİ`;
  }

  console.log(`[GOAL] ${announcement}`);
  sendMsg(room, announcement, null, color, 'bold');

  lastTouchPlayer = null;
  secondLastTouchPlayer = null;
}

async function handlePlayerJoin(room, player, deps) {
  if (typeof room.getPlayerList !== 'function') return;

  rebalanceTeams(room, deps);
  await deps.sleep(600);
  checkAndStartGame(room, deps);
}

function handlePlayerLeave(room, player, { playerAssignments, playerJoinOrder, loggedInPlayers, leavingIntentions, getTimestamp }) {
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
    afkPlayers.delete(player.id);
    playerAuths.delete(String(player.id));
  }

  if (typeof room.getPlayerList !== 'function') return;

  // Filter real players excluding Host (ID 0)
  const activePlayers = room.getPlayerList().filter((p) => p.id !== 0 && (p.team === 1 || p.team === 2));

  if (activePlayers.length === 0 && typeof room.stopGame === 'function') {
    try {
      room.stopGame();
    } catch (error) {}
  }

  rebalanceTeams(room, { playerAssignments, playerJoinOrder, loggedInPlayers });
}

function checkAndStartGame(room, deps) {
  if (typeof room.getPlayerList !== 'function') return;

  // Filter real players excluding Host (ID 0)
  const activePlayers = room.getPlayerList().filter((p) => p.id !== 0 && (p.team === 1 || p.team === 2));
  if (activePlayers.length >= 1 && !currentGame && typeof room.startGame === 'function') {
    try {
      room.startGame();
    } catch (e) {
      console.warn('Oyun hemen başlatılamadı, 1.5 saniye sonra tekrar deneniyor:', e.message);
      setTimeout(() => {
        try {
          room.startGame();
        } catch (err) {
          console.warn('Yeniden deneme başarısız oldu:', err.message);
        }
      }, 1500);
    }
  }
}

function rebalanceTeams(room, { playerAssignments, playerJoinOrder, loggedInPlayers }) {
  if (isRebalancing) return;
  if (typeof room.getPlayerList !== 'function' || typeof room.setPlayerTeam !== 'function') return;

  isRebalancing = true;

  try {
    let players = room.getPlayerList();

    // Ensure Host (ID 0) is always on Spectator team (0)
    const hostPlayer = players.find(p => p.id === 0);
    if (hostPlayer && hostPlayer.team !== 0) {
      try { room.setPlayerTeam(0, 0); } catch (e) {}
    }

    // Ignore Host (ID 0) from active teams
    let redPlayers = players.filter((p) => p.id !== 0 && p.team === 1 && !afkPlayers.has(p.id));
    let bluePlayers = players.filter((p) => p.id !== 0 && p.team === 2 && !afkPlayers.has(p.id));
    let spectators = players
      .filter((p) => p.id !== 0 && p.team === 0 && !afkPlayers.has(p.id))
      .sort((a, b) => (playerJoinOrder.get(a.id) ?? 0) - (playerJoinOrder.get(b.id) ?? 0));

    const activeNonAfkCount = players.filter((p) => p.id !== 0 && !afkPlayers.has(p.id)).length;
    const maxTeamSize = Math.min(4, Math.max(1, Math.floor(activeNonAfkCount / 2)));

    let redCount = redPlayers.length;
    let blueCount = bluePlayers.length;

    if (redCount === 0 && blueCount === 0 && spectators.length > 0) {
      const promote = spectators.shift();
      try {
        room.setPlayerTeam(promote.id, 1);
        redCount++;
      } catch (e) {}
    }

    while (spectators.length > 0 && (redCount < maxTeamSize || blueCount < maxTeamSize)) {
      let targetTeam = 1;
      if (redCount < maxTeamSize && blueCount < maxTeamSize) {
        targetTeam = redCount <= blueCount ? 1 : 2;
      } else if (redCount < maxTeamSize) {
        targetTeam = 1;
      } else {
        targetTeam = 2;
      }

      const promote = spectators.shift();
      try {
        room.setPlayerTeam(promote.id, targetTeam);
        if (targetTeam === 1) redCount++;
        else blueCount++;
      } catch (e) { break; }
    }

    players = room.getPlayerList();
    redPlayers = players.filter((p) => p.id !== 0 && p.team === 1 && !afkPlayers.has(p.id));
    bluePlayers = players.filter((p) => p.id !== 0 && p.team === 2 && !afkPlayers.has(p.id));
    redCount = redPlayers.length;
    blueCount = bluePlayers.length;

    while (Math.abs(redCount - blueCount) > 1) {
      if (redCount > blueCount) {
        const movePlayer = redPlayers.pop();
        if (!movePlayer) break;
        try {
          room.setPlayerTeam(movePlayer.id, 2);
          redCount--;
          blueCount++;
        } catch (e) { break; }
      } else {
        const movePlayer = bluePlayers.pop();
        if (!movePlayer) break;
        try {
          room.setPlayerTeam(movePlayer.id, 1);
          blueCount--;
          redCount++;
        } catch (e) { break; }
      }
    }

    lockTeams(room);
  } finally {
    isRebalancing = false;
  }
}

function handleGameStart(room, { getTimestamp, sendMsg, playerAssignments }) {
  if (typeof room.getPlayerList !== 'function') return;

  lastTouchPlayer = null;
  secondLastTouchPlayer = null;

  currentGame = {
    started_at: new Date().toISOString(),
    redScore: 0,
    blueScore: 0,
    players: room.getPlayerList().filter(p => p.id !== 0).map((player) => ({
      id: player.id,
      cleanName: getCleanName(player),
      team: player.team,
      goals: 0,
      assists: 0,
    })),
  };

  console.log(`[GAME START] Maç başladı! Aktif oyuncu sayısı: ${currentGame.players.length}`);
  sendMsg(room, '🚀 Maç başladı! Herkese başarılar ve iyi oyunlar!', null, 0x00FF7F, 'bold');
}

/**
 * MAÇ BİTİMİ KONTROLÜ VE TAKIM ROTASYON MANTIĞI
 */
async function handleGameStop(room, deps) {
  const { db, DB_FILE, persistDatabase, getTimestamp, sendMsg, playerAssignments, playerJoinOrder, loggedInPlayers, sleep } = deps;

  const liveScores = typeof room.getScores === 'function' ? room.getScores() : null;
  let scores = { red: 0, blue: 0, time: 0 };

  if (liveScores && (liveScores.red > 0 || liveScores.blue > 0)) {
    scores = liveScores;
  } else if (currentGame) {
    scores = {
      red: currentGame.redScore || 0,
      blue: currentGame.blueScore || 0,
      time: liveScores ? liveScores.time : 0
    };
  }

  const winnerTeam = scores.red > scores.blue ? 1 : scores.blue > scores.red ? 2 : null;
  // Berabere kalınırsa varsayılan olarak Mavi Takım (2) yenilmiş kabul edilir
  const loserTeam = winnerTeam === 1 ? 2 : (winnerTeam === 2 ? 1 : 2); 
  const endedAt = new Date().toISOString();
  const durationSeconds = currentGame ? (new Date(endedAt) - new Date(currentGame.started_at)) / 1000 : 0;

  console.log(`[GAME STOP] Maç bitti! Skor - Kırmızı: ${scores.red} | Mavi: ${scores.blue} (Süre: ${Math.round(durationSeconds)}s)`);

  if (scores.red > 0 || scores.blue > 0) {
    saveGameResult(db, DB_FILE, scores, winnerTeam, loserTeam, currentGame, endedAt, durationSeconds, persistDatabase);
    const winMsg = winnerTeam === 1 ? '🔴 Kırmızı Takım Kazandı!' : winnerTeam === 2 ? '🔵 Mavi Takım Kazandı!' : '🤝 Berabere Bitti!';
    sendMsg(room, `🏆 MAÇ BİTTİ! ${winMsg} Skor: KIRMIZI ${scores.red} - ${scores.blue} MAVİ`, null, 0xFFD700, 'bold');
  }

  currentGame = null;

  await sleep(2000);

  // Rebalance tetiklemelerinin çakışmaması için rebalance kilidini açıyoruz
  isRebalancing = true;

  try {
    const allPlayers = room.getPlayerList();
    const activeNonAfkPlayers = allPlayers.filter((p) => p.id !== 0 && !afkPlayers.has(p.id));

    if (activeNonAfkPlayers.length <= 8) {
      // ---------------------------------------------------------------------
      // SENARYO 1: 8 veya daha az AFK OLMAYAN oyuncu var
      // ---------------------------------------------------------------------
      console.log(`[MATCH ROTATION] Aktif oyuncu sayısı <= 8 (${activeNonAfkPlayers.length}). Tüm oyuncular resetlenip yeniden dağıtılıyor...`);

      // 1. Tüm oyuncuları Spectator (0) konumuna çek (Host hariç)
      for (const p of allPlayers) {
        if (p.id !== 0 && p.team !== 0) {
          try { room.setPlayerTeam(p.id, 0); } catch (e) {}
        }
      }

      // 2. Spectator'daki AFK olmayan tüm oyuncuları giriş sırasına göre al
      const availableSpecs = room.getPlayerList()
        .filter((p) => p.id !== 0 && !afkPlayers.has(p.id))
        .sort((a, b) => (playerJoinOrder.get(a.id) ?? 0) - (playerJoinOrder.get(b.id) ?? 0));

      const totalPlayers = availableSpecs.length;
      const redCount = Math.min(4, Math.ceil(totalPlayers / 2));
      const blueCount = Math.min(4, totalPlayers - redCount);

      // 3. İki takıma da maks 4 oyuncu olacak şekilde sırayla aktar
      for (let i = 0; i < availableSpecs.length; i++) {
        const p = availableSpecs[i];
        if (i < redCount) {
          try { room.setPlayerTeam(p.id, 1); } catch (e) {}
        } else if (i < redCount + blueCount) {
          try { room.setPlayerTeam(p.id, 2); } catch (e) {}
        } else {
          try { room.setPlayerTeam(p.id, 0); } catch (e) {}
        }
      }

    } else {
      // ---------------------------------------------------------------------
      // SENARYO 2: 8'den fazla AFK OLMAYAN oyuncu var (> 8)
      // ---------------------------------------------------------------------
      console.log(`[MATCH ROTATION] Aktif oyuncu sayısı > 8 (${activeNonAfkPlayers.length}). Yenilen takım spece alınıyor ve sıradaki 4 kişi sahaya sürülüyor...`);

      // 1. Yenilen takımdaki tüm oyuncuları spece koy ve sıranın arkasına at
      const losingPlayers = allPlayers.filter((p) => p.id !== 0 && p.team === loserTeam);
      for (const p of losingPlayers) {
        try { 
          room.setPlayerTeam(p.id, 0); 
          playerJoinOrder.set(p.id, nextJoinOrder++);
        } catch (e) {}
      }

      // 2. Spectator'ın en üstündeki AFK OLMAYAN ilk 4 oyuncuyu bul
      const currentSpecs = room.getPlayerList()
        .filter((p) => p.id !== 0 && p.team === 0 && !afkPlayers.has(p.id))
        .sort((a, b) => (playerJoinOrder.get(a.id) ?? 0) - (playerJoinOrder.get(b.id) ?? 0));

      const nextToPlay = currentSpecs.slice(0, 4);

      // 3. Bu 4 oyuncuyu yenilen takıma yerleştir
      for (const p of nextToPlay) {
        try { room.setPlayerTeam(p.id, loserTeam); } catch (e) {}
      }
    }

    lockTeams(room);

  } finally {
    isRebalancing = false;
  }

  // Takımlar hazırlandıktan sonra maçı başlat
  await sleep(1000);
  checkAndStartGame(room, { playerAssignments, playerJoinOrder, loggedInPlayers });
}

function lockTeams(room) {
  if (typeof room.setTeamsLock === 'function') {
    try { room.setTeamsLock(true); } catch (e) {}
  }
}

module.exports = {
  createRoom,
};