// Horror Faces only haunt the dark: every 5 s in daytime, faces under open sky in the overworld vanish.
ServerEvents.tick(event => {
  const server = event.server
  if (server.tickCount % 100 !== 0) return
  const level = server.overworld()
  if (!level.isDay()) return
  level.getEntities().forEach(entity => {
    if (String(entity.type).startsWith('goofy_horror_mod:') && level.canSeeSky(entity.blockPosition())) entity.discard()
  })
})
