// Horror Faces only haunt the dark: every 5 s in daytime, faces under open sky in the overworld vanish.
// Unless the Engine was stopped in Act 6 (engine_ending 'stopped', set by engine.js): then nothing sends them away.
ServerEvents.tick(event => {
  const server = event.server
  if (server.tickCount % 100 !== 0) return
  const level = server.overworld()
  if (!level.isDay()) return
  if (server.persistentData.getString('engine_ending') === 'stopped') return
  level.getEntities().forEach(entity => {
    if (String(entity.getEncodeId()).startsWith('goofy_horror_mod:') && level.canSeeSky(entity.blockPosition())) entity.discard()
  })
})
