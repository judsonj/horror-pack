// Create Guard: mobs and explosions can't break Create blocks (Create + its add-ons, trains, airships, Copycats, Octo Arms...).
// Players still break them normally (wrench, pickaxe). Three layers:
//   1. tags  minecraft:wither_immune + dragon_immune: the vanilla "do not break" lists that boss mobs and many modded mobs check
//   2. LivingDestroyBlockEvent: NeoForge's "a mob wants to break this block" hook, cancelled for Create blocks
//   3. explosions (creepers, TNT, Spore bombs, cannons...): Create blocks are removed from the blast's break list (they still take no damage)
// Mods that break blocks directly without asking the game (no event) can't be stopped from a script; test those mobs one by one.
const CG_NS = /^(create[a-z0-9_]*|railways|copycats|sable|aeronautics|simulated|offroad|tentaworks|aeroportals):/

function cgIsCreate(state) {
  try { return CG_NS.test(String(state.getBlock().builtInRegistryHolder().key().location())) } catch (e) { return false }
}

ServerEvents.tags('block', event => {
  event.add('minecraft:wither_immune', CG_NS)
  event.add('minecraft:dragon_immune', CG_NS)
})

let cgBlocked = 0
NativeEvents.onEvent('net.neoforged.neoforge.event.entity.living.LivingDestroyBlockEvent', e => {
  try {
    if (cgIsCreate(e.getState())) { e.setCanceled(true); cgBlocked++ }
  } catch (err) { }
})

NativeEvents.onEvent('net.neoforged.neoforge.event.level.ExplosionEvent$Detonate', e => {
  try {
    let level = e.getLevel()
    let list = e.getAffectedBlocks()
    let before = list.size()
    list.removeIf(pos => cgIsCreate(level.getBlockState(pos)))
    let saved = before - list.size()
    if (saved > 0) { cgBlocked += saved; console.info('[create_guard] explosion: kept ' + saved + ' Create blocks') }
  } catch (err) { console.warn('[create_guard] explosion hook: ' + err) }
})

ServerEvents.commandRegistry(event => {
  const { commands: Commands } = event
  event.register(Commands.literal('createguard').requires(s => s.hasPermission(2)).executes(ctx => {
    ctx.source.sendSuccess(Text.of('[create_guard] on; blocked ' + cgBlocked + ' mob/explosion breaks since the last reload'), false)
    return 1
  }))
})
