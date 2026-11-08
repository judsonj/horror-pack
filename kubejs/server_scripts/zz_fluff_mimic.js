// Mimic scares. Nothing here places, breaks or changes a block, opens a door, or touches an inventory. Sound + chat only.
//   steps    ~15 s of footsteps a few blocks behind you, only while YOU are moving; silent the moment you stop
//   silence  ambient + music are stopped on and off for ~10 s, then ONE sound near you (partial: see note)
//   friends  a real friend who is OFFLINE "joins" then "leaves" (yellow, vanilla style), or says one slightly-wrong chat line
// Natural scares: only in the dark, never near a refuge, modest rate, per-player cooldown (this file's scares only).
// Admin test: /hpmimic steps|silence <player>   /hpmimic friend join|chat [name]
// NOTE (silence): AmbientSounds is client-side; the server can only stop vanilla ambient/music. The silence is PARTIAL.
// Load order: this file sorts BEFORE zz_fluff_mobs/zz_fluff_scares, so flf* helpers are only called from events/ticks, never at top level.
const MIM_ROLL_EVERY = 400            // ticks between scare rolls per player (20 s), offset from the fluff roll
const MIM_SCARE_CHANCE = 0.03         // per roll
const MIM_CAP_COUNT = 2               // shared cap: at most this many natural scares per player ...
const MIM_CAP_TICKS = 20 * 60 * 10    // ... in this window, across zz_fluff_scares.js and this file
const MIM_SILENCE_FIRST = 1 / 3       // chance a natural steps scare is preceded by the silence
const MIM_STEPS_TICKS = 20 * 15
const MIM_SILENCE_TICKS = 20 * 10
const MIM_SAMPLE = 4                  // ticks between position samples
const MIM_MOVE_MIN2 = 0.04            // squared blocks moved per sample that counts as "moving"
const MIM_FRIEND_ROLL_EVERY = 1200    // 1 min
const MIM_FRIEND_CHANCE = 1 / 90      // per roll with 2+ online: about once per 1.5 h of server time
const MIM_FRIEND_COOLDOWN = 20 * 60 * 30
const MIM_FRIEND_KEY = 'mim_names'    // server.persistentData: JSON list of every name that has joined
const MIM_CHAT_LINES = ['where did everyone go', 'i can see your torch', 'dont go down there', 'did you hear that', 'who else is here', 'its behind you', 'dont look back', 'someone is standing outside']
const MIM_SILENCE_END = ['minecraft:ambient.cave', 'minecraft:block.wooden_door.close', 'minecraft:entity.skeleton.step', 'minecraft:entity.warden.nearby_close']

let mimSteps = {}     // name -> { until, lastX, lastZ, dx, dz, lastStep, nextAt }
let mimSilence = {}   // name -> { until, nextAt, after: fn|null }
let mimScareLog = {}  // name -> ticks of recent scares (shared cap, fed by this file AND by flfScare via mimGate)
let mimLastFriend = -999999

// Shared scare cap. Called by flfScare (zz_fluff_scares.js, one-line hook) and by this file's natural rolls.
// Returns true and records the scare if the player is under the cap; false means skip this scare.
function mimGate(server, p) {
  let name = String(p.username), t = server.tickCount
  let log = (mimScareLog[name] || []).filter(x => t - x < MIM_CAP_TICKS)
  if (log.length >= MIM_CAP_COUNT) { mimScareLog[name] = log; return false }
  log.push(t); mimScareLog[name] = log
  return true
}
function mimPlayer(server, name) {
  let out = null
  server.players.forEach(p => { if (String(p.username) === name) out = p })
  return out
}
function mimOnlineLower(server) {
  let s = {}
  server.players.forEach(p => { s[String(p.username).toLowerCase()] = true })
  return s
}
function mimStepSound(p) {
  try {
    let id = String(hpLvl(p).getBlock(Math.floor(p.x), Math.floor(p.y - 0.5), Math.floor(p.z)).id)
    if (/stone|deepslate|brick|cobble|andesite|diorite|granite|tuff|basalt|blackstone|concrete/.test(id)) return 'minecraft:block.stone.step'
    if (/plank|wood|log|stairs|slab|door|fence/.test(id)) return 'minecraft:block.wood.step'
    if (/sand/.test(id)) return 'minecraft:block.sand.step'
    if (/grass|dirt|podzol|mud|moss|leaves/.test(id)) return 'minecraft:block.grass.step'
    if (/snow/.test(id)) return 'minecraft:block.snow.step'
  } catch (err) { /* fall through */ }
  return 'minecraft:block.gravel.step'
}

// ---------------------------------------------------------------- 1. mimic steps
function mimStartSteps(server, p, why, admin) {
  let name = String(p.username)
  mimSteps[name] = { until: server.tickCount + MIM_STEPS_TICKS, lastX: p.x, lastZ: p.z, dx: 0, dz: 1, lastStep: 0, nextAt: server.tickCount + MIM_SAMPLE, admin: !!admin }
  console.info('[mimic] steps for ' + name + ' (' + why + ')')
}
function mimStepTick(server) {
  Object.keys(mimSteps).forEach(name => { try {
    let st = mimSteps[name]
    let p = mimPlayer(server, name)
    if (p && !st.admin && (!flfDark(server, p) || flfSafe(server, p))) { delete mimSteps[name]; console.info('[mimic] steps ended for ' + name + ' (light or refuge)'); return }
    if (!p || server.tickCount >= st.until || !p.isAlive()) { delete mimSteps[name]; if (p) console.info('[mimic] steps ended for ' + name); return }
    if (server.tickCount < st.nextAt) return
    st.nextAt = server.tickCount + MIM_SAMPLE
    let mx = p.x - st.lastX, mz = p.z - st.lastZ
    st.lastX = p.x; st.lastZ = p.z
    let d2 = mx * mx + mz * mz
    if (d2 < MIM_MOVE_MIN2 || d2 > 9) return                 // standing still (or teleported): silence
    let len = Math.sqrt(d2)
    st.dx = mx / len; st.dz = mz / len
    if (server.tickCount - st.lastStep < 7) return             // walking cadence
    st.lastStep = server.tickCount
    let back = 3 + Math.random() * 1.5
    flfSound(server, p, mimStepSound(p), p.x - st.dx * back, p.y, p.z - st.dz * back, 0.45, 0.75 + Math.random() * 0.1)
  } catch (err) { delete mimSteps[name]; console.warn('[mimic] steps failed for ' + name + ': ' + err) } })
}

// ---------------------------------------------------------------- 2. the silence
function mimStartSilence(server, p, after, why, admin) {
  let name = String(p.username)
  mimSilence[name] = { until: server.tickCount + MIM_SILENCE_TICKS, nextAt: server.tickCount, after: after || null, n: 0, admin: !!admin }
  console.info('[mimic] silence for ' + name + ' (' + why + ')')
}
function mimSilenceTick(server) {
  Object.keys(mimSilence).forEach(name => { try {
    let st = mimSilence[name]
    let p = mimPlayer(server, name)
    if (!p) { delete mimSilence[name]; return }
    if (!st.admin && (!flfDark(server, p) || flfSafe(server, p))) { delete mimSilence[name]; console.info('[mimic] silence ended for ' + name + ' (light or refuge)'); return }
    if (server.tickCount >= st.until) {
      delete mimSilence[name]
      let a = Math.random() * Math.PI * 2
      let snd = MIM_SILENCE_END[Math.floor(Math.random() * MIM_SILENCE_END.length)]
      flfSound(server, p, snd, p.x + Math.cos(a) * 6, p.y, p.z + Math.sin(a) * 6, 0.7, 0.85)
      console.info('[mimic] silence broken for ' + name + ' with ' + snd + ' (stopsound sent ' + st.n + 'x)')
      if (st.after) { try { st.after() } catch (err) { console.warn('[mimic] after-silence step failed: ' + err) } }
      return
    }
    if (server.tickCount < st.nextAt) return
    st.nextAt = server.tickCount + 3 + Math.floor(Math.random() * 3)   // every 3-5 ticks
    hpCmd(server, 'stopsound ' + p.uuid + ' ambient')
    hpCmd(server, 'stopsound ' + p.uuid + ' music')
    st.n++
  } catch (err) { delete mimSilence[name]; console.warn('[mimic] silence failed for ' + name + ': ' + err) } })
}

// ---------------------------------------------------------------- 3. fake friends
function mimKnownNames(server) { return hpJson(server, MIM_FRIEND_KEY) }
function mimOfflineNames(server) {
  let on = mimOnlineLower(server)
  return mimKnownNames(server).filter(n => !on[String(n).toLowerCase()])
}
function mimIsOnline(server, name) { return !!mimOnlineLower(server)[String(name).toLowerCase()] }
function mimTranslate(server, key, args, color) {
  let c = { translate: key, with: args }
  if (color) c.color = color
  hpCmd(server, 'tellraw @a ' + JSON.stringify(c))
}
function mimFriendJoin(server, name) {
  mimTranslate(server, 'multiplayer.player.joined', [name], 'yellow')
  console.info('[mimic] fake join: ' + name)
  flfLater(server, 60 + Math.floor(Math.random() * 120), () => {
    if (mimIsOnline(server, name)) { console.info('[mimic] fake leave skipped, ' + name + ' really joined'); return }
    mimTranslate(server, 'multiplayer.player.left', [name], 'yellow')
    console.info('[mimic] fake leave: ' + name)
  })
}
function mimFriendChat(server, name) {
  let line = MIM_CHAT_LINES[Math.floor(Math.random() * MIM_CHAT_LINES.length)]
  hpCmd(server, 'tellraw @a ' + JSON.stringify({ translate: 'chat.type.text', with: [name, line] }))
  console.info('[mimic] fake chat: <' + name + '> ' + line)
}
// kind: 'join' or 'chat'; name optional (random offline friend). Returns a status string.
function mimFriend(server, kind, name) {
  if (!name) {
    let pool = mimOfflineNames(server)
    if (pool.length === 0) { console.info('[mimic] friend scare skipped: no offline friend known yet'); return 'no offline friend known yet' }
    name = pool[Math.floor(Math.random() * pool.length)]
  }
  if (mimIsOnline(server, name)) return name + ' is online: refused'
  if (kind === 'join') mimFriendJoin(server, name); else mimFriendChat(server, name)
  return kind + ' as ' + name
}

PlayerEvents.loggedIn(event => {
  try {
    let server = event.server
    let name = String(event.player.username)
    let list = mimKnownNames(server)
    if (!list.some(n => String(n).toLowerCase() === name.toLowerCase())) { list.push(name); hpSave(server, MIM_FRIEND_KEY, list) }
  } catch (err) { console.warn('[mimic] name record failed: ' + err) }
})

// ---------------------------------------------------------------- natural rolls + ticks
ServerEvents.tick(event => {
  let server = event.server
  let t = server.tickCount
  if (Object.keys(mimSteps).length > 0) mimStepTick(server)
  if (Object.keys(mimSilence).length > 0) mimSilenceTick(server)
  if (t % MIM_ROLL_EVERY === 200) {
    server.players.forEach(p => {
      let name = String(p.username)
      if (p.isSpectator() || p.isCreative()) return
      if (mimSteps[name] || mimSilence[name] || mimBusy2(name)) return
      if (!flfDark(server, p) || flfSafe(server, p)) return
      if (Math.random() >= MIM_SCARE_CHANCE) return
      if (!mimGate(server, p)) return
      let r = Math.random()
      if (r < 0.40) { if (Math.random() < MIM_SILENCE_FIRST) mimStartSilence(server, p, () => mimStartSteps(server, p, 'after silence'), 'natural'); else mimStartSteps(server, p, 'natural') }
      else if (r < 0.55) mimStartSilence(server, p, null, 'natural, alone')
      else if (r < 0.80) mimStartEyes(server, p, 'natural')
      else mimStartLantern(server, p, 'natural')
    })
  }
  if (t % MIM_FRIEND_ROLL_EVERY === 600) {
    if (Object.keys(mimOnlineLower(server)).length < 2) return
    if (t - mimLastFriend < MIM_FRIEND_COOLDOWN || Math.random() >= MIM_FRIEND_CHANCE) return
    mimLastFriend = t
    mimFriend(server, Math.random() < 0.5 ? 'join' : 'chat', null)
  }
})

// ---------------------------------------------------------------- admin triggers (skip the dark / refuge / cooldown / 2-online checks)
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
  let friendRun = (ctx, kind, name) => {
    try { return say(ctx, 'friend ' + mimFriend(ctx.source.server, kind, name)) } catch (e) { return say(ctx, 'script error: ' + e) }
  }
  event.register(Commands.literal('hpmimic').requires(s => s.hasPermission(2))
    .then(Commands.literal('steps').then(Commands.argument('player', Arguments.WORD.create(event)).executes(ctx =>
      withPlayer(ctx, (server, p) => { mimStartSteps(server, p, 'admin test', true); return say(ctx, 'steps started for ' + p.username) }))))
    .then(Commands.literal('silence').then(Commands.argument('player', Arguments.WORD.create(event)).executes(ctx =>
      withPlayer(ctx, (server, p) => { mimStartSilence(server, p, null, 'admin test', true); return say(ctx, 'silence started for ' + p.username) }))))
    .then(Commands.literal('friend')
      .then(Commands.literal('join').executes(ctx => friendRun(ctx, 'join', null))
        .then(Commands.argument('name', Arguments.WORD.create(event)).executes(ctx => friendRun(ctx, 'join', String(Arguments.WORD.getResult(ctx, 'name'))))))
      .then(Commands.literal('chat').executes(ctx => friendRun(ctx, 'chat', null))
        .then(Commands.argument('name', Arguments.WORD.create(event)).executes(ctx => friendRun(ctx, 'chat', String(Arguments.WORD.getResult(ctx, 'name'))))))
      .then(Commands.literal('names').executes(ctx => say(ctx, 'known friends: ' + mimKnownNames(ctx.source.server).join(', '))))))
})
