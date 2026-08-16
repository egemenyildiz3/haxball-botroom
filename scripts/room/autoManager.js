const { rebalanceTeams, checkAndStartGame } = require('./teamBalancer');
const { sendMsg } = require('../commands/helpers');

function rebalanceThenStart(room, state, deps) {
  rebalanceTeams(room, state, deps)
    .then(() => checkAndStartGame(room, state))
    .catch((err) => console.warn('[AUTO] Otomatik dengeleme başarısız:', err.message));
}

function createAutoManager(room, state, deps) {
  return {
    isEnabled: () => state.autoManageEnabled,

    enable() {
      state.autoManageEnabled = true;
      rebalanceThenStart(room, state, deps);
    },

    disable() {
      state.autoManageEnabled = false;
    },

    status() {
      return state.autoManageEnabled
        ? '⚙️ Otomatik yönetim AÇIK: takım dağıtımı, maç başlatma ve maç sonu rotasyonu çalışıyor.'
        : '⚙️ Otomatik yönetim KAPALI: takımlar ve maç tamamen elle yönetiliyor.';
    },
  };
}

function restoreAutoManageIfNoAdmins(room, state, deps, excludeId) {
  if (state.autoManageEnabled) return false;
  if (typeof room.getPlayerList !== 'function') return false;

  const { loggedInPlayers } = deps;

  const hasAdmin = room.getPlayerList().some((p) => {
    if (p.id === 0) return false;
    if (excludeId !== undefined && p.id === excludeId) return false;
    if (p.admin) return true;

    const user = loggedInPlayers && loggedInPlayers.get(p.id);
    return !!(user && user.isadmin === 1);
  });

  if (hasAdmin) return false;

  state.autoManageEnabled = true;
  console.log('[AUTO] Odada yönetici kalmadı - otomatik yönetim tekrar açıldı.');
  sendMsg(room, '🔓 Odada yönetici kalmadığı için otomatik yönetim tekrar açıldı.', null, 0x00FF7F, 'bold');

  rebalanceThenStart(room, state, deps);
  return true;
}

module.exports = {
  createAutoManager,
  restoreAutoManageIfNoAdmins,
};
