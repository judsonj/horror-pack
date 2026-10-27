// Creepy surprises between bosses. Nothing here places, breaks or changes a block.
//   footsteps  three soft steps right behind you          door       a door opens somewhere close by
//   torch      a torch-out hiss and a moment of Darkness  figure     a dark shape stands still far off; gone when you get close
//   ambush     opening a chest in the dark: a warning, then ~3 s later a few zombies behind you
// Only in the dark (night outside, or unlit underground), never near a refuge (safety.js).
const FLF_SCARE_EVERY = 400          // ticks between scare rolls per player (20 s)
const FLF_SCARE_CHANCE = 0.06        // per roll: roughly one scare every 5-6 minutes in the dark
const FLF_AMBUSH_CHANCE = 0.25
const FLF_AMBUSH_COOLDOWN = 20 * 60 * 15  // 15 min per player
const FLF_FIGURE_LIFE = 20 * 60           // a figure lasts at most 1 min
let flfQueue = []    // { at: tick, run: fn }
let flfFigures = []  // { uuid, dim, x, y, z, born }
let flfAmbushAt = {} // username -> tick of last ambush

function flfLater(server, ticks, fn) { flfQueue.push({ at: server.tickCount + ticks, run: fn }) }
function flfDark(server, p) {
  try {
    let b = p.block
    if (b.blockLight > 3) return false
    return b.skyLight <= 4 || flfNight(server)
  } catch (err) { return false }
}
function flfSafe(server, p) {
  try { return typeof safNearRefuge === 'function' && safNearRefuge(server, hpDim(hpLvl(p)), p.x, p.y, p.z, 24) } catch (err) { return false }
}
function flfSound(server, p, sound, x, y, z, vol, pitch) {
  hpCmd(server, 'execute in ' + hpDim(hpLvl(p)) + ' run playsound ' + sound + ' hostile ' + p.uuid + ' ' + x + ' ' + y + ' ' + z + ' ' + vol + ' ' + pitch)
}
// Unit vector the player faces (x, z).
function flfFacing(p) {
  let yaw = Number(p.getYRot()) * Math.PI / 180
  return { x: -Math.sin(yaw), z: Math.cos(yaw) }
}
function flfOpen(level, x, y, z) {
  try {
    return !level.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)).blockState.isSolid() &&
      !level.getBlock(Math.floor(x), Math.floor(y) + 1, Math.floor(z)).blockState.isSolid()
  } catch (err) { return false }
}
// First standable spot (solid below, two open above) near y at x,z, or null.
function flfGround(level, x, z, y) {
  for (let dy = 6; dy >= -10; dy--) {
    var yy = Math.floor(y) + dy
    if (flfOpen(level, x, yy, z) && level.getBlock(Math.floor(x), yy - 1, Math.floor(z)).blockState.isSolid()) return yy
  }
  return null
}

// One footstep d blocks behind the player, after delay ticks (own function so each step keeps its own d).
function flfStep(server, p, f, d, delay) {
  flfLater(server, delay, () => flfSound(server, p, 'minecraft:block.gravel.step', p.x - f.x * d, p.y, p.z - f.z * d, 0.5, 0.8))
}

function flfScare(server, p) {
  let pick = Math.floor(Math.random() * 4)
  let f = flfFacing(p)
  if (pick === 0) {
    for (let i = 0; i < 3; i++) flfStep(server, p, f, 3 - i * 0.6, 6 + i * 7)
  } else if (pick === 1) {
    let a = Math.random() * Math.PI * 2
    flfSound(server, p, 'minecraft:block.wooden_door.open', p.x + Math.cos(a) * 9, p.y, p.z + Math.sin(a) * 9, 0.7, 0.9)
  } else if (pick === 2) {
    flfSound(server, p, 'minecraft:block.fire.extinguish', p.x + f.x * 2, p.y + 1, p.z + f.z * 2, 0.6, 1.2)
    hpCmd(server, 'effect give ' + p.uuid + ' minecraft:darkness 3 0 true')
  } else {
    let level = hpLvl(p)
    let a = Math.random() * Math.PI * 2
    let x = p.x + Math.cos(a) * 22, z = p.z + Math.sin(a) * 22
    let y = flfGround(level, x, z, p.y)
    if (y === null) return
    let dim = hpDim(level)
    hpCmd(server, 'execute in ' + dim + ' run summon minecraft:wither_skeleton ' + Math.floor(x) + '.5 ' + y + ' ' + Math.floor(z) + '.5' +
      ' {NoAI:1b,Silent:1b,Invulnerable:1b,PersistenceRequired:0b,DeathLootTable:"minecraft:empty",HandItems:[{},{}],Tags:["hp_v","hp_figure"]}')
    flfFigures.push({ dim: dim, x: Math.floor(x) + 0.5, y: y, z: Math.floor(z) + 0.5, born: server.tickCount })
  }
  console.info('[fluff] scare ' + ['footsteps', 'door', 'torch', 'figure'][pick] + ' for ' + p.username)
}

// Remove figures that a player walked up to (or that got old). Selected by tag + position, so no UUID lookups.
function flfFigureTick(server) {
  let keep = []
  flfFigures.forEach(fg => {
    let near = false
    server.players.forEach(p => { if (hpDim(hpLvl(p)) === fg.dim && hpDist2(p, fg.x, fg.y, fg.z) < 12 * 12) near = true })
    if (!near && server.tickCount - fg.born < FLF_FIGURE_LIFE) { keep.push(fg); return }
    let at = 'execute in ' + fg.dim + ' positioned ' + fg.x + ' ' + fg.y + ' ' + fg.z
    hpCmd(server, at + ' run particle minecraft:large_smoke ~ ~1 ~ 0.3 0.8 0.3 0.01 30')
    hpCmd(server, at + ' run kill @e[type=minecraft:wither_skeleton,tag=hp_figure,distance=..2]')
  })
  flfFigures = keep
}

ServerEvents.tick(event => {
  let server = event.server
  if (flfQueue.length > 0) {
    let due = flfQueue.filter(q => q.at <= server.tickCount)
    flfQueue = flfQueue.filter(q => q.at > server.tickCount)
    due.forEach(q => { try { q.run() } catch (err) { console.warn('[fluff] queued step failed: ' + err) } })
  }
  if (server.tickCount % 20 === 0 && flfFigures.length > 0) flfFigureTick(server)
  if (server.tickCount % FLF_SCARE_EVERY !== 0) return
  server.players.forEach(p => {
    if (p.isSpectator() || p.isCreative()) return
    if (!flfDark(server, p) || flfSafe(server, p)) return
    if (Math.random() < FLF_SCARE_CHANCE) flfScare(server, p)
  })
})

PlayerEvents.chestOpened(event => {
  let p = event.player
  let server = event.server
  if (p.isSpectator() || p.isCreative()) return
  if (!flfDark(server, p) || flfSafe(server, p)) return
  let name = String(p.username)
  if (flfAmbushAt[name] !== undefined && server.tickCount - flfAmbushAt[name] < FLF_AMBUSH_COOLDOWN) return
  if (Math.random() >= FLF_AMBUSH_CHANCE) return
  flfAmbushAt[name] = server.tickCount
  // The warning first
  hpCmd(server, 'title ' + p.uuid + ' actionbar ' + JSON.stringify({ text: 'Something heard the latch...', color: 'dark_red', italic: true }))
  flfSound(server, p, 'minecraft:entity.warden.heartbeat', p.x, p.y, p.z, 1, 0.8)
  flfLater(server, 30, () => flfSound(server, p, 'minecraft:entity.warden.heartbeat', p.x, p.y, p.z, 1, 1.0))
  // ~3 s later: a few zombies just behind where the player stood
  flfLater(server, 60, () => {
    let level = hpLvl(p)
    let f = flfFacing(p)
    let dim = hpDim(level)
    let placed = 0
    for (let d = 4; d >= 2 && placed === 0; d--) {
      var bx = p.x - f.x * d, bz = p.z - f.z * d
      if (!flfOpen(level, bx, p.y, bz)) continue
      for (let i = 0; i < 3; i++) {
        var side = (i - 1) * 0.8
        hpCmd(server, 'execute in ' + dim + ' run summon minecraft:zombie ' + (bx + f.z * side) + ' ' + Math.floor(p.y) + ' ' + (bz - f.x * side))
      }
      placed = 3
    }
    console.info('[fluff] chest ambush for ' + name + (placed ? '' : ' (no room behind: skipped)'))
  })
})
