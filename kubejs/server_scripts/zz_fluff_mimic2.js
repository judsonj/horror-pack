// Mimic scares, batch 2. Same rules as zz_fluff_mimic.js: nothing places, breaks or changes a block, opens a door, or touches an inventory.
//   eyes      two red dots at head height out in the dark; blink; gone after ~5 s or when you come within 6 blocks (only you see them)
//   heartbeat a heartbeat that speeds up and gets louder as a horror stalker closes in (only that player hears it)
//   lantern   a dim, bobbing light 20-30 blocks off on a dark night outdoors; drifts away if you approach; goes out after ~60 s
//   deadone   the NEXT night, another player sees a still figure in the dead player's head and dark armour at their death spot
// Admin test: /hpmimic eyes|lantern|deadone <player>   /hpmimic heartbeat <player> <seconds>   (these skip dark/refuge/cap checks)
// Shared names with zz_fluff_mimic.js (mimGate, mimPlayer, ...) and the flf*/hp* helpers are only called at run time, never at top level.
const MIM_EYES_TICKS = 100
const MIM_EYES_VANISH2 = 6 * 6
const MIM_LANTERN_TICKS = 1200
const MIM_LANTERN_RUN2 = 12 * 12
const MIM_DEAD_KEY = 'mim_deaths'           // persistentData: JSON list of { name, dim, x, y, z, day, shown }
const MIM_DEAD_NEAR2 = 40 * 40
const MIM_DEAD_VANISH2 = 10 * 10
const MIM_HB_FAR = 32, MIM_HB_NEAR = 6
// Horror stalkers that get the proximity heartbeat (registry ids confirmed against the running server at test time).
const MIM_HB_MOBS = ['the_knocker:knocker', 'the_knocker:knockerstalk', 'the_knocker:knockerstalklooked', 'cave_dweller:cave_dweller',
  'the_obsessed:idk_stalker', 'the_obsessed:idk_stalker_behind', 'the_obsessed:idk_stalker_follow_close', 'the_obsessed:idk_stalker_lurker']

let mimEyes = {}      // name -> { x, y, z, px, pz, born, nextAt, admin }
let mimLantern = {}   // name -> { x, y, z, born, nextAt, admin }
let mimHb = {}        // name -> { dist, nextBeat, seen, fakeUntil }
let mimDead = {}      // name of viewer -> { idx, tag, x, y, z, dim, dx }

function mimPart(server, p, particle, x, y, z, spread, count) {
  hpCmd(server, 'execute in ' + hpDim(hpLvl(p)) + ' run particle ' + particle + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' ' + z.toFixed(2) + ' ' + spread + ' ' + spread + ' ' + spread + ' 0 ' + count + ' force ' + p.uuid)
}
function mimBusy2(name) { return !!(mimEyes[name] || mimLantern[name]) }
function mimDist2(p, x, y, z) { return hpDist2(p, x, y, z) }

// ---------------------------------------------------------------- a. eyes in the dark
function mimStartEyes(server, p, why) {
  let name = String(p.username), level = hpLvl(p)
  let f = flfFacing(p)
  for (let i = 0; i < 6; i++) {
    let a = (Math.random() - 0.5) * 1.4, d = 10 + Math.random() * 6
    let ca = Math.cos(a), sa = Math.sin(a)
    let dx = f.x * ca - f.z * sa, dz = f.x * sa + f.z * ca
    let x = p.x + dx * d, z = p.z + dz * d, y = p.y + 1.6
    if (!flfOpen(level, x, y - 1, z)) continue
    mimEyes[name] = { x: x, y: y, z: z, px: -dz * 0.18, pz: dx * 0.18, born: server.tickCount, nextAt: server.tickCount, admin: why === 'admin test' }
    console.info('[mimic] eyes for ' + name + ' at ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z) + ' (' + why + ')')
    return true
  }
  console.info('[mimic] eyes skipped for ' + name + ': no open spot ahead')
  return false
}
function mimEyesTick(server) {
  Object.keys(mimEyes).forEach(name => { try {
    let e = mimEyes[name], p = mimPlayer(server, name)
    let age = server.tickCount - e.born
    if (!p || age >= MIM_EYES_TICKS) { delete mimEyes[name]; console.info('[mimic] eyes faded for ' + name); return }
    if (mimDist2(p, e.x, e.y, e.z) < MIM_EYES_VANISH2) { delete mimEyes[name]; console.info('[mimic] eyes vanished early for ' + name + ' (too close)'); return }
    if (server.tickCount < e.nextAt) return
    e.nextAt = server.tickCount + 4
    // open 0-30, blink gap 30-38, open 38-62, gap 62-70, open 70-100
    let open = age < 30 || (age >= 38 && age < 62) || age >= 70
    if (!open) return
    let dust = 'minecraft:dust{color:[1.0,0.0,0.0],scale:0.7}'
    mimPart(server, p, dust, e.x + e.px, e.y, e.z + e.pz, 0, 1)
    mimPart(server, p, dust, e.x - e.px, e.y, e.z - e.pz, 0, 1)
  } catch (err) { delete mimEyes[name]; console.warn('[mimic] eyes failed for ' + name + ': ' + err) } })
}

// ---------------------------------------------------------------- b. heartbeat
function mimHbBeat(dist) {   // ticks between beats and volume for a distance
  let k = Math.max(0, Math.min(1, (dist - MIM_HB_NEAR) / (MIM_HB_FAR - MIM_HB_NEAR)))   // 0 near .. 1 far
  return { gap: Math.round(8 + k * 22), vol: 1.0 - k * 0.7, pitch: 1.15 - k * 0.3 }        // 0.4 s at 6 blocks .. 1.5 s at 32
}
function mimHbScan(server) {
  server.players.forEach(p => {
    let name = String(p.username)
    let st = mimHb[name] || (mimHb[name] = { dist: null, nextBeat: 0, fakeUntil: 0 })
    if (server.tickCount < st.fakeUntil) return
    if (p.isSpectator()) { st.dist = null; return }
    let best = null
    try {
      hpEntitiesNear(hpLvl(p), p.x, p.y, p.z, MIM_HB_FAR, MIM_HB_FAR).forEach(e => {
        if (MIM_HB_MOBS.indexOf(String(e.type)) < 0) return
        let d = Math.sqrt(mimDist2(p, e.x, e.y, e.z))
        if (d <= MIM_HB_FAR && (best === null || d < best)) best = d
      })
    } catch (err) { console.warn('[mimic] heartbeat scan failed for ' + name + ': ' + err) }
    if (best !== null && st.dist === null) console.info('[mimic] heartbeat starts for ' + name + ' (stalker ' + best.toFixed(0) + ' blocks)')
    if (best === null && st.dist !== null) console.info('[mimic] heartbeat stops for ' + name)
    st.dist = best
  })
}
function mimHbTick(server) {
  Object.keys(mimHb).forEach(name => {
    let st = mimHb[name]
    let p = mimPlayer(server, name)
    if (!p) { delete mimHb[name]; return }
    if (server.tickCount < st.fakeUntil) st.dist = st.fakeDist
    if (st.dist === null || server.tickCount < st.nextBeat) return
    let b = mimHbBeat(st.dist)
    st.nextBeat = server.tickCount + b.gap
    hpCmd(server, 'playsound minecraft:entity.warden.heartbeat master ' + p.uuid + ' ' + p.x + ' ' + p.y + ' ' + p.z + ' ' + b.vol.toFixed(2) + ' ' + b.pitch.toFixed(2))
  })
}

// ---------------------------------------------------------------- c. lantern in the field
function mimStartLantern(server, p, why) {
  let name = String(p.username), level = hpLvl(p)
  if (why !== 'admin test') {
    let outside = false
    try { outside = p.block.skyLight >= 12 && flfNight(server) } catch (err) { }
    if (!outside) { console.info('[mimic] lantern skipped for ' + name + ': not outside at night'); return false }
  }
  for (let i = 0; i < 6; i++) {
    let a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 10
    let x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d
    let y = flfGround(level, x, z, p.y)
    if (y === null) continue
    mimLantern[name] = { x: x, y: y + 1.6, z: z, born: server.tickCount, nextAt: server.tickCount, admin: why === 'admin test' }
    console.info('[mimic] lantern for ' + name + ' at ' + Math.floor(x) + ' ' + y + ' ' + Math.floor(z) + ' (' + why + ')')
    return true
  }
  console.info('[mimic] lantern skipped for ' + name + ': no ground found')
  return false
}
function mimLanternTick(server) {
  Object.keys(mimLantern).forEach(name => { try {
    let l = mimLantern[name], p = mimPlayer(server, name)
    let age = server.tickCount - l.born
    if (!p || age >= MIM_LANTERN_TICKS) { delete mimLantern[name]; console.info('[mimic] lantern went out for ' + name + ' (time)'); return }
    if (!l.admin && flfSafe(server, p)) { delete mimLantern[name]; console.info('[mimic] lantern went out for ' + name + ' (refuge)'); return }
    if (server.tickCount < l.nextAt) return
    l.nextAt = server.tickCount + 4
    let dx = l.x - p.x, dz = l.z - p.z, d2 = dx * dx + dz * dz
    if (d2 > 48 * 48) { delete mimLantern[name]; console.info('[mimic] lantern went out for ' + name + ' (lost)'); return }
    if (d2 < MIM_LANTERN_RUN2) {   // drift away, staying ahead of the player
      let d = Math.sqrt(d2) || 1
      let nx = l.x + dx / d * 1.3, nz = l.z + dz / d * 1.3
      let gy = flfGround(hpLvl(p), nx, nz, l.y - 1.6)
      if (gy !== null) { l.x = nx; l.z = nz; l.y = gy + 1.6 }
    }
    let bob = Math.sin(age / 9) * 0.25
    mimPart(server, p, 'minecraft:small_flame', l.x, l.y + bob, l.z, 0.04, 2)
    mimPart(server, p, 'minecraft:end_rod', l.x, l.y + bob + 0.1, l.z, 0.02, 1)
  } catch (err) { delete mimLantern[name]; console.warn('[mimic] lantern failed for ' + name + ': ' + err) } })
}

// ---------------------------------------------------------------- d. the one who died here
// Figure = NoAI zombie (silent, invulnerable, no loot) in the dead player's head + black leather armour. Easy NPC skin-by-name was not used (see notes).
EntityEvents.death(event => {
  try {
    let e = event.entity
    if (!e || !e.isPlayer()) return
    let server = e.server || event.server
    let list = hpJson(server, MIM_DEAD_KEY)
    list.push({ name: String(e.username), dim: hpDim(hpLvl(e)), x: Math.floor(e.x) + 0.5, y: Math.floor(e.y), z: Math.floor(e.z) + 0.5, day: hpDay(server), shown: false })
    if (list.length > 20) list = list.slice(list.length - 20)
    hpSave(server, MIM_DEAD_KEY, list)
    console.info('[mimic] death recorded for ' + e.username + ' at ' + Math.floor(e.x) + ' ' + Math.floor(e.y) + ' ' + Math.floor(e.z))
  } catch (err) { console.warn('[mimic] death record failed: ' + err) }
})
function mimDeadSummon(server, rec, tag, x, y, z) {
  let nbt = '{NoAI:1b,Silent:1b,Invulnerable:1b,PersistenceRequired:0b,IsBaby:0b,CanPickUpLoot:0b,DeathLootTable:"minecraft:empty",Tags:["hp_v","hp_mimicdead","' + tag + '"],' +
    'ArmorItems:[{id:"minecraft:leather_boots",count:1,components:{"minecraft:dyed_color":{rgb:1052688,show_in_tooltip:false}}},' +
    '{id:"minecraft:leather_leggings",count:1,components:{"minecraft:dyed_color":{rgb:1052688,show_in_tooltip:false}}},' +
    '{id:"minecraft:leather_chestplate",count:1,components:{"minecraft:dyed_color":{rgb:1052688,show_in_tooltip:false}}},' +
    '{id:"minecraft:player_head",count:1,components:{"minecraft:profile":' + JSON.stringify(rec.name) + '}}],HandItems:[{},{}],ArmorDropChances:[0.0f,0.0f,0.0f,0.0f]}'
  hpCmd(server, 'execute in ' + rec.dim + ' run summon minecraft:zombie ' + x + ' ' + y + ' ' + z + ' ' + nbt)
}
function mimDeadAt(rec) { return 'execute in ' + rec.dim + ' positioned ' + rec.x + ' ' + rec.y + ' ' + rec.z + ' ' }
function mimDeadStart(server, rec, viewer, idx, why) {
  let level = hpLvl(viewer)
  let y = flfGround(level, rec.x, rec.z, rec.y)
  if (y === null) return false
  let tag = 'mimdead' + idx
  mimDeadSummon(server, rec, tag, rec.x, y, rec.z)
  mimDead[String(viewer.username)] = { idx: idx, tag: tag, x: rec.x, y: y, z: rec.z, dim: rec.dim, born: server.tickCount, face: 0 }
  console.info('[mimic] deadone: ' + rec.name + "'s figure shown to " + viewer.username + ' (' + why + ')')
  return true
}
function mimDeadEnd(server, vname, st, why) {
  let at = 'execute in ' + st.dim + ' positioned ' + st.x + ' ' + st.y + ' ' + st.z + ' '
  hpCmd(server, at + 'run particle minecraft:large_smoke ~ ~1 ~ 0.3 0.8 0.3 0.01 30')
  hpCmd(server, at + 'run kill @e[type=minecraft:zombie,tag=hp_mimicdead,tag=' + st.tag + ',distance=..3]')
  delete mimDead[vname]
  console.info('[mimic] deadone vanished for ' + vname + ' (' + why + ')')
}
function mimDeadTick(server) {
  Object.keys(mimDead).forEach(vname => { try {
    let st = mimDead[vname], p = mimPlayer(server, vname)
    if (!p) { mimDeadEnd(server, vname, st, 'viewer left'); return }
    if (server.tickCount - st.born > 20 * 60 * 3) { mimDeadEnd(server, vname, st, 'time'); return }
    // nearest player to the figure decides who it faces and who scares it away
    let near = null, nd = 1e12
    server.players.forEach(q => { if (hpDim(hpLvl(q)) !== st.dim) return; let d = mimDist2(q, st.x, st.y, st.z); if (d < nd) { nd = d; near = q } })
    if (near === null) { mimDeadEnd(server, vname, st, 'nobody around'); return }
    if (nd < MIM_DEAD_VANISH2) { mimDeadEnd(server, vname, st, 'player came within 10 blocks'); return }
    let looked = false
    server.players.forEach(q => {
      if (hpDim(hpLvl(q)) !== st.dim) return
      let dx = st.x - q.x, dy = st.y + 1.6 - (q.y + 1.62), dz = st.z - q.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (d > 40 || d < 1) return
      let yaw = hpYawDeg(q) * Math.PI / 180, pit = hpPitchDeg(q) * Math.PI / 180
      let lx = -Math.sin(yaw) * Math.cos(pit), ly = -Math.sin(pit), lz = Math.cos(yaw) * Math.cos(pit)
      if ((dx * lx + dy * ly + dz * lz) / d > 0.985) looked = true
    })
    if (looked) { mimDeadEnd(server, vname, st, 'looked at'); return }
    if (server.tickCount - st.face >= 20) {
      st.face = server.tickCount
      hpCmd(server, 'execute in ' + st.dim + ' as @e[type=minecraft:zombie,tag=hp_mimicdead,tag=' + st.tag + ',distance=..3,x=' + st.x + ',y=' + st.y + ',z=' + st.z + '] at @s run tp @s ~ ~ ~ facing entity ' + near.uuid + ' eyes')
    }
  } catch (err) { try { mimDeadEnd(server, vname, mimDead[vname], 'error ' + err) } catch (e2) { delete mimDead[vname] } console.warn('[mimic] deadone failed for ' + vname + ': ' + err) } })
}
function mimDeadRoll(server) {
  if (!hpIsNight(server)) return
  let list = hpJson(server, MIM_DEAD_KEY), day = hpDay(server), changed = false
  list.forEach((rec, idx) => {
    if (rec.shown) return
    if (day > rec.day + 2) { rec.shown = true; changed = true; return }   // expired after 2 nights
    if (day < rec.day + 1) return                                         // the NEXT night, not tonight
    let busy = false
    Object.keys(mimDead).forEach(v => { if (mimDead[v].idx === idx) busy = true })
    if (busy) return
    let pick = null
    server.players.forEach(q => {
      if (pick || String(q.username).toLowerCase() === String(rec.name).toLowerCase() || q.isSpectator() || q.isCreative()) return
      if (hpDim(hpLvl(q)) !== rec.dim || mimDist2(q, rec.x, rec.y, rec.z) > MIM_DEAD_NEAR2) return
      if (mimDist2(q, rec.x, rec.y, rec.z) < MIM_DEAD_VANISH2) return
      if (!flfDark(server, q) || flfSafe(server, q)) return
      pick = q
    })
    if (pick === null || !mimGate(server, pick)) return
    if (mimDeadStart(server, rec, pick, idx, 'natural')) { rec.shown = true; changed = true }
  })
  if (changed) hpSave(server, MIM_DEAD_KEY, list)
}

// ---------------------------------------------------------------- ticks
ServerEvents.tick(event => {
  let server = event.server, t = server.tickCount
  if (t % 2 === 0) mimHbTick(server)
  if (t % 20 === 7) mimHbScan(server)
  if (t % 4 === 1) {
    if (Object.keys(mimEyes).length > 0) mimEyesTick(server)
    if (Object.keys(mimLantern).length > 0) mimLanternTick(server)
    if (Object.keys(mimDead).length > 0) mimDeadTick(server)
  }
  if (t % 100 === 50) { try { mimDeadRoll(server) } catch (err) { console.warn('[mimic] deadone roll failed: ' + err) } }
})

// ---------------------------------------------------------------- admin triggers
ServerEvents.commandRegistry(event => {
  const { commands: Commands, arguments: Arguments } = event
  let say = (ctx, text) => { ctx.source.sendSuccess(Text.of(text), false); console.info('[mimic] ' + text); return 1 }
  let withPlayer = (ctx, fn) => {
    try {
      let p = mimPlayer(ctx.source.server, String(Arguments.WORD.getResult(ctx, 'player')))
      if (!p) return say(ctx, 'no such player online')
      return fn(ctx.source.server, p)
    } catch (e) { return say(ctx, 'script error: ' + e) }
  }
  let player = () => Commands.argument('player', Arguments.WORD.create(event))
  event.register(Commands.literal('hpmimic').requires(s => s.hasPermission(2))
    .then(Commands.literal('eyes').then(player().executes(ctx => withPlayer(ctx, (server, p) =>
      say(ctx, mimStartEyes(server, p, 'admin test') ? 'eyes started for ' + p.username : 'eyes: no open spot ahead')))))
    .then(Commands.literal('lantern').then(player().executes(ctx => withPlayer(ctx, (server, p) =>
      say(ctx, mimStartLantern(server, p, 'admin test') ? 'lantern started for ' + p.username : 'lantern: no ground found')))))
    .then(Commands.literal('heartbeat').then(player().then(Commands.argument('dist', Arguments.INTEGER.create(event)).executes(ctx => withPlayer(ctx, (server, p) => {
      // test: pretend a stalker is <dist> blocks away for 10 s (real mobs are found by the once-a-second scan)
      let d = Number(Arguments.INTEGER.getResult(ctx, 'dist'))
      let st = mimHb[String(p.username)] || (mimHb[String(p.username)] = { dist: null, nextBeat: 0, fakeUntil: 0 })
      st.fakeUntil = server.tickCount + 200; st.fakeDist = d; st.dist = d
      return say(ctx, 'heartbeat test for ' + p.username + ' at ' + d + ' blocks for 10 s (gap ' + mimHbBeat(d).gap + ' ticks, vol ' + mimHbBeat(d).vol.toFixed(2) + ')')
    })))))
    .then(Commands.literal('deadone').then(player().executes(ctx => withPlayer(ctx, (server, p) => {
      // test: figure of a fake dead player "Ghost" 14 blocks ahead of the viewer, ignoring night/dark/cap
      let f = flfFacing(p)
      let rec = { name: 'Ghost', dim: hpDim(hpLvl(p)), x: Math.floor(p.x + f.x * 14) + 0.5, y: Math.floor(p.y), z: Math.floor(p.z + f.z * 14) + 0.5 }
      return say(ctx, mimDeadStart(server, rec, p, 999, 'admin test') ? 'deadone started for ' + p.username : 'deadone: no ground there')
    })))))
})
