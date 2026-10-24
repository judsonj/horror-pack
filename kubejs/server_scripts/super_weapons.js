// The Builders' super weapons. Items registered in startup_scripts/horror_items.js, recipes in kubejs/data/horrorpack/recipe.
// None of them breaks blocks (safe on a server). Needs safety.js (hp* helpers, hp_zones, noise).
//
// The Rail Lance: charge it on running Create machinery, then fire one line.
//   Charge: right-click any turning Create part while holding it. Each click adds |RPM| / 4 (max 32), up to 100.
//   Fire: right-click the air when full. A 96-block line: every living thing within 1.5 blocks takes 40 (horrors and
//   the infected 80; Spore's Proto/hivemind 250). Stops at the first solid block. Charge is kept per player.
// The Sunbreaker: an artificial sun for one night.
//   Right-click a Create part turning at 128 RPM or more, at night. For the rest of that night, within 64 blocks:
//   invisible light (level 15) every 8 blocks over the ground, no horror or infection can join, horrors already
//   there flee (removed in smoke), the infected burn, players get night vision. Ends at dawn. Then 3 in-game days to recharge.
// The Last Whistle: a train whistle the dark remembers.
//   Right-click: horrors and the infected within 20 blocks (40 while riding anything, a train seat included) are thrown
//   back, slowed and lit up for 10 s; the infected also take 8. Very loud (noise +40 for everyone near). 60 s cooldown.
// Op test command: /hpweapon lance|sun|whistle <x y z> [yaw] fires one from a spot with no player (batch test).

const SW_LANCE_RANGE = 96
const SW_SUN_RADIUS = 64
const SW_SUN_MIN_RPM = 128
const SW_SUN_RECHARGE_DAYS = 3
const SW_WHISTLE_COOLDOWN = 1200
const SW_BIG = /^spore:(proto|hivemind|.*nexus.*|.*calamity.*)|^infnexus:/

let swLastUse = {}   // player name -> tick (swallows the off-hand duplicate and the whistle cooldown)

function swHostile(id) { return hpIsHorror(id) || hpIsInfection(id) }

function swFx(server, dim, particle, x, y, z, dx, dy, dz, speed, count) {
  hpCmd(server, 'execute in ' + dim + ' run particle ' + particle + ' ' + x + ' ' + y + ' ' + z + ' ' + dx + ' ' + dy + ' ' + dz + ' ' + speed + ' ' + count + ' force')
}

function swSoundAt(server, dim, sound, x, y, z, volume, pitch) {
  hpCmd(server, 'execute in ' + dim + ' run playsound ' + sound + ' master @a ' + x + ' ' + y + ' ' + z + ' ' + volume + ' ' + pitch)
}

function swDamage(server, e, amount, by) {
  hpCmd(server, 'damage ' + e.uuid + ' ' + amount + ' minecraft:' + (by ? 'player_attack by ' + by : 'magic'))
}

// ------------------------------------------------------------------ Rail Lance
function swLanceFire(server, level, ox, oy, oz, yaw, pitch, shooter) {
  let dim = hpDim(level)
  let rad = Math.PI / 180
  let dx = -Math.sin(yaw * rad) * Math.cos(pitch * rad), dy = -Math.sin(pitch * rad), dz = Math.cos(yaw * rad) * Math.cos(pitch * rad)
  let len = SW_LANCE_RANGE
  for (let t = 1; t <= SW_LANCE_RANGE; t += 0.5) {
    let b = level.getBlock(Math.floor(ox + dx * t), Math.floor(oy + dy * t), Math.floor(oz + dz * t))
    if (b.blockState.isSolid()) { len = t; break }
  }
  for (let t = 1; t <= len; t += 1.5) swFx(server, dim, 'minecraft:end_rod', ox + dx * t, oy + dy * t, oz + dz * t, 0.05, 0.05, 0.05, 0.01, 2)
  swFx(server, dim, 'minecraft:electric_spark', ox + dx * len, oy + dy * len, oz + dz * len, 0.4, 0.4, 0.4, 0.2, 30)
  swSoundAt(server, dim, 'create:whistle_high', ox, oy, oz, 2, 1.6)
  swSoundAt(server, dim, 'minecraft:entity.lightning_bolt.impact', ox + dx * len / 2, oy + dy * len / 2, oz + dz * len / 2, 3, 1.2)
  let cx = ox + dx * len / 2, cy = oy + dy * len / 2, cz = oz + dz * len / 2
  let hits = 0
  hpEntitiesNear(level, cx, cy, cz, len / 2 + 2, len / 2 + 2).forEach(e => {
    if (!e.isLiving() || (shooter && String(e.uuid) === String(shooter.uuid))) return
    let ex = e.x - ox, ey = e.y + 0.9 - oy, ez = e.z - oz
    let along = ex * dx + ey * dy + ez * dz
    if (along < 0 || along > len) return
    let px = ex - dx * along, py = ey - dy * along, pz = ez - dz * along
    if (px * px + py * py + pz * pz > 1.5 * 1.5) return
    let id = String(e.type)
    swDamage(server, e, SW_BIG.test(id) ? 250 : swHostile(id) ? 80 : 40, shooter ? String(shooter.username) : null)
    hits++
  })
  hpAddNoise(server, dim, ox, oy, oz, 64, 30)
  console.info('[weapons] Rail Lance fired by ' + (shooter ? shooter.username : 'command') + ' in ' + dim + ': line ' + Math.round(len) + ' blocks, ' + hits + ' hit')
  return hits
}

// ------------------------------------------------------------------ Sunbreaker
function swSunStart(server, level, x, y, z, by) {
  let dim = hpDim(level)
  let zones = hpJson(server, 'hp_zones')
  let lights = []
  for (let gx = -SW_SUN_RADIUS; gx <= SW_SUN_RADIUS; gx += 8) for (let gz = -SW_SUN_RADIUS; gz <= SW_SUN_RADIUS; gz += 8) {
    if (gx * gx + gz * gz > SW_SUN_RADIUS * SW_SUN_RADIUS) continue
    let bx = Math.floor(x) + gx, bz = Math.floor(z) + gz
    let top = swGround(level, bx, bz)
    if (top === null) continue  // not loaded (or the void)
    let ly = top + 2
    if (String(level.getBlock(bx, ly, bz).id) !== 'minecraft:air') continue
    hpCmd(server, 'execute in ' + dim + ' run setblock ' + bx + ' ' + ly + ' ' + bz + ' minecraft:light[level=15] keep')
    lights.push([bx, ly, bz])
  }
  zones.push({ dim: dim, x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), r: SW_SUN_RADIUS, day: hpDay(server), by: by || '', lights: lights })
  hpSave(server, 'hp_zones', zones)
  swFx(server, dim, 'minecraft:flash', x, y + 30, z, 0, 0, 0, 0, 3)
  swFx(server, dim, 'minecraft:end_rod', x, y + 30, z, 6, 6, 6, 0.05, 300)
  swSoundAt(server, dim, 'minecraft:block.beacon.power_select', x, y, z, 4, 0.5)
  swSoundAt(server, dim, 'create:whistle_train', x, y, z, 4, 0.7)
  hpCmd(server, 'execute in ' + dim + ' positioned ' + x + ' ' + y + ' ' + z + ' run title @a[distance=..160] title ' + JSON.stringify({ text: 'SUNBREAK', color: 'gold' }))
  hpCmd(server, 'execute in ' + dim + ' positioned ' + x + ' ' + y + ' ' + z + ' run title @a[distance=..160] subtitle ' + JSON.stringify({ text: 'The Builders\' sun, for one night.', color: 'yellow' }))
  console.info('[weapons] Sunbreaker lit at ' + dim + ' ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z) + ' by ' + (by || 'command') + ': ' + lights.length + ' lights')
  return lights.length
}

function swSunTick(server) {
  let zones = hpJson(server, 'hp_zones')
  if (zones.length === 0) return
  let keep = []
  zones.forEach(zn => {
    let level = hpLevel(server, zn.dim)
    if (!level) return
    if (!hpIsNight(server) || hpDay(server) > zn.day + 1) {
      zn.lights.forEach(l => {
        if (String(level.getBlock(l[0], l[1], l[2]).id) === 'minecraft:light')
          hpCmd(server, 'execute in ' + zn.dim + ' run setblock ' + l[0] + ' ' + l[1] + ' ' + l[2] + ' minecraft:air')
      })
      console.info('[weapons] Sunbreaker at ' + zn.x + ' ' + zn.z + ' set (' + zn.lights.length + ' lights removed)')
      return
    }
    keep.push(zn)
    hpEntitiesNear(level, zn.x, zn.y, zn.z, zn.r, 64).forEach(e => {
      if ((e.x - zn.x) * (e.x - zn.x) + (e.z - zn.z) * (e.z - zn.z) > zn.r * zn.r) return
      let id = String(e.type)
      if (hpIsHorror(id)) {
        swFx(server, zn.dim, 'minecraft:large_smoke', e.x, e.y + 1, e.z, 0.3, 0.6, 0.3, 0.02, 20)
        e.discard()
      } else if (hpIsInfection(id) && e.isLiving()) {
        hpCmd(server, 'execute as ' + e.uuid + ' run data merge entity @s {Fire:100s}')
      }
    })
    server.players.forEach(p => {
      if (hpDim(p.level()) === zn.dim && (p.x - zn.x) * (p.x - zn.x) + (p.z - zn.z) * (p.z - zn.z) <= zn.r * zn.r)
        hpCmd(server, 'effect give ' + p.username + ' minecraft:night_vision 15 0 true')
    })
  })
  if (keep.length !== zones.length) hpSave(server, 'hp_zones', keep)
}

// ------------------------------------------------------------------ Last Whistle
function swWhistle(server, level, x, y, z, r, by) {
  let dim = hpDim(level)
  swSoundAt(server, dim, 'create:whistle_train', x, y, z, 6, 0.6)
  swSoundAt(server, dim, 'create:whistle_train_low', x, y, z, 6, 0.5)
  swFx(server, dim, 'minecraft:cloud', x, y + 1.5, z, r / 4, 1, r / 4, 0.1, 120)
  let n = 0
  hpEntitiesNear(level, x, y, z, r, 12).forEach(e => {
    let id = String(e.type)
    if (!swHostile(id) || !e.isLiving()) return
    let dx = e.x - x, dz = e.z - z, d = Math.max(1, Math.sqrt(dx * dx + dz * dz))
    if (d > r) return
    e.setDeltaMovement(new SW_Vec3(dx / d * 2.2, 0.6, dz / d * 2.2))
    e.hurtMarked = true
    hpCmd(server, 'effect give ' + e.uuid + ' minecraft:slowness 10 3 true')
    hpCmd(server, 'effect give ' + e.uuid + ' minecraft:glowing 10 0 true')
    if (hpIsInfection(id)) swDamage(server, e, 8, by)
    n++
  })
  hpAddNoise(server, dim, x, y, z, 64, 40)
  console.info('[weapons] Last Whistle by ' + (by || 'command') + ' r ' + r + ': ' + n + ' thrown back')
  return n
}

const SW_Vec3 = Java.loadClass('net.minecraft.world.phys.Vec3')
let SW_HEIGHTMAP = null
try { SW_HEIGHTMAP = Java.loadClass('net.minecraft.world.level.levelgen.Heightmap$Types').MOTION_BLOCKING } catch (e) { console.warn('[weapons] no Heightmap: ' + e) }

// Height of the ground (first air above the top motion-blocking block) in a loaded chunk, or null.
let swGroundWarned = false
function swGround(level, x, z) {
  let chunk = hpChunk(level, x >> 4, z >> 4)
  if (!chunk) return null
  try {
    let h = Number(chunk.getHeight(SW_HEIGHTMAP, x & 15, z & 15)) + 1
    if (!(h > Number(level.getMinBuildHeight()) + 1)) {
      if (!swGroundWarned) { swGroundWarned = true; console.warn('[weapons] odd ground at ' + x + ' ' + z + ': ' + h + ' min ' + level.getMinBuildHeight()) }
      return null
    }
    return h
  } catch (e) {
    if (!swGroundWarned) { swGroundWarned = true; console.warn('[weapons] ground height failed: ' + e) }
    return null
  }
}

// ------------------------------------------------------------------ player use
function swSpeedOf(block) {
  let be = block.entity
  if (!be) return 0
  try { return Math.abs(Number(be.getSpeed())) } catch (e) { return 0 }
}

function swOnce(event) {
  let name = String(event.player.username)
  let tick = event.server.tickCount
  if (String(event.hand) !== 'MAIN_HAND' || swLastUse[name + '/click'] === tick) return false
  swLastUse[name + '/click'] = tick
  return true
}

BlockEvents.rightClicked(event => {
  let item = String(event.item.id)
  if (item !== 'horrorpack:rail_lance' && item !== 'horrorpack:sunbreaker') return
  let p = event.player, server = event.server
  if (!swOnce(event)) { event.cancel(); return }
  let name = String(p.username)
  let speed = swSpeedOf(event.block)
  event.cancel()
  if (item === 'horrorpack:rail_lance') {
    if (speed <= 0) { hpBar(server, name, 'The Lance needs something turning.', 'gray'); return }
    let c = Math.min(100, p.persistentData.getInt('hp_lance_charge') + Math.min(32, Math.ceil(speed / 4)))
    p.persistentData.putInt('hp_lance_charge', c)
    hpBar(server, name, c >= 100 ? 'Rail Lance: charged. Aim and fire.' : 'Rail Lance: ' + c + '%', c >= 100 ? 'gold' : 'yellow')
    hpSound(server, name, 'create:steam', 0.6, 0.8 + c / 100)
    return
  }
  // Sunbreaker
  if (!hpIsNight(server)) { hpBar(server, name, 'The Sunbreaker only answers the night.', 'gray'); return }
  if (speed < SW_SUN_MIN_RPM) { hpBar(server, name, 'Not enough power: ' + Math.round(speed) + ' of ' + SW_SUN_MIN_RPM + ' RPM.', 'red'); return }
  let last = p.persistentData.getInt('hp_sun_day')
  if (last > 0 && hpDay(server) - last < SW_SUN_RECHARGE_DAYS) {
    hpBar(server, name, 'Still recharging: ' + (SW_SUN_RECHARGE_DAYS - (hpDay(server) - last)) + ' more day(s).', 'red'); return
  }
  p.persistentData.putInt('hp_sun_day', Math.max(1, hpDay(server)))
  let b = event.block
  swSunStart(server, p.level(), b.x + 0.5, b.y + 1, b.z + 0.5, name)
})

ItemEvents.rightClicked(event => {
  let item = String(event.item.id)
  if (item !== 'horrorpack:rail_lance' && item !== 'horrorpack:last_whistle') return
  if (!swOnce(event)) return
  let p = event.player, server = event.server
  let name = String(p.username)
  if (item === 'horrorpack:rail_lance') {
    if (p.persistentData.getInt('hp_lance_charge') < 100) {
      hpBar(server, name, 'Rail Lance: ' + p.persistentData.getInt('hp_lance_charge') + '%. Charge it on a turning shaft or cog.', 'yellow'); return
    }
    p.persistentData.putInt('hp_lance_charge', 0)
    swLanceFire(server, p.level(), p.x, p.y + p.getEyeHeight(), p.z, Number(p.yRot), Number(p.xRot), p)
    return
  }
  let last = swLastUse[name + '/whistle'] || -SW_WHISTLE_COOLDOWN
  if (server.tickCount - last < SW_WHISTLE_COOLDOWN) {
    hpBar(server, name, 'The Whistle needs ' + Math.ceil((SW_WHISTLE_COOLDOWN - (server.tickCount - last)) / 20) + ' s of steam.', 'gray'); return
  }
  swLastUse[name + '/whistle'] = server.tickCount
  swWhistle(server, p.level(), p.x, p.y, p.z, p.vehicle ? 40 : 20, name)
})

ServerEvents.tick(event => {
  if (event.server.tickCount % 100 === 30) { try { swSunTick(event.server) } catch (e) { console.warn('[weapons] sun tick: ' + e) } }
})

ServerEvents.commandRegistry(event => {
  let { commands: Commands, arguments: Arguments } = event
  let at = (kind, fn) => Commands.literal(kind).then(Commands.argument('pos', Arguments.BLOCK_POS.create(event)).executes(ctx => hpTry(ctx, () => {
    let pos = Arguments.BLOCK_POS.getResult(ctx, 'pos')
    let n = fn(ctx.source.server, ctx.source.level, pos.x + 0.5, pos.y, pos.z + 0.5)
    let text = 'hpweapon ' + kind + ' at ' + pos.x + ' ' + pos.y + ' ' + pos.z + ': ' + n
    ctx.source.sendSuccess(Text.of(text), false)
    console.info('[hpworld] ' + text)
    return 1
  })))
  event.register(Commands.literal('hpweapon').requires(s => s.hasPermission(2))
    .then(at('lance', (server, level, x, y, z) => swLanceFire(server, level, x, y + 1.6, z, 0, 0, null)))  // fires toward +z
    .then(at('sun', (server, level, x, y, z) => swSunStart(server, level, x, y, z, '')))
    .then(at('whistle', (server, level, x, y, z) => swWhistle(server, level, x, y, z, 20, null)))
    .then(Commands.literal('ground').then(Commands.argument('pos', Arguments.BLOCK_POS.create(event)).executes(ctx => hpTry(ctx, () => {
      const pos = Arguments.BLOCK_POS.getResult(ctx, 'pos')
      const level = ctx.source.level
      const chunk = hpChunk(level, pos.x >> 4, pos.z >> 4)
      const g = swGround(level, pos.x, pos.z)
      ctx.source.sendSuccess(Text.of('ground ' + pos.x + ' ' + pos.z + ': chunk ' + (chunk ? 'yes' : 'no') + ', ground ' + g +
        (g !== null ? ', block at +1: ' + level.getBlock(pos.x, g + 1, pos.z).id : '')), false)
      return 1
    }))))
    .then(Commands.literal('sun_tick').executes(ctx => { swSunTick(ctx.source.server); ctx.source.sendSuccess(Text.of('sun tick'), false); return 1 })))
})
