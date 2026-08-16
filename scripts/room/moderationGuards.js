const { getCleanName } = require('../util');
const { sendMsg } = require('../commands/helpers');
const { restoreAutoManageIfNoAdmins } = require('./autoManager');
const { rebalanceTeams } = require('./teamBalancer');
const { isProtectedBotIdentity } = require('./botPolicy');

function handlePlayerKicked(room, state, kickedPlayer, reason, ban, byPlayer, deps, sanitizePlayer) {
  if (!byPlayer || byPlayer.id === 0) return;

  const { loggedInPlayers, CONFIG_ADMIN_CAN_BAN, botManager } = deps;
  const safeKicked = sanitizePlayer(room, kickedPlayer, state);
  const safeBy = sanitizePlayer(room, byPlayer, state);
  const kickedClean = getCleanName(safeKicked);
  const byClean = getCleanName(safeBy);

  const isProtectedBot = isProtectedBotIdentity(botManager, safeKicked);

  if (ban && isProtectedBot) {
    console.warn(`[SECURITY] ${byClean} bot oyuncuyu banlamaya çalıştı: ${kickedClean}`);

    try { room.clearBan(safeKicked.id); } catch (e) {}

    try {
      if (typeof room.setPlayerAdmin === 'function') room.setPlayerAdmin(safeBy.id, false);
    } catch (e) {}

    sendMsg(room, `🛡️ Bot oyuncular banlanamaz. Bot kaldırmak için !bot kapat veya !bot hepsi kullan.`, safeBy.id, 0xFFCC00, 'bold');
    return;
  }

  const isOwnerKicked = loggedInPlayers.has(safeKicked.id) && loggedInPlayers.get(safeKicked.id).isadmin === 1;

  if (isOwnerKicked) {
    console.warn(`[SECURITY] ${byClean} (ID: ${safeBy.id}), Super Admin ${kickedClean}'ı atmaya çalıştı!`);

    try { room.clearBan(safeKicked.id); } catch (e) {}

    try {
      room.setPlayerAdmin(safeBy.id, false);
      room.kickPlayer(safeBy.id, "Kurucuya yetki uygulamaya çalıştığınız için banlandınız!", true);
    } catch (e) {}

    sendMsg(room, `🛡️ ${byClean}, Super-Admin'i atmaya çalıştığı için cezalandırıldı!`, null, 0xFF5555, 'bold');
    return;
  }

  if (ban && Number(CONFIG_ADMIN_CAN_BAN) === 0) {
    console.warn(`[SECURITY] ${byClean} ban atmaya çalıştı fakat CONFIG_ADMIN_CAN_BAN=0!`);

    try { room.clearBan(safeKicked.id); } catch (e) {}

    try {
      room.setPlayerAdmin(safeBy.id, false);
    } catch (e) {}

    sendMsg(room, `⚠️ Adminlerin ban yetkisi kapalıdır! ${kickedClean} üzerindeki ban kaldırıldı.`, null, 0xFF5555, 'bold');
  }
}

function handlePlayerAdminChange(room, state, changedPlayer, byPlayer, deps, sanitizePlayer) {
  if (state.isRebalancing) return;
  if (byPlayer && byPlayer.id === 0) return;

  const { loggedInPlayers, CONFIG_ADMIN_CAN_GIVE_ADMIN } = deps;
  const safePlayer = sanitizePlayer(room, changedPlayer, state);

  if (byPlayer && safePlayer.admin) {
    const safeBy = sanitizePlayer(room, byPlayer, state);

    if (Number(CONFIG_ADMIN_CAN_GIVE_ADMIN) === 0) {
      const isBySuperAdmin = loggedInPlayers.has(safeBy.id) && loggedInPlayers.get(safeBy.id).isadmin === 1;

      if (!isBySuperAdmin) {
        console.warn(`[SECURITY] ${getCleanName(safeBy)} yetki vermeye çalıştı fakat CONFIG_ADMIN_CAN_GIVE_ADMIN=0!`);

        try {
          room.setPlayerAdmin(safePlayer.id, false);
        } catch (e) {}

        sendMsg(room, `⚠️ Adminlerin başkasına yetki verme yetkisi kapalıdır!`, safeBy.id, 0xFF5555, 'bold');
        return;
      }
    }
  }

  restoreAutoManageIfNoAdmins(room, state, deps);
}

function handlePlayerTeamChange(room, state, changedPlayer, byPlayer, deps, sanitizePlayer) {
  if (state.isRebalancing) return;

  const safePlayer = sanitizePlayer(room, changedPlayer, state);

  if ((state.afkPlayers.has(safePlayer.id) || safePlayer.id === 0) && safePlayer.team !== 0) {
    try {
      room.setPlayerTeam(safePlayer.id, 0);
      if (safePlayer.id !== 0) {
        sendMsg(room, '💤 AFK modundasınız. Sahaya girmek için sohbetten !afk yazmalısınız.', safePlayer.id, 0xFF5555, 'bold');
      }
    } catch (e) {}
    return;
  }

  if (byPlayer && byPlayer.id !== 0) {
    state.manualPlacements.set(safePlayer.id, safePlayer.team);
    console.log(`${deps.getTimestamp()} [MANUAL] ${getCleanName(sanitizePlayer(room, byPlayer, state))}, ${getCleanName(safePlayer)} oyuncusunu elle taşıdı (takım: ${safePlayer.team}). Otomatik dağıtım bu oyuncuya dokunmayacak.`);
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
