const VALID_ROLES = new Set(['player', 'vip', 'mod', 'admin', 'owner']);

const DEFAULT_ROLE_CAPABILITIES = {
  owner: ['*'],
  admin: [
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
  ],
  mod: [
    'admin_chat',
    'afk_exempt',
    'auto',
    'kick',
    'mute',
    'mute_exempt',
    'native_admin',
  ],
  vip: [
  ],
  player: [],
};

function normalizeRole(role) {
  const clean = String(role || '').trim().toLowerCase();
  return VALID_ROLES.has(clean) ? clean : 'player';
}

function parseCapabilities(raw, fallback = []) {
  if (raw === undefined || raw === null || raw === '') return [...fallback];
  return String(raw)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function createRoleCapabilities(env = process.env) {
  return {
    owner: parseCapabilities(env.ROLE_OWNER_CAPABILITIES, DEFAULT_ROLE_CAPABILITIES.owner),
    admin: parseCapabilities(env.ROLE_ADMIN_CAPABILITIES, DEFAULT_ROLE_CAPABILITIES.admin),
    mod: parseCapabilities(env.ROLE_MOD_CAPABILITIES, DEFAULT_ROLE_CAPABILITIES.mod),
    vip: parseCapabilities(env.ROLE_VIP_CAPABILITIES, DEFAULT_ROLE_CAPABILITIES.vip),
    player: parseCapabilities(env.ROLE_PLAYER_CAPABILITIES, DEFAULT_ROLE_CAPABILITIES.player),
  };
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

function hasPlayerCapability(player, loggedInPlayers, capability, roleCapabilities) {
  if (!player) return false;
  if (player.id === 0) return true;
  return hasCapability(loggedInPlayers && loggedInPlayers.get(player.id), capability, roleCapabilities);
}

function isOwner(userData) {
  return roleOfUser(userData) === 'owner';
}

function isOwnerPlayer(player, loggedInPlayers) {
  if (!player) return false;
  if (player.id === 0) return true;
  return isOwner(loggedInPlayers && loggedInPlayers.get(player.id));
}

function isPrivilegedRole(userData, roleCapabilities) {
  return hasCapability(userData, 'admin_chat', roleCapabilities);
}

module.exports = {
  DEFAULT_ROLE_CAPABILITIES,
  VALID_ROLES,
  capabilitiesForRole,
  createRoleCapabilities,
  hasCapability,
  hasPlayerCapability,
  isOwner,
  isOwnerPlayer,
  isPrivilegedRole,
  normalizeRole,
  roleOfUser,
};
