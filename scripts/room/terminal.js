const readline = require('readline');
const { handlePlayerChat } = require('../commands');
const { rebalanceTeams } = require('./teamBalancer');

function attachTerminalInput(room, state, deps, autoManager) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const hostPlayer = { id: 0, name: 'Host-admin', admin: true, team: 0 };

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;

    if (text.startsWith('/')) {
      const cmd = text.toLowerCase();
      if (cmd === '/clear_bans' || cmd === '/clearbans') {
        try {
          if (typeof room.clearBans === 'function') {
            room.clearBans();
            console.log('⚡ [CONSOLE]: Tüm banlar kaldırıldı.');
          } else {
            console.warn('⚡ [CONSOLE]: room.clearBans() metodu bulunamadı.');
          }
        } catch (e) {
          console.warn('Banlar kaldırılamadı:', e.message);
        }
      } else if (cmd === '/start') {
        try {
          room.startGame();
          console.log('⚡ [CONSOLE]: Oyun başlatıldı.');
        } catch (e) {
          console.warn('Oyun başlatılamadı:', e.message);
        }
      } else if (cmd === '/stop') {
        try {
          room.stopGame();
          console.log('⚡ [CONSOLE]: Oyun durduruldu.');
        } catch (e) {
          console.warn('Oyun durdurulamadı:', e.message);
        }
      } else {
        console.log(`⚠️ Bilinmeyen konsol komutu: ${text}`);
      }
      return;
    }

    if (text.startsWith('!')) {
      console.log(`⚡ [CONSOLE CMD]: ${text}`);
      handlePlayerChat(room, hostPlayer, text, {
        ...deps,
        afkPlayers: state.afkPlayers,
        rebalanceTeams: () => rebalanceTeams(room, state, deps)
          .catch((err) => console.warn('[AUTO] Konsoldan takım dengeleme başarısız:', err.message)),
        autoManager,
        chatFilter: state.chatFilter,
      });
      return;
    }

    try {
      room.sendChat(text);
      console.log(`💬 [TERMINAL CHAT]: ${text}`);
    } catch (err) {
      console.warn('Sohbet mesajı gönderilemedi:', err.message);
    }
  });

  return rl;
}

module.exports = { attachTerminalInput };
