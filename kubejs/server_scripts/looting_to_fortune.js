// Looting <-> Fortune, same level (I -> I, II -> II, III -> III).
// 1) Book recipe: an enchanted book + 1 lapis lazuli swaps Looting <-> Fortune at the same level
//    (books holding both, or neither, give nothing). Other enchantments on the book stay.
// 2) Automatic: kubejs/data/minecraft/enchantment/{looting,fortune}.json let both go on swords AND mining tools
//    (tag horror:loot_or_fortune). Every second, each player's inventory is swept: Looting on a mining tool becomes
//    Fortune, Fortune on a sword becomes Looting. A mining tool with Silk Touch keeps its Looting (Fortune can't sit with Silk Touch).
// Rhino: no const/let inside callbacks (redeclaration errors on the second run), use var.
let lfSrv = null

ServerEvents.recipes(event => {
  event.shapeless('minecraft:enchanted_book', ['minecraft:enchanted_book', 'minecraft:lapis_lazuli'])
    .modifyResult('horror:lf_swap')
    .id('horror:looting_fortune_swap')
})

// KubeJS 2101: modifyResult takes an id; the work happens in this event. Exit with the item to give (empty = no craft).
ServerEvents.modifyRecipeResult('horror:lf_swap', event => {
  var src = null
  for (var i = 0; i < event.grid.size(); i++) {
    var it = event.grid.getItem(i)
    if (!it.isEmpty() && String(it.getItem()) === 'minecraft:enchanted_book') src = it
  }
  if (!lfSrv || !src) { event.exit(Item.empty); return }
  var hh = lfHolders(lfSrv)
  var L = LF_EH.getEnchantmentsForCrafting(src).getLevel(hh.looting)
  var F = LF_EH.getEnchantmentsForCrafting(src).getLevel(hh.fortune)
  if ((L > 0) === (F > 0)) { event.exit(Item.empty); return }
  var out = src.copyWithCount(1)
  if (L > 0) lfSwap(out, hh.looting, hh.fortune)
  else lfSwap(out, hh.fortune, hh.looting)
  event.exit(out)
})

const LF_EH = Java.loadClass('net.minecraft.world.item.enchantment.EnchantmentHelper')
const LF_Registries = Java.loadClass('net.minecraft.core.registries.Registries')
const LF_ResourceKey = Java.loadClass('net.minecraft.resources.ResourceKey')
const LF_RL = Java.loadClass('net.minecraft.resources.ResourceLocation')
const LF_TagKey = Java.loadClass('net.minecraft.tags.TagKey')
const LF_SWORD = LF_TagKey.create(LF_Registries.ITEM, LF_RL.parse('minecraft:enchantable/sword'))
const LF_MINING = LF_TagKey.create(LF_Registries.ITEM, LF_RL.parse('minecraft:enchantable/mining_loot'))
let lfH = null // { looting, fortune, silk } holders, filled on first use

function lfHolders(server) {
  if (lfH) return lfH
  var reg = server.registryAccess().registryOrThrow(LF_Registries.ENCHANTMENT)
  var get = id => reg.getHolderOrThrow(LF_ResourceKey.create(LF_Registries.ENCHANTMENT, LF_RL.parse(id)))
  lfH = { looting: get('minecraft:looting'), fortune: get('minecraft:fortune'), silk: get('minecraft:silk_touch') }
  return lfH
}

function lfIs(stack, tag) { return stack['is(net.minecraft.tags.TagKey)'](tag) }

// Moves `from` onto `to` at the higher of the two levels. Returns true if the stack changed.
function lfSwap(stack, from, to) {
  var lvl = LF_EH.getEnchantmentsForCrafting(stack).getLevel(from)  // reads stored enchantments on books too
  if (lvl <= 0) return false
  var have = LF_EH.getEnchantmentsForCrafting(stack).getLevel(to)
  LF_EH.updateEnchantments(stack, m => {
    m.set(from, 0)
    m.set(to, Math.max(lvl, have))
  })
  return true
}

ServerEvents.tick(event => {
  var server = event.server
  if (server.tickCount % 20 !== 0) return
  lfSrv = server
  var lfh = lfHolders(server)
  server.players.forEach(p => {
    var inv = p.inventory
    for (let i = 0; i < inv.getContainerSize(); i++) {
      var stack = inv.getItem(i)
      if (stack.isEmpty() || stack.getItem().toString() === 'enchanted_book') continue
      var changed = false
      if (lfIs(stack, LF_MINING) && !lfIs(stack, LF_SWORD)) {
        if (LF_EH.getItemEnchantmentLevel(lfh.silk, stack) <= 0) changed = lfSwap(stack, lfh.looting, lfh.fortune)
      } else if (lfIs(stack, LF_SWORD) && !lfIs(stack, LF_MINING)) {
        changed = lfSwap(stack, lfh.fortune, lfh.looting)
      }
      if (changed) p.tell(Text.gold('Your ' + stack.hoverName.string + ' re-attuned its enchantment.'))
    }
  })
})
