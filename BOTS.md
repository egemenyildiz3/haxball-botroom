# Spacebounce Bot System

AI players that join the room on command and actually play — reading the live
physics state every tick and pressing keys like a human client would.

This document explains what was built, **why** each decision was made (most of
them were forced by measurements, not preference), and which knobs to turn.

---

## 1. Quick start

```bash
make rebuild          # build + restart the container
```

Then, as an admin, in room chat or the server console:

| Command | Effect |
|---|---|
| `!bot aç [adet]` | Add bot(s) to the pitch. Repeatable; caps at `HAXBALL_BOT_MAX` (default 4) |
| `!bot kapat` | Remove the latest active bot |
| `!bot hepsi` | Remove all bots |
| `!bot durum` | List active bots and their personalities |
| `!oto kapat` | Disable auto team assignment, auto match start, post-match rotation |
| `!oto aç` | Re-enable it |
| `!oto durum` | Show current mode |

`!oto` is a **manual-control mode** for running organised matches. Scores are
still recorded while it's off — only team manipulation stops. It automatically
resets to **on** if the room is left with no admin or super-admin, so the room
can't get stuck in manual mode after an admin leaves.

---

## 2. Architecture, and why it looks like this

### 2.1 The first attempt failed

The obvious design is a second process that joins the room over the network as
a normal client. That was built, and it worked right up to the last step:

```
[SpaceBot] [BOT] connecting: oda e9Zkn3Hkhng
🤖 [BOT] SpaceBot bağlantısı kapandı: FailedHost (kod 8)
```

The bot reached Haxball's master server, got the room's address, then failed to
open a WebRTC connection **back to the host running on the same machine**. This
is NAT hairpinning: the client resolves the host's public IP and the router
won't loop that traffic back inside. A headless browser would have hit exactly
the same wall — the blocker is the network path, not the client implementation.

### 2.2 The fix: in-memory players

`node-haxball` supports creating bot players *inside* the host process, and
documents this as the preferred approach:

> intended to be used in host mode to create/control in-memory bot players that
> will run much more efficiently than standard networking bot players

Bots are now fake players injected via `fakePlayerJoin`, driven each physics
tick with `fakeSendPlayerInput`. **No network connection, no NAT, no auth, no
room ID, no child processes** — and far less CPU.

### 2.3 The cost: the room engine changed

Fake players only exist in `node-haxball`'s host mode, so the room is no longer
hosted by `haxball.js`. `scripts/bot/hostRoom.js` uses `node-haxball`'s
`headlessWrapper`, which exposes an **identical `HBInit` interface**, so
`room.js` and `commands.js` run unchanged.

One wrinkle: the wrapper exposes the underlying room as `nhInstance`, but
assigns it *before* `onOpen` fires, so it is always `null`. `hostRoom.js` works
around this by briefly wrapping `Room.create` to capture the real room object.

### 2.4 Files

| File | Role |
|---|---|
| `scripts/bot/brain.js` | **Pure** decision logic. No I/O, no game API — takes a world snapshot, returns `{dirX, dirY, kick}`. This is why it's testable offline. |
| `scripts/bot/manager.js` | Spawns/removes fake players, builds the world snapshot from the raw room, drives the tick loop |
| `scripts/bot/hostRoom.js` | Creates the room via `node-haxball` while keeping the headless interface |
| `scripts/bot/client.js` | The original networked client. **Unused** — kept because it would work for a bot connecting to a *remote* host |

---

## 3. The map physics changed everything

Spacebounce is not a normal Haxball map. From `maps/Spacebounce.hbs`:

| Property | Spacebounce | Default | Consequence |
|---|---|---|---|
| `damping` | **0.9995** | 0.96 | Effectively frictionless — you glide forever |
| `kickingDamping` | **0.985** | 0.96 | Holding kick is a **brake** |
| `acceleration` | 0.028 | 0.1 | Very weak thrust |
| `kickingAcceleration` | 0.0195 | 0.07 | Weaker thrust while braking |
| `bCoef` | 1.5 | 0.5 | Walls throw you back *harder* |

Two numbers that drive most of the design:

- **Terminal speed is `0.028 / 0.0005 ≈ 56`** coasting, versus `≈1.3` while
  holding kick. Coasting at speed 5, the stopping distance is **~10,000 units**
  on a pitch only 2,600 wide. Braking is not optional.
- **A shot travels at most `5 × 0.99 / 0.01 ≈ 495 units`** (`kickStrength` and
  ball damping). Long-range shooting is physically impossible.

All of this is read from the live stadium at runtime via `configFromPhysics()`,
so **swapping maps re-tunes the bot automatically**.

### A trap worth remembering

`stadium.width/height` reports **1500×1000**, but the real pitch from its
vertices is **2600×1500**. Those fields are the *camera*, not the field. The
bot was originally judging "own third", clearing direction and support
positions against a field 40% too small — which read as "it doesn't know where
the goals are". Bounds are now derived from stadium vertices.

---

## 4. Driving: velocity matching + brake hysteresis

Because friction is ~0, "press toward the target" overshoots wildly. Instead
the bot computes a **desired velocity**, subtracts current velocity, and steers
along the difference. When that correction points *against* current motion, it
holds kick to scrub speed.

### 4.1 Brake must be held, not tapped

The first version used a single threshold, and the brake chattered — as braking
bled off speed the required correction flipped sign and released the key:

```
önce:  ...##################.##.################.#######......   36 toggles
sonra: ...#############................................          2 toggles
```

Fixed with **hysteresis** (separate engage/release thresholds, `brakeEnter` /
`brakeExit`) plus a minimum hold (`brakeMinTicks`). Holding is also *more
effective*: total brake ticks dropped **166 → 53** for the same approach,
because a continuous hold applies the full `0.985` damping instead of averaging
it with `0.9995` during the gaps.

### 4.2 Brake and shot share one key

Haxball only kicks on a **fresh press**. Braking right up to the ball left the
key already down, so the shot silently wouldn't register. `decide()` tracks
`memory.lastKeyDown` and forces a one-tick release before any shot. Braking is
also suppressed inside kick range, so it can't cause an accidental touch.

### 4.3 Approach speed: the aggression dial

Chasing the ball uses **strike mode** — it doesn't try to stop *on* the ball, it
plans to arrive at a controlled speed:

```js
desiredSpeed = min(strikeSpeed, strikeImpactSpeed + shedable)
```

Measured over a 600-unit approach:

| `strikeImpactSpeed` | arrival speed | overshoot | approach brake toggles |
|---|---|---|---|
| 0 | 1.06 | 29 | 0 |
| **2** ← current | **3.47** | **103** | **0** |
| 5.5 | 5.45 | 227 | 0 |

`0` was the original crawl; `∞` never braked and was reckless. `2` sits between
them. Strike mode reaches the ball in 205 ticks against a **theoretical floor of
207** — approach speed is now physics-limited, not logic-limited.

---

## 5. Shooting

### 5.1 The cone was the bug

Shot alignment used a fixed cone (`shotConeCos: 0.7` ≈ 45°). From point-blank
range that cone is **wider than the goal**, so the bot fired at empty space and
missed open nets.

Replaced with an exact **ray vs goal-mouth intersection**: does the ball's path
actually cross the goal line between the posts, with a safety margin
(`goalMargin`)?

### 5.2 Momentum compensation

A kick *adds* an impulse to the ball's existing velocity. Kicking straight at
goal while the ball rolls sideways sends it wide. The bot computes the resultant
vector and positions itself to kick at an angle that cancels the drift.

### 5.3 Reach check

Caught by a test: a shot can be aimed perfectly and still **die before arriving**
— the kick partly cancels the ball's momentum, leaving it travelling 196 units
toward a goal 200 away. Reach is now checked with the damping series
`v·d/(1−d)` before committing.

### 5.4 Result

| distance to goal | mode | kicks | goals | misses |
|---|---|---|---|---|
| 50 | SHOOT | 23 | 23 | 0 |
| 100 | SHOOT | 15 | 15 | 0 |
| 200–400 | SHOOT | 19 | 19 | 0 |
| 500–900 | ADVANCE | 124 | – | – (all move ball forward) |

**57 shots in the shooting zone, 57 goals, 0 misses.**

### 5.5 The shooting zone is derived, not configured

`shootingRange` was hardcoded at 900, but shots die at ~495. That created a
**dead band**: between 450–900 the bot considered itself in shooting range,
demanded accuracy it could never achieve, and therefore *never kicked at all*.
The zone is now gated by real reachability; outside it the bot drives the ball
forward instead.

**Consequence:** the bot only shoots from within ~450 units. That's correct
Haxball play — you must work the ball close to score.

---

## 6. Roles

Every bot computes the **same** assignment from the same world state (ties
broken by player id), so they never disagree.

| Role | Count | Behaviour |
|---|---|---|
| `attacker` | 1 | Lowest intercept ETA. Drives at the ball in strike mode |
| `defender` | 1 | Closest to own goal *excluding the attacker* |
| `support` | rest | Spread into symmetric lateral lanes |

### 6.1 Why exactly one defender

The defensive target was originally computed from ball and goal position only,
so **every** non-attacker produced the identical coordinate and they stacked on
one pixel. Only the single player closest to own goal now defends.

Human teammates count — if a human is already deeper than any bot, no bot takes
the role.

### 6.2 The defender is not a goalkeeper

The old formula was a flat 35% of the goal→ball distance regardless of
situation. It now slides with ball depth:

```js
ratio = defenderNear + (defenderFar - defenderNear) * ballDepth
```

| ball x | old | new |
|---|---|---|
| −600 (defending) | −990 | **−893** |
| +800 (attacking) | −500 | **+117** |
| +1000 | −430 | **+294** |

Deeper when threatened, but no longer parked on the goal line. When the team
attacks, the defender steps into midfield as a safety valve instead of playing
as a dedicated keeper.

---

## 7. Personalities

Each bot draws a seed at spawn and derives slightly different settings:

| Trait | Variance | Effect |
|---|---|---|
| `strikeImpactSpeed` | ±22% | commitment into the ball |
| `brakeEnter` | ±18% | brakes early vs late |
| `supportSpread` | ±18% | positioning width |
| `defenderNear` / `defenderFar` | ±15% / ±12% | defensive discipline |
| `shootingRange` | ±15% | when it starts trying |
| `goalMargin` | ±35% | picky vs quick to shoot |
| `cruiseSpeed` / `strikeSpeed` | ±12% | general pace |
| `releaseTicks` | ±1 tick | kick cadence |

Values are clamped so no draw produces a broken bot. The seed is logged, and
`makePersonality(seed, base)` is deterministic — so a bot that plays unusually
well or badly can be reproduced exactly.

### ⚠️ The invariant that must not break

Role assignment relies on every bot computing the **same** answer. It runs
`solveIntercept` over the whole squad, which reads `accel`, `kickPadding`,
`predictTicks` and `ballDamping`. **If personality varied any of those, bots
would disagree about who attacks** — producing two attackers or none, and
reintroducing the clustering bug.

Those four are excluded from `PERSONALITY_SPEC`, and the guarantee is made
structural: `decide()` builds an explicit canonical `roleCfg` and passes *that*
to `assignRoles()`. Adding a risky key to the spec later still can't break it.

Verified over 120 randomised trials: always exactly one attacker, one defender.

---

## 8. Tuning

All in `scripts/bot/brain.js` → `DEFAULTS`.

| Knob | Default | Raise it to… |
|---|---|---|
| `strikeImpactSpeed` | 2 | Hit the ball harder / more recklessly (5.5 was too wild) |
| `brakeEnter` | 1.2 | Brake later and more aggressively |
| `goalMargin` | 0.12 | Only shoot into the middle of the goal (pickier) |
| `defenderNear` | 0.45 | Drop the defender deeper when the ball is near own goal |
| `defenderFar` | 0.7 | Push the defender further up when attacking (max 0.8) |
| `supportSpread` | 220 | Widen the gap between supporting bots |
| `cruiseSpeed` | 10 | Move faster when positioning |

Env overrides: `HAXBALL_BOT_NAME`, `HAXBALL_BOT_MAX`, `HAXBALL_BOT_AVATAR`.

---

## 9. How this was tested

`brain.js` is a pure function, which made real verification possible without a
live room:

- **Closed-loop physics simulation** — steps the *actual* map physics
  (`v = (v + a·dir)·d`) and asserts on outcomes: does it arrive and stop, does
  the shot enter the goal, does the brake chatter.
- **Mock room integration** — a fake room object exercises `createRoom`,
  join/leave handling, the `!bot` and `!oto` commands, and the admin-reset path.
- **Invariant tests** — 120 randomised squads confirming role assignment never
  degenerates.

Roughly 100 checks across brain, physics/braking, aiming/shooting, roles,
personalities, in-memory bot plumbing, and command behaviour.

**Not verified:** live play against real humans. Everything above is simulation
and mocks.

---

## 10. Known limits and next steps

- **No passing.** The bot always shoots or advances; it never plays a teammate in.
- **No dedicated goalkeeper.** The defender tracks the ball rather than holding a line.
- **No wall-bounce shots.** `bCoef 1.5` makes bank shots unusually strong here.
- **No difficulty levels.** For a public room, a beatable bot is arguably a better
  product; `strikeSpeed` and reaction timing would be the throttles.
- **No kickoff handling.**

### Would a trained RL agent be better?

**On score: probably yes, eventually.** This map — momentum management, bouncy
walls, strike timing — is exactly where hand-tuned heuristics struggle. The
precedent is Rocket League, where self-play bots reached top-human level.

**On efficiency: it's a wash.** A small policy network is microseconds per tick.

**The blocker is the simulator.** RL needs 10⁸–10¹⁰ steps, which means porting
the physics into a vectorised environment — a multi-week project. And you'd lose
two things this system has for free: **map portability** (the heuristic re-tunes
itself from `playerPhysics`) and **debuggability** ("it brakes too early" is a
one-line change here; with RL it's reward engineering and a retrain).

**Recommendation:** not worth it for a public room. If ever attempted, the sane
split is hybrid — keep heuristics for roles, positioning and safety rules
(never own-goal), and train only the low-level "reach the ball and strike it"
controller.
