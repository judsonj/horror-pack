// XP onto belts: belts can't carry XP orbs, so any orb sitting on (or just above) a Create belt
// becomes Create Experience Nuggets (1 nugget = 3 XP, same as eating it back) dropped in place with no fling,
// so the belt carries them on to a Grindstone Drain / Enchantment Industry line.
// Leftover 1-2 XP becomes one more nugget by chance (fair on average). Orbs anywhere else are untouched.
// Rhino: var, not const/let, inside callbacks.
ServerEvents.tick(event => {
  var server = event.server
  if (server.tickCount % 20 !== 0) return
  server.getAllLevels().forEach(level => {
    var orbs = []
    level.getEntities().forEach(e => { if (String(e.type) === 'minecraft:experience_orb') orbs.push(e) })
    orbs.forEach(e => {
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z)
      var onBelt = false
      for (var dy = 0; dy >= -1; dy--) {
        if (String(level.getBlock(bx, by + dy, bz).id) === 'create:belt') onBelt = true
      }
      if (!onBelt) return
      var nbt = e.nbt
      var xp = (nbt.getInt('Value') || 0) * Math.max(1, nbt.getInt('Count') || 1)
      if (xp <= 0) return
      var n = Math.floor(xp / 3)
      if (Math.random() < (xp % 3) / 3) n++
      var x = e.x, y = e.y, z = e.z
      while (n > 0) {
        var c = Math.min(64, n)
        n -= c
        var ie = level.createEntity('minecraft:item')
        ie.item = Item.of('create:experience_nugget', c)
        ie.setPosition(x, y, z)
        ie.spawn()
      }
      e.discard() // only after the nuggets exist, so XP is never lost
    })
  })
})
