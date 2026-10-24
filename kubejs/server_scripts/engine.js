// The Engine: Act 6 of "The Line" (quest chapter ch6). Players build it from the Builders' blueprint at the end of a
// rail line, wake it, then choose its fate once, for the whole server.
//
// The pattern, centred on a beacon (the heart, a quest reward from "The Heart"):
//   y-1: a 3x3 bed of beacon-base blocks (iron/gold/emerald/diamond/netherite), so the beam shows under open sky
//   y 0: a Create cogwheel (small or large) on each of the beacon's four sides, a Create casing in each corner
//   any Create/Railways track within 8 blocks (the end of the line), and at least one of the cogs turning.
//
// Flow (all state in server.persistentData, so a restart keeps it):
//   1. Right-click the beacon with an empty hand: checks the pattern (and tells you what's missing). If it's complete
//      and turning, the Engine starts WAKING: 240 s of turning with someone within 64 blocks, infected waves every 40 s.
//      Cogs stop -> the count pauses. Nobody near for 2 min -> it winds down to 0. Pattern broken -> it falls apart.
//   2. AWAKE: the choice. Lantern on the heart (while it turns) = "turning". Sneak + wrench on the heart = "stopped".
//      Either needs a second use (anyone) within 15 s. Once made, never again.
//
// Flags other scripts read (server.persistentData):
//   engine_ending  ''|'turning'|'stopped'   the choice (horror_grace.js, faces_daylight.js read it)
//   engine_state   ''|'waking'|'awake'      progress before the choice
//   engine_x/y/z (int), engine_dim (string) where the heart sits
//   engine_wake    seconds of turning so far while waking
//   engine_ending_day  overworld day number the choice was made on
//   engine_still   seconds the Engine's chunk has been loaded with no cog turning (Keep It Lit upkeep, below)
//   engine_hungry  1 while the Engine has stood still a full in-game day: the light rule is off until it turns again
// With the Survivors mod loaded its horror director is the only spawn gate, so the ending's spawn rules live there:
// engDirector() hands it the Engine (/director engine <dim> <x> <y> <z>) and the ending (/director flag engine_turning|
// engine_stopped on) when the choice is made and again on the first tick after every start (idempotent, so an existing
// world catches up). Without the mod, horror_grace.js applies the same rules from engine_ending.
// Quest tasks complete through hidden advancements in kubejs/data/horrorpack/advancement (granted to everyone online,
// and again on login so late players' books catch up).

const ENG_S = '§'
const ENG_WAKE_SECONDS = 240
const ENG_NEAR = 64
const ENG_AWAY_LIMIT = 120
const ENG_CONFIRM_TICKS = 300
const ENG_WAVES = [15, 55, 95, 135, 175, 215]
const ENG_POOLS = [
  ['spore:inf_human', 'spore:inf_villager', 'spore:inf_husk', 'spore:inf_wanderer'],
  ['spore:inf_human', 'spore:inf_villager', 'spore:knight', 'spore:griefer', 'spore:leaper', 'spore:spitter'],
  ['spore:knight', 'spore:slasher', 'spore:brute', 'spore:howler', 'spore:leaper', 'spore:spitter']
]
const ENG_BED = ['minecraft:iron_block', 'minecraft:gold_block', 'minecraft:emerald_block', 'minecraft:diamond_block', 'minecraft:netherite_block']
const ENG_COGS = ['create:cogwheel', 'create:large_cogwheel']
const ENG_CASINGS = ['create:andesite_casing', 'create:brass_casing', 'create:copper_casing', 'create:railway_casing']
// Same namespaces as the Survivors mod's horror/Horrors.java (general horrors; friendly SCP staff and ArPhEx helpers skipped).
const ENG_HORROR_NS = ['weeping_angels:', 'cave_dweller:', 'kenny:', 'the_knocker:', 'the_boy_and_the_bath:', 'thewatcher:',
  'arphex:', 'scp_ultimate:', 'the_backwoods:', 'the_obsessed:']
const ENG_HORROR_SKIP = [/^scp_ultimate:(class_d|scp_guard|scp_scientist.*|rat.*|scp_999|scp_529|scp_131.*|scp_111.*)$/,
  /^arphex:(ai_.*|.*spawner.*|.*clone.*|.*controller.*)$/]
const ENG_INFECTION_NS = ['spore:', 'sporeinquisition:', 'inqui:', 'infnexus:']
const ENG_SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const ENG_CORNERS = [[1, 1], [1, -1], [-1, 1], [-1, -1]]

let engPending = null      // { kind: 'turning'|'stopped', until: tick }
let engAway = 0            // seconds nobody has been near a waking Engine
let engLastClick = {}      // player name -> tick, to swallow the duplicate hand events
let engQueue = []          // [{ at: tick, fn }] delayed lines for the endings
let engSpeedWarned = false
let engDirectorSynced = false  // engDirector() runs once on the first tick after a start

// ------------------------------------------------------------------ helpers
function engDim(level) {
  return String(level.dimension().location())
}

function engId(level, x, y, z) {
  return String(level.getBlock(x, y, z).id)
}

function engTell(server, target, text) {
  server.runCommandSilent('tellraw ' + target + ' ' + JSON.stringify({ text: text }))
}

function engBar(server, target, text) {
  server.runCommandSilent('title ' + target + ' actionbar ' + JSON.stringify({ text: text }))
}

function engTitle(server, title, sub) {
  server.runCommandSilent('title @a times 10 90 30')
  server.runCommandSilent('title @a subtitle ' + JSON.stringify({ text: sub }))
  server.runCommandSilent('title @a title ' + JSON.stringify({ text: title }))
}

function engSoundAll(server, sound, volume, pitch) {
  server.runCommandSilent('execute as @a at @s run playsound ' + sound + ' master @s ~ ~ ~ ' + volume + ' ' + pitch)
}

function engGrant(server, target, adv) {
  server.runCommandSilent('advancement grant ' + target + ' only horrorpack:' + adv)
}

function engLater(server, ticks, fn) {
  engQueue.push({ at: server.tickCount + ticks, fn: fn })
}

function engLevel(server, dim) {
  let found = null
  server.getAllLevels().forEach(l => { if (engDim(l) === dim) found = l })
  return found
}

function engNearby(server, dim, x, y, z, r) {
  const out = []
  server.players.forEach(p => {
    if (engDim(p.level()) !== dim) return
    const dx = p.x - (x + 0.5), dy = p.y - y, dz = p.z - (z + 0.5)
    if (dx * dx + dy * dy + dz * dz <= r * r) out.push(p)
  })
  return out
}

function engSpinning(level, x, y, z) {
  const be = level.getBlock(x, y, z).entity
  if (!be) return false
  try {
    return Math.abs(Number(be.getSpeed())) > 0
  } catch (e) {
    if (!engSpeedWarned) { console.warn('[engine] could not read cog speed, treating the Engine as turning: ' + e); engSpeedWarned = true }
    return true
  }
}

// Checks the pattern around a beacon at x,y,z. Returns { missing: [..], partial: bool, turning: bool }.
function engCheck(level, x, y, z, withTrack) {
  const missing = []
  let parts = 0
  if (engId(level, x, y, z) !== 'minecraft:beacon') missing.push('the heart (the beacon)')
  let bed = 0
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (ENG_BED.indexOf(engId(level, x + dx, y - 1, z + dz)) >= 0) bed++
  if (bed < 9) missing.push((9 - bed) + ' more iron block' + (9 - bed > 1 ? 's' : '') + ' in the bed under the heart')
  let cogs = 0, turning = false
  ENG_SIDES.forEach(s => {
    if (ENG_COGS.indexOf(engId(level, x + s[0], y, z + s[1])) >= 0) {
      cogs++
      if (!turning && engSpinning(level, x + s[0], y, z + s[1])) turning = true
    }
  })
  if (cogs < 4) missing.push((4 - cogs) + ' more cogwheel' + (4 - cogs > 1 ? 's' : '') + ' on the sides of the heart')
  let casings = 0
  ENG_CORNERS.forEach(c => { if (ENG_CASINGS.indexOf(engId(level, x + c[0], y, z + c[1])) >= 0) casings++ })
  if (casings < 4) missing.push((4 - casings) + ' more casing' + (4 - casings > 1 ? 's' : '') + ' in the corners')
  parts = cogs + casings
  if (withTrack) {
    let track = false
    for (let dx = -8; dx <= 8 && !track; dx++) for (let dz = -8; dz <= 8 && !track; dz++) for (let dy = -3; dy <= 3 && !track; dy++) {
      if (engId(level, x + dx, y + dy, z + dz).indexOf('track') >= 0) track = true
    }
    if (!track) missing.push('track within 8 blocks (the Engine sits at the end of a line)')
  }
  return { missing: missing, partial: parts > 0, turning: turning }
}

function engAirish(level, x, y, z) {
  const id = engId(level, x, y, z)
  return id === 'minecraft:air' || id === 'minecraft:cave_air'
}

function engSpot(level, x, y, z) {
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2, r = 7 + Math.random() * 9
    const sx = Math.floor(x + Math.cos(a) * r), sz = Math.floor(z + Math.sin(a) * r)
    for (let dy = -4; dy <= 4; dy++) {
      const sy = y + dy
      if (engAirish(level, sx, sy, sz) && engAirish(level, sx, sy + 1, sz)) {
        const below = engId(level, sx, sy - 1, sz)
        if (below !== 'minecraft:air' && below !== 'minecraft:cave_air' && below !== 'minecraft:water' && below !== 'minecraft:lava') return [sx, sy, sz]
      }
    }
  }
  return null
}

function engIsType(t, prefixes) {
  return prefixes.some(p => t.startsWith(p)) && !ENG_HORROR_SKIP.some(r => r.test(t))
}

// Tell the Survivors horror director where the Engine is and which ending holds (its spawn gate applies the rules).
function engDirector(server, data) {
  if (!Platform.isLoaded('survivors')) return
  const ending = data.getString('engine_ending')
  if (ending !== 'turning' && ending !== 'stopped') return
  const pos = engPos(data)
  if (pos.dim !== '') server.runCommandSilent('director engine ' + pos.dim + ' ' + pos.x + ' ' + pos.y + ' ' + pos.z)
  server.runCommandSilent('director flag engine_turning ' + (ending === 'turning' && data.getInt('engine_hungry') !== 1 ? 'on' : 'off'))
  server.runCommandSilent('director flag engine_stopped ' + (ending === 'stopped' ? 'on' : 'off'))
  console.info('[engine] director told: ending ' + ending + (pos.dim !== '' ? ' at ' + pos.dim + ' ' + pos.x + ' ' + pos.y + ' ' + pos.z : ''))
}

function engPurge(server, prefixes) {
  let n = 0
  server.getAllLevels().forEach(level => {
    const dim = engDim(level)
    level.getEntities().forEach(e => {
      const t = String(e.type)
      if (!engIsType(t, prefixes)) return
      if (t === 'spore:proto' || !e.isLiving()) return // Protos stay (the Director's Let It Rest exemption); no projectiles or drops
      server.runCommandSilent('execute in ' + dim + ' run particle minecraft:large_smoke ' + e.x + ' ' + (e.y + 1) + ' ' + e.z + ' 0.3 0.6 0.3 0.02 20 force')
      e.discard()
      n++
    })
  })
  return n
}

function engPos(data) {
  return { x: data.getInt('engine_x'), y: data.getInt('engine_y'), z: data.getInt('engine_z'), dim: data.getString('engine_dim') }
}

function engReset(data) {
  data.putString('engine_state', '')
  data.putInt('engine_wake', 0)
  engAway = 0
}

// ------------------------------------------------------------------ waking
function engStartWaking(server, data, level, x, y, z) {
  data.putString('engine_state', 'waking')
  data.putInt('engine_x', x); data.putInt('engine_y', y); data.putInt('engine_z', z)
  data.putString('engine_dim', engDim(level))
  data.putInt('engine_wake', 0)
  engAway = 0
  engGrant(server, '@a', 'engine_seated')
  engTitle(server, ENG_S + '6THE ENGINE WAKES', ENG_S + '7Keep it turning.')
  engSoundAll(server, 'minecraft:block.beacon.activate', 1, 0.5)
  engSoundAll(server, 'minecraft:ambient.cave', 1, 0.6)
  engTell(server, '@a', ENG_S + '7The cogs bite. Something under the capital stops moving, and listens.')
  engTell(server, '@a', ENG_S + 'eFour minutes.' + ENG_S + '7 Keep a cog turning and stay near the heart. Everything infected heard that.')
}

function engWave(server, level, x, y, z, index, players) {
  const pool = ENG_POOLS[Math.min(ENG_POOLS.length - 1, Math.floor(index / 2))]
  const count = Math.min(14, 2 + 2 * players + index)
  const dim = engDim(level)
  let placed = 0
  for (let i = 0; i < count; i++) {
    const spot = engSpot(level, x, y, z)
    if (!spot) continue
    const mob = pool[Math.floor(Math.random() * pool.length)]
    server.runCommandSilent('execute in ' + dim + ' run particle minecraft:large_smoke ' + (spot[0] + 0.5) + ' ' + (spot[1] + 0.5) + ' ' + (spot[2] + 0.5) + ' 0.4 0.8 0.4 0.02 25 force')
    server.runCommandSilent('execute in ' + dim + ' run summon ' + mob + ' ' + (spot[0] + 0.5) + ' ' + spot[1] + ' ' + (spot[2] + 0.5))
    placed++
  }
  const lines = ['Something is coming up the tunnel.', 'More of them. Keep it turning.', 'They are coming from everywhere now.',
    'The walls are moving.', 'It is almost awake. So are they.', 'Last push. Hold the line.']
  engNearby(server, dim, x, y, z, ENG_NEAR).forEach(p => engTell(server, p.username, ENG_S + 'c' + lines[Math.min(index, lines.length - 1)]))
  console.info('[engine] wave ' + (index + 1) + ': ' + placed + '/' + count + ' infected at ' + x + ' ' + y + ' ' + z)
}

function engWakeTick(server, data) {
  const pos = engPos(data)
  const level = engLevel(server, pos.dim)
  if (!level) { engReset(data); return }
  const near = engNearby(server, pos.dim, pos.x, pos.y, pos.z, ENG_NEAR)
  if (near.length === 0) {
    engAway++
    if (engAway >= ENG_AWAY_LIMIT) {
      engReset(data)
      engTell(server, '@a', ENG_S + '7Far away, the Engine winds down. Nobody was there to turn it.')
    }
    return
  }
  engAway = 0
  const chk = engCheck(level, pos.x, pos.y, pos.z, false)
  if (chk.missing.length > 0) {
    engReset(data)
    near.forEach(p => engTell(server, p.username, ENG_S + 'cThe Engine shudders apart. ' + ENG_S + '7Missing: ' + chk.missing.join(', ') + '. Rebuild it and seat the heart again.'))
    return
  }
  if (!chk.turning) {
    near.forEach(p => engBar(server, p.username, ENG_S + 'cThe Engine is slowing. Turn it!'))
    return
  }
  const w = data.getInt('engine_wake') + 1
  data.putInt('engine_wake', w)
  const wave = ENG_WAVES.indexOf(w)
  if (wave >= 0) engWave(server, level, pos.x, pos.y, pos.z, wave, near.length)
  const filled = Math.floor(w * 20 / ENG_WAKE_SECONDS)
  let bar = ''
  for (let i = 0; i < 20; i++) bar += i < filled ? '|' : '.'
  near.forEach(p => engBar(server, p.username, ENG_S + '6The Engine ' + ENG_S + 'e' + bar + ENG_S + '7 ' + (ENG_WAKE_SECONDS - w) + 's'))
  if (w % 20 === 0) server.runCommandSilent('execute in ' + pos.dim + ' run playsound create:cogs master @a ' + pos.x + ' ' + pos.y + ' ' + pos.z + ' 2 ' + (0.5 + w / ENG_WAKE_SECONDS))
  if (w >= ENG_WAKE_SECONDS) engAwake(server, data)
}

function engAwake(server, data) {
  data.putString('engine_state', 'awake')
  engGrant(server, '@a', 'engine_awake')
  engTitle(server, ENG_S + '6IT TURNS', ENG_S + '7The heart is awake. Now choose.')
  engSoundAll(server, 'minecraft:block.beacon.power_select', 1, 0.6)
  engTell(server, '@a', ENG_S + '7The Engine is awake, and waiting. Read ' + ENG_S + 'eThe Last Entry' + ENG_S + '7 in your book.')
  engTell(server, '@a', ENG_S + 'eA lantern on the heart' + ENG_S + '7 keeps it lit. ' + ENG_S + 'eSneak with a wrench' + ENG_S + '7 lets it rest. One choice, for everyone.')
}

// ------------------------------------------------------------------ the endings
function engEndTurning(server, data) {
  const pos = engPos(data)
  data.putString('engine_ending', 'turning')
  data.putLong('engine_ending_day', Math.floor(Number(server.overworld().dayTime) / 24000))
  engPending = null
  engDirector(server, data)
  engGrant(server, '@a', 'engine_turning')
  engTitle(server, ENG_S + 'eTHE LINE HOLDS', ENG_S + '7The Engine turns.')
  engSoundAll(server, 'minecraft:block.beacon.power_select', 1, 1)
  engSoundAll(server, 'create:whistle_train_low', 1, 0.8)
  server.runCommandSilent('execute in ' + pos.dim + ' run particle minecraft:end_rod ' + (pos.x + 0.5) + ' ' + (pos.y + 1) + ' ' + (pos.z + 0.5) + ' 0.5 6 0.5 0.05 300 force')
  const gone = engPurge(server, ENG_HORROR_NS)
  console.info('[engine] ending: turning (' + gone + ' horrors driven off)')
  engTell(server, '@a', ENG_S + '7The lantern catches. The beam goes up into the dark like a rail laid on the sky.')
  engLater(server, 80, () => {
    engSoundAll(server, 'create:whistle_train', 0.8, 0.7)
    engTell(server, '@a', ENG_S + '7Every track you ever crossed starts to hum. Far off, a whistle. Then another.')
  })
  engLater(server, 160, () => engTell(server, '@a', ENG_S + 'eThey don\'t come where the lights are on.' + ENG_S + '7 Now that is true. Not in your light, not near the Engine, not near a train.'))
  engLater(server, 240, () => engTell(server, '@a', ENG_S + '7Below, the fungus climbs toward the heat. The Engine will want it. It always will.'))
}

function engEndStopped(server, data) {
  const pos = engPos(data)
  data.putString('engine_ending', 'stopped')
  data.putLong('engine_ending_day', Math.floor(Number(server.overworld().dayTime) / 24000))
  engPending = null
  engDirector(server, data)
  engGrant(server, '@a', 'engine_stopped')
  engTitle(server, ENG_S + 'cLIGHTS OUT', ENG_S + '7The Engine rests.')
  engSoundAll(server, 'minecraft:block.beacon.deactivate', 1, 0.5)
  engSoundAll(server, 'create:cogs', 1, 0.5)
  server.runCommandSilent('execute in ' + pos.dim + ' run setblock ' + pos.x + ' ' + pos.y + ' ' + pos.z + ' minecraft:crying_obsidian')
  server.runCommandSilent('execute in ' + pos.dim + ' run particle minecraft:large_smoke ' + (pos.x + 0.5) + ' ' + (pos.y + 1) + ' ' + (pos.z + 0.5) + ' 0.6 1.5 0.6 0.02 200 force')
  const gone = engPurge(server, ENG_INFECTION_NS)
  console.info('[engine] ending: stopped (' + gone + ' infected withered)')
  engTell(server, '@a', ENG_S + '7You turn the last bolt. The cogs grind down, slower, slower, and stop.')
  engLater(server, 80, () => engTell(server, '@a', ENG_S + '7The heart goes dark. Under the capital, something that was pulled on for a hundred years lets go.'))
  engLater(server, 160, () => engTell(server, '@a', ENG_S + 'bThe fungus sinks. Out in the dark, the infected fall where they stand.'))
  engLater(server, 240, () => {
    engSoundAll(server, 'minecraft:ambient.cave', 1, 0.5)
    engTell(server, '@a', ENG_S + 'cAnd the things that were held at arm\'s length take a step closer.')
  })
}

// ------------------------------------------------------------------ world state after the choice
// Turning: horrors near a train (any Create carriage) are driven off in a puff of smoke, every 5 s.
function engTrainsTick(server) {
  server.getAllLevels().forEach(level => {
    const ents = level.getEntities()
    const trains = []
    ents.forEach(e => { if (String(e.type) === 'create:carriage_contraption') trains.push([e.x, e.y, e.z]) })
    if (trains.length === 0) return
    const dim = engDim(level)
    ents.forEach(e => {
      const t = String(e.type)
      if (!engIsType(t, ENG_HORROR_NS)) return
      if (!trains.some(c => (c[0] - e.x) * (c[0] - e.x) + (c[1] - e.y) * (c[1] - e.y) + (c[2] - e.z) * (c[2] - e.z) < 24 * 24)) return
      server.runCommandSilent('execute in ' + dim + ' run particle minecraft:large_smoke ' + e.x + ' ' + (e.y + 1) + ' ' + e.z + ' 0.3 0.6 0.3 0.02 20 force')
      e.discard()
    })
  })
}

// Stopped: on overworld nights, players standing in the dark sometimes feel it come close (a short Darkness pulse).
function engDarkTick(server) {
  const level = server.overworld()
  if (level.isDay()) return
  server.players.forEach(p => {
    if (engDim(p.level()) !== 'minecraft:overworld') return
    if (p.block.blockLight >= 4 || Math.random() > 0.35) return
    server.runCommandSilent('effect give ' + p.username + ' minecraft:darkness 5 0 true')
    server.runCommandSilent('execute as ' + p.username + ' at @s run playsound minecraft:ambient.cave master @s ~ ~ ~ 1 0.6')
  })
}

// Keep It Lit upkeep ("it will want feeding"): only while the Engine's chunk is loaded. A full in-game day (1200 s)
// with no cog turning and the Engine goes hungry: the director's light rule switches off and the trains stop driving
// horrors away. Any cog turning again feeds it and the rule comes back.
const ENG_HUNGRY_SECONDS = 1200
function engHungerTick(server, data) {
  const pos = engPos(data)
  const level = engLevel(server, pos.dim)
  if (!level) return
  let loaded = false
  try { loaded = level.hasChunk(pos.x >> 4, pos.z >> 4) } catch (err) { loaded = false }
  if (!loaded) return
  const turning = ENG_SIDES.some(s => engSpinning(level, pos.x + s[0], pos.y, pos.z + s[1]))
  const hungry = data.getInt('engine_hungry') === 1
  if (turning) {
    data.putInt('engine_still', 0)
    if (hungry) {
      data.putInt('engine_hungry', 0)
      engDirector(server, data)
      engTell(server, '@a', ENG_S + '6The Engine turns again.' + ENG_S + '7 The light holds.')
      console.info('[engine] fed again: light rule back on')
    }
    return
  }
  const still = data.getInt('engine_still') + 20
  data.putInt('engine_still', still)
  if (!hungry && still >= ENG_HUNGRY_SECONDS) {
    data.putInt('engine_hungry', 1)
    engDirector(server, data)
    engTell(server, '@a', ENG_S + '4The Engine has stood still a whole day.' + ENG_S + '7 It wants feeding. The dark has noticed.')
    engSoundAll(server, 'minecraft:block.beacon.deactivate', 1, 0.5)
    console.info('[engine] hungry: light rule off until a cog turns')
  }
}

// ------------------------------------------------------------------ events
ServerEvents.tick(event => {
  const server = event.server
  if (!engDirectorSynced) { engDirectorSynced = true; engDirector(server, server.persistentData) }
  if (engQueue.length > 0) {
    const now = server.tickCount
    const due = engQueue.filter(q => q.at <= now)
    engQueue = engQueue.filter(q => q.at > now)
    due.forEach(q => q.fn())
  }
  if (server.tickCount % 20 !== 0) return
  const data = server.persistentData
  if (data.getString('engine_state') === 'waking' && data.getString('engine_ending') === '') engWakeTick(server, data)
  const ending = data.getString('engine_ending')
  if (ending === 'turning' && server.tickCount % 100 === 0 && data.getInt('engine_hungry') !== 1) engTrainsTick(server)
  if (ending === 'turning' && server.tickCount % 400 === 0) engHungerTick(server, data)
  if (ending === 'stopped' && server.tickCount % 1200 === 0) engDarkTick(server)
})

BlockEvents.rightClicked('minecraft:beacon', event => {
  const player = event.player
  const server = player.server
  const data = server.persistentData
  const name = String(player.username)
  const tick = server.tickCount
  if (String(event.hand) !== 'MAIN_HAND') {
    if (engLastClick[name] === tick) event.cancel()  // the main hand already handled this click
    return
  }
  const block = event.block
  const level = block.getLevel()
  const x = block.x, y = block.y, z = block.z
  const dim = engDim(level)
  const item = player.mainHandItem
  const held = item.isEmpty() ? '' : String(item.id)
  const ending = data.getString('engine_ending')
  const state = data.getString('engine_state')
  const pos = engPos(data)
  const atEngine = state !== '' && pos.dim === dim && pos.x === x && pos.y === y && pos.z === z
  const handled = () => { engLastClick[name] = tick; event.cancel() }

  if (ending !== '') return  // the choice is made; the heart is just a beacon now

  if (held === '') {
    if (atEngine && state === 'awake') {
      engTell(server, name, ENG_S + '7The heart waits. ' + ENG_S + 'eA lantern' + ENG_S + '7 keeps it lit. ' + ENG_S + 'eSneak with a wrench' + ENG_S + '7 lets it rest.')
      return handled()
    }
    if (atEngine && state === 'waking') {
      engTell(server, name, ENG_S + '7The Engine is waking: ' + data.getInt('engine_wake') + ' of ' + ENG_WAKE_SECONDS + ' seconds. Keep it turning.')
      return handled()
    }
    const chk = engCheck(level, x, y, z, true)
    if (!chk.partial) return  // an ordinary beacon: leave it alone
    if (state === 'waking' || state === 'awake') {
      engTell(server, name, ENG_S + '7Another heart is already ' + state + ' at ' + pos.x + ' ' + pos.y + ' ' + pos.z + '. There is only one Engine.')
      return handled()
    }
    if (chk.missing.length > 0) {
      engTell(server, name, ENG_S + '7The heart sits in its cradle, cold. Missing: ' + ENG_S + 'e' + chk.missing.join(', ') + ENG_S + '7.')
      return handled()
    }
    if (!chk.turning) {
      engTell(server, name, ENG_S + '7Everything is in place. The heart is still cold. ' + ENG_S + 'eIt needs to turn' + ENG_S + '7: put a hand crank on a cog and crank it.')
      return handled()
    }
    engStartWaking(server, data, level, x, y, z)
    return handled()
  }

  const kind = held === 'minecraft:lantern' ? 'turning' : (held === 'create:wrench' && player.isShiftKeyDown() ? 'stopped' : '')
  if (kind === '') return
  if (!atEngine || state !== 'awake') {
    if (atEngine) { engTell(server, name, ENG_S + '7Not yet. It has to wake first.'); return handled() }
    return
  }
  const chk = engCheck(level, x, y, z, false)
  if (chk.missing.length > 0) {
    engTell(server, name, ENG_S + '7The Engine is broken. Missing: ' + ENG_S + 'e' + chk.missing.join(', ') + ENG_S + '7.')
    return handled()
  }
  if (kind === 'turning' && !chk.turning) {
    engTell(server, name, ENG_S + '7The heart will not take the light while it is still. ' + ENG_S + 'eTurn it' + ENG_S + '7, then try again.')
    return handled()
  }
  if (engPending && engPending.kind === kind && tick <= engPending.until) {
    if (kind === 'turning') { item.shrink(1); engEndTurning(server, data) } else engEndStopped(server, data)
    return handled()
  }
  engPending = { kind: kind, until: tick + ENG_CONFIRM_TICKS }
  if (kind === 'turning') {
    engTell(server, '@a', ENG_S + 'e' + name + ' holds a lantern to the heart.' + ENG_S + '7 Anyone: do the same within 15 seconds to keep it lit, forever.')
  } else {
    engTell(server, '@a', ENG_S + 'c' + name + ' has a wrench on the heart.' + ENG_S + '7 Anyone: sneak and use a wrench on it within 15 seconds to let it rest, forever.')
  }
  engSoundAll(server, 'minecraft:block.note_block.bell', 1, 0.5)
  return handled()
})

// Late players' quest books catch up with whatever the server has already been through.
PlayerEvents.loggedIn(event => {
  const player = event.player
  const server = player.server
  const data = server.persistentData
  const name = String(player.username)
  const state = data.getString('engine_state')
  const ending = data.getString('engine_ending')
  if (state !== '' || ending !== '') engGrant(server, name, 'engine_seated')
  if (state === 'awake' || ending !== '') engGrant(server, name, 'engine_awake')
  if (ending !== '') engGrant(server, name, 'engine_' + ending)
})
