const { rebalanceTeams, checkAndStartGame } = require('./teamBalancer');
const { sendMsg } = require('../commands/helpers');
const { hasCapability } = require('../roles');

function rebalanceThenStart(room, state, deps) {
  rebalanceTeams(room, state, deps)
    .then(() => checkAndStartGame(room, state))
    .catch((err) => console.warn('[AUTO] Otomatik dengeleme başarısız:', err.message));
}

function createAutoManager(room, state, deps) {
  const t = deps.t || ((key) => {
    const messages = {
      'auto.statusOn': '⚙️ Otomatik yönetim AÇIK: takım dağıtımı, maç başlatma ve maç sonu rotasyonu çalışıyor.',
      'auto.statusOff': '⚙️ Otomatik yönetim KAPALI: takımlar ve maç tamamen elle yönetiliyor.',
    };
    return messages[key] || key;
  });

  return {
    isEnabled: () => state.autoManageEnabled,

    enable() {
      state.autoManageEnabled = true;
      rebalanceThenStart(room, state, deps);
    },

    disable() {
      state.autoManageEnabled = false;
      state.isRebalancing = false;
      state.rebalanceRequested = false;
      state.startGamePending = false;
      state.teamChangesLocked = false;
      state.lockedTeams.clear();
    },

    status() {
      return state.autoManageEnabled
        ? t('auto.statusOn')
        : t('auto.statusOff');
    },
  };
}

function restoreAutoManageIfNoAdmins(room, state, deps, excludeId) {
  if (state.autoManageEnabled) return false;
  if (typeof room.getPlayerList !== 'function') return false;

  const { loggedInPlayers, config } = deps;
  const roleCapabilities = config && config.adminRules && config.adminRules.roleCapabilities;

  const hasAdmin = room.getPlayerList().some((p) => {
    if (p.id === 0) return false;
    if (excludeId !== undefined && p.id === excludeId) return false;
    if (p.admin) return true;

    const user = loggedInPlayers && loggedInPlayers.get(p.id);
    return hasCapability(user, 'admin_chat', roleCapabilities);
  });

  if (hasAdmin) return false;

  state.autoManageEnabled = true;
  console.log('[AUTO] Odada Admin/Kurucu kalmadı - otomatik yönetim tekrar açıldı.');
  sendMsg(
    room,
    deps.t ? deps.t('auto.restored') : '🔓 Odada Admin/Kurucu kalmadığı için otomatik yönetim tekrar açıldı.',
    null,
    0x00FF7F,
    'bold'
  );

  rebalanceThenStart(room, state, deps);
  return true;
}

module.exports = {
  createAutoManager,
  restoreAutoManageIfNoAdmins,
};
