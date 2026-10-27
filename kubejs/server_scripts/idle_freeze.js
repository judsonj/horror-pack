// While nobody is online, slow the world down so Spore (and anything else) can't spread in loaded chunks.
// Turns off random ticks and mob spawning when the server empties; turns them back on the moment someone joins.
// The flag lives in persistentData, so a restart while idle still restores the world on the next join.
const IDLE_CHECK_EVERY = 100 // server ticks (5 seconds)
const IDLE_NORMAL_RANDOM_TICK_SPEED = 3 // vanilla default; change here if the server ever uses another value

function idleRestore(server) {
  const data = server.persistentData
  if (!data.getBoolean('idle_frozen')) return
  server.runCommandSilent('gamerule randomTickSpeed ' + IDLE_NORMAL_RANDOM_TICK_SPEED)
  server.runCommandSilent('gamerule doMobSpawning true')
  data.putBoolean('idle_frozen', false)
  console.info('[idle_freeze] player joined: world restored')
}

ServerEvents.tick(event => {
  const server = event.server
  if (server.tickCount % IDLE_CHECK_EVERY !== 0) return
  if (server.playerCount > 0) { idleRestore(server); return }
  const data = server.persistentData
  if (data.getBoolean('idle_frozen')) return
  data.putBoolean('idle_frozen', true)
  server.runCommandSilent('gamerule randomTickSpeed 0')
  server.runCommandSilent('gamerule doMobSpawning false')
  console.info('[idle_freeze] server empty: random ticks and mob spawning paused')
})

PlayerEvents.loggedIn(event => idleRestore(event.server))
