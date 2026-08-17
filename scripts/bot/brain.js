/**
 * Bot karar motoru.
 *
 * Bu dosya tamamen saftır (pure): oyun API'sine hiç dokunmaz, sadece bir
 * "view" nesnesi alıp {dirX, dirY, kick} döndürür. Böylece oyuna bağlanmadan
 * test edilebilir.
 *
 * ÖNEMLİ - Spacebounce fiziği:
 *   damping 0.9995        -> sürtünme yok denecek kadar az, oyuncu sonsuza
 *                            kadar kayar (terminal hız ~56 birim/tick)
 *   kickingDamping 0.985  -> vuruş tuşu BASILIYKEN çok güçlü fren
 *   acceleration 0.028    -> itiş çok zayıf
 *
 * Yani bu haritada vuruş tuşu aynı zamanda FREN görevi görüyor. Bot sadece
 * "hedefe doğru bas" mantığıyla oynayamaz; hedefi fena halde aşar. Bunun
 * yerine hız eşleme (velocity matching) yapıyoruz: istenen hız vektörünü
 * hesaplayıp aradaki farkı kapatacak yöne basıyoruz, gerektiğinde frenliyoruz.
 *
 * view = {
 *   self:      { id, pos:{x,y}, speed:{x,y}, radius },
 *   ball:      { pos:{x,y}, speed:{x,y}, radius, damping },
 *   teammates: [{ id, pos, speed, radius }],   // self hariç
 *   opponents: [{ id, pos, speed, radius }],
 *   ownGoal:   { p0:{x,y}, p1:{x,y} },
 *   oppGoal:   { p0:{x,y}, p1:{x,y} },
 *   stadium:   { width, height },
 * }
 */

const DEFAULTS = {
  // --- Fizik (Spacebounce varsayılanları; çalışma anında haritadan okunur) ---
  accel: 0.028,
  kickAccel: 0.0195,
  damping: 0.9995,
  kickingDamping: 0.985,
  ballDamping: 0.99,

  // --- Sürüş ---
  cruiseSpeed: 10, // pozisyon alırken hedeflenen azami hız
  strikeSpeed: 12, // hücumda tavan hız
  // Topa VARIŞ hızı hedefi - "ne kadar atak" ayarının asıl düğmesi.
  // Ölçüm (600 birim yaklaşma): varış hızı / topu aşma mesafesi
  //   0   -> 1.06 /  29  (eski sürüm: topa sürünüyor)
  //   2   -> 3.47 / 103  (denge noktası)
  //   5.5 -> 5.45 / 227  (savruk sürüm: topu aşıp gidiyor)
  // Yaklaşma sırasında fren aç/kapa sayısı hepsinde 0 - spam yok.
  strikeImpactSpeed: 2,
  steerDeadzone: 0.05, // bu kadar küçük hız farkını yok say (titreme önler)
  minBrakeSpeed: 0.5, // bu hızın altında frene gerek yok
  brakeMargin: 1.1, // fren mesafesi payı

  // Fren histerezisi: basma eşiği yüksek, bırakma eşiği düşük. Tek eşik
  // kullanılınca fren her birkaç tick'te açılıp kapanıyor (tuş spam'i) ve
  // ortalama sönümleme düştüğü için bot gerçekten yavaşlayamıyor.
  brakeEnter: 1.2, // frene basmak için gereken "atılacak hız"
  brakeExit: 0.15, // fren bu değerin altına inene kadar BASILI kalır
  brakeMinTicks: 8, // basıldıktan sonra en az bu kadar tick basılı tut

  // --- Topa vurma ---
  kickPadding: 4, // yarıçapların ötesinde vuruşun tuttuğu ek mesafe
  kickAttemptPadding: 7, // temas kaçırmamak için kick'i biraz erken hazırla
  kickHoldTicks: 2, // erken kick başlarsa temas anına kadar kısa süre basılı tut
  releaseTicks: 3, // tekrar vurabilmek için tuşu bırakma süresi
  preKickReleaseMargin: 18, // topa girmeden önce fren/kick tuşunu bırakmaya başla
  preKickReleaseTicks: 1, // temas anında yeni kick kaydolması için kısa hazırlık
  overlapRecoveryRange: 6, // topa yapışınca kısa geri/yan açılma modu
  overlapRecoveryTicks: 5,
  overlapRecoverySideStep: 45,
  ownGoalCarryRange: 70, // kötü açıdaysa topa gövdeyle dalma mesafesi
  ownGoalCarrySideStep: 80, // kötü açıdan çıkmak için yanal kaçış
  postInset: 22, // direğe bu kadar içeriden nişan al

  // Bölgeye göre vuruş kararı:
  //  - Kaleye yakınsak gerçek isabet kontrolü yap (goalMargin)
  //  - Uzaktaysak nişan arama, ileri doğru vur (clearConeCos)
  //  - Hiçbir durumda kendi kalemize doğru vurma (ownGoalGuard)
  shootingRange: 900, // kaleye bu mesafeden yakınsa "şut bölgesi"
  preciseAimRange: 750, // bu mesafeden yakında direk seçimine geç
  clearConeCos: -0.1, // şut bölgesi dışında yeterli olan "ileriye dönüklük"
  ownGoalGuard: -0.25, // bu değerin altındaki yön = kendi kalemize, asla vurma
  pressuredOpponentTicks: 10, // rakip bu kadar tick yakındaysa topu bekletme
  pressureRange: 180, // yakın rakip baskısı mesafesi

  // Şut bölgesinde artık sabit bir açı konisi yerine GERÇEK isabet kontrolü
  // yapılıyor: topun gideceği yön kale ağzını kesiyor mu? goalMargin, kale
  // ağzının iki ucundan içeride bırakılan güvenlik payı (0-0.5 arası oran).
  goalMargin: 0.12,
  kickStrength: 5, // Haxball varsayılanı; haritada tanımlıysa oradan okunur

  // --- Konumlanma ---
  predictTicks: 90, // topu kaç tick ileri tahmin edelim
  supportSpread: 220, // destek oyuncusunun yanal açılma mesafesi
  supportBehind: 150, // destek oyuncusu topun ne kadar gerisinde opsiyon olsun
  teamSpacing: 135, // botlar/oyuncular aynı noktaya yığılmasın
  teamSpacingPush: 75, // çok yakın hedefleri ne kadar yana/geriye itelim
  botOnlyStuckTicks: 80, // sadece botlar varken yatay kilidi kaç tick sonra kır
  botOnlyNudge: 90, // kilit açmak için hedefe eklenecek küçük dikey sapma

  // Savunmacının kale-top ekseninde nerede duracağı (0 = kalede, 1 = topun üstünde).
  // Defans oyuncusu kaleci gibi çizgide beklemesin; tehlikede geri gelsin ama
  // normal oyunda daha önde bir sigorta/libero gibi dursun.
  //   top kendi kalemize yakın  -> defenderNear (temkinli ama çizgi değil)
  //   takım hücumda, top uzakta -> defenderFar  (orta sahaya kadar çık)
  defenderNear: 0.45,
  defenderFar: 0.7,
  clearThird: 0.33, // sahanın bu kadarlık dilimi "kendi bölgemiz" sayılır
};

// --- Vektör yardımcıları -------------------------------------------------

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function normalize(a) {
  const l = Math.hypot(a.x, a.y);
  if (l < 1e-6) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

function isFinitePoint(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Gerçek saha sınırları. stadium.width/height KAMERA ölçüsüdür, sahanın
 * kendisi değildir (Spacebounce'ta kamera 1500x1000 iken saha 2600x1500).
 * Bu yüzden sınırlar köşe noktalarından türetilir; yoksa kalelerden tahmin.
 */
function fieldOf(view) {
  const f = view.field;
  if (f && Number.isFinite(f.maxX) && Number.isFinite(f.maxY) && f.maxX > f.minX) {
    return f;
  }
  const halfX = Math.max(Math.abs(view.ownGoal.p0.x), Math.abs(view.oppGoal.p0.x)) || 1200;
  const halfY = (view.stadium && view.stadium.height ? view.stadium.height / 2 : halfX * 0.58);
  return { minX: -halfX, maxX: halfX, minY: -halfY, maxY: halfY };
}

/**
 * `origin` noktasından `dir` yönünde giden ışın, p0-p1 doğru parçasını
 * kesiyor mu? Kesiyorsa parça üzerindeki oranı (0-1) döner, yoksa null.
 *
 * Şutun gerçekten kale ağzına gidip gitmediğini ölçmek için kullanılıyor.
 * Sabit açı konisi yerine bunu kullanmak şart: kalenin önündeyken koni
 * kalenin tamamından geniş kalıyor ve bot boş kaleyi ıskalıyordu.
 */
function rayHitsSegment(origin, dir, p0, p1) {
  const seg = sub(p1, p0);
  const denom = dir.x * seg.y - dir.y * seg.x;
  if (Math.abs(denom) < 1e-9) return null; // paralel

  const diff = sub(p0, origin);
  const t = (diff.x * seg.y - diff.y * seg.x) / denom; // ışın üzerindeki mesafe
  const s = (diff.x * dir.y - diff.y * dir.x) / denom; // parça üzerindeki oran

  if (t <= 0 || s < 0 || s > 1) return null;
  return { s, distance: t };
}

/**
 * Top, verilen hızla sönümlenerek toplam ne kadar yol alır?
 * Her tick hız `damping` ile çarpılıyor -> geometrik seri.
 *
 * Bu kontrol şart: vuruş topun mevcut hızını kısmen götürebiliyor ve ortaya
 * kaleye doğru ama oraya ULAŞAMAYAN cılız bir şut çıkabiliyor.
 */
function ballTravelDistance(speed, damping) {
  if (!(damping < 1)) return Infinity;
  return (speed * damping) / (1 - damping);
}

/**
 * Vuruştan sonra topun gideceği gerçek yön.
 * Haxball'da vuruş, topun MEVCUT hızına kickStrength kadar bir itki ekler;
 * yani hareket hâlindeki topa körü körüne kaleye doğru vurmak sapmaya yol
 * açar. Bileşke vektörü hesaplıyoruz.
 */
function resultingBallDirection(ballVel, kickDir, kickStrength) {
  const result = add(ballVel || { x: 0, y: 0 }, scale(kickDir, kickStrength));
  return normalize(result);
}

/**
 * Topun `u` yönüne gitmesi için hangi yönden vurmalıyız?
 * Topun hızının `u`ya dik bileşenini iptal edecek şekilde vuruş açısını kaydırır.
 */
function aimKickDirection(u, ballVel, kickStrength) {
  const vel = ballVel || { x: 0, y: 0 };
  const along = dot(vel, u);
  const perp = sub(vel, scale(u, along));
  const perpMag = len(perp);

  if (perpMag < 1e-6 || kickStrength <= 0) return u;

  // Dik bileşeni ne kadarını iptal edebiliriz (vuruş gücü sınırlı)
  const cancel = Math.min(perpMag / kickStrength, 0.95);
  const forward = Math.sqrt(Math.max(0, 1 - cancel * cancel));

  return normalize(add(scale(u, forward), scale(normalize(perp), -cancel)));
}

/** Kendi kalemiz -> rakip kale yönü (sahada "ileri" nedir). */
function upfieldOf(view) {
  return normalize(sub(mid(view.oppGoal.p0, view.oppGoal.p1), mid(view.ownGoal.p0, view.ownGoal.p1)));
}

/**
 * Bot kişilikleri: her bot biraz farklı ayarlarla başlasın diye küçük
 * sapmalar üretilir. Oranlar bilinçli olarak dar tutuldu (±%8-22).
 *
 * ⚠️ BURAYA `solveIntercept`in kullandığı hiçbir ayar EKLENMEMELİ
 * (accel, kickPadding, predictTicks, ballDamping). Sebebi: rol dağılımı
 * her botun aynı hesabı yapıp aynı sonuca varmasına dayanıyor. O ayarlar
 * botlar arasında farklılaşırsa kim hücumcu kim defans konusunda anlaşamaz
 * ve iki hücumcu / hiç defans gibi durumlar oluşur.
 */
const PERSONALITY_SPEC = {
  strikeImpactSpeed: 0.22, // atak mı temkinli mi (topa giriş hızı)
  strikeSpeed: 0.12,
  cruiseSpeed: 0.12,
  brakeEnter: 0.18, // erken mi geç mi frenler
  goalMargin: 0.35, // şut seçiciliği: kale ağzında ne kadar pay ister
  shootingRange: 0.15, // nereden şut denemeye başlar
  supportSpread: 0.18, // konumlanma genişliği
  defenderNear: 0.15, // savunmada kaleye ne kadar yapışır
  defenderFar: 0.12, // hücumda ne kadar yukarı çıkar
};

/** Küçük, deterministik PRNG (mulberry32). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bir tohumdan (seed) kişilik üretir. Aynı tohum -> aynı kişilik.
 * @returns {object} base üzerine yazılacak ayarlar
 */
function makePersonality(seed, base) {
  const cfg = { ...DEFAULTS, ...(base || {}) };
  const rnd = mulberry32(seed);
  const traits = {};

  for (const [key, frac] of Object.entries(PERSONALITY_SPEC)) {
    const value = cfg[key];
    if (!Number.isFinite(value)) continue;
    traits[key] = value * (1 + (rnd() * 2 - 1) * frac);
  }

  // Şut seçiciliği makul aralıkta kalsın (0 = direğe nişan, 0.45 = sadece orta)
  if (Number.isFinite(traits.goalMargin)) {
    traits.goalMargin = clamp(traits.goalMargin, 0.04, 0.3);
  }
  if (Number.isFinite(traits.defenderNear)) {
    traits.defenderNear = clamp(traits.defenderNear, 0.35, 0.6);
  }
  if (Number.isFinite(traits.defenderFar)) {
    traits.defenderFar = clamp(traits.defenderFar, 0.55, 0.8);
  }
  if (Number.isFinite(traits.defenderNear) && Number.isFinite(traits.defenderFar)) {
    traits.defenderFar = Math.max(traits.defenderFar, traits.defenderNear + 0.1);
  }

  // Vuruş temposu: ±1 tick
  const release = Math.round((cfg.releaseTicks || DEFAULTS.releaseTicks) + (rnd() < 0.5 ? -1 : 1));
  traits.releaseTicks = Math.max(1, release);

  return traits;
}

/** Kişiliği kısa, okunur bir etikete çevirir (log ve !bot durum için). */
function describePersonality(traits, base) {
  const cfg = { ...DEFAULTS, ...(base || {}) };
  const impact = traits.strikeImpactSpeed ?? cfg.strikeImpactSpeed;
  const ratio = impact / cfg.strikeImpactSpeed;

  const style = ratio > 1.08 ? 'atak' : ratio < 0.92 ? 'temkinli' : 'dengeli';
  const aim = (traits.goalMargin ?? cfg.goalMargin) > cfg.goalMargin ? 'seçici' : 'çabuk şut';

  return `${style}/${aim}`;
}

/**
 * Stadyumun playerPhysics değerlerinden brain ayarlarını üretir.
 * Böylece harita değişirse bot da otomatik uyum sağlar.
 */
function configFromPhysics(playerPhysics, extra) {
  const pp = playerPhysics || {};
  const cfg = { ...(extra || {}) };

  if (Number.isFinite(pp.acceleration)) cfg.accel = pp.acceleration;
  if (Number.isFinite(pp.kickingAcceleration)) cfg.kickAccel = pp.kickingAcceleration;
  if (Number.isFinite(pp.damping)) cfg.damping = pp.damping;
  if (Number.isFinite(pp.kickingDamping)) cfg.kickingDamping = pp.kickingDamping;
  if (Number.isFinite(pp.kickStrength)) cfg.kickStrength = pp.kickStrength;

  return cfg;
}

// --- Fizik hesapları -----------------------------------------------------

/**
 * Topun t tick sonraki konumu. Her tick hız `damping` ile çarpıldığı için
 * yol alınan mesafe geometrik seri: v * (1 - d^t) / (1 - d)
 */
function predictBall(ball, t, damping) {
  const speed = ball.speed || { x: 0, y: 0 };
  if (t <= 0) return { x: ball.pos.x, y: ball.pos.y };

  const d = damping;
  const factor = Math.abs(1 - d) < 1e-9 ? t : (1 - Math.pow(d, t)) / (1 - d);

  return {
    x: ball.pos.x + speed.x * factor,
    y: ball.pos.y + speed.y * factor,
  };
}

/**
 * Vuruş tuşunu basılı tutarak (fren) durana kadar alınacak yol.
 * Hız her tick kickingDamping ile çarpılır -> toplam yol = v*kd/(1-kd)
 */
function brakingDistance(speed, kickingDamping) {
  const kd = kickingDamping;
  if (kd >= 1) return Infinity;
  return (speed * kd) / (1 - kd);
}

/**
 * t tick içinde kat edilebilecek yaklaşık mesafe.
 * Sürtünme ~0 olduğu için basit kinematik yeterli: v*t + ½*a*t²
 */
function reachableDistance(t, speedTowards, accel) {
  return Math.max(0, speedTowards) * t + 0.5 * accel * t * t;
}

/**
 * Bir oyuncunun topa yetişebileceği en erken tick'i bulur.
 * Yetişemiyorsa mesafeye göre küçük bir ceza ekler; böylece roller
 * doygunlukta bile ayrışabilir.
 */
function solveIntercept(from, ball, cfg) {
  // Eksik ayarla çağrılırsa NaN yayılmasın diye varsayılanlara düş
  const num = (value, fallback) => (Number.isFinite(value) ? value : fallback);
  const accel = num(cfg.accel, DEFAULTS.accel);
  const padding = num(cfg.kickPadding, DEFAULTS.kickPadding);
  const ticksAhead = num(cfg.predictTicks, DEFAULTS.predictTicks);
  const damping = num(cfg.ballDamping, DEFAULTS.ballDamping);

  const reach = (from.radius || 15) + (ball.radius || 10) + padding;
  const vel = from.speed || { x: 0, y: 0 };

  for (let t = 0; t <= ticksAhead; t++) {
    const bp = predictBall(ball, t, damping);
    const toBall = sub(bp, from.pos);
    const dist = len(toBall);
    const speedTowards = dot(vel, normalize(toBall));

    if (reachableDistance(t, speedTowards, accel) + reach >= dist) {
      return { ticks: t, point: bp };
    }
  }

  const far = predictBall(ball, ticksAhead, damping);
  return {
    ticks: ticksAhead + 1 + len(sub(far, from.pos)) / 10000,
    point: far,
  };
}

// --- Nişan alma ----------------------------------------------------------

/**
 * Rakip kalede nişan alınacak noktayı seçer: kalecinin (kaleye en yakın
 * rakibin) uzak kaldığı direğe yönelir.
 */
function chooseAimPoint(view, cfg) {
  const goal = view.oppGoal;
  const center = mid(goal.p0, goal.p1);
  const distToGoal = len(sub(center, view.ball.pos));

  const toP1 = normalize(sub(goal.p1, goal.p0));
  const postA = add(goal.p0, scale(toP1, cfg.postInset));
  const postB = sub(goal.p1, scale(toP1, cfg.postInset));

  // Kaleye en yakın rakip = fiili kaleci
  let keeper = null;
  let bestDist = Infinity;
  for (const opp of view.opponents) {
    const d = len(sub(opp.pos, center));
    if (d < bestDist) {
      bestDist = d;
      keeper = opp;
    }
  }

  if (!keeper) return center;

  const openPost = len(sub(postA, keeper.pos)) > len(sub(postB, keeper.pos)) ? postA : postB;

  // Uzaktan direğe nişan almak isabetsizlik demek: uzakta kale ortasına,
  // yaklaştıkça kalecinin boş bıraktığı direğe doğru kaydır.
  const t = clamp(1 - distToGoal / cfg.preciseAimRange, 0, 1);
  return {
    x: center.x + (openPost.x - center.x) * t,
    y: center.y + (openPost.y - center.y) * t,
  };
}

/**
 * Kendi bölgemizdeysek topu kaleden uzaklaştırmak için açık bir kaçış
 * noktası seçer (kendi kalemize doğru vurmayı engeller).
 */
function chooseClearPoint(view) {
  const f = fieldOf(view);
  const upfield = upfieldOf(view);
  const side = view.ball.pos.y >= 0 ? 1 : -1;

  // Topu kendi kalemizden uzağa, ileri ve kanada doğru gönder
  return {
    x: clamp(view.ball.pos.x + upfield.x * (f.maxX - f.minX) * 0.35, f.minX, f.maxX),
    y: clamp(side * f.maxY * 0.7, f.minY, f.maxY),
  };
}

function opponentPressure(view, cfg) {
  let bestTicks = Infinity;
  let bestDistance = Infinity;

  for (const opponent of view.opponents || []) {
    const eta = solveIntercept(opponent, view.ball, cfg);
    if (eta.ticks < bestTicks) bestTicks = eta.ticks;
    const distance = len(sub(opponent.pos, view.ball.pos));
    if (distance < bestDistance) bestDistance = distance;
  }

  return {
    close: bestDistance <= cfg.pressureRange,
    soon: bestTicks <= cfg.pressuredOpponentTicks,
    ticks: bestTicks,
    distance: bestDistance,
  };
}

// --- Rol dağılımı --------------------------------------------------------

/**
 * Rol dağılımı. Tüm botlar aynı dünya durumunu gördüğü için hepsi aynı
 * sonuca varır (eşitlikte id'ye göre) - yani rol çakışması olmaz.
 *
 *   attacker : topa en hızlı ulaşan
 *   defender : hücumcu DIŞINDA kendi kalesine EN YAKIN olan (yalnızca 1 kişi)
 *   support  : geri kalanlar, yanal şeritlere dağıtılır
 *
 * Defans rolünün tek kişiye verilmesi şart: eskiden savunma hedefi sadece
 * top+kale konumundan hesaplandığı için bütün botlar aynı noktaya yığılıyordu.
 */
function assignRoles(view, cfg) {
  const mine = solveIntercept(view.self, view.ball, cfg);
  const squad = [view.self, ...view.teammates];

  // 1) Hücumcu: topa en erken ulaşan
  let attackerId = view.self.id;
  let bestTicks = mine.ticks;
  for (const mate of view.teammates) {
    const eta = solveIntercept(mate, view.ball, cfg);
    if (eta.ticks < bestTicks || (eta.ticks === bestTicks && mate.id < attackerId)) {
      bestTicks = eta.ticks;
      attackerId = mate.id;
    }
  }

  if (attackerId === view.self.id) {
    return { role: 'attacker', intercept: mine, slot: 0, supportIndex: -1, supportCount: 0 };
  }

  // 2) Defans: hücumcu dışındakiler arasında kendi kalesine en yakın olan
  const ownCenter = mid(view.ownGoal.p0, view.ownGoal.p1);
  const rest = squad.filter((p) => p.id !== attackerId);

  let defenderId = null;
  let bestDist = Infinity;
  for (const p of rest) {
    const d = len(sub(p.pos, ownCenter));
    if (d < bestDist || (d === bestDist && (defenderId === null || p.id < defenderId))) {
      bestDist = d;
      defenderId = p.id;
    }
  }

  if (defenderId === view.self.id) {
    return { role: 'defender', intercept: mine, slot: 0, supportIndex: -1, supportCount: 0 };
  }

  // 3) Destek: kalanları yanal şeritlere böl ki üst üste binmesinler
  const supports = rest.filter((p) => p.id !== defenderId).sort((a, b) => a.id - b.id);
  const index = supports.findIndex((p) => p.id === view.self.id);
  const count = supports.length;

  // Tek destekçi varsa topun ters kanadına açıl; birden fazlaysa simetrik şeritler
  const slot = count <= 1
    ? 0.75 * (view.ball.pos.y >= 0 ? -1 : 1)
    : index - (count - 1) / 2;

  return { role: 'support', intercept: mine, slot, supportIndex: index, supportCount: count };
}

/**
 * Defans: kale-top ekseninde dur ama topun konumuna göre yukarı/aşağı kay.
 *
 * Top kendi kalemize yakınken geri düşer (tehlike var), takım hücum ederken
 * orta sahaya kadar çıkar - böylece hem geri pas alabilir hem de kontratağa
 * karşı geride kalır.
 */
function defenderTarget(view, cfg) {
  const ownCenter = mid(view.ownGoal.p0, view.ownGoal.p1);
  const oppCenter = mid(view.oppGoal.p0, view.oppGoal.p1);
  const f = fieldOf(view);

  const toBall = sub(view.ball.pos, ownCenter);
  const pitchLength = len(sub(oppCenter, ownCenter)) || (f.maxX - f.minX);

  // 0 = top kendi kalemizde, 1 = top rakip kalede
  const ballDepth = clamp(dot(toBall, upfieldOf(view)) / pitchLength, 0, 1);

  // Top uzaklaştıkça daha ileri konumlan
  const ratio = clamp(
    cfg.defenderNear + (cfg.defenderFar - cfg.defenderNear) * ballDepth,
    0.35,
    0.8
  );

  return add(ownCenter, scale(toBall, ratio));
}

/**
 * Destek: topun hizasında ama yanal şeride açılmış dur.
 * `slot` her destekçiye farklı bir şerit verir (… -1, 0, +1 …), böylece
 * aynı noktaya yığılmazlar.
 */
function supportTarget(view, cfg, roleInfo) {
  const ownCenter = mid(view.ownGoal.p0, view.ownGoal.p1);
  const oppCenter = mid(view.oppGoal.p0, view.oppGoal.p1);
  const upfield = upfieldOf(view);
  const f = fieldOf(view);
  const slot = roleInfo.slot || 0;
  const index = roleInfo.supportIndex || 0;
  const count = roleInfo.supportCount || 1;

  const pitchLength = len(sub(oppCenter, ownCenter)) || (f.maxX - f.minX);
  const ballDepth = dot(sub(view.ball.pos, ownCenter), upfield) / pitchLength;

  let along;
  let lateral = slot * cfg.supportSpread;

  if (ballDepth < 0.45) {
    along = -cfg.supportBehind;
  } else if (count <= 1) {
    along = -cfg.supportBehind * 0.7;
  } else if (index === 0) {
    along = -cfg.supportBehind * 0.85;
  } else {
    along = cfg.supportBehind * 0.45;
    lateral += (view.ball.pos.y >= 0 ? -1 : 1) * cfg.supportSpread * 0.35;
  }

  return {
    x: clamp(view.ball.pos.x + upfield.x * along, f.minX * 0.95, f.maxX * 0.95),
    y: clamp(view.ball.pos.y + lateral, f.minY * 0.85, f.maxY * 0.85),
  };
}

function applyTeamSpacing(view, target, cfg, role) {
  if (role === 'attacker') return target;

  const f = fieldOf(view);
  const upfield = upfieldOf(view);
  const perp = normalize({ x: -upfield.y, y: upfield.x });
  let adjusted = { ...target };

  for (const mate of view.teammates || []) {
    const diff = sub(adjusted, mate.pos);
    const distance = len(diff);
    if (distance >= cfg.teamSpacing || distance < 1e-6) continue;

    const away = normalize(diff);
    const side = dot(away, perp) >= 0 ? 1 : -1;
    const strength = (1 - distance / cfg.teamSpacing) * cfg.teamSpacingPush;
    adjusted = add(adjusted, add(scale(away, strength), scale(perp, side * strength * 0.45)));
  }

  return {
    x: clamp(adjusted.x, f.minX * 0.95, f.maxX * 0.95),
    y: clamp(adjusted.y, f.minY * 0.85, f.maxY * 0.85),
  };
}

function avoidOwnGoalCarryTarget(view, cfg, ballToAim, upfield) {
  const f = fieldOf(view);
  const standOff = (view.self.radius || 15) + (view.ball.radius || 10) + cfg.kickPadding;
  const perp = normalize({ x: -upfield.y, y: upfield.x });
  const selfFromBall = sub(view.self.pos, view.ball.pos);
  const side = dot(selfFromBall, perp) >= 0 ? 1 : -1;

  const setup = sub(view.ball.pos, scale(ballToAim, standOff * 1.25));
  const sideStep = scale(perp, side * cfg.ownGoalCarrySideStep);

  return {
    x: clamp(setup.x + sideStep.x, f.minX * 0.95, f.maxX * 0.95),
    y: clamp(setup.y + sideStep.y, f.minY * 0.85, f.maxY * 0.85),
  };
}

function botOnlyNudgeTarget(view, target, cfg, memory) {
  if (!view.botOnly) {
    memory.botOnlyFlatTicks = 0;
    memory.botOnlyNudgeSide = 0;
    return target;
  }

  const ballSpeed = len(view.ball.speed || { x: 0, y: 0 });
  const flatBall = Math.abs((view.ball.speed || {}).y || 0) < 0.08;
  const flatSelf = Math.abs((view.self.speed || {}).y || 0) < 0.08;
  const flatTarget = Math.abs(target.y - view.self.pos.y) < 12;
  const ballNearMiddle = Math.abs(view.ball.pos.y) < (fieldOf(view).maxY || 750) * 0.35;

  if (ballSpeed < 1.2 && flatBall && flatSelf && flatTarget && ballNearMiddle) {
    memory.botOnlyFlatTicks = (memory.botOnlyFlatTicks || 0) + 1;
  } else {
    memory.botOnlyFlatTicks = 0;
  }

  if (memory.botOnlyFlatTicks < cfg.botOnlyStuckTicks) return target;

  if (!memory.botOnlyNudgeSide) {
    memory.botOnlyNudgeSide = view.self.id % 2 === 0 ? 1 : -1;
  }

  const f = fieldOf(view);
  return {
    x: target.x,
    y: clamp(target.y + memory.botOnlyNudgeSide * cfg.botOnlyNudge, f.minY * 0.85, f.maxY * 0.85),
  };
}

function overlapRecoveryTarget(view, cfg, ballToAim, memory) {
  const selfRadius = view.self.radius || 15;
  const ballRadius = view.ball.radius || 10;
  const standOff = selfRadius + ballRadius + cfg.kickPadding + 4;
  const lateral = normalize({ x: -ballToAim.y, y: ballToAim.x });
  const sideSign = dot(sub(view.self.pos, view.ball.pos), lateral) >= 0 ? 1 : -1;
  const raw = add(
    sub(view.ball.pos, scale(ballToAim, standOff)),
    scale(lateral, sideSign * cfg.overlapRecoverySideStep)
  );
  const f = fieldOf(view);
  memory.overlapRecoveryTicks = cfg.overlapRecoveryTicks;

  return {
    x: clamp(raw.x, f.minX * 0.95, f.maxX * 0.95),
    y: clamp(raw.y, f.minY * 0.85, f.maxY * 0.85),
  };
}

// --- Sürüş kontrolü ------------------------------------------------------

/**
 * Hız eşleme: hedefe ulaşmak için istenen hız vektörünü hesaplar, mevcut
 * hızdan farkını alır ve o yöne basar. Fark büyük ölçüde mevcut hıza TERSSE
 * fren (vuruş tuşu) gerekir - bu haritada tek yavaşlama yolu o.
 *
 * @returns {{dirX:number, dirY:number, brake:boolean}}
 */
function navigate(self, target, cfg, memory = {}, opts = {}) {
  const toTarget = sub(target, self.pos);
  const dist = len(toTarget);
  const dir = normalize(toTarget);
  const vel = self.speed || { x: 0, y: 0 };
  const speed = len(vel);

  // Kalan mesafede frenle atılabilecek hız payı.
  const kd = cfg.kickingDamping;
  const shedable = kd >= 1 ? cfg.cruiseSpeed : (dist * (1 - kd)) / (kd * cfg.brakeMargin);

  // "strike" = topa gidiyoruz. Hedefte durmak istemiyoruz ama kontrolü de
  // bırakmak istemiyoruz: varış hızı strikeImpactSpeed olacak şekilde planla.
  // Böylece uzakta hızlanır, yaklaşırken fazlalığı frenleyip topa kontrollü
  // bir hızla girer.
  const desiredSpeed = opts.strike
    ? Math.min(cfg.strikeSpeed, cfg.strikeImpactSpeed + shedable)
    : Math.min(cfg.cruiseSpeed, shedable);

  const desiredVel = scale(dir, desiredSpeed);
  const deltaV = sub(desiredVel, vel);

  // "shed" = atmamız gereken hız miktarı. Pozitifse yavaşlamamız gerekiyor:
  // ya hedefe fazla hızlı gidiyoruz ya da tamamen ters yöne savruluyoruz.
  const shed = speed > 1e-6 ? -dot(deltaV, normalize(vel)) : 0;

  // Histerezis: basmak için brakeEnter, bırakmak için brakeExit eşiği.
  let brake = false;
  if (speed > cfg.minBrakeSpeed) {
    brake = memory.braking ? shed > cfg.brakeExit : shed > cfg.brakeEnter;
  }

  // Asgari basılı tutma: kısa dalgalanmalarda tuş titremesin, fren gerçekten
  // işini yapsın (sönümleme ancak basılıyken uygulanıyor).
  if (brake) {
    memory.brakeHold = cfg.brakeMinTicks;
  } else if (memory.brakeHold > 0) {
    memory.brakeHold--;
    brake = true;
  }

  memory.braking = brake;

  const dirX = Math.abs(deltaV.x) < cfg.steerDeadzone ? 0 : Math.sign(deltaV.x);
  const dirY = Math.abs(deltaV.y) < cfg.steerDeadzone ? 0 : Math.sign(deltaV.y);

  return { dirX, dirY, brake };
}

// --- Ana karar -----------------------------------------------------------

/**
 * @param {object} view   Oyun durumunun sadeleştirilmiş görünümü
 * @param {object} memory Tickler arası hafıza (vuruş tuşu döngüsü için)
 * @param {object} config DEFAULTS üzerine yazılacak ayarlar
 * @returns {{dirX:number, dirY:number, kick:boolean, intentKick:boolean, role:string, braking:boolean}}
 */
function decide(view, memory, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) };
  const idle = { dirX: 0, dirY: 0, kick: false, intentKick: false, role: 'idle', braking: false };

  if (!view || !view.self || !view.ball) return idle;
  if (!isFinitePoint(view.self.pos) || !isFinitePoint(view.ball.pos)) return idle;
  if (!view.ownGoal || !view.oppGoal) return idle;

  const ballDamping = Number.isFinite(view.ball.damping) ? view.ball.damping : cfg.ballDamping;
  const activeCfg = { ...cfg, ballDamping };

  // Rol dağılımı KİŞİLİKTEN ETKİLENMEMELİ: tüm botlar bu dört değeri aynı
  // kullanır, böylece hepsi aynı hücumcu/defans sonucuna varır.
  const roleCfg = {
    accel: activeCfg.accel,
    kickPadding: activeCfg.kickPadding,
    predictTicks: activeCfg.predictTicks,
    ballDamping: activeCfg.ballDamping,
  };

  const roleInfo = assignRoles(view, roleCfg);
  const { role, intercept } = roleInfo;

  const ownCenter = mid(view.ownGoal.p0, view.ownGoal.p1);
  const oppCenter = mid(view.oppGoal.p0, view.oppGoal.p1);
  const upfield = upfieldOf(view);
  const field = fieldOf(view);

  // Sahadaki konumu gerçek saha uzunluğuna göre ölç (kamera ölçüsüne göre değil)
  const pitchLength = len(sub(oppCenter, ownCenter)) || (field.maxX - field.minX);
  const ballDepth = dot(sub(view.ball.pos, ownCenter), upfield) / pitchLength;
  const inOwnThird = ballDepth < activeCfg.clearThird;
  const pressure = opponentPressure(view, activeCfg);
  const shouldClear = inOwnThird || (ballDepth < 0.55 && (pressure.close || pressure.soon));

  const aim = shouldClear ? chooseClearPoint(view) : chooseAimPoint(view, activeCfg);
  const toAim = normalize(sub(aim, view.ball.pos));

  // Topun mevcut hızını hesaba katarak hangi yönden vurmamız gerektiğini bul.
  // Konumlanmayı da buna göre yapıyoruz ki hareketli topu doğru yere gönderelim.
  const ballToAim = aimKickDirection(toAim, view.ball.speed, activeCfg.kickStrength);

  let target;
  if (role === 'attacker') {
    // Topun arkasına geç: vuruş yönü hedefe baksın
    const standOff = (view.self.radius || 15) + (view.ball.radius || 10);
    target = sub(intercept.point, scale(ballToAim, standOff * 0.95));
  } else if (role === 'defender') {
    target = defenderTarget(view, activeCfg);
  } else {
    target = supportTarget(view, activeCfg, roleInfo);
  }

  target = applyTeamSpacing(view, target, activeCfg, role);
  target = botOnlyNudgeTarget(view, target, activeCfg, memory);

  // --- Vuruş kararı ---
  const toBall = sub(view.ball.pos, view.self.pos);
  const distToBall = len(toBall);
  const kickRange = (view.self.radius || 15) + (view.ball.radius || 10) + activeCfg.kickPadding;
  const kickEngageRange = kickRange + activeCfg.kickAttemptPadding;
  const inKickRange = distToBall <= kickRange;
  const inKickEngageRange = distToBall <= kickEngageRange;

  // Şimdi vurursak top hangi yöne gider? (vuruş yönü + topun mevcut hızı)
  const kickDir = normalize(toBall);
  const shotDir = resultingBallDirection(view.ball.speed, kickDir, activeCfg.kickStrength);
  const forwardness = dot(shotDir, upfield); // gerçek gidiş yönü ileriye mi

  // Şut bölgesi: top kaleye yakın OLMAKLA kalmayıp, vuruşun kaleye
  // ULAŞABİLECEĞİ kadar da yakın olmalı. Haxball'da vuruş gücü sabit ve top
  // sönümlendiği için şut ~495 birimde ölüyor; sabit bir "şut menzili"
  // kullanınca bot ulaşamayacağı mesafeden isabet arayıp hiç vurmuyordu.
  const distBallToOppGoal = len(sub(oppCenter, view.ball.pos));
  const speedTowardGoal = Math.max(0, dot(view.ball.speed || { x: 0, y: 0 }, toAim));
  const bestReach = ballTravelDistance(activeCfg.kickStrength + speedTowardGoal, ballDamping);
  const goalReachable = bestReach >= distBallToOppGoal * 1.1;

  const inShootingRange = distBallToOppGoal <= activeCfg.shootingRange && goalReachable;

  // Kendi kalemize doğru vuruş her koşulda yasak.
  const safeDirection = forwardness > activeCfg.ownGoalGuard;

  const carryForwardness = dot(normalize(toBall), upfield);
  const ownGoalCarryDanger = role === 'attacker'
    && distToBall <= activeCfg.ownGoalCarryRange
    && carryForwardness <= activeCfg.ownGoalGuard;

  if (ownGoalCarryDanger) {
    target = avoidOwnGoalCarryTarget(view, activeCfg, ballToAim, upfield);
  }

  const overlapDistance = (view.self.radius || 15)
    + (view.ball.radius || 10)
    + activeCfg.overlapRecoveryRange;
  const closeOverlap = role === 'attacker'
    && distToBall <= overlapDistance
    && dot(normalize(toBall), ballToAim) < 0.15;

  if (!ownGoalCarryDanger && (closeOverlap || memory.overlapRecoveryTicks > 0)) {
    if (memory.overlapRecoveryTicks > 0) memory.overlapRecoveryTicks--;
    target = overlapRecoveryTarget(view, activeCfg, ballToAim, memory);
  }

  // Hücumcuysak topa hızla dalıyoruz; destekçiysek pozisyonda durmak istiyoruz.
  const nav = navigate(view.self, target, activeCfg, memory, { strike: role === 'attacker' });

  // Şut bölgesinde: top gerçekten kale ağzına gidiyor mu VE oraya ulaşıyor mu?
  // (sabit açı konisi yerine ışın-kale kesişimi; boş kale ıskalamasın)
  let onTarget = false;
  if (inShootingRange) {
    const hit = rayHitsSegment(view.ball.pos, shotDir, view.oppGoal.p0, view.oppGoal.p1);
    const margin = clamp(activeCfg.goalMargin, 0, 0.45);

    if (hit && hit.s >= margin && hit.s <= 1 - margin) {
      // Vuruş sonrası hız, topu kale çizgisine kadar taşıyabiliyor mu?
      const resultSpeed = len(add(view.ball.speed || { x: 0, y: 0 }, scale(kickDir, activeCfg.kickStrength)));
      const reach = ballTravelDistance(resultSpeed, ballDamping);
      onTarget = reach >= hit.distance * 1.1; // %10 emniyet payı
    }
  }

  // Kaleye yakınsak isabet şartı ara; uzaktaysak topa vur ve ileri gönder.
  const forwardTouch = forwardness >= activeCfg.clearConeCos;
  const pressuredTouch = pressure.close || pressure.soon;
  const wantKick = inKickEngageRange && safeDirection && !ownGoalCarryDanger && (
    inShootingRange ? (onTarget || (forwardTouch && (pressuredTouch || inKickRange))) : forwardTouch
  );

  const nearKickRange = distToBall <= kickEngageRange + activeCfg.preKickReleaseMargin;
  const likelyKickSoon = role === 'attacker' && nearKickRange && safeDirection && (
    inShootingRange ? true : forwardness >= activeCfg.clearConeCos
  );

  if (!inKickRange && likelyKickSoon && (nav.brake || memory.lastKeyDown)) {
    memory.preKickReleaseTicks = Math.max(
      memory.preKickReleaseTicks || 0,
      activeCfg.preKickReleaseTicks
    );
  }

  // Haxball'da tuşu basılı tutmak tek vuruş yapar; tekrar vurmak için önce
  // BIRAKMAK gerekir. Fren de aynı tuşu kullandığı için, frenden çıkıp topa
  // vuracaksak arada mutlaka bir tick tuşu bırakmalıyız; yoksa şut kaydolmaz.
  let shot = false;
  let releasingForKick = false;
  if (wantKick) {
    if (memory.kickHoldTicks > 0) {
      memory.kickHoldTicks--;
      shot = true;
    } else if (memory.preKickReleaseTicks > 0) {
      memory.preKickReleaseTicks--;
      releasingForKick = true;
    } else if (memory.kickCooldown > 0) {
      memory.kickCooldown--;
    } else if (memory.lastKeyDown) {
      // Tuş (büyük ihtimalle fren yüzünden) zaten basılıydı: bu tick bırak.
      releasingForKick = true;
    } else {
      shot = true;
      memory.kickHoldTicks = activeCfg.kickHoldTicks;
      memory.kickCooldown = activeCfg.releaseTicks;
    }
  } else {
    memory.kickCooldown = 0;
    memory.kickHoldTicks = 0;
    if (memory.preKickReleaseTicks > 0) {
      memory.preKickReleaseTicks--;
      releasingForKick = true;
    }
  }

  // Top vuruş menzilindeyken frenlemek istemsiz bir dokunuşa yol açar;
  // bu yüzden menzil içinde frene izin vermiyoruz.
  const braking = nav.brake && !inKickRange && !releasingForKick;
  const keyDown = shot || braking;
  memory.lastKeyDown = keyDown;

  return {
    dirX: nav.dirX,
    dirY: nav.dirY,
    kick: keyDown,
    intentKick: wantKick,
    role,
    braking,
  };
}

module.exports = {
  decide,
  makePersonality,
  describePersonality,
  PERSONALITY_SPEC,
  DEFAULTS,
  predictBall,
  solveIntercept,
  brakingDistance,
  reachableDistance,
  navigate,
  configFromPhysics,
};
