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

const BRAIN_MODULES = {
  balanced: require('./brain'),
  smallPitch: require('./brainSmallPitch'),
};

const FIRST_BOT_ID = 900000; // gerçek oyuncu id sayacı günlerce çalışınca 500'lere ulaşabiliyor
const BOT_CONN_PREFIX = 'bot-conn-';
const BOT_AUTH_PREFIX = 'bot-auth-';
const KICKOFF_FORCE_MS = 15 * 1000;
const KICKOFF_RELEASE_DISTANCE = 85;
const KICK_KEY_BIT = 16;
const DEFAULT_BOT_NAMES = [
  'Messi',
  'Ronaldo',
  'Neymar',
  'Mbappe',
  'Haaland',
  'Zidane',
  'Ronaldinho',
  'Modric',
];

const boundsCache = new WeakMap();
const wallPlaneCache = new WeakMap();

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

function vectorPart(vector, key, index) {
  if (Array.isArray(vector)) return Number(vector[index]);
  return vector ? Number(vector[key]) : NaN;
}

function maskContainsBall(mask, ballFlag) {
  if (Array.isArray(mask)) return mask.includes('ball');
  if (Number.isFinite(mask) && Number.isFinite(ballFlag)) return (mask & ballFlag) !== 0;
  return true;
}

/** Haritadaki yatay, topa çarpan düzlemleri merkez sınırlarına çevirir. */
function ballWallBounds(stadium, ball, ballFlag) {
  if (!stadium || !ball) return null;

  let planes = wallPlaneCache.get(stadium);
  if (!planes) {
    planes = [];
    for (const plane of stadium.planes || []) {
      const nx = vectorPart(plane && plane.normal, 'x', 0);
      const ny = vectorPart(plane && plane.normal, 'y', 1);
      const dist = Number(plane && plane.dist);
      if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(dist)) continue;
      if (Math.abs(nx) > 1e-6 || Math.abs(ny) < 0.9) continue;
      if (!maskContainsBall(plane.cMask, ballFlag)) continue;
      planes.push({ ny, dist, bCoef: Number(plane.bCoef ?? plane.bCoeff) });
    }
    wallPlaneCache.set(stadium, planes);
  }

  const radius = Number.isFinite(ball.radius) ? ball.radius : 10;
  const ballBounce = Number(ball.bCoef ?? ball.bCoeff);
  const discBounce = Number.isFinite(ballBounce) ? ballBounce : 0.5;
  let min = null;
  let max = null;

  for (const plane of planes) {
    const boundary = (plane.dist + radius) / plane.ny;
    const restitution = Math.max(0, Math.min(1.5,
      discBounce * (Number.isFinite(plane.bCoef) ? plane.bCoef : 1)
    ));
    if (plane.ny > 0 && (!min || boundary > min.value)) min = { value: boundary, restitution };
    if (plane.ny < 0 && (!max || boundary < max.value)) max = { value: boundary, restitution };
  }

  if (!min || !max || max.value <= min.value) return null;
  return {
    minY: min.value,
    maxY: max.value,
    minRestitution: min.restitution,
    maxRestitution: max.restitution,
  };
}

function createBotManager(options = {}) {
  const baseName = options.botName || 'SpaceBot';
  const botNames = Array.isArray(options.botNames) && options.botNames.length > 0
    ? options.botNames
    : DEFAULT_BOT_NAMES;
  const maxBots = Number(options.maxBots || 8);
  const avatar = options.avatar || '🤖';
  const log = options.log || ((msg) => console.log(msg));
  const brainName = BRAIN_MODULES[options.brain] ? options.brain : 'balanced';
  const brain = BRAIN_MODULES[brainName];
  const {
    decide,
    configFromPhysics,
    makePersonality,
    describePersonality,
    selectAttacker,
  } = brain;
  const brainConfig = options.brainConfig || {};
  const telemetry = !!options.telemetry;
  const telemetryEveryTicks = Math.max(1, Number(options.telemetryEveryTicks) || 120);
  const t = options.t || ((key, vars = {}) => {
    const messages = {
      'bot.roomNotReady': 'Oda henüz hazır değil.',
      'bot.roomNotReadyRetry': 'Oda henüz hazır değil, birkaç saniye sonra tekrar deneyin.',
      'bot.maxReached': `Zaten en fazla sayıda bot sahada (${vars.max}).`,
      'bot.startFailed': 'Yeni bot eklenemedi.',
      'bot.started': `🤖 ${vars.count} bot sahaya eklendi. (toplam ${vars.total})`,
      'bot.none': 'Şu anda sahada bot yok.',
      'bot.notFound': `"${vars.name}" adında bir bot yok.`,
      'bot.stoppedOne': `🤖 ${vars.name} sahadan çıkarıldı.`,
      'bot.stoppedAll': `🤖 ${vars.count} bot sahadan çıkarıldı.`,
      'bot.stoppedLast': `🤖 ${vars.name} sahadan çıkarıldı. (toplam ${vars.total})`,
      'bot.statusNotReady': '🤖 Bot durumu: oda henüz hazır değil.',
      'bot.statusOff': '🤖 Bot durumu: kapalı. (!bot aç ile ekleyebilirsin)',
      'bot.status': `🤖 Bot durumu: ${vars.count}/${vars.max} sahada → ${vars.list}`,
      'bot.validation': `Bot validation: ${vars.count}/${vars.max} bot odada. Temizlenen=${vars.pruned}, eklenen=${vars.started}.`,
    };
    return messages[key] || key;
  });

  let raw = null; // node-haxball ham oda nesnesi
  let keyState = null; // API.Utils.keyState
  let runAfterGameTick = null; // API.Utils.runAfterGameTick
  let nextId = FIRST_BOT_ID;
  let physicsCfg = null; // haritadan okunan fizik ayarları
  let physicsStadium = null; // ayarların hangi stadyuma ait olduğu
  let ballCollisionFlag = null;
  let tickNumber = 0;

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
        `🤖 [BOT] Harita fiziği okundu → brain=${brainName} damping=${pp.damping} ` +
        `kickingDamping=${pp.kickingDamping} acceleration=${pp.acceleration}`
      );
    }
    return physicsCfg || brainConfig;
  }

  const bots = new Map(); // name -> { id, name, memory, lastInput }

  function expectedName(index) {
    const suffix = botNames[index];
    return suffix ? `${baseName} ${suffix}` : `${baseName} ${index + 1}`;
  }

  function isExpectedBotName(cleanName) {
    if (!cleanName) return false;
    for (let i = 0; i < maxBots; i++) {
      const name = expectedName(i);
      if (name.toLowerCase() === String(cleanName).toLowerCase()) return true;
    }
    return false;
  }

  function playerMatchesBot(player, bot) {
    if (!player || !bot || player.id !== bot.id) return false;
    const auth = player.auth || '';
    const conn = player.conn || '';
    const name = String(player.name || '').trim().toLowerCase();
    const botName = String(bot.name || '').trim().toLowerCase();

    return auth === `${BOT_AUTH_PREFIX}${bot.id}`
      || conn === `${BOT_CONN_PREFIX}${bot.id}`
      || (name && botName && name === botName);
  }

  function botByPlayerId(playerId) {
    for (const bot of bots.values()) {
      if (bot.id === playerId) return bot;
    }
    return null;
  }

  function isBotPlayer(playerId) {
    const bot = botByPlayerId(playerId);
    if (!bot) return false;
    if (!raw || typeof raw.getPlayer !== 'function') return true;
    return playerMatchesBot(raw.getPlayer(playerId), bot);
  }

  function isBotAuth(value) {
    return typeof value === 'string' && value.startsWith(BOT_AUTH_PREFIX);
  }

  function isBotConn(value) {
    return typeof value === 'string' && value.startsWith(BOT_CONN_PREFIX);
  }

  function isProtectedBotIdentity(player) {
    if (!player) return false;
    return isBotAuth(player.auth) || isBotConn(player.conn) || isBotPlayer(player.id);
  }

  function translateTrait(trait) {
    return String(trait || '')
      .split('/')
      .map((part) => t(`bot.trait.${part}`, {}, part))
      .join('/');
  }

  /** Ham oda durumundan brain.js'in beklediği görünümü kurar. */
  function buildView(bot, attackerIds, walls) {
    const gameState = raw.gameState;
    if (!gameState || !gameState.physicsState) return null;

    const me = raw.getPlayer(bot.id);
    if (!playerMatchesBot(me, bot)) return null;
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
        walls,
      },
      teammates: others.filter((p) => p.team.id === teamId).map(toActor),
      opponents: others.filter((p) => p.team.id !== teamId && p.team.id !== 0).map(toActor),
      ownGoal: { p0: ownGoal.p0, p1: ownGoal.p1 },
      oppGoal: { p0: oppGoal.p0, p1: oppGoal.p1 },
      stadium: { width, height },
      field,
      botOnly,
      forceBall: bot.forceBallUntil && bot.forceBallUntil > Date.now(),
      attackerId: attackerIds.get(teamId),
    };
  }

  function distanceToBall(player, ball) {
    if (!player || !player.disc || !player.disc.pos || !ball || !ball.pos) return Infinity;
    const dx = player.disc.pos.x - ball.pos.x;
    const dy = player.disc.pos.y - ball.pos.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function clearForce(bot) {
    bot.forceBallUntil = 0;
    bot.forceBallOrigin = null;
  }

  function actorOf(player) {
    return {
      id: player.id,
      pos: player.disc.pos,
      speed: player.disc.speed || { x: 0, y: 0 },
      radius: player.disc.radius,
    };
  }

  /** Takım başına tek, her tick güncellenen ortak hücumcu seçimi. */
  function selectTeamAttackers(ball, walls, cfg) {
    const result = new Map();
    const now = Date.now();
    const ballSnapshot = {
      pos: ball.pos,
      speed: ball.speed || { x: 0, y: 0 },
      radius: ball.radius,
      damping: ball.damping,
      walls,
    };

    for (const teamId of [1, 2]) {
      const players = raw.players.filter((player) => {
        if (!player || !player.disc || !player.team || player.team.id !== teamId) return false;
        const bot = botByPlayerId(player.id);
        return playerMatchesBot(player, bot);
      });
      if (players.length === 0) continue;

      let forced = null;
      for (const bot of bots.values()) {
        if (!bot.forceBallUntil) continue;
        const player = raw.getPlayer(bot.id);
        const moved = bot.forceBallOrigin && Math.hypot(
          ball.pos.x - bot.forceBallOrigin.x,
          ball.pos.y - bot.forceBallOrigin.y
        ) > KICKOFF_RELEASE_DISTANCE;
        if (bot.forceBallUntil <= now || moved || !playerMatchesBot(player, bot) || !player.team ||
            (player.team.id !== 1 && player.team.id !== 2)) {
          clearForce(bot);
          continue;
        }
        if (player.team.id !== teamId) continue;
        forced = bot;
        break;
      }

      let attackerId;
      if (forced) {
        attackerId = forced.id;
      } else {
        const squad = players.map(actorOf);
        const choice = selectAttacker(
          squad,
          ballSnapshot,
          { ...cfg, ballDamping: Number.isFinite(ball.damping) ? ball.damping : cfg.ballDamping }
        );
        attackerId = choice.id;
      }

      result.set(teamId, attackerId);
    }

    return result;
  }

  /** Her fizik tick'inde tüm botların girdisini hesaplar ve gönderir. */
  function tick() {
    if (!raw || bots.size === 0) return;

    tickNumber++;
    const cfg = currentBrainConfig();
    const gameState = raw.gameState;
    const ball = gameState && gameState.physicsState && gameState.physicsState.discs[0];
    const walls = ball ? ballWallBounds(raw.stadium, ball, ballCollisionFlag) : null;
    const attackerIds = ball ? selectTeamAttackers(ball, walls, cfg) : new Map();
    const traceThisTick = telemetry && tickNumber % telemetryEveryTicks === 0;

    for (const bot of bots.values()) {
      const rawPlayer = raw.getPlayer(bot.id);
      if (!playerMatchesBot(rawPlayer, bot)) {
        bot.memory.kickCooldown = 0;
        bot.lastInput = 0;
        continue;
      }

      // Kişiliği taban ayarların üstüne uygula (taban değişirse yeniden birleştir)
      if (bot.cfgBase !== cfg) {
        bot.cfgBase = cfg;
        bot.cfg = { ...cfg, ...bot.personality };
      }

      let input = 0;
      try {
        const view = buildView(bot, attackerIds, walls);
        if (view) {
          const move = decide(view, bot.memory, bot.cfg);
          input = keyState(move.dirX, move.dirY, move.kick);
          if (traceThisTick) {
            const p = (point) => point
              ? `${point.x.toFixed(1)},${point.y.toFixed(1)}`
              : '-';
            log(
              `🤖 [BOT-TRACE] t=${tickNumber} name=${bot.name} role=${move.role} ` +
              `mode=${move.mode} eta=${Number(move.interceptTicks).toFixed(1)} ` +
              `self=${p(view.self.pos)} ball=${p(view.ball.pos)} target=${p(move.target)} ` +
              `input=${move.dirX},${move.dirY},${move.kick ? 1 : 0}`
            );
          }
        } else {
          bot.memory.kickCooldown = 0;
        }
      } catch (err) {
        input = 0;
      }

      const sendInput = (value) => {
        try { raw.fakeSendPlayerInput(value, bot.id); } catch (e) {}
      };
      const sendAfterTick = (value) => {
        if (typeof runAfterGameTick === 'function') {
          try {
            runAfterGameTick(() => sendInput(value), 1);
            return;
          } catch (e) {}
        }
        sendInput(value);
      };
      const wantsKick = (input & KICK_KEY_BIT) !== 0;

      if (input !== bot.lastInput) {
        bot.lastInput = input;
        sendAfterTick(input);
      } else if (wantsKick && rawPlayer && rawPlayer.isKicking === false) {
        sendAfterTick(input & ~KICK_KEY_BIT);
        sendAfterTick(input);
      }
    }
  }

  function allocateBotId() {
    for (let attempts = 0; attempts < 10000; attempts++) {
      const candidate = nextId++;
      const tracked = [...bots.values()].some((bot) => bot.id === candidate);
      const occupied = raw && typeof raw.getPlayer === 'function' && raw.getPlayer(candidate);
      if (!tracked && !occupied) return candidate;
    }

    throw new Error('Bot ID üretilemedi; bot ID aralığı dolu görünüyor.');
  }

  function spawnOne(index) {
    const name = expectedName(index);
    if (bots.has(name)) return false;

    let id;
    try {
      id = allocateBotId();
    } catch (err) {
      log(`🤖 [BOT] ${name} eklenemedi: ${err.message}`);
      return false;
    }

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
    const player = raw && typeof raw.getPlayer === 'function' ? raw.getPlayer(bot.id) : null;
    if (playerMatchesBot(player, bot)) {
      try { raw.fakeSendPlayerInput(0, bot.id); } catch (e) {}
      try { raw.fakePlayerLeave(bot.id); } catch (e) {}
    } else if (player) {
      log(`🤖 [BOT] ${bot.name} silinirken id=${bot.id} gerçek/farklı oyuncuya ait göründü (${player.name || 'isimsiz'}); oyuncuya dokunulmadı.`);
    }
    bots.delete(bot.name);
  }

  function pruneMissingBots() {
    if (!raw || typeof raw.getPlayer !== 'function') return 0;

    let removed = 0;
    for (const bot of [...bots.values()]) {
      const player = raw.getPlayer(bot.id);
      if (playerMatchesBot(player, bot)) continue;
      bots.delete(bot.name);
      removed++;
      if (player) {
        log(`🤖 [BOT] ${bot.name} id=${bot.id} artık gerçek/farklı oyuncuya ait görünüyor (${player.name || 'isimsiz'}); bot kaydı temizlendi.`);
      } else {
        log(`🤖 [BOT] ${bot.name} odada görünmüyor; bot kaydı temizlendi.`);
      }
    }
    return removed;
  }

  return {
    /**
     * Oda açıldıktan sonra çağrılmalı. Ham oda nesnesini ve tick kancasını bağlar.
     */
    attach(rawRoom, api) {
      raw = rawRoom;
      keyState = api.Utils.keyState;
      runAfterGameTick = api.Utils && api.Utils.runAfterGameTick;
      ballCollisionFlag = api.CollisionFlags && api.CollisionFlags.ball;

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
      pruneMissingBots();
      return bots.size;
    },

    ensureMinimum(minimum = 4) {
      if (!raw) return { ok: false, message: t('bot.roomNotReady'), count: bots.size, pruned: 0, started: 0 };

      const pruned = pruneMissingBots();
      const target = Math.max(0, Math.min(maxBots, Number(minimum) || 0));
      const missing = Math.max(0, target - bots.size);
      let started = 0;

      for (let i = 0; i < maxBots && started < missing; i++) {
        if (!bots.has(expectedName(i)) && spawnOne(i)) started++;
      }

      return {
        ok: bots.size >= target,
        message: t('bot.validation', { count: bots.size, max: maxBots, pruned, started }),
        count: bots.size,
        pruned,
        started,
      };
    },

    forceClosestBotToBall(teamId, durationMs = KICKOFF_FORCE_MS) {
      if (!raw || !raw.gameState || !raw.gameState.physicsState) {
        log(`🤖 [BOT] Santra watchdog atlandı: raw oyun durumu hazır değil (team=${teamId}).`);
        return false;
      }

      const ball = raw.gameState.physicsState.discs[0];
      const candidates = [...bots.values()]
        .map((bot) => ({ bot, player: raw.getPlayer(bot.id) }))
        .filter(({ bot, player }) => playerMatchesBot(player, bot) && player.disc && player.team && player.team.id === teamId)
        .sort((a, b) => distanceToBall(a.player, ball) - distanceToBall(b.player, ball));

      const chosen = candidates[0];
      if (!chosen) {
        const teamBots = [...bots.values()]
          .map((bot) => ({ bot, player: raw.getPlayer(bot.id) }))
          .filter(({ bot, player }) => playerMatchesBot(player, bot))
          .map(({ bot, player }) => `${bot.name}:team=${player.team && player.team.id}`);
        log(`🤖 [BOT] Santra watchdog atlandı: team=${teamId} için uygun bot yok. Botlar=[${teamBots.join(', ')}]`);
        return false;
      }

      for (const bot of bots.values()) {
        const player = raw.getPlayer(bot.id);
        if (playerMatchesBot(player, bot) && player.team && player.team.id === teamId) clearForce(bot);
      }
      chosen.bot.forceBallUntil = Date.now() + durationMs;
      chosen.bot.forceBallOrigin = { x: ball.pos.x, y: ball.pos.y };
      chosen.bot.lastInput = 0;

      const distance = distanceToBall(chosen.player, ball);
      log(`🤖 [BOT] Santra watchdog: ${chosen.bot.name} güvenli vuruş planıyla topa yönlendirildi (team=${teamId}, mesafe=${Math.round(distance)}).`);
      return true;
    },

    start(requested = 1) {
      if (!raw) {
        return { ok: false, message: t('bot.roomNotReadyRetry') };
      }

      pruneMissingBots();

      if (bots.size >= maxBots) {
        return { ok: false, message: t('bot.maxReached', { max: maxBots }) };
      }

      const want = Math.max(1, Math.min(maxBots, Number(requested) || 1));
      let started = 0;
      for (let i = 0; i < maxBots && started < want; i++) {
        if (!bots.has(expectedName(i)) && spawnOne(i)) started++;
      }

      if (started === 0) return { ok: false, message: t('bot.startFailed') };
      return { ok: true, message: t('bot.started', { count: started, total: bots.size }) };
    },

    stop(name) {
      if (bots.size === 0) return { ok: false, message: t('bot.none') };

      if (name) {
        const bot = bots.get(name);
        if (!bot) return { ok: false, message: t('bot.notFound', { name }) };
        removeOne(bot);
        return { ok: true, message: t('bot.stoppedOne', { name }) };
      }

      const stopped = bots.size;
      for (const bot of [...bots.values()]) removeOne(bot);
      return { ok: true, message: t('bot.stoppedAll', { count: stopped }) };
    },

    stopLast() {
      if (bots.size === 0) return { ok: false, message: t('bot.none') };

      const bot = [...bots.values()].at(-1);
      removeOne(bot);
      return { ok: true, message: t('bot.stoppedLast', { name: bot.name, total: bots.size }) };
    },

    status() {
      if (!raw) return t('bot.statusNotReady');
      pruneMissingBots();
      if (bots.size === 0) return t('bot.statusOff');
      const list = [...bots.values()].map((b) => `${b.name} [${translateTrait(b.trait)}]`).join(', ');
      return t('bot.status', { count: bots.size, max: maxBots, list });
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

module.exports = { createBotManager, ballWallBounds };
