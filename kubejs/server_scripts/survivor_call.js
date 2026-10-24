// /callsurvivor: any player (no op needed) brings one survivor out of hiding next to them. This is what /claude
// suggests when someone asks for a survivor (config/survivors/claude_context.md). It runs the Survivors mod's own
// op-only "/survivors spawn" as the server, at the player.
// Limits: one per player per in-game day, CALL_DAILY_CAP per server per in-game day, overworld only, not during a raid.
const CALL_DAILY_CAP = 6

ServerEvents.commandRegistry(event => {
  const { commands: Commands } = event
  event.register(Commands.literal('callsurvivor').executes(ctx => {
    const p = ctx.source.player
    if (!p) return 0
    const server = ctx.source.server
    const name = String(p.username)
    if (!Platform.isLoaded('survivors')) { p.tell(Text.red('Survivors are not on this server.')); return 0 }
    if (hpDim(p.level()) !== 'minecraft:overworld') { p.tell(Text.gray('Nobody is hiding out here. Try the overworld.')); return 0 }
    const day = hpDay(server)
    if (p.persistentData.getInt('hp_call_day') === day + 1) { p.tell(Text.gray('You already called someone today. Try again tomorrow.')); return 0 }
    const data = server.persistentData
    if (data.getInt('hp_call_server_day') !== day + 1) { data.putInt('hp_call_server_day', day + 1); data.putInt('hp_call_count', 0) }
    if (data.getInt('hp_call_count') >= CALL_DAILY_CAP) { p.tell(Text.gray('No one else answers today.')); return 0 }
    const count = () => hpEntitiesNear(p.level(), p.x, p.y, p.z, 12, 8).filter(e => String(e.type) === 'survivors:survivor').length
    const before = count()
    server.runCommandSilent('execute as ' + name + ' at @s run survivors spawn')
    if (count() <= before) { p.tell(Text.gray('No one could get to you here. Try open ground.')); return 0 }
    p.persistentData.putInt('hp_call_day', day + 1)
    data.putInt('hp_call_count', data.getInt('hp_call_count') + 1)
    p.tell(Text.gold('Someone heard you. They come out slowly, hands up.'))
    console.info('[callsurvivor] ' + name + ' called a survivor (day ' + day + ', ' + data.getInt('hp_call_count') + ' today)')
    return 1
  }))
})
