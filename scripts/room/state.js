const { createChatFilter } = require('../chatFilter');

function createRoomState(options = {}) {
  const { chat = {}, t = null } = options;
  return {
    lastTouchPlayer: null,
    secondLastTouchPlayer: null,
    touchHistory: [],
    currentGame: null,
    lastGameTickAt: null,
    lastGoalAt: 0,
    lastGameStartAt: 0,
    kickoffWatch: null,
    ballRecovery: null,
    joinIdsByPlayer: new Map(),
    nextJoinOrder: 1,
    playerAuths: new Map(),
    pendingJoinPlayers: new Set(),
    afkPlayers: new Set([0]),
    manualPlacements: new Map(),
    isRebalancing: false,
    rebalanceRequested: false,
    promotionNoticePlayers: new Set(),
    matchRotationPending: false,
    startGamePending: false,
    teamChangesLocked: false,
    lockedTeams: new Map(),
    autoManageEnabled: true,
    chatMuted: false,
    roomMuted: false,
    mutedPlayers: new Map(),
    lastInputAt: new Map(),
    inactivityWarnings: new Set(),
    chatFilter: createChatFilter({ ...chat, t }),
  };
}

module.exports = { createRoomState };
