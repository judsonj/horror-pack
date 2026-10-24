// New-world move-in: inventories, quests and teams are carried into a fresh world by copying playerdata, so a player's
// saved position still points into the OLD world (maybe the sky, inside a hill, or another dimension). On the first login
// to a world whose seed this player hasn't seen, they are moved to the overworld spawn once. Flag: player persistentData
// hp_world_seed (the overworld seed as a string). Brand-new players get it too, which is harmless.
PlayerEvents.loggedIn(event => {
  const p = event.player
  const server = event.server
  let seed = ''
  try { seed = String(server.overworld().getSeed()) } catch (e) { return }
  if (String(p.persistentData.getString('hp_world_seed')) === seed) return
  p.persistentData.putString('hp_world_seed', seed)
  const sp = server.overworld().getSharedSpawnPos()
  const name = String(p.username)
  server.runCommandSilent('execute in minecraft:overworld run tp ' + name + ' ' + (sp.x + 0.5) + ' ' + sp.y + ' ' + (sp.z + 0.5))
  server.runCommandSilent('effect give ' + name + ' minecraft:resistance 10 4 true')
  p.tell(Text.gray('New world. Your things came with you. The trains still run.'))
  console.info('[world_move] ' + name + ' moved to spawn ' + sp.x + ' ' + sp.y + ' ' + sp.z + ' (new world)')
})
