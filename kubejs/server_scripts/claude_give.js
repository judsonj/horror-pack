// /hpgive <item id> [count]: lets /claude's [Run] button hand the OPERATOR items without op rights.
// Only names in CG_ALLOWED can use it; anyone else gets a polite no. Every give is logged ([claude_give]).
// Nothing else changes: /claude still never runs commands itself, it only shows a [Run] button the player clicks.
const CG_ALLOWED = ['New_Indixico']
const CG_MAX = 64

ServerEvents.commandRegistry(event => {
  const { commands: Commands, arguments: Arguments } = event
  let run = (ctx, text) => {
    let src = ctx.source
    let p = src.player
    if (!p) { src.sendFailure(Text.of('Players only.')); return 0 }
    let name = String(p.username)
    if (CG_ALLOWED.indexOf(name) < 0) {
      src.sendFailure(Text.of('Sorry, item gifts are for the server owner only.'))
      console.info('[claude_give] refused ' + name + ': ' + text)
      return 0
    }
    let parts = String(text).trim().split(/\s+/)
    let id = parts[0].toLowerCase()
    if (id.indexOf(':') < 0) id = 'minecraft:' + id
    if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id)) { src.sendFailure(Text.of('That is not an item id: ' + id)); return 0 }
    let n = parts.length > 1 ? parseInt(parts[1], 10) : 1
    if (!(n >= 1)) n = 1
    if (n > CG_MAX) n = CG_MAX
    if (Item.of(id).isEmpty()) { src.sendFailure(Text.of('No such item: ' + id)); return 0 }
    src.server.runCommandSilent('give ' + name + ' ' + id + ' ' + n)
    src.sendSuccess(Text.of('Gave you ' + n + ' x ' + id), false)
    console.info('[claude_give] ' + name + ' got ' + n + ' x ' + id)
    return 1
  }
  event.register(Commands.literal('hpgive')
    .then(Commands.argument('item', Arguments.GREEDY_STRING.create(event)).executes(ctx =>
      run(ctx, Arguments.GREEDY_STRING.getResult(ctx, 'item')))))
})
