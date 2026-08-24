const VALID_ROLES = new Set(['player', 'vip', 'mod', 'admin', 'owner']);

const DEFAULT_ROLE_CAPABILITIES = {
  owner: ['*'],
  admin: [
    'admin_chat',
    'afk_exempt',
    'mute_exempt',
    'native_admin',
  ],
  mod: [
    'admin_chat',
    'afk_exempt',
    'auto',
    'ban',
    'blacklist',
    'bot',
    'clear_bans',
    'duplicate_join_exempt',
    'kick',
    'mute',
    'mute_exempt',
    'native_admin',
    'unmute',
  ],
  vip: [],
  player: [],
};

function normalizeRole(role) {
  const clean = String(role || '').trim().toLowerCase();
  return VALID_ROLES.has(clean) ? clean : 'player';
}

function roleOfUser(userData) {
  return normalizeRole(userData && userData.role);
}

function capabilitiesForRole(role, roleCapabilities) {
  const cleanRole = normalizeRole(role);
  return roleCapabilities && Array.isArray(roleCapabilities[cleanRole])
    ? roleCapabilities[cleanRole]
    : DEFAULT_ROLE_CAPABILITIES[cleanRole];
}

function hasCapability(userData, capability, roleCapabilities) {
  const capabilities = capabilitiesForRole(roleOfUser(userData), roleCapabilities);
  return capabilities.includes('*') || capabilities.includes(String(capability || '').trim().toLowerCase());
}

function isOwner(userData) {
  return roleOfUser(userData) === 'owner';
}

function isOwnerPlayer(player, loggedInPlayers) {
  if (!player) return false;
  if (player.id === 0) return true;
  return isOwner(loggedInPlayers && loggedInPlayers.get(player.id));
}

module.exports = {
  hasCapability,
  isOwner,
  isOwnerPlayer,
  normalizeRole,
  roleOfUser,
};
