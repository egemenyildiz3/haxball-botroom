const readline = require('readline');
const { handlePlayerChat } = require('../commands');
const { rebalanceTeams } = require('./teamBalancer');

function attachTerminalInput(room, state, deps, autoManager) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const hostPlayer = { id: 0, name: 'Host-admin', admin: true, team: 0 };

  function terminalDeps() {
    const loggedInPlayers = new Map(deps.loggedInPlayers || []);
    loggedInPlayers.set(hostPlayer.id, {
      username: hostPlayer.name,
      isadmin: 1,
      source: 'terminal',
    });

    return {
      ...deps,
      loggedInPlayers,
      afkPlayers: state.afkPlayers,
      rebalanceTeams: () => rebalanceTeams(room, state, deps)
        .catch((err) => console.warn('[AUTO] Konsoldan takım dengeleme başarısız:', err.message)),
      autoManager,
      chatFilter: state.chatFilter,
      chatMuted: state.chatMuted,
      setChatMuted: (muted) => { state.chatMuted = !!muted; },
      mutedPlayers: state.mutedPlayers,
      gameActive: !!state.currentGame,
    };
  }

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;

    if (text.startsWith('/')) {
      const [cmd] = text.split(/\s+/, 1);
      const command = cmd.toLowerCase();
      if (command === '/clear_bans' || command === '/clearbans') {
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
      } else if (command === '/start') {
        try {
          room.startGame();
          console.log('⚡ [CONSOLE]: Oyun başlatıldı.');
        } catch (e) {
          console.warn('Oyun başlatılamadı:', e.message);
        }
      } else if (command === '/stop') {
        try {
          room.stopGame();
          console.log('⚡ [CONSOLE]: Oyun durduruldu.');
        } catch (e) {
          console.warn('Oyun durdurulamadı:', e.message);
        }
      } else if (command === '/set_password') {
        const password = text.slice(cmd.length).trim();
        if (!password) {
          console.warn('⚡ [CONSOLE]: Kullanım: /set_password <şifre>');
          return;
        }

        try {
          if (typeof room.setPassword === 'function') {
            room.setPassword(password);
            console.log('⚡ [CONSOLE]: Oda şifresi ayarlandı.');
          } else {
            console.warn('⚡ [CONSOLE]: room.setPassword() metodu bulunamadı.');
          }
        } catch (e) {
          console.warn('Oda şifresi ayarlanamadı:', e.message);
        }
      } else if (command === '/clear_password') {
        try {
          if (typeof room.setPassword === 'function') {
            room.setPassword(null);
            console.log('⚡ [CONSOLE]: Oda şifresi kaldırıldı.');
          } else {
            console.warn('⚡ [CONSOLE]: room.setPassword() metodu bulunamadı.');
          }
        } catch (e) {
          console.warn('Oda şifresi kaldırılamadı:', e.message);
        }
      } else {
        console.log(`⚠️ Bilinmeyen konsol komutu: ${text}`);
      }
      return;
    }

    if (text.startsWith('!')) {
      console.log(`⚡ [CONSOLE CMD]: ${text}`);
      handlePlayerChat(room, hostPlayer, text, terminalDeps());
      return;
    }

    try {
      handlePlayerChat(room, hostPlayer, text, terminalDeps());
      console.log(`💬 [TERMINAL CHAT]: ${text}`);
    } catch (err) {
      console.warn('Sohbet mesajı gönderilemedi:', err.message);
    }
  });

  return rl;
}

module.exports = { attachTerminalInput };
