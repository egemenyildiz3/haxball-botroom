const { getCleanName } = require('../util');
const { sendMsg } = require('../commands/helpers');
const { restoreAutoManageIfNoAdmins } = require('./autoManager');
const { rebalanceTeams } = require('./teamBalancer');
const { isProtectedBotIdentity } = require('./botPolicy');
const { hasCapability, isOwnerPlayer, roleOfUser } = require('../roles');

function canUseNativeModeration(userData) {
  const role = roleOfUser(userData);
  return role === 'owner' || role === 'mod';
}

function punishUnauthorizedNativeModeration(room, safeBy, reason) {
  try {
    if (typeof room.setPlayerAdmin === 'function') room.setPlayerAdmin(safeBy.id, false);
  } catch (e) {}

  try {
    room.kickPlayer(safeBy.id, reason, false);
  } catch (e) {}
}

function handlePlayerKicked(room, state, kickedPlayer, reason, ban, byPlayer, deps, sanitizePlayer) {
  if (!byPlayer || byPlayer.id === 0) return;

  const { loggedInPlayers, config, botManager, t = (key, vars = {}) => {
    const messages = {
      'guard.botBanProtected': '🛡️ Bot oyuncular banlanamaz. Bot kaldırmak için !bot kapat veya !bot hepsi kullan.',
      'guard.ownerAttackPunished': `🛡️ ${vars.name}, Kurucuyu atmaya çalıştığı için cezalandırıldı!`,
      'guard.ownerAttackReason': 'Kurucuya yetki uygulamaya çalıştığınız için banlandınız!',
      'guard.adminBanDisabled': `⚠️ Adminlerin ban yetkisi kapalıdır! ${vars.name} üzerindeki ban kaldırıldı.`,
      'guard.kickDisabled': '⚠️ Bu admin görünümü yetki vermez. Oyuncu atma yetkiniz yok.',
      'guard.nativeModerationReason': 'Yetkisiz admin aksiyonu kullandınız.',
    };
    return messages[key] || key;
  } } = deps;
  const safeKicked = sanitizePlayer(room, kickedPlayer, state);
  const safeBy = sanitizePlayer(room, byPlayer, state);
  const kickedClean = getCleanName(safeKicked);
  const byClean = getCleanName(safeBy);
  const byUser = loggedInPlayers && loggedInPlayers.get(safeBy.id);
  const canUseNativeModerationTools = canUseNativeModeration(byUser);

  const isProtectedBot = isProtectedBotIdentity(botManager, safeKicked);

  if (ban && isProtectedBot) {
    console.warn(`[SECURITY] ${byClean} bot oyuncuyu banlamaya çalıştı: ${kickedClean}`);

    try { room.clearBan(safeKicked.id); } catch (e) {}

    sendMsg(room, t('guard.botBanProtected'), safeBy.id, 0xFFCC00, 'bold');
    if (!canUseNativeModerationTools) {
      punishUnauthorizedNativeModeration(room, safeBy, t('guard.nativeModerationReason'));
    }
    return;
  }

  const roleCapabilities = config && config.adminRules && config.adminRules.roleCapabilities;
  const isOwnerKicked = isOwnerPlayer(safeKicked, loggedInPlayers);

  if (isOwnerKicked) {
    console.warn(`[SECURITY] ${byClean} (ID: ${safeBy.id}), Kurucu ${kickedClean}'ı atmaya çalıştı!`);

    try { room.clearBan(safeKicked.id); } catch (e) {}

    try {
      room.setPlayerAdmin(safeBy.id, false);
      room.kickPlayer(safeBy.id, t('guard.ownerAttackReason'), true);
    } catch (e) {}

    sendMsg(room, t('guard.ownerAttackPunished', { name: byClean }), null, 0xFF5555, 'bold');
    return;
  }

  if (ban && !canUseNativeModerationTools) {
    console.warn(`[SECURITY] ${byClean} native ban kullanmaya çalıştı fakat owner/mod değil!`);

    try { room.clearBan(safeKicked.id); } catch (e) {}

    sendMsg(room, t('guard.adminBanDisabled', { name: kickedClean }), null, 0xFF5555, 'bold');
    punishUnauthorizedNativeModeration(room, safeBy, t('guard.nativeModerationReason'));
    return;
  }

  if (!ban && !canUseNativeModerationTools) {
    console.warn(`[SECURITY] ${byClean} native kick kullanmaya çalıştı fakat owner/mod değil!`);

    sendMsg(room, t('guard.kickDisabled'), safeBy.id, 0xFF5555, 'bold');
    punishUnauthorizedNativeModeration(room, safeBy, t('guard.nativeModerationReason'));
    return;
  }

  if (state.autoManageEnabled) {
    setTimeout(() => {
      rebalanceTeams(room, state, deps)
        .catch((err) => console.warn('[AUTO] Kick/ban sonrası dengeleme başarısız:', err.message));
    }, 250);
  }
}

function handlePlayerAdminChange(room, state, changedPlayer, byPlayer, deps, sanitizePlayer) {
  if (state.isRebalancing) return;
  if (byPlayer && byPlayer.id === 0) return;

  const { loggedInPlayers, config, t = (key) => (
    key === 'guard.adminGiveDisabled' ? '⚠️ Adminlerin başkasına yetki verme yetkisi kapalıdır!' : key
  ) } = deps;
  const safePlayer = sanitizePlayer(room, changedPlayer, state);

  if (byPlayer && safePlayer.admin) {
    const safeBy = sanitizePlayer(room, byPlayer, state);
    const roleCapabilities = config && config.adminRules && config.adminRules.roleCapabilities;

    {
      const byUser = loggedInPlayers.has(safeBy.id) ? loggedInPlayers.get(safeBy.id) : null;
      const canGiveNativeAdmin = hasCapability(byUser, 'native_admin', roleCapabilities);

      if (!canGiveNativeAdmin) {
        console.warn(`[SECURITY] ${getCleanName(safeBy)} yetki vermeye çalıştı fakat native_admin capability yok!`);

        try {
          room.setPlayerAdmin(safePlayer.id, false);
        } catch (e) {}

        sendMsg(room, t('guard.adminGiveDisabled'), safeBy.id, 0xFF5555, 'bold');
        return;
      }
    }
  }

  restoreAutoManageIfNoAdmins(room, state, deps);
}

function handlePlayerTeamChange(room, state, changedPlayer, byPlayer, deps, sanitizePlayer) {
  const { loggedInPlayers, config, t = (key) => (
    key === 'guard.afkTeamBlocked' ? '💤 AFK modundasınız. Sahaya girmek için sohbetten !afk yazmalısınız.'
      : key === 'guard.teamMoveDisabled' ? '⚠️ Bu admin görünümü yetki vermez. Oyuncu taşıma yetkiniz yok.'
        : key
  ) } = deps;
  const safePlayer = sanitizePlayer(room, changedPlayer, state);
  const changedByHost = !byPlayer || byPlayer.id === 0;

  if (state.isRebalancing && changedByHost) return;

  if (state.autoManageEnabled && state.teamChangesLocked && safePlayer.id !== 0) {
    const expectedTeam = state.lockedTeams.has(safePlayer.id) ? state.lockedTeams.get(safePlayer.id) : 0;
    if (safePlayer.team !== expectedTeam) {
      try {
        room.setPlayerTeam(safePlayer.id, expectedTeam);
      } catch (e) {}
      console.warn(`${deps.getTimestamp()} [TEAM LOCK] Maç arası izinsiz takım değişimi geri alındı: ${getCleanName(safePlayer)} -> takım ${expectedTeam}`);
      return;
    }
    return;
  }

  if ((state.afkPlayers.has(safePlayer.id) || safePlayer.id === 0) && safePlayer.team !== 0) {
    try {
      room.setPlayerTeam(safePlayer.id, 0);
      if (safePlayer.id !== 0) {
        sendMsg(room, t('guard.afkTeamBlocked'), safePlayer.id, 0xFF5555, 'bold');
      }
    } catch (e) {}
    return;
  }

  if (byPlayer && byPlayer.id !== 0) {
    const safeBy = sanitizePlayer(room, byPlayer, state);
    const byUser = loggedInPlayers && loggedInPlayers.get(safeBy.id);
    const roleCapabilities = config && config.adminRules && config.adminRules.roleCapabilities;

    if (!hasCapability(byUser, 'auto', roleCapabilities)) {
      console.warn(`[SECURITY] ${getCleanName(safeBy)} takım taşıma denedi fakat auto capability yok!`);
      try {
        room.setPlayerAdmin(safeBy.id, false);
      } catch (e) {}
      sendMsg(room, t('guard.teamMoveDisabled'), safeBy.id, 0xFF5555, 'bold');
      rebalanceTeams(room, state, deps)
        .catch((err) => console.warn('[AUTO] Yetkisiz takım değişimi sonrası dengeleme başarısız:', err.message));
      return;
    }

    state.manualPlacements.set(safePlayer.id, safePlayer.team);
    console.log(`[MANUAL] ${getCleanName(safeBy)}, ${getCleanName(safePlayer)} oyuncusunu elle taşıdı (takım: ${safePlayer.team}). Otomatik dağıtım bu oyuncuya dokunmayacak.`);
    return;
  }

  rebalanceTeams(room, state, deps)
    .catch((err) => console.warn('[AUTO] Takım değişimi sonrası dengeleme başarısız:', err.message));
}

module.exports = {
  handlePlayerKicked,
  handlePlayerAdminChange,
  handlePlayerTeamChange,
};
