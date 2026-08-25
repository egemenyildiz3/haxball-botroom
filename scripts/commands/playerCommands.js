const { sendMsg } = require('./helpers');

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
  const t = ctx.t || ((key) => (key === 'afk.kickReason' ? '😴 Uzun süre AFK kaldınız. 👋' : key));
  const maxDurationMs = ctx.config && ctx.config.afk && typeof ctx.config.afk.maxDurationMs === 'number'
    ? ctx.config.afk.maxDurationMs
    : 15 * 60 * 1000;

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
        room.kickPlayer(player.id, t('afk.kickReason'), false);
      } catch (e) {}
    }
  }, maxDurationMs);
}

function handlePlayers(ctx) {
  const { room, player, playerAssignments } = ctx;
  const t = ctx.t || ((key, vars = {}) => (
    key === 'player.none'
      ? '👥 Odada başka oyuncu bulunmuyor.'
      : key === 'player.list'
        ? `👥 Odadaki Oyuncular (${vars.count}):\n${vars.players}`
        : key
  ));
  if (typeof room.getPlayerList !== 'function') return false;

  const players = room.getPlayerList().filter((p) => p.id !== 0);
  if (players.length === 0) {
    sendMsg(room, t('player.none'), player.id, 0x00BFFF, 'normal');
    return false;
  }

  const playerListText = players
    .map((p) => {
      const dName = playerAssignments.get(p.id) || p.name || '';
      return `• [HB-ID: ${p.id}] ${dName}`;
    })
    .join('\n');

  sendMsg(room, t('player.list', { count: players.length, players: playerListText }), player.id, 0x00BFFF, 'normal');
  return false;
}

function handleAfk(ctx) {
  const { room, player, displayName, afkPlayers, rebalanceTeams, gameActive } = ctx;
  const t = ctx.t || ((key, vars = {}) => {
    const messages = {
      'afk.gameOnly': '⏸️ !afk komutu sadece maç devam ederken kullanılabilir.',
      'afk.waitExit': `⏳ AFK modundan çıkmak için ${vars.seconds} sn daha beklemelisin.`,
      'afk.back': `🔔 ${vars.name} artık AFK değil! Oyuna girmeye hazır.`,
      'afk.cooldown': `⏳ !afk komutunu ${vars.minutes} dk sonra tekrar kullanabilirsin.`,
      'afk.on': `💤 ${vars.name} AFK moduna geçti.`,
    };
    return messages[key] || key;
  });
  const afkConfig = (ctx.config && ctx.config.afk) || {};
  const cooldownMs = typeof afkConfig.cooldownMs === 'number' ? afkConfig.cooldownMs : 10 * 60 * 1000;
  const minDurationMs = typeof afkConfig.minDurationMs === 'number' ? afkConfig.minDurationMs : 30 * 1000;
  const earlyWarningMs = typeof afkConfig.earlyWarningMs === 'number' ? afkConfig.earlyWarningMs : 10 * 1000;
  if (!gameActive) {
    sendMsg(room, t('afk.gameOnly'), player.id, 0xFFCC00, 'bold');
    return false;
  }

  const key = afkKey(player);
  const now = Date.now();

  if (afkPlayers.has(player.id)) {
    const startedAt = afkStartedAt.get(key) || 0;
    const waitMs = minDurationMs - (now - startedAt);
    const isAdmin = typeof ctx.hasCapability === 'function' && ctx.hasCapability('afk_exempt');

    if (!isAdmin && waitMs > 0) {
      const lastWarning = lastAfkEarlyWarningAt.get(key) || 0;
      if (now - lastWarning >= earlyWarningMs) {
        lastAfkEarlyWarningAt.set(key, now);
        sendMsg(room, t('afk.waitExit', { seconds: Math.ceil(waitMs / 1000) }), player.id, 0xFFCC00, 'bold');
      }
      return false;
    }

    afkPlayers.delete(player.id);
    afkStartedAt.delete(key);
    lastAfkEarlyWarningAt.delete(key);
    sendMsg(room, t('afk.back', { name: displayName }), null, 0x00FF7F, 'bold');
  } else {
    const isAdmin = typeof ctx.hasCapability === 'function' && ctx.hasCapability('afk_exempt');
    const previous = lastAfkAt.get(key) || 0;
    const waitMs = cooldownMs - (now - previous);

    if (!isAdmin && waitMs > 0) {
      sendMsg(room, t('afk.cooldown', { minutes: minutesLeft(waitMs) }), player.id, 0xFFCC00, 'bold');
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
    sendMsg(room, t('afk.on', { name: displayName }), null, 0xFFCC00, 'bold');
  }

  if (typeof rebalanceTeams === 'function') {
    rebalanceTeams();
  }
  return false;
}

function handleBye(ctx) {
  const { room, player, displayName } = ctx;
  const t = ctx.t || ((key, vars = {}) => (
    key === 'bye.message' ? `👋 ${vars.name} görüşürüz dedi. Yolun açık olsun ✨` : key === 'bye.reason' ? '👋 Görüşürüz! ✨' : key
  ));
  sendMsg(room, t('bye.message', { name: displayName }), null, 0x00BFFF, 'bold');

  if (typeof room.kickPlayer === 'function') {
    try {
      room.kickPlayer(player.id, t('bye.reason'), false);
    } catch (e) {}
  }

  return false;
}

function handleHelp(ctx) {
  const { room, player } = ctx;
  const maxTeamSize = ctx.config && ctx.config.teamManagement && ctx.config.teamManagement.maxTeamSize
    ? ctx.config.teamManagement.maxTeamSize
    : 4;
  const gameMode = `${maxTeamSize}v${maxTeamSize}`;
  const t = ctx.t || ((key, vars = {}) => ({
    'help.title': `📖 Spacebounce ${vars.mode || gameMode} - Komutlar`,
    'help.public': 'Genel: !oyuncular | !s | !golkralı | !asistkralı | !top | !afk | !bb | !admin <mesaj> | !t <mesaj>',
    'help.account': 'Hesap: !kaydol <şifre> | !giris <şifre>',
    'help.bot': 'Bot: !bot aç [adet] | !bot kapat | !bot hepsi | !bot durum',
    'help.auto': 'Oto: !oto aç | !oto kapat | !oto durum',
    'help.moderation': 'Yetki: !kick <id/isim> | !ban <id/isim> | !mute [id/isim] [dk] | !unmute <id/isim>',
    'help.roomMute': 'Oda: !muteroom | !unmuteroom',
    'help.owner': 'Owner: !blacklist <id/isim> | !clearbans',
  }[key] || key));
  const helpText = [
    t('help.title', { mode: gameMode }),
    t('help.public'),
    t('help.account'),
    ctx.hasCapability('bot') ? t('help.bot') : '',
    ctx.hasCapability('auto') ? t('help.auto') : '',
    (ctx.hasCapability('kick') || ctx.hasCapability('ban') || ctx.hasCapability('mute') || ctx.hasCapability('unmute'))
      ? t('help.moderation')
      : '',
    ['owner', 'mod'].includes(ctx.role) ? t('help.roomMute') : '',
    (ctx.hasCapability('blacklist') || ctx.hasCapability('clear_bans')) ? t('help.owner') : '',
  ]
    .filter(Boolean)
    .join('\n');

  sendMsg(room, helpText, player.id, 0x00BFFF, 'normal');
  return false;
}

function routePlayerCommand(ctx) {
  if (ctx.commandKey === 'players') return handlePlayers(ctx);
  if (ctx.commandKey === 'afk') return handleAfk(ctx);
  if (ctx.commandKey === 'bye') return handleBye(ctx);
  if (ctx.commandKey === 'help') return handleHelp(ctx);
  return null;
}

module.exports = { routePlayerCommand };
