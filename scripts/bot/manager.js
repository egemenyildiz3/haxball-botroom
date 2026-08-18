/**
 * Bot yöneticisi - bellek içi (in-memory) sürüm.
 *
 * Botlar ayrı bir process olarak odaya BAĞLANMAZ. node-haxball'un host modu
 * sahte oyuncu desteğiyle (fakePlayerJoin / fakeSendPlayerInput) botlar
 * doğrudan host process içinde yaşar ve her fizik tick'inde tuş girdisi
 * üretir. Böylece:
 *   - Kendi odana WebRTC ile bağlanma (NAT / FailedHost) sorunu yok
 *   - Auth/oda kimliği/çift giriş kontrolü derdi yok
 *   - CPU maliyeti çok daha düşük
 */

const { decide, configFromPhysics, makePersonality, describePersonality } = require('./brain');

const FIRST_BOT_ID = 500; // gerçek oyuncu id'leriyle çakışmasın diye yüksek başlıyoruz
const BOT_CONN_PREFIX = 'bot-conn-';
const BOT_AUTH_PREFIX = 'bot-auth-';

const boundsCache = new WeakMap();

/**
 * Gerçek saha sınırlarını köşe noktalarından hesaplar.
 * stadium.width/height kamera ölçüsü olduğu için sahayı temsil etmiyor.
 */
function fieldBounds(stadium) {
  if (!stadium) return null;
  if (boundsCache.has(stadium)) return boundsCache.get(stadium);

  const vertices = stadium.vertices || [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (const v of vertices) {
    const p = v && v.pos;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const bounds = Number.isFinite(minX) && maxX > minX ? { minX, maxX, minY, maxY } : null;
  boundsCache.set(stadium, bounds);
  return bounds;
}

function createBotManager(options = {}) {
  const baseName = options.botName || 'SpaceBot';
  const maxBots = Number(options.maxBots || 8);
  const avatar = options.avatar || '🤖';
  const log = options.log || ((msg) => console.log(msg));
  const brainConfig = options.brainConfig || {};

  let raw = null; // node-haxball ham oda nesnesi
  let keyState = null; // API.Utils.keyState
  let nextId = FIRST_BOT_ID;
  let physicsCfg = null; // haritadan okunan fizik ayarları
  let physicsStadium = null; // ayarların hangi stadyuma ait olduğu

  /**
   * Aktif haritanın playerPhysics değerlerini brain ayarlarına çevirir.
   * Harita değişirse yeniden hesaplanır (Spacebounce'ın damping/kickingDamping
   * değerleri varsayılanlardan çok farklı, bu yüzden şart).
   */
  function currentBrainConfig() {
    const stadium = raw && raw.stadium;
    if (stadium !== physicsStadium) {
      physicsStadium = stadium;
      physicsCfg = configFromPhysics(stadium && stadium.playerPhysics, brainConfig);

      const pp = (stadium && stadium.playerPhysics) || {};
      log(
        `🤖 [BOT] Harita fiziği okundu → damping=${pp.damping} ` +
        `kickingDamping=${pp.kickingDamping} acceleration=${pp.acceleration}`
      );
    }
    return physicsCfg || brainConfig;
  }

  const bots = new Map(); // name -> { id, name, memory, lastInput }

  function expectedName(index) {
    return index === 0 ? baseName : `${baseName} ${index + 1}`;
  }

  function isExpectedBotName(cleanName) {
    if (!cleanName) return false;
    for (const name of bots.keys()) {
      if (name.toLowerCase() === String(cleanName).toLowerCase()) return true;
    }
    return false;
  }

  function isBotPlayer(playerId) {
    for (const bot of bots.values()) {
      if (bot.id === playerId) return true;
    }
    return false;
  }

  function isBotAuth(value) {
    return typeof value === 'string' && value.startsWith(BOT_AUTH_PREFIX);
  }

  function isBotConn(value) {
    return typeof value === 'string' && value.startsWith(BOT_CONN_PREFIX);
  }

  function isProtectedBotIdentity(player) {
    if (!player) return false;
    return isBotPlayer(player.id) || isBotAuth(player.auth) || isBotConn(player.conn);
  }

  /** Ham oda durumundan brain.js'in beklediği görünümü kurar. */
  function buildView(bot) {
    const gameState = raw.gameState;
    if (!gameState || !gameState.physicsState) return null;

    const me = raw.getPlayer(bot.id);
    if (!me || !me.disc || !me.team) return null;

    const teamId = me.team.id;
    if (teamId !== 1 && teamId !== 2) return null; // izleyicide

    const ball = gameState.physicsState.discs[0];
    if (!ball || !ball.pos) return null;

    const stadium = raw.stadium;
    const goals = (stadium && stadium.goals) || [];
    const ownGoal = goals.find((g) => g.team && g.team.id === teamId);
    const oppGoal = goals.find((g) => g.team && g.team.id !== teamId);
    if (!ownGoal || !oppGoal) return null;

    const toActor = (p) => ({
      id: p.id,
      pos: p.disc.pos,
      speed: p.disc.speed || { x: 0, y: 0 },
      radius: p.disc.radius,
    });

    const onPitch = raw.players.filter((p) => p.disc && p.team && (p.team.id === 1 || p.team.id === 2));
    const others = onPitch.filter((p) => p.id !== bot.id);
    const botOnly = onPitch.length > 0 && onPitch.every((p) => isBotPlayer(p.id));

    // Saha uzunluğu = kaleler arası mesafe. stadium.width/height KAMERA
    // ölçüsüdür (Spacebounce'ta 1500x1000) ama gerçek saha 2600x1500.
    const width = Math.abs(oppGoal.p0.x - ownGoal.p0.x) || 2400;
    const field = fieldBounds(stadium);
    const height = field ? field.maxY - field.minY : Math.abs(ownGoal.p1.y - ownGoal.p0.y) * 5;

    return {
      self: toActor(me),
      ball: {
        pos: ball.pos,
        speed: ball.speed || { x: 0, y: 0 },
        radius: ball.radius,
        damping: ball.damping,
      },
      teammates: others.filter((p) => p.team.id === teamId).map(toActor),
      opponents: others.filter((p) => p.team.id !== teamId && p.team.id !== 0).map(toActor),
      ownGoal: { p0: ownGoal.p0, p1: ownGoal.p1 },
      oppGoal: { p0: oppGoal.p0, p1: oppGoal.p1 },
      stadium: { width, height },
      field,
      botOnly,
    };
  }

  /** Her fizik tick'inde tüm botların girdisini hesaplar ve gönderir. */
  function tick() {
    if (!raw || bots.size === 0) return;

    const cfg = currentBrainConfig();

    for (const bot of bots.values()) {
      // Kişiliği taban ayarların üstüne uygula (taban değişirse yeniden birleştir)
      if (bot.cfgBase !== cfg) {
        bot.cfgBase = cfg;
        bot.cfg = { ...cfg, ...bot.personality };
      }

      let input = 0;
      try {
        const view = buildView(bot);
        if (view) {
          const move = decide(view, bot.memory, bot.cfg);
          input = keyState(move.dirX, move.dirY, move.kick);
        } else {
          bot.memory.kickCooldown = 0;
        }
      } catch (err) {
        input = 0;
      }

      // Sadece değiştiğinde gönder (gereksiz olay üretmeyelim)
      if (input !== bot.lastInput) {
        bot.lastInput = input;
        try { raw.fakeSendPlayerInput(input, bot.id); } catch (e) {}
      }
    }
  }

  function spawnOne(index) {
    const name = expectedName(index);
    if (bots.has(name)) return false;

    const id = nextId++;

    // Her bot kendi tohumuyla biraz farklı bir kişilik alır
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const baseCfg = currentBrainConfig();
    const personality = makePersonality(seed, baseCfg);

    const bot = {
      id,
      name,
      memory: { kickCooldown: 0 },
      lastInput: 0,
      seed,
      personality,
      trait: describePersonality(personality, baseCfg),
      cfgBase: null,
      cfg: null,
    };

    try {
      // conn/auth benzersiz olsun ki host'un çift giriş kontrolüne takılmasın
      raw.fakePlayerJoin(id, name, 'tr', avatar, `${BOT_CONN_PREFIX}${id}`, `${BOT_AUTH_PREFIX}${id}`);
    } catch (err) {
      log(`🤖 [BOT] ${name} eklenemedi: ${err.message}`);
      return false;
    }

    bots.set(name, bot);
    log(`🤖 [BOT] ${name} sahaya eklendi (id=${id}, karakter=${bot.trait}, tohum=${seed}).`);
    return true;
  }

  function removeOne(bot) {
    try { raw.fakeSendPlayerInput(0, bot.id); } catch (e) {}
    try { raw.fakePlayerLeave(bot.id); } catch (e) {}
    bots.delete(bot.name);
  }

  return {
    /**
     * Oda açıldıktan sonra çağrılmalı. Ham oda nesnesini ve tick kancasını bağlar.
     */
    attach(rawRoom, api) {
      raw = rawRoom;
      keyState = api.Utils.keyState;

      // Oyun tick'ine bağlan; varsa mevcut kancayı da çağırmaya devam et
      const previous = raw.onGameTick;
      raw.onGameTick = function (...args) {
        if (typeof previous === 'function') {
          try { previous.apply(this, args); } catch (e) {}
        }
        tick();
      };
    },

    isReady() {
      return !!raw;
    },

    isExpectedBotName,
    isBotPlayer,
    isBotAuth,
    isBotConn,
    isProtectedBotIdentity,

    count() {
      return bots.size;
    },

    start(requested = 1) {
      if (!raw) {
        return { ok: false, message: 'Oda henüz hazır değil, birkaç saniye sonra tekrar deneyin.' };
      }
      if (bots.size >= maxBots) {
        return { ok: false, message: `Zaten en fazla sayıda bot sahada (${maxBots}).` };
      }

      const want = Math.max(1, Math.min(maxBots, Number(requested) || 1));
      let started = 0;
      for (let i = 0; i < maxBots && started < want; i++) {
        if (!bots.has(expectedName(i)) && spawnOne(i)) started++;
      }

      if (started === 0) return { ok: false, message: 'Yeni bot eklenemedi.' };
      return { ok: true, message: `🤖 ${started} bot sahaya eklendi. (toplam ${bots.size})` };
    },

    stop(name) {
      if (bots.size === 0) return { ok: false, message: 'Şu anda sahada bot yok.' };

      if (name) {
        const bot = bots.get(name);
        if (!bot) return { ok: false, message: `"${name}" adında bir bot yok.` };
        removeOne(bot);
        return { ok: true, message: `🤖 ${name} sahadan çıkarıldı.` };
      }

      const stopped = bots.size;
      for (const bot of [...bots.values()]) removeOne(bot);
      return { ok: true, message: `🤖 ${stopped} bot sahadan çıkarıldı.` };
    },

    stopLast() {
      if (bots.size === 0) return { ok: false, message: 'Şu anda sahada bot yok.' };

      const bot = [...bots.values()].at(-1);
      removeOne(bot);
      return { ok: true, message: `🤖 ${bot.name} sahadan çıkarıldı. (toplam ${bots.size})` };
    },

    status() {
      if (!raw) return '🤖 Bot durumu: oda henüz hazır değil.';
      if (bots.size === 0) return '🤖 Bot durumu: kapalı. (!bot aç ile ekleyebilirsin)';
      const list = [...bots.values()].map((b) => `${b.name} [${b.trait}]`).join(', ');
      return `🤖 Bot durumu: ${bots.size}/${maxBots} sahada → ${list}`;
    },

    diagnostics() {
      if (!raw) return null;

      const gameState = raw.gameState || null;
      const players = Array.isArray(raw.players) ? raw.players : [];
      return {
        rawGame: !!gameState,
        rawTime: gameState ? Number(gameState.timeElapsed || 0).toFixed(2) : 'none',
        rawScore: gameState ? `${gameState.redScore || 0}-${gameState.blueScore || 0}` : 'none',
        rawPlayers: players.length,
        rawTeamsLocked: raw.teamsLocked,
      };
    },

    stopAll() {
      if (!raw) return;
      for (const bot of [...bots.values()]) removeOne(bot);
    },
  };
}

module.exports = { createBotManager };
