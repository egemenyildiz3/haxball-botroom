const { sendMsg } = require('./helpers');

const AFK_COOLDOWN_MS = 10 * 60 * 1000;
const AFK_MIN_DURATION_MS = 30 * 1000;
const AFK_MAX_DURATION_MS = 15 * 60 * 1000;
const AFK_EARLY_WARNING_MS = 10 * 1000;
const lastAfkAt = new Map();
const afkStartedAt = new Map();
const lastAfkEarlyWarningAt = new Map();

function afkKey(player) {
  return player.auth || player.conn || String(player.id);
}

function minutesLeft(ms) {
  return Math.max(1, Math.ceil(ms / 60000));
}

function scheduleAfkKick(ctx, key, startedAt) {
  const { room, player } = ctx;

  setTimeout(() => {
    if (!afkStartedAt.has(key) || afkStartedAt.get(key) !== startedAt) return;
    if (!ctx.afkPlayers.has(player.id)) return;

    const currentPlayer = typeof room.getPlayer === 'function'
      ? room.getPlayer(player.id)
      : (typeof room.getPlayerList === 'function' ? room.getPlayerList().find((p) => p.id === player.id) : null);
    if (!currentPlayer) {
      afkStartedAt.delete(key);
      lastAfkEarlyWarningAt.delete(key);
      ctx.afkPlayers.delete(player.id);
      return;
    }

    afkStartedAt.delete(key);
    lastAfkEarlyWarningAt.delete(key);
    ctx.afkPlayers.delete(player.id);

    if (typeof room.kickPlayer === 'function') {
      try {
        room.kickPlayer(player.id, '😴 Uzun süre AFK kaldınız. 👋', false);
      } catch (e) {}
    }
  }, AFK_MAX_DURATION_MS);
}

function handlePlayers(ctx) {
  const { room, player, playerAssignments } = ctx;
  if (typeof room.getPlayerList !== 'function') return false;

  const players = room.getPlayerList().filter((p) => p.id !== 0);
  if (players.length === 0) {
    sendMsg(room, '👥 Odada başka oyuncu bulunmuyor.', player.id, 0x00BFFF, 'normal');
    return false;
  }

  const playerListText = players
    .map((p) => {
      const dName = playerAssignments.get(p.id) || p.name || '';
      return `• [HB-ID: ${p.id}] ${dName}`;
    })
    .join('\n');

  sendMsg(room, `👥 Odadaki Oyuncular (${players.length}):\n${playerListText}`, player.id, 0x00BFFF, 'normal');
  return false;
}

function handleAfk(ctx) {
  const { room, player, displayName, afkPlayers, rebalanceTeams, gameActive, isSuperAdmin } = ctx;
  if (!gameActive) {
    sendMsg(room, '⏸️ !afk komutu sadece maç devam ederken kullanılabilir.', player.id, 0xFFCC00, 'bold');
    return false;
  }

  const key = afkKey(player);
  const now = Date.now();

  if (afkPlayers.has(player.id)) {
    const startedAt = afkStartedAt.get(key) || 0;
    const waitMs = AFK_MIN_DURATION_MS - (now - startedAt);
    const isAdmin = player.admin || isSuperAdmin;

    if (!isAdmin && waitMs > 0) {
      const lastWarning = lastAfkEarlyWarningAt.get(key) || 0;
      if (now - lastWarning >= AFK_EARLY_WARNING_MS) {
        lastAfkEarlyWarningAt.set(key, now);
        sendMsg(room, `⏳ AFK modundan çıkmak için ${Math.ceil(waitMs / 1000)} sn daha beklemelisin.`, player.id, 0xFFCC00, 'bold');
      }
      return false;
    }

    afkPlayers.delete(player.id);
    afkStartedAt.delete(key);
    lastAfkEarlyWarningAt.delete(key);
    sendMsg(room, `🔔 ${displayName} artık AFK değil! Oyuna girmeye hazır.`, null, 0x00FF7F, 'bold');
  } else {
    const isAdmin = player.admin || isSuperAdmin;
    const previous = lastAfkAt.get(key) || 0;
    const waitMs = AFK_COOLDOWN_MS - (now - previous);

    if (!isAdmin && waitMs > 0) {
      sendMsg(room, `⏳ !afk komutunu ${minutesLeft(waitMs)} dk sonra tekrar kullanabilirsin.`, player.id, 0xFFCC00, 'bold');
      return false;
    }

    if (!isAdmin) {
      lastAfkAt.set(key, now);
    }
    afkStartedAt.set(key, now);
    lastAfkEarlyWarningAt.delete(key);
    afkPlayers.add(player.id);
    if (!isAdmin) {
      scheduleAfkKick(ctx, key, now);
    }
    if (player.team !== 0 && typeof room.setPlayerTeam === 'function') {
      try {
        room.setPlayerTeam(player.id, 0);
      } catch (e) {}
    }
    sendMsg(room, `💤 ${displayName} AFK moduna geçti.`, null, 0xFFCC00, 'bold');
  }

  if (typeof rebalanceTeams === 'function') {
    rebalanceTeams();
  }
  return false;
}

function handleBye(ctx) {
  const { room, player, displayName } = ctx;
  sendMsg(room, `👋 ${displayName} görüşürüz dedi. Yolun açık olsun ✨`, null, 0x00BFFF, 'bold');

  if (typeof room.kickPlayer === 'function') {
    try {
      room.kickPlayer(player.id, '👋 Görüşürüz! ✨', false);
    } catch (e) {}
  }

  return false;
}

function handleHelp(ctx) {
  const { room, player, isSuperAdmin } = ctx;
  const helpText = [
    '📖 Spacebounce 4v4 - Komut listesi:',
    '• !oyuncular — Odadaki oyuncuları ve ID\'lerini listeler',
    '• !s / !stats / !istatistik — İstatistiklerinizi gösterir',
    '• !golkralı / !asistkralı / !top — Liderlik tablolarını gösterir',
    '• !afk — AFK modunu açar/kapatır',
    '• !bb — Tatlı bir vedayla odadan ayrılır',
    '• !admin <açıklama> — Adminlere istek, talep veya şikayet gönderir',
    '• !kaydol <şifre> — Hesap oluşturur ve oturum açar',
    '• !giris <şifre> — Mevcut hesabınıza giriş yapar',
    player.admin || isSuperAdmin ? '• !bot aç [adet] / !bot kapat / !bot hepsi / !bot durum — Yapay zeka botunu yönetir (Yönetici)' : '',
    player.admin || isSuperAdmin ? '• !oto aç / !oto kapat / !oto durum — Otomatik takım dağıtımı ve maç başlatmayı açar/kapatır (Yönetici)' : '',
    player.admin || isSuperAdmin ? '• !mute [id/isim] — Sohbeti veya bir oyuncuyu susturur (Yönetici)' : '',
    isSuperAdmin ? '• !blacklist <id/isim> [sebep] — Oyuncuyu veritabanı kara listesine ekler (Super-Admin)' : '',
    isSuperAdmin ? '• !clearbans — Tüm banları temizler (Super-Admin)' : '',
  ]
    .filter(Boolean)
    .join('\n');

  sendMsg(room, helpText, player.id, 0x00BFFF, 'normal');
  return false;
}

function routePlayerCommand(ctx) {
  if (ctx.command === '!oyuncular' || ctx.command === '!oyunculistesi' || ctx.command === '!players') return handlePlayers(ctx);
  if (ctx.command === '!afk') return handleAfk(ctx);
  if (ctx.command === '!bb' || ctx.command === '!bye' || ctx.command === '!cik') return handleBye(ctx);
  if (ctx.command === '!yardim' || ctx.command === '!yardım' || ctx.command === '!help') return handleHelp(ctx);
  return null;
}

module.exports = { routePlayerCommand };
