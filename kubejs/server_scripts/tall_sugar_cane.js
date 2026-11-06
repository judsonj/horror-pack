// Sugar cane with no height cap: grows like vanilla (age 0-15 per random tick, then a new block on top)
// but keeps going until it hits a block or the build limit, instead of stopping at 3.
// BlockEvents.randomTick replaces vanilla's tick for sugar_cane (cancel() goes LAST: it exits the handler at once). Server script: `kubejs reload server-scripts` is enough.
BlockEvents.randomTick('minecraft:sugar_cane', event => {
  var b = event.block
  var up = b.up
  if (up.y >= event.level.maxBuildHeight) return
  if (!up.blockState.isAir()) return
  var age = parseInt(b.properties.age || '0')
  if (age >= 15) {
    up.set('minecraft:sugar_cane')
    b.set('minecraft:sugar_cane', { age: '0' })
  } else {
    b.set('minecraft:sugar_cane', { age: String(age + 1) })
  }
  event.cancel() // last: cancel() exits the handler, then vanilla's capped tick is skipped
})
