// Grace periods, counted in server seconds by one persistent counter that starts when this script first runs:
//  - general horrors (angels, dwellers, knocker, goofy): no spawns during the first 3 in-game days (60 minutes),
//    so a new group can build a base.
//  - the infection (spore, sporeinquisition, infnexus): a longer grace of 5 in-game days (100 minutes), so the group
//    can meet it prepared (gas mask, cold kit) before it arrives.
// Kenny keeps his own schedule (huntStartDay in kenny.json).
const GRACE_SECONDS = 3 * 20 * 60
const INFECTION_GRACE_SECONDS = 5 * 20 * 60
const HORRORS = ['weeping_angels:', 'cave_dweller:', 'goofy_horror_mod:', 'the_knocker:']
const INFECTION = ['spore:', 'sporeinquisition:', 'infnexus:']

ServerEvents.tick(event => {
  if (event.server.tickCount % 20 !== 0) return
  const data = event.server.persistentData
  const s = data.getInt('horror_grace_seconds')
  if (s < INFECTION_GRACE_SECONDS) data.putInt('horror_grace_seconds', s + 1)
})

EntityEvents.spawned(event => {
  const id = String(event.entity.getEncodeId())
  const s = event.server.persistentData.getInt('horror_grace_seconds')
  if (INFECTION.some(p => id.startsWith(p))) {
    if (s < INFECTION_GRACE_SECONDS) event.cancel()
  } else if (HORRORS.some(p => id.startsWith(p))) {
    if (s < GRACE_SECONDS) event.cancel()
  }
})
