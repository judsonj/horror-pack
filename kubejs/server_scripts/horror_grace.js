// Grace period: horror mobs don't spawn during the first 3 in-game days (60 minutes) of server time after this
// script first runs, so a new group can build a base. Kenny keeps his own schedule (huntStartDay in kenny.json).
const GRACE_SECONDS = 3 * 20 * 60
const HORRORS = ['weeping_angels:', 'cave_dweller:', 'goofy_horror_mod:', 'the_knocker:', 'spore:', 'sporeinquisition:', 'infnexus:']

ServerEvents.tick(event => {
  if (event.server.tickCount % 20 !== 0) return
  const data = event.server.persistentData
  const s = data.getInt('horror_grace_seconds')
  if (s < GRACE_SECONDS) data.putInt('horror_grace_seconds', s + 1)
})

EntityEvents.spawned(event => {
  const id = String(event.entity.getEncodeId())
  if (!HORRORS.some(p => id.startsWith(p))) return
  if (event.server.persistentData.getInt('horror_grace_seconds') < GRACE_SECONDS) event.cancel()
})
