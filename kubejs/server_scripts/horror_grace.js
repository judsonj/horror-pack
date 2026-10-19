// FALLBACK ONLY. With the Survivors mod loaded, the grace period and every spawn rule below live in its horror director
// (horror/Director.java: general horrors 3 in-game days, infection 5, Tuning graceDays / infectionGraceDays, budget and
// role cards in config/survivors/director.json, and the Act 6 ending effects via its flags). This script only runs when
// the Survivors mod is NOT loaded, so the old rules still hold if the jar is ever missing. With the mod present it does
// nothing (it would otherwise also cancel /director force during grace).
// Rules kept here, counted in server seconds by one persistent counter that starts when this script first runs:
//  - general horrors: no spawns during the first 3 in-game days (60 minutes), so a new group can build a base.
//  - the infection (spore, sporeinquisition, inqui, infnexus): 5 in-game days (100 minutes), so the group can meet it prepared.
//  - after Act 6 (engine.js sets server.persistentData engine_ending once, for good):
//    'turning': general horrors never spawn in block light 8+ or within 128 blocks of the Engine; the infection is unchanged.
//    'stopped': 3 in 4 infection spawns are cancelled, none within 160 blocks of the Engine (spore:proto excepted).
// Kenny keeps his own schedule (huntStartDay in kenny.json).
if (!Platform.isLoaded('survivors')) {
  const GRACE_SECONDS = 3 * 20 * 60
  const INFECTION_GRACE_SECONDS = 5 * 20 * 60
  // same namespaces as the mod's horror/Horrors.java
  const HORRORS = ['weeping_angels:', 'cave_dweller:', 'kenny:', 'the_knocker:', 'the_boy_and_the_bath:', 'scp_ultimate:',
    'thewatcher:', 'arphex:', 'the_backwoods:', 'the_obsessed:']
  const INFECTION = ['spore:', 'sporeinquisition:', 'inqui:', 'infnexus:']

  ServerEvents.tick(event => {
    if (event.server.tickCount % 20 !== 0) return
    const data = event.server.persistentData
    const s = data.getInt('horror_grace_seconds')
    if (s < INFECTION_GRACE_SECONDS) data.putInt('horror_grace_seconds', s + 1)
  })

  function graceNearEngine(event, data, r) {
    if (String(event.level.dimension().location()) !== data.getString('engine_dim')) return false
    const e = event.entity
    const dx = e.x - data.getInt('engine_x'), dz = e.z - data.getInt('engine_z')
    return dx * dx + dz * dz <= r * r
  }

  EntityEvents.spawned(event => {
    const id = String(event.entity.getEncodeId())
    const data = event.server.persistentData
    const s = data.getInt('horror_grace_seconds')
    const ending = data.getString('engine_ending')
    if (INFECTION.some(p => id.startsWith(p))) {
      if (s < INFECTION_GRACE_SECONDS) event.cancel()
      else if (ending === 'stopped' && id !== 'spore:proto' && (graceNearEngine(event, data, 160) || Math.random() < 0.75)) event.cancel()
    } else if (HORRORS.some(p => id.startsWith(p))) {
      if (s < GRACE_SECONDS) event.cancel()
      else if (ending === 'turning' && (event.entity.block.blockLight >= 8 || graceNearEngine(event, data, 128))) event.cancel()
    }
  })
}
