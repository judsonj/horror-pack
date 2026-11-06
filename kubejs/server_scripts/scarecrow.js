// The Scarecrow (block horrorpack:scarecrow, registered in startup_scripts/horror_items.js).
// Stands in for a player so the 3x3 chunks around it keep running while nobody is near or online:
//  - the chunks stay force-loaded, so machines, furnaces, hoppers and Create keep working;
//  - spawners in those chunks keep firing (vanilla spawners need a real player within range, so this script
//    runs the spawner's own rules for it, only when no real player is close enough for vanilla to do it).
// It does NOT bring back crop growth or natural mob spawns: idle_freeze.js still pauses those when the server is empty.
// Cap: 2 per FTB team (every player has at least a personal team). Positions live in persistentData 'scarecrows'.
// inqui:chunkloader runs "forceload remove all" every 5 min, so the forced chunks are re-asserted every second.
// Admin: /scarecrows list | add <pos> (no team cap) | remove <pos>

var SC_ID = 'horrorpack:scarecrow'
var SC_CAP = 2
var SC_RADIUS = 1            // chunks around its own chunk (1 = 3x3)
var SC_SPAWN_STEP = 20       // ticks between spawner checks
var SC_DESPAWN = 128         // vanilla: hostile mobs farther than this from every player despawn at once
var SC_TEAMS = null
try { SC_TEAMS = Java.loadClass('dev.ftb.mods.ftbteams.api.FTBTeamsAPI') } catch (e) { SC_TEAMS = null }
var SC_BlockPos = Java.loadClass('net.minecraft.core.BlockPos')
var SC_AABB = Java.loadClass('net.minecraft.world.phys.AABB')
var SC_SpawnerBE = Java.loadClass('net.minecraft.world.level.block.entity.SpawnerBlockEntity')
var SC_EntityType = Java.loadClass('net.minecraft.world.entity.EntityType')
var SC_Mob = Java.loadClass('net.minecraft.world.entity.Mob')
var SC_MobSpawnType = Java.loadClass('net.minecraft.world.entity.MobSpawnType')
var SC_SpawnPlacements = Java.loadClass('net.minecraft.world.entity.SpawnPlacements')
var SC_Enemy = Java.loadClass('net.minecraft.world.entity.monster.Enemy')
var SC_KEEP = 8               // blocks around a covered spawner where hostile mobs are kept from despawning

var scList = null            // [{d, x, y, z, team, teamName, owner}]
var scSpawners = {}          // "d|x,y,z" -> {delay}
var scSpawnerCache = {}      // scarecrow key -> [{x,y,z}] (rescanned every 30 s)

function scKey(d, x, y, z) { return d + '|' + x + ',' + y + ',' + z }
function scDim(level) {
  var d = level.dimension
  var k = typeof d === 'function' ? level.dimension() : d
  return String(typeof k.location === 'function' ? k.location() : k)
}
function scLoad(server) {
  if (scList) return scList
  try { scList = JSON.parse(String(server.persistentData.getString('scarecrows')) || '[]') } catch (e) { scList = [] }
  return scList
}
function scSave(server) { server.persistentData.putString('scarecrows', JSON.stringify(scList)) }
function scLevel(server, d) {
  var it = server.getAllLevels().iterator()
  while (it.hasNext()) { var l = it.next(); if (scDim(l) === d) return l }
  return null
}
function scTeam(p) {
  try {
    if (SC_TEAMS) {
      var api = SC_TEAMS.api()
      if (api.isManagerLoaded()) {
        var t = api.getManager().getTeamForPlayer(p)
        if (t.isPresent()) return { id: String(t.get().getId()), name: String(t.get().getShortName()) }
      }
    }
  } catch (e) { console.warn('[scarecrow] team lookup failed: ' + e) }
  return { id: String(p.getUUID()), name: String(p.getGameProfile().getName()) }
}
function scCovers(s, d, cx, cz) {
  return s.d === d && Math.abs((s.x >> 4) - cx) <= SC_RADIUS && Math.abs((s.z >> 4) - cz) <= SC_RADIUS
}
function scForce(level, s, on) {
  var d = scDim(level)
  for (var dx = -SC_RADIUS; dx <= SC_RADIUS; dx++) for (var dz = -SC_RADIUS; dz <= SC_RADIUS; dz++) {
    var cx = (s.x >> 4) + dx, cz = (s.z >> 4) + dz
    if (!on && scList.some(o => o !== s && scCovers(o, d, cx, cz))) continue  // another scarecrow still holds it
    level.setChunkForced(cx, cz, on)
  }
}
function scRemove(server, level, d, x, y, z, why) {
  var list = scLoad(server)
  var s = list.find(o => o.d === d && o.x === x && o.y === y && o.z === z)
  if (!s) return false
  scList = list.filter(o => o !== s)
  if (level) scForce(level, s, false)  // s is already off the list, so chunks another scarecrow holds stay forced
  delete scSpawnerCache[scKey(d, x, y, z)]
  scSave(server)
  console.info('[scarecrow] removed at ' + d + ' ' + x + ' ' + y + ' ' + z + ' (' + why + ')')
  return true
}
function scAdd(server, level, x, y, z, team, teamName, owner) {
  var s = { d: scDim(level), x: x, y: y, z: z, team: team, teamName: teamName, owner: owner }
  scLoad(server).push(s)
  scSave(server)
  scForce(level, s, true)
  console.info('[scarecrow] placed at ' + s.d + ' ' + x + ' ' + y + ' ' + z + ' by ' + owner + ' (team ' + teamName + ')')
  return s
}

BlockEvents.placed(SC_ID, event => {
  var p = event.player
  var level = event.level
  var pos = event.block.pos
  if (!p) { event.cancel(); return }  // machines can't place one: it has to belong to a team
  var server = level.server
  var t = scTeam(p)
  var mine = scLoad(server).filter(o => o.team === t.id)
  if (mine.length >= SC_CAP) {
    p.tell(Text.gold('Your team already has ' + SC_CAP + ' scarecrows standing watch. Take one down first.'))
    mine.forEach(o => p.tell(Text.gray('  ' + o.x + ' ' + o.y + ' ' + o.z + (o.d !== 'minecraft:overworld' ? ' (' + o.d + ')' : ''))))
    event.cancel()
    return
  }
  scAdd(server, level, pos.x, pos.y, pos.z, t.id, t.name, String(p.getGameProfile().getName()))
  p.tell(Text.gold('The scarecrow keeps watch. The ground around it stays awake while you\'re away.'))
  p.tell(Text.gray('Machines and spawners in the nearby chunks keep running. Crops still wait for you. (' + (mine.length + 1) + '/' + SC_CAP + ' for your team)'))
})

BlockEvents.broken(SC_ID, event => {
  var level = event.level
  var pos = event.block.pos
  scRemove(level.server, level, scDim(level), pos.x, pos.y, pos.z, 'broken')
})

// Vanilla BaseSpawner.serverTick, minus the "is a player near" gate, using the spawner's own saved settings.
function scSpawnerTick(server, level, d, x, y, z) {
  var bpos = new SC_BlockPos(x, y, z)
  var be = level.getBlockEntity(bpos)
  if (!(be instanceof SC_SpawnerBE)) return
  var tag = be.saveWithoutMetadata(level.registryAccess())
  var range = tag.getShort('RequiredPlayerRange')
  // A real player close enough for vanilla to run this spawner AND close enough (128) that its mobs don't despawn on
  // the spot? Then vanilla handles it. Otherwise (nobody on, or everyone far away) the scarecrow runs it, and marks its
  // mobs persistent so a far-off player doesn't make them vanish. MaxNearbyEntities still caps how many pile up.
  var r = range < 0 ? SC_DESPAWN : Math.min(range, SC_DESPAWN)
  var near = server.players.some(p => scDim(p.level) === d &&
    (p.x - x - 0.5) * (p.x - x - 0.5) + (p.y - y - 0.5) * (p.y - y - 0.5) + (p.z - z - 0.5) * (p.z - z - 0.5) < r * r)
  if (near) return
  var k = scKey(d, x, y, z)
  var st = scSpawners[k]
  if (!st) { st = scSpawners[k] = { delay: tag.getShort('Delay') } }
  st.delay -= SC_SPAWN_STEP
  if (st.delay > 0) return
  var minD = tag.getShort('MinSpawnDelay'), maxD = tag.getShort('MaxSpawnDelay')
  var next = () => { st.delay = maxD <= minD ? minD : minD + Math.floor(Math.random() * (maxD - minD)) }
  var entityTag = tag.getCompound('SpawnData').getCompound('entity')
  var typeOpt = SC_EntityType.by(entityTag)
  if (!typeOpt.isPresent()) { next(); return }
  var type = typeOpt.get()
  var count = tag.getShort('SpawnCount'), maxNear = tag.getShort('MaxNearbyEntities'), sr = tag.getShort('SpawnRange')
  var custom = tag.getCompound('SpawnData').contains('custom_spawn_rules')
  var onlyId = entityTag.size() === 1 && entityTag.contains('id')
  var rnd = level.getRandom()
  var spawned = 0
  for (var i = 0; i < count; i++) {
    var sx = x + (rnd.nextDouble() - rnd.nextDouble()) * sr + 0.5
    var sy = y + rnd.nextInt(3) - 1
    var sz = z + (rnd.nextDouble() - rnd.nextDouble()) * sr + 0.5
    if (!level.noCollision(type.getDimensions().makeBoundingBox(sx, sy, sz))) continue
    var spos = SC_BlockPos.containing(sx, sy, sz)
    if (!custom && !SC_SpawnPlacements.checkSpawnRules(type, level, SC_MobSpawnType.SPAWNER, spos, rnd)) continue
    var e = SC_EntityType.loadEntityRecursive(entityTag, level, en => { en.setPos(sx, sy, sz); return en })
    if (!e) { next(); return }
    var nearby = level.getEntities(type, new SC_AABB(bpos).inflate(sr), x => true).size()
    if (nearby >= maxNear) { next(); return }
    e.setPos(sx, sy, sz)
    if (e instanceof SC_Mob) {
      if ((!custom && !e.checkSpawnRules(level, SC_MobSpawnType.SPAWNER)) || !e.checkSpawnObstruction(level)) continue
      if (onlyId) e.finalizeSpawn(level, level.getCurrentDifficultyAt(e.blockPosition()), SC_MobSpawnType.SPAWNER, null)
      e.setPersistenceRequired()
    }
    if (!level.tryAddFreshEntityWithPassengers(e)) { next(); return }
    level.levelEvent(2004, bpos, 0)
    if (e instanceof SC_Mob) e.spawnAnim()
    spawned++
  }
  if (spawned > 0) next()
}

function scScanSpawners(level, s) {
  var found = []
  for (var dx = -SC_RADIUS; dx <= SC_RADIUS; dx++) for (var dz = -SC_RADIUS; dz <= SC_RADIUS; dz++) {
    var it = level.getChunk((s.x >> 4) + dx, (s.z >> 4) + dz).getBlockEntities().values().iterator()
    while (it.hasNext()) {
      var be = it.next()
      if (be instanceof SC_SpawnerBE) { var bp = be.getBlockPos(); found.push({ x: bp.getX(), y: bp.getY(), z: bp.getZ() }) }
    }
  }
  return found
}

ServerEvents.tick(event => {
  var server = event.server
  var tc = server.tickCount
  if (tc % SC_SPAWN_STEP !== 0) return
  var list = scLoad(server)
  if (list.length === 0) return
  var gone = []
  var seen = {}
  list.forEach(s => {
    var level = scLevel(server, s.d)
    if (!level) return
    scForce(level, s, true)  // cheap when already forced; undoes inqui's "forceload remove all"
    var sk = scKey(s.d, s.x, s.y, s.z)
    if (tc % 200 === 0 && String(level.getBlock(s.x, s.y, s.z).id) !== SC_ID) { gone.push([level, s]); return }
    if (!scSpawnerCache[sk] || tc % 600 === 0) scSpawnerCache[sk] = scScanSpawners(level, s)
    scSpawnerCache[sk].forEach(b => {
      var k = scKey(s.d, b.x, b.y, b.z)
      if (seen[k]) return  // two scarecrows covering one spawner: tick it once
      seen[k] = true
      try { scSpawnerTick(server, level, s.d, b.x, b.y, b.z) } catch (e) { console.warn('[scarecrow] spawner ' + k + ': ' + e) }
      // Mobs vanilla spawned here (a player in the spawner's range but far away) despawn at random once that player
      // is over 32 blocks off, and at once past 128. Keep the ones by a covered spawner.
      try {
        var it = level.getEntities(null, new SC_AABB(new SC_BlockPos(b.x, b.y, b.z)).inflate(SC_KEEP)).iterator()
        while (it.hasNext()) {
          var m = it.next()
          if (m instanceof SC_Enemy && m instanceof SC_Mob && !m.isPersistenceRequired()) m.setPersistenceRequired()
        }
      } catch (e) { console.warn('[scarecrow] keep ' + k + ': ' + e) }
    })
  })
  gone.forEach(g => scRemove(server, g[0], g[1].d, g[1].x, g[1].y, g[1].z, 'block missing'))
})

ServerEvents.commandRegistry(event => {
  var Commands = event.commands, Arguments = event.arguments
  var say = (ctx, text) => { ctx.source.sendSuccess(Text.of(text), false); console.info('[scarecrow] ' + text); return 1 }
  var safe = fn => ctx => { try { return fn(ctx) } catch (e) { console.warn('[scarecrow] command failed: ' + e); return say(ctx, 'failed: ' + e) } }
  event.register(Commands.literal('scarecrows').requires(s => s.hasPermission(2))
    .then(Commands.literal('list').executes(safe(ctx => {
      var list = scLoad(ctx.source.server)
      if (list.length === 0) return say(ctx, 'no scarecrows')
      list.forEach(s => say(ctx, s.d + ' ' + s.x + ' ' + s.y + ' ' + s.z + ' team ' + s.teamName + ' (by ' + s.owner + ')'))
      return list.length
    })))
    .then(Commands.literal('add').then(Commands.argument('pos', Arguments.BLOCK_POS.create(event)).executes(safe(ctx => {
      var pos = Arguments.BLOCK_POS.getResult(ctx, 'pos')
      var level = ctx.source.level
      level.getBlock(pos.x, pos.y, pos.z).set(SC_ID)
      scAdd(ctx.source.server, level, pos.x, pos.y, pos.z, 'admin', 'admin', 'admin')
      return say(ctx, 'scarecrow added at ' + pos.x + ' ' + pos.y + ' ' + pos.z)
    }))))
    .then(Commands.literal('remove').then(Commands.argument('pos', Arguments.BLOCK_POS.create(event)).executes(safe(ctx => {
      var pos = Arguments.BLOCK_POS.getResult(ctx, 'pos')
      var level = ctx.source.level
      var ok = scRemove(ctx.source.server, level, scDim(level), pos.x, pos.y, pos.z, 'admin')
      if (ok) level.getBlock(pos.x, pos.y, pos.z).set('minecraft:air')
      return say(ctx, ok ? 'scarecrow removed' : 'no scarecrow there')
    }))))
  )
})
