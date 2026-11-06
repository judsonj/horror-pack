// Fall-damage mob farms give XP: vanilla only drops XP when a player (or a Create deployer) hit the mob recently,
// so drop-tower farms make none. A hostile mob that dies from a fall with no player credit drops Create
// Experience Nuggets instead (5 XP like a zombie/skeleton/creeper kill: 1 nugget + a 2-in-3 chance of a 2nd),
// as items, so belts carry them to a Grindstone Drain like any other drop.
// Rhino: var, not const/let, inside callbacks.
var FKX_Enemy = Java.loadClass('net.minecraft.world.entity.monster.Enemy')

EntityEvents.death(event => {
  var e = event.entity
  if (!e.isLiving() || e.isPlayer()) return
  if (!(e instanceof FKX_Enemy)) return // hostile mobs only (KubeJS getType() is a string, no category)
  var src = event.source
  if (String(src.getType()) !== 'fall') return
  if (e.getLastHurtByMob && e.getLastHurtByMob() && e.getLastHurtByMob().isPlayer()) return // vanilla already pays XP
  var n = 1 + (Math.random() < 2 / 3 ? 1 : 0)
  var ie = e.level.createEntity('minecraft:item')
  ie.item = Item.of('create:experience_nugget', n)
  ie.setPosition(e.x, e.y + 0.2, e.z)
  ie.spawn()
})
