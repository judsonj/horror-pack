// Spore zone: the infection belongs in deserts and mushroom fields only (overworld).
// 1) A new infection mob trying to appear anywhere else is refused.
// 2) Every 10 s, infection mobs that wandered out of their zone (into a forest, plains...) crumble to smoke.
// Protos are exempt (the Engine's story mob). Other dimensions are untouched.
// Needs safety.js (hpDim, hpLvl).
const SZ_INFECTION = ['spore:', 'sporeinquisition:', 'inqui:', 'infnexus:']
const SZ_ALLOWED = ['minecraft:desert', 'minecraft:mushroom_fields']
const SZ_ALLOWED_TAGS = ['c:is_desert', 'c:is_mushroom']
const SZ_BlockPos = Java.loadClass('net.minecraft.core.BlockPos')

function szIsInfection(t) { return SZ_INFECTION.some(p => t.startsWith(p)) }

function szAllowedAt(level, x, y, z) {
  try {
    const holder = level.getBiome(SZ_BlockPos.containing(x, y, z))
    const id = String(holder.unwrapKey().get().location())
    if (SZ_ALLOWED.indexOf(id) >= 0) return true
    let ok = false
    holder.tags().forEach(tag => { if (SZ_ALLOWED_TAGS.indexOf(String(tag.location())) >= 0) ok = true })
    return ok
  } catch (err) { return true } // if the biome can't be read, don't interfere
}

EntityEvents.spawned(event => {
  const e = event.entity
  const t = String(e.type)
  if (!szIsInfection(t) || t === 'spore:proto' || !e.isLiving()) return
  const level = hpLvl(e)
  if (hpDim(level) !== 'minecraft:overworld') return
  if (!szAllowedAt(level, e.x, e.y, e.z)) event.cancel()
})

ServerEvents.tick(event => {
  const server = event.server
  if (server.tickCount % 200 !== 0) return
  const level = server.overworld()
  let n = 0
  level.getEntities().forEach(e => {
    const t = String(e.type)
    if (!szIsInfection(t) || t === 'spore:proto' || !e.isLiving()) return
    if (szAllowedAt(level, e.x, e.y, e.z)) return
    server.runCommandSilent('execute in minecraft:overworld run particle minecraft:large_smoke ' + e.x + ' ' + (e.y + 1) + ' ' + e.z + ' 0.3 0.6 0.3 0.02 20 force')
    e.discard()
    n++
  })
  if (n > 0) console.info('[spore_zone] removed ' + n + ' infection mob(s) outside desert/mushroom biomes')
})
