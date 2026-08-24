const { normalizeCmd } = require('../util');

const COMMAND_ALIASES = {
  help: ['!help', '!commands', '!komutlar', '!yardim', '!yardım'],
  players: ['!players', '!oyuncular', '!oyunculistesi'],
  stats: ['!s', '!stats', '!istatistik'],
  goals: ['!goals', '!goller', '!golkralı', '!golkrali'],
  assists: ['!assists', '!asistler', '!asistkralı', '!asistkrali'],
  wins: ['!wins', '!top'],
  signup: ['!signup', '!register', '!kaydol', '!kayit', '!kayıt'],
  login: ['!login', '!giris', '!giriş'],
  adminRequest: ['!admin', '!request', '!istek'],
  adminLogin: ['!adminlogin', '!adminol'],
  afk: ['!afk'],
  bye: ['!bb', '!bye', '!cik', '!çık'],
  teamRadio: ['!t', '!team', '!takim', '!takım'],
  bot: ['!bot'],
  auto: ['!auto', '!oto', '!otomatik'],
  mute: ['!mute', '!sohbet', '!chat'],
  unmute: ['!unmute', '!unmutex', '!susturac', '!susturaç'],
  muteRoom: ['!muteroom', '!odaroommute', '!odasustur'],
  unmuteRoom: ['!unmuteroom', '!roomunmute', '!odaac', '!odaaç'],
  kick: ['!kick'],
  ban: ['!ban'],
  blacklist: ['!blacklist', '!blackban', '!permaban'],
  clearBans: ['!clearbans', '!clear_bans', '!unbanall'],
};

const ALIAS_TO_KEY = new Map();

for (const [key, aliases] of Object.entries(COMMAND_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_TO_KEY.set(normalizeCmd(alias), key);
  }
}

function resolveCommandKey(command) {
  return ALIAS_TO_KEY.get(normalizeCmd(command)) || null;
}

module.exports = {
  COMMAND_ALIASES,
  resolveCommandKey,
};
