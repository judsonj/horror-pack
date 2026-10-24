// The safety score: "power = safety", made gradual. Everything players do moves it a little; light moves it most.
// Plain KubeJS, no Survivors code. With the Survivors mod loaded its director still decides WHEN a scare is tried;
// this script then decides whether the place the player is in turns it away (same spawn event the director and
// rail/Shelter use, so they compose: any of them can cancel).
//
// Score 0..100 per player, rescanned every SAF_SCAN_TICKS (one player per tick, so 8 players never land on one tick):
//   base 20
//   + block light at the feet x3 (max 45)     plain light (torch, lantern) counts a third on a Lights Out night
//   + powered light within 5 blocks  +15       lit redstone lamp / copper bulb, any Contraption Lights lamp
//   + lit campfire within 5           +5
//   + turning Create parts nearby     +2 each, max +8   (someone keeps this place alive)
//   + another player within 12       +10;  nobody within 48: -10
//   + a survivor within 12            +5
//   + a train carriage within 16     +15        (lit or not; Contraption Lights makes it light the track too)
//   + an active refuge within 24     +20;  inside a Sunbreaker's day: +40
//   - night under open sky            -10;  underground: -5
//   - carrying 28+ stacks             -5
//   - noise / 2                                noise: gunfire +6, cannons/rockets/shells +20, explosions +15,
//                                              8+ turning machines +2 per scan, the Last Whistle +40; decays 4 per scan
// What it does: a general horror trying to join within 48 blocks of a player is turned away with chance
// (score - 40) / 50, capped at 90 %. Refuges, Sunbreaker days and trains turn away everything near them (infection too).
// Loud players at night (noise 70+) can draw a sound hunter: /director force scp_headline (or cave_dweller underground),
// at most once per 30 minutes per player.
//
// Refuges: stand within 6 blocks of a turning Create part with a lit light source within 6 and the spot becomes a
// refuge (64+ blocks from any other): a waypoint, a note and a small supply. It stays active while it turns and is lit.
// Lights Out: from overworld day SAF_LIGHTS_OUT_FROM, each night has a 1 in 4 chance. Torches gutter (darkness pulses
// for players standing only in plain light) and plain light counts for a third. Powered light holds.
//
// Commands: /safety (your own score, line by line). Ops: /hpworld status | lightsout on|off | probe <x y z> |
// refuges | refuge_here | noise <n> (the batch test in build/tools/bench/features_check.py uses these).
// State: server.persistentData hp_refuges (JSON list), hp_lightsout_day, hp_zones (Sunbreaker days, JSON list).

const SAF_SCAN_TICKS = 100
const SAF_LIGHTS_OUT_FROM = 12
const SAF_HORROR_NS = ['weeping_angels:', 'cave_dweller:', 'kenny:', 'the_knocker:', 'the_boy_and_the_bath:', 'thewatcher:',
  'arphex:', 'scp_ultimate:', 'the_backwoods:', 'the_obsessed:', 'the_ravenous:']
const SAF_HORROR_SKIP = [/^scp_ultimate:(class_d|scp_guard|scp_scientist.*|rat.*|scp_999|scp_529|scp_131.*|scp_111.*)$/,
  /^arphex:(ai_.*|.*spawner.*|.*clone.*|.*controller.*)$/, /^the_ravenous:rav_scream$/]
const SAF_INFECTION_NS = ['spore:', 'sporeinquisition:', 'inqui:', 'infnexus:']
const SAF_LOUD_SMALL = /^superbwarfare:.*(bullet|projectile|taser|electrode|shotgun).*$/
const SAF_LOUD_BIG = /^(createbigcannons:.*|superbwarfare:.*(rocket|shell|missile|grenade|mortar|cannon|javelin|rpg).*)$/

const SAF_AABB = Java.loadClass('net.minecraft.world.phys.AABB')
let safState = {}       // player name -> { score, parts: [[label, n]...], noise, band, bandAt, light, powered, track, under, x, y, z, dim }
let safQueue = []       // player names still to scan this cycle
let safForced = {}      // player name -> tick of the last forced sound hunter
let safAllowUntil = 0   // a forced hunter may join until this tick
let safTrains = []      // [{dim, x, y, z}] carriages seen in the last scans
let safLastNight = -1   // overworld day whose dusk was handled

// ------------------------------------------------------------------ small helpers (hp* are used by the other scripts too)
// Rhino shows ServerLevel.dimension() as a property on some objects and a method on others: handle both.
function hpDim(level) {
  let d = level.dimension
  let key = typeof d === 'function' ? level.dimension() : d
  return String(typeof key.location === 'function' ? key.location() : key.location || key)
}
function hpCmd(server, cmd) { server.runCommandSilent(cmd) }
function hpTell(server, target, text, color) {
  hpCmd(server, 'tellraw ' + target + ' ' + JSON.stringify({ text: text, color: color || 'gray' }))
}
function hpBar(server, target, text, color) {
  hpCmd(server, 'title ' + target + ' actionbar ' + JSON.stringify({ text: text, color: color || 'gray', italic: true }))
}
function hpSound(server, target, sound, volume, pitch) {
  hpCmd(server, 'execute as ' + target + ' at @s run playsound ' + sound + ' master @s ~ ~ ~ ' + volume + ' ' + pitch)
}
function hpJson(server, key) {
  let s = String(server.persistentData.getString(key))
  if (s === '') return []
  try { return JSON.parse(s) } catch (e) { return [] }
}
function hpSave(server, key, value) { server.persistentData.putString(key, JSON.stringify(value)) }
function hpDay(server) { return Math.floor(Number(server.overworld().getDayTime()) / 24000) }
function hpIsNight(server) {
  let t = Number(server.overworld().getDayTime()) % 24000
  return t >= 13000 && t < 23000
}
function hpIsHorror(id) {
  return SAF_HORROR_NS.some(p => id.startsWith(p)) && !SAF_HORROR_SKIP.some(r => r.test(id))
}
function hpIsInfection(id) { return SAF_INFECTION_NS.some(p => id.startsWith(p)) }
function hpDist2(a, x, y, z) { let dx = a.x - x, dy = a.y - y, dz = a.z - z; return dx * dx + dy * dy + dz * dz }
// Entities in a box: KubeJS's getEntitiesWithin when it exists, else a filter over the level's list.
function hpEntitiesNear(level, x, y, z, rx, ry) {
  let out = []
  try {
    level.getEntitiesWithin(new SAF_AABB(x - rx, y - ry, z - rx, x + rx, y + ry, z + rx)).forEach(e => out.push(e))
    return out
  } catch (err) { }
  level.getEntities().forEach(e => { if (Math.abs(e.x - x) <= rx && Math.abs(e.y - y) <= ry && Math.abs(e.z - z) <= rx) out.push(e) })
  return out
}
// Runs a command body and reports a script error in the reply and the log instead of Minecraft's bare "unexpected error".
function hpTry(ctx, fn) {
  try { return fn() } catch (e) {
    let text = 'script error: ' + e + (e.stack ? ' @ ' + String(e.stack).split('\n')[0] : '')
    console.warn('[hpworld] ' + text)
    ctx.source.sendSuccess(Text.of(text), false)
    return 0
  }
}
// A chunk only if it is already loaded (never loads one), else null.
function hpChunk(level, cx, cz) {
  try { return level.hasChunk(cx, cz) ? level.getChunk(cx, cz) : null } catch (e) { console.warn('[safety] chunk lookup: ' + e); return null }
}
function hpLightsOut(server) { return server.persistentData.getInt('hp_lightsout_day') === hpDay(server) + 1 && hpIsNight(server) }
function hpAddNoise(server, dim, x, y, z, r, amount) {
  server.players.forEach(p => {
    if (hpDim(p.level()) !== dim || hpDist2(p, x, y, z) > r * r) return
    let st = safState[String(p.username)]
    if (st) st.noise = Math.min(100, st.noise + amount)
  })
}

// ------------------------------------------------------------------ the scan
// Reads blocks around (x, y, z): light at the feet, powered lamps, campfires, track, turning Create parts in the 3x3 chunks.
function safScanPlace(level, x, y, z) {
  let bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z)
  let feet = level.getBlock(bx, by, bz)
  let out = { light: Number(feet.blockLight), sky: !!feet.canSeeSky, powered: 0, campfire: 0, track: 0, lit: 0, kinetic: 0, kineticAt: null }
  for (let dx = -5; dx <= 5; dx++) for (let dy = -2; dy <= 3; dy++) for (let dz = -5; dz <= 5; dz++) {
    let b = level.getBlock(bx + dx, by + dy, bz + dz)
    let id = String(b.id)
    if (id === 'minecraft:air' || id === 'minecraft:cave_air') continue
    if (id === 'create:track') { out.track++; continue }
    let props = b.properties
    let lit = props && String(props.get('lit')) === 'true'
    if (id.startsWith('contraptionlights:') || ((id === 'minecraft:redstone_lamp' || id.endsWith('copper_bulb')) && lit)) out.powered++
    else if (id.endsWith('campfire') && lit) out.campfire++
    if (Math.abs(dx) <= 4 && Math.abs(dz) <= 4 && Number(b.blockLight) >= 13 && (lit || /lantern|torch|lamp|glowstone|shroomlight|campfire|bulb|light/.test(id))) out.lit++
  }
  let cx = bx >> 4, cz = bz >> 4
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    let chunk = hpChunk(level, cx + i, cz + j)
    if (!chunk) continue
    chunk.getBlockEntities().values().forEach(be => {
      let speed = 0
      try { speed = Math.abs(Number(be.getSpeed())) } catch (e) { return }
      if (!(speed > 0)) return
      let p = be.getBlockPos()
      let ddx = p.x - bx, ddy = p.y - by, ddz = p.z - bz
      if (ddx * ddx + ddy * ddy + ddz * ddz > 24 * 24) return
      out.kinetic++
      if (ddx * ddx + ddy * ddy + ddz * ddz <= 36 && !out.kineticAt) out.kineticAt = { x: p.x, y: p.y, z: p.z, speed: speed }
    })
  }
  return out
}

// Turns a place scan (plus the player's situation, if there is a player) into the score and its parts.
function safScore(server, level, x, y, z, place, player, st) {
  let parts = [['base', 20]]
  let dim = hpDim(level)
  let lightsOut = hpLightsOut(server)
  let light = Math.min(45, place.light * 3)
  if (lightsOut && place.powered === 0) light = Math.round(light / 3)
  parts.push([lightsOut && place.powered === 0 ? 'light (Lights Out: torches gutter)' : 'light', light])
  if (place.powered > 0) parts.push(['powered light', 15])
  if (place.campfire > 0) parts.push(['campfire', 5])
  if (place.kinetic > 0) parts.push(['turning machines', Math.min(8, place.kinetic * 2)])
  let near = 0, far = true
  server.players.forEach(p => {
    if (player && String(p.username) === String(player.username)) return
    if (hpDim(p.level()) !== dim) return
    let d2 = hpDist2(p, x, y, z)
    if (d2 <= 144) near++
    if (d2 <= 48 * 48) far = false
  })
  if (near > 0) parts.push(['company', 10])
  else if (player && far) parts.push(['alone', -10])
  let survivor = false
  hpEntitiesNear(level, x, y, z, 12, 6).forEach(e => { if (String(e.type) === 'survivors:survivor') survivor = true })
  if (survivor) parts.push(['a survivor nearby', 5])
  if (safTrains.some(t => t.dim === dim && hpDist2(t, x, y, z) <= 256)) parts.push(['a train', 15])
  if (safNearRefuge(server, dim, x, y, z, 24)) parts.push(['refuge', 20])
  if (safInZone(server, dim, x, z)) parts.push(['the Sunbreaker', 40])
  if (place.sky && hpIsNight(server)) parts.push(['night, out in the open', -10])
  if (!place.sky && y < 50) parts.push(['underground', -5])
  if (player) {
    let stacks = 0
    try { player.inventory.allItems.forEach(s => { if (!s.isEmpty()) stacks++ }) } catch (e) { }
    if (stacks >= 28) parts.push(['carrying a lot', -5])
  }
  if (st && st.noise > 0) parts.push(['noise', -Math.round(st.noise / 2)])
  let score = 0
  parts.forEach(p => { score += p[1] })
  return { score: Math.max(0, Math.min(100, score)), parts: parts }
}

function safScanPlayer(server, player) {
  let name = String(player.username)
  let level = player.level()
  let st = safState[name] || (safState[name] = { score: 50, parts: [], noise: 0, band: '', bandAt: 0 })
  st.noise = Math.max(0, st.noise - 4)
  let place = safScanPlace(level, player.x, player.y, player.z)
  if (place.kinetic >= 8) st.noise = Math.min(100, st.noise + 2)
  let r = safScore(server, level, player.x, player.y, player.z, place, player, st)
  Object.assign(st, { score: r.score, parts: r.parts, light: place.light, powered: place.powered, track: place.track,
    under: !place.sky && player.y < 60, x: player.x, y: player.y, z: player.z, dim: hpDim(level) })
  // trains near this player, for the next spawn checks
  hpEntitiesNear(level, player.x, player.y, player.z, 48, 16).forEach(e => {
    if (String(e.type) === 'create:carriage_contraption') safTrains.push({ dim: st.dim, x: e.x, y: e.y, z: e.z, at: server.tickCount })
  })
  safMaybeRefuge(server, player, place)
  safBand(server, player, st)
  safLightsOutPulse(server, player, place)
  safHunters(server, player, st)
}

function safBand(server, player, st) {
  let band = st.score >= 60 ? 'safe' : st.score >= 30 ? 'uneasy' : 'exposed'
  if (band === st.band) return
  let was = st.band
  st.band = band
  if (was === '' || server.tickCount - st.bandAt < 600) return
  st.bandAt = server.tickCount
  let name = String(player.username)
  if (band === 'safe') hpBar(server, name, 'Safe here, for now.', 'gray')
  else if (band === 'exposed') hpBar(server, name, 'Exposed.', 'dark_gray')
}

function safLightsOutPulse(server, player, place) {
  if (!hpLightsOut(server) || place.powered > 0 || place.light < 6 || Math.random() > 0.35) return
  let name = String(player.username)
  hpCmd(server, 'effect give ' + name + ' minecraft:darkness 4 0 true')
  hpSound(server, name, 'minecraft:block.fire.extinguish', 0.5, 0.6)
}

function safHunters(server, player, st) {
  let name = String(player.username)
  if (st.noise < 70 || !hpIsNight(server)) return
  if (safForced[name] && server.tickCount - safForced[name] < 36000) return
  if (Math.random() > 1 / 6) return
  safForced[name] = server.tickCount
  safAllowUntil = server.tickCount + 1200
  hpCmd(server, 'director force ' + (st.under ? 'cave_dweller' : 'scp_headline'))
  hpBar(server, name, 'Too loud. Something heard that.', 'dark_red')
  console.info('[safety] ' + name + ' noise ' + st.noise + ': forced a sound hunter')
}

// ------------------------------------------------------------------ refuges
function safNearRefuge(server, dim, x, y, z, r) {
  return hpJson(server, 'hp_refuges').some(f => f.dim === dim && f.active && hpDist2(f, x, y, z) <= r * r)
}

const SAF_NOTES = [
  ['Pump House log, last page', 'Kept the wheel turning and the lamp lit.', 'They never came inside the light.', 'Whoever reads this: keep it turning.'],
  ['Signalman\'s note', 'The 6:40 never came. Neither did the 7:15.', 'The board still lists them. The lamp is on.', 'I will wait one more night.'],
  ['Scratched on the lamp post', 'LIGHT + TURNING = SAFE', 'DARK = RUN', 'DON\'T STOP THE WHEEL'],
  ['Windmill keeper', 'The sails sing at night and the things', 'in the field stop to listen. Then they leave.', 'Grease the bearing. Keep the lantern full.'],
  ['A child\'s drawing', 'A house with a wheel, a lamp, and', 'a tall shape outside, crossed out.', 'Underneath: "it can\'t come in when it spins"']
]
const SAF_SUPPLY = ['8x minecraft:bread', '16x minecraft:torch', '4x minecraft:cooked_beef', 'superbwarfare:handgun_ammo_box',
  '2x minecraft:lantern', '6x create:andesite_alloy']

function safMaybeRefuge(server, player, place) {
  if (!place.kineticAt || place.lit === 0) return
  let dim = hpDim(player.level())
  let list = hpJson(server, 'hp_refuges')
  let k = place.kineticAt
  if (list.some(f => f.dim === dim && hpDist2(f, k.x, k.y, k.z) < 64 * 64)) return
  safMakeRefuge(server, list, dim, k.x, k.y, k.z, String(player.username))
}

function safMakeRefuge(server, list, dim, x, y, z, finder) {
  let n = list.length
  let f = { dim: dim, x: x, y: y, z: z, active: true, by: finder, day: hpDay(server), name: 'Refuge ' + (n + 1) }
  list.push(f)
  hpSave(server, 'hp_refuges', list)
  if (finder) {
    let note = SAF_NOTES[n % SAF_NOTES.length]
    hpCmd(server, 'title ' + finder + ' times 10 70 20')
    hpCmd(server, 'title ' + finder + ' subtitle ' + JSON.stringify({ text: 'It turns. It\'s lit. It holds.', color: 'gray', italic: true }))
    hpCmd(server, 'title ' + finder + ' title ' + JSON.stringify({ text: f.name, color: 'gold' }))
    hpSound(server, finder, 'minecraft:block.beacon.activate', 0.6, 1.4)
    hpCmd(server, 'give ' + finder + ' minecraft:paper[custom_name=' + JSON.stringify(JSON.stringify({ text: note[0], italic: false, color: 'yellow' })) +
      ',lore=[' + note.slice(1).map(l => JSON.stringify(JSON.stringify({ text: l, color: 'gray' }))).join(',') + ']]')
    hpCmd(server, 'give ' + finder + ' ' + SAF_SUPPLY[n % SAF_SUPPLY.length].replace(/^(\d+)x (.*)$/, '$2 $1'))
    hpTell(server, '@a', f.name + ' at ' + x + ' ' + y + ' ' + z + ' (found by ' + finder + '). Keep it turning and lit and nothing comes near it at night.', 'gold')
    hpTell(server, '@a', 'xaero-waypoint:' + f.name + ':R:' + x + ':' + (y + 1) + ':' + z + ':6:false:0:Internal-' + dim.replace('minecraft:', '') + '-waypoints', 'dark_gray')
  }
  console.info('[safety] refuge ' + f.name + ' at ' + dim + ' ' + x + ' ' + y + ' ' + z + ' by ' + (finder || 'command'))
  return f
}

// Re-checks the refuges near players (loaded chunks only): still turning and lit?
function safCheckRefuges(server, all) {
  let list = hpJson(server, 'hp_refuges')
  let changed = false
  list.forEach(f => {
    let level = hpLevel(server, f.dim)
    if (!level) return
    let watched = false
    server.players.forEach(p => { if (hpDim(p.level()) === f.dim && hpDist2(p, f.x, f.y, f.z) <= 96 * 96) watched = true })
    if (!watched && !all) return
    let place = safScanPlace(level, f.x + 0.5, f.y, f.z + 0.5)
    let active = place.kinetic > 0 && place.lit > 0
    if (active !== f.active) {
      f.active = active
      changed = true
      server.players.forEach(p => {
        if (hpDim(p.level()) === f.dim && hpDist2(p, f.x, f.y, f.z) <= 48 * 48)
          hpBar(server, String(p.username), active ? f.name + ' holds again.' : f.name + ' has gone dark.', active ? 'gold' : 'dark_red')
      })
    }
  })
  if (changed) hpSave(server, 'hp_refuges', list)
}

function hpLevel(server, dim) {
  let found = null
  server.getAllLevels().forEach(l => { if (hpDim(l) === dim) found = l })
  return found
}

// ------------------------------------------------------------------ Sunbreaker days (zones written by super_weapons.js)
function safInZone(server, dim, x, z) {
  return hpJson(server, 'hp_zones').some(zn => zn.dim === dim && (zn.x - x) * (zn.x - x) + (zn.z - z) * (zn.z - z) <= zn.r * zn.r)
}

// ------------------------------------------------------------------ the spawn rule
EntityEvents.spawned(event => {
  let e = event.entity
  let id = String(e.type)
  let horror = hpIsHorror(id), infection = hpIsInfection(id)
  if (!horror && !infection) {
    if (SAF_LOUD_BIG.test(id)) hpAddNoise(event.server, hpDim(event.level), e.x, e.y, e.z, 48, 20)
    else if (SAF_LOUD_SMALL.test(id)) hpAddNoise(event.server, hpDim(event.level), e.x, e.y, e.z, 24, 6)
    return
  }
  if (e.persistentData.getBoolean('hp_seen')) return  // allowed before (e.g. loaded again with its chunk)
  let server = event.server
  let dim = hpDim(event.level)
  let verdict = ''
  if (safInZone(server, dim, e.x, e.z)) verdict = 'the Sunbreaker'
  else if (safNearRefuge(server, dim, e.x, e.y, e.z, 24)) verdict = 'a refuge'
  else if (safTrains.some(t => t.dim === dim && hpDist2(t, e.x, e.y, e.z) <= 144)) verdict = 'a train'
  else if (horror && server.tickCount > safAllowUntil) {
    let best = null, bestD = 48 * 48
    server.players.forEach(p => {
      if (hpDim(p.level()) !== dim) return
      let d2 = hpDist2(p, e.x, e.y, e.z)
      if (d2 <= bestD) { bestD = d2; best = p }
    })
    let score
    if (best) {
      let st = safState[String(best.username)]
      score = st ? st.score : 50
    } else {
      score = safScore(server, event.level, e.x, e.y, e.z, safScanPlace(event.level, e.x, e.y, e.z), null, null).score
    }
    let chance = Math.min(0.9, Math.max(0, (score - 40) / 50))
    if (Math.random() < chance) verdict = 'safety ' + score + (best ? ' (' + best.username + ')' : ' (place)')
  }
  if (verdict !== '') {
    console.info('[safety] turned away ' + id + ' at ' + Math.floor(e.x) + ' ' + Math.floor(e.y) + ' ' + Math.floor(e.z) + ': ' + verdict)
    event.cancel()
    return
  }
  e.persistentData.putBoolean('hp_seen', true)
})

LevelEvents.afterExplosion(event => {
  try { hpAddNoise(event.server, hpDim(event.level), event.x, event.y, event.z, 48, 15) } catch (e) { }
})

// ------------------------------------------------------------------ ticking
ServerEvents.tick(event => {
  let server = event.server
  if (safQueue.length === 0 && server.tickCount % SAF_SCAN_TICKS === 0) {
    server.players.forEach(p => safQueue.push(String(p.username)))
    safTrains = safTrains.filter(t => server.tickCount - t.at < SAF_SCAN_TICKS * 2)
  }
  if (safQueue.length > 0) {
    let name = safQueue.shift()
    let p = server.getPlayer(name)
    if (p) { try { safScanPlayer(server, p) } catch (e) { console.warn('[safety] scan failed for ' + name + ': ' + e) } }
  }
  if (server.tickCount % 200 === 50) { try { safCheckRefuges(server) } catch (e) { console.warn('[safety] refuge check: ' + e) } }
  if (server.tickCount % 20 === 0) safDusk(server)
})

// Dusk: decide tonight's Lights Out.
function safDusk(server) {
  let t = Number(server.overworld().getDayTime()) % 24000
  let day = hpDay(server)
  if (t < 12500 || t > 13500 || safLastNight === day) return
  safLastNight = day
  let data = server.persistentData
  let forced = data.getInt('hp_lightsout_force') === 1
  if (forced || (day >= SAF_LIGHTS_OUT_FROM && Math.random() < 0.25)) {
    data.putInt('hp_lightsout_day', day + 1)
    data.putInt('hp_lightsout_force', 0)
    hpCmd(server, 'title @a times 10 80 30')
    hpCmd(server, 'title @a subtitle ' + JSON.stringify({ text: 'The lines are dead tonight. Torches won\'t hold. Get power.', color: 'gray' }))
    hpCmd(server, 'title @a title ' + JSON.stringify({ text: 'LIGHTS OUT', color: 'dark_red' }))
    hpSound(server, '@a', 'minecraft:block.beacon.deactivate', 1, 0.5)
    console.info('[safety] Lights Out tonight (day ' + day + (forced ? ', forced' : '') + ')')
  }
}

// ------------------------------------------------------------------ commands
ServerEvents.commandRegistry(event => {
  let { commands: Commands, arguments: Arguments } = event
  event.register(Commands.literal('safety').executes(ctx => {
    let p = ctx.source.player
    if (!p) return 0
    let st = safState[String(p.username)]
    if (!st) { hpTell(ctx.source.server, String(p.username), 'Still getting a feel for this place. Ask again in a few seconds.'); return 1 }
    hpTell(ctx.source.server, String(p.username), 'Safety here: ' + st.score + ' / 100 (' + st.band + ')', st.score >= 60 ? 'green' : st.score >= 30 ? 'yellow' : 'red')
    hpTell(ctx.source.server, String(p.username), st.parts.map(x => x[0] + ' ' + (x[1] >= 0 ? '+' : '') + x[1]).join(', '))
    return 1
  }))
  let say = (ctx, text) => { ctx.source.sendSuccess(Text.of(text), false); console.info('[hpworld] ' + text); return 1 }
  event.register(Commands.literal('hpworld').requires(s => s.hasPermission(2))
    .then(Commands.literal('status').executes(ctx => {
      let server = ctx.source.server
      return say(ctx, 'day ' + hpDay(server) + ', night ' + hpIsNight(server) + ', lights out ' + hpLightsOut(server) +
        ', refuges ' + hpJson(server, 'hp_refuges').length + ', zones ' + hpJson(server, 'hp_zones').length + ', trains ' + safTrains.length +
        ', players ' + Object.keys(safState).map(n => n + '=' + safState[n].score + '/noise ' + safState[n].noise).join(' '))
    }))
    .then(Commands.literal('lightsout')
      .then(Commands.literal('on').executes(ctx => {
        let server = ctx.source.server
        server.persistentData.putInt('hp_lightsout_day', hpDay(server) + 1)
        return say(ctx, 'Lights Out set for tonight (day ' + hpDay(server) + '); active now: ' + hpLightsOut(server))
      }))
      .then(Commands.literal('off').executes(ctx => { ctx.source.server.persistentData.putInt('hp_lightsout_day', -1); return say(ctx, 'Lights Out off') })))
    .then(Commands.literal('probe').then(Commands.argument('pos', Arguments.BLOCK_POS.create(event)).executes(ctx => hpTry(ctx, () => {
      let pos = Arguments.BLOCK_POS.getResult(ctx, 'pos')
      let level = ctx.source.level
      let place = safScanPlace(level, pos.x + 0.5, pos.y, pos.z + 0.5)
      let r = safScore(ctx.source.server, level, pos.x + 0.5, pos.y, pos.z + 0.5, place, null, null)
      return say(ctx, 'probe ' + pos.x + ' ' + pos.y + ' ' + pos.z + ': score ' + r.score + ' [' + r.parts.map(x => x[0] + ' ' + x[1]).join(', ') +
        '] light ' + place.light + ' powered ' + place.powered + ' lit ' + place.lit + ' kinetic ' + place.kinetic + ' track ' + place.track +
        ' refuge-ready ' + (!!place.kineticAt && place.lit > 0))
    }))))
    .then(Commands.literal('refuges').executes(ctx => {
      let list = hpJson(ctx.source.server, 'hp_refuges')
      return say(ctx, list.length + ' refuges: ' + list.map(f => f.name + ' ' + f.x + ',' + f.y + ',' + f.z + (f.active ? ' active' : ' dark')).join('; '))
    }))
    .then(Commands.literal('refuge_at').then(Commands.argument('pos', Arguments.BLOCK_POS.create(event)).executes(ctx => hpTry(ctx, () => {
      let pos = Arguments.BLOCK_POS.getResult(ctx, 'pos')
      let server = ctx.source.server, level = ctx.source.level
      let place = safScanPlace(level, pos.x + 0.5, pos.y, pos.z + 0.5)
      if (!place.kineticAt || place.lit === 0) return say(ctx, 'not a refuge: kinetic ' + place.kinetic + ' (near ' + !!place.kineticAt + '), lit ' + place.lit)
      let f = safMakeRefuge(server, hpJson(server, 'hp_refuges'), hpDim(level), place.kineticAt.x, place.kineticAt.y, place.kineticAt.z, '')
      return say(ctx, 'made ' + f.name)
    }))))
    .then(Commands.literal('refuge_check').executes(ctx => { safCheckRefuges(ctx.source.server, true); return say(ctx, 'refuges rechecked') }))
    .then(Commands.literal('reset').executes(ctx => {
      let d = ctx.source.server.persistentData
      ;['hp_refuges', 'hp_zones'].forEach(k => d.putString(k, '[]'))
      d.putInt('hp_lightsout_day', -1)
      safState = {}
      return say(ctx, 'world features reset (refuges, zones, lights out)')
    }))
    .then(Commands.literal('noise').then(Commands.argument('n', Arguments.INTEGER.create(event)).executes(ctx => {
      let n = Arguments.INTEGER.getResult(ctx, 'n')
      Object.keys(safState).forEach(k => { safState[k].noise = n })
      return say(ctx, 'noise set to ' + n + ' for ' + Object.keys(safState).length + ' players')
    }))))
})
