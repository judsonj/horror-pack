// Enchanting tables re-roll for each nearby player when their bookshelves change.
// A sticky piston that moves a shelf in or out of the table's ring is the trigger.
// Each player gets their own roll: their enchantment seed is changed, so the options they see shift.
const REROLL_RADIUS = 8 // blocks around a player to scan for tables
const CHECK_EVERY = 40 // server ticks (2 seconds)
const shelfCounts = {} // "dimension|x,y,z" -> shelves last seen around that table
const ENCH_ItemStack = Java.loadClass('net.minecraft.world.item.ItemStack')
const ENCH_BlockTags = Java.loadClass('net.minecraft.tags.BlockTags')

// Same ring vanilla checks: the 5x5 border, two blocks high, with a see-through block halfway to the table.
function shelvesAround(level, x, y, z) {
  let count = 0
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue
      for (let dy = 0; dy <= 1; dy++) {
        if (!level.getBlock(x + Math.trunc(dx / 2), y + dy, z + Math.trunc(dz / 2)).blockState['is(net.minecraft.tags.TagKey)'](ENCH_BlockTags.ENCHANTMENT_POWER_TRANSMITTER)) continue
        if (level.getBlock(x + dx, y + dy, z + dz).blockState['is(net.minecraft.tags.TagKey)'](ENCH_BlockTags.ENCHANTMENT_POWER_PROVIDER)) count++
      }
    }
  }
  return count
}

ServerEvents.tick(event => {
  const server = event.server
  if (server.tickCount % CHECK_EVERY !== 0) return
  const players = server.players
  if (players.length === 0) return

  const seen = {}
  players.forEach(player => {
    const level = player.level
    const dim = String(level.dimension)
    const px = Math.floor(player.x)
    const py = Math.floor(player.y)
    const pz = Math.floor(player.z)
    for (let x = px - REROLL_RADIUS; x <= px + REROLL_RADIUS; x++) {
      for (let y = py - 4; y <= py + 4; y++) {
        for (let z = pz - REROLL_RADIUS; z <= pz + REROLL_RADIUS; z++) {
          if (level.getBlock(x, y, z).id !== 'minecraft:enchanting_table') continue
          var key = dim + '|' + x + ',' + y + ',' + z
          if (seen[key]) continue
          seen[key] = true
          var count = shelvesAround(level, x, y, z)
          var before = shelfCounts[key]
          shelfCounts[key] = count
          if (before === undefined || before === count) continue
          // The shelves changed: every player near this table gets a fresh roll.
          players.forEach(p => {
            if (String(p.level.dimension) !== dim) return
            var d = Math.abs(p.x - x) + Math.abs(p.y - y) + Math.abs(p.z - z)
            if (d > REROLL_RADIUS * 2) return
            // 1.21.1 has no setEnchantmentSeed; this is vanilla's own re-roll (costs 0 levels here).
            p.minecraftPlayer.onEnchantmentPerformed(ENCH_ItemStack.EMPTY, 0)
          })
        }
      }
    }
  })
})
