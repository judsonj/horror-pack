// Spore paces itself to how many people are on: nobody = total halt, 1 = slow, 2 = faster, 3+ = full speed.
// Works on new infection spawns (the Survivors Director lets them through, so gamerules don't stop them).
// Mobs that already exist are never touched: a mob seen once is marked and allowed when its chunk loads again.
// Random-tick block spread is paused at 0 players by idle_freeze.js.
const PACE_INFECTION = ['spore:', 'sporeinquisition:', 'inqui:', 'infnexus:']
const PACE_KEEP = [0, 1 / 3, 2 / 3, 1] // share of new infection spawns kept for 0, 1, 2, 3+ players

EntityEvents.spawned(event => {
  let e = event.entity
  let id = String(e.type)
  if (!PACE_INFECTION.some(p => id.startsWith(p))) return
  // Runs before regions.js and safety.js (name order); safety marks every mob it allows hp_seen, so old mobs carry it.
  if (e.persistentData.getBoolean('pace_seen') || e.persistentData.getBoolean('hp_seen')) return
  let players = event.server.playerCount
  let keep = PACE_KEEP[Math.min(players, 3)]
  if (id === 'spore:proto' && players > 0) keep = 1   // the Engine's story mob only waits for players, never thins out
  if (Math.random() >= keep) {
    event.cancel()
    return
  }
  e.persistentData.putBoolean('pace_seen', true)
})
