// Our own sort, by what you're doing (not A-Z). Server-side only: players need nothing installed.
//   /sort              looking at a chest/barrel/shulker within reach -> sorts it; otherwise sorts YOUR inventory (hotbar, armor, offhand untouched)
//   sneak + right-click a chest/barrel/shulker with an EMPTY hand -> sorts it (instead of opening it)
//   /hpsort at <x> <y> <z>   (op/console) sorts the container there: for testing
// Order: 1 weapons/tools (best first) · 2 armor · 3 light + survival (torches, food best first, potions) · 4 building blocks (most first)
//        · 5 Create parts · 6 ores -> raw -> ingots/gems -> nuggets/dust · 7 everything else · 8 junk (rotten flesh, bones, string, seeds...)
// Same items are merged into full stacks. Nothing is ever lost: totals are checked and the old layout is put back if they don't match.
// Only plain storage is sorted (never furnaces or machines, where slots have jobs). Lootr chests and Sophisticated Storage are skipped.
const SRT_Container = Java.loadClass('net.minecraft.world.Container')
const SRT_ItemStack = Java.loadClass('net.minecraft.world.item.ItemStack')
const SRT_ChestBE = Java.loadClass('net.minecraft.world.level.block.entity.ChestBlockEntity')
const SRT_BarrelBE = Java.loadClass('net.minecraft.world.level.block.entity.BarrelBlockEntity')
const SRT_ShulkerBE = Java.loadClass('net.minecraft.world.level.block.entity.ShulkerBoxBlockEntity')
const SRT_ChestBlock = Java.loadClass('net.minecraft.world.level.block.ChestBlock')
const SRT_BlockPos = Java.loadClass('net.minecraft.core.BlockPos')
const SRT_Tiered = Java.loadClass('net.minecraft.world.item.TieredItem')
const SRT_Bow = Java.loadClass('net.minecraft.world.item.ProjectileWeaponItem')
const SRT_Trident = Java.loadClass('net.minecraft.world.item.TridentItem')
const SRT_Shield = Java.loadClass('net.minecraft.world.item.ShieldItem')
const SRT_Armor = Java.loadClass('net.minecraft.world.item.ArmorItem')
const SRT_BlockItem = Java.loadClass('net.minecraft.world.item.BlockItem')
const SRT_Potion = Java.loadClass('net.minecraft.world.item.PotionItem')
const SRT_DC = Java.loadClass('net.minecraft.core.component.DataComponents')
const SRT_TagKey = Java.loadClass('net.minecraft.tags.TagKey')
const SRT_Registries = Java.loadClass('net.minecraft.core.registries.Registries')
const SRT_RL = Java.loadClass('net.minecraft.resources.ResourceLocation')

const SRT_JUNK = ['minecraft:rotten_flesh', 'minecraft:bone', 'minecraft:string', 'minecraft:spider_eye', 'minecraft:poisonous_potato',
  'minecraft:wheat_seeds', 'minecraft:beetroot_seeds', 'minecraft:melon_seeds', 'minecraft:pumpkin_seeds', 'minecraft:dead_bush',
  'minecraft:stick', 'minecraft:feather', 'minecraft:flint', 'minecraft:egg', 'minecraft:ink_sac', 'minecraft:phantom_membrane']
let srtTags = {}
function srtTag(id) {
  if (!srtTags[id]) srtTags[id] = SRT_TagKey.create(SRT_Registries.ITEM, SRT_RL.parse(id))
  return srtTags[id]
}
function srtIs(stack, id) { try { return stack['is(net.minecraft.tags.TagKey)'](srtTag(id)) } catch (e) { return false } }
function srtId(stack) { return String(stack.getItem().builtInRegistryHolder().key().location()) }

// [group, score] : lower group first, higher score first inside a group
function srtKey(stack, totals) {
  let item = stack.getItem()
  let id = srtId(stack)
  if (SRT_JUNK.indexOf(id) >= 0 || srtIs(stack, 'c:seeds')) return [8, 0]
  if (item instanceof SRT_Tiered || item instanceof SRT_Bow || item instanceof SRT_Trident || item instanceof SRT_Shield ||
      srtIs(stack, 'c:tools') || srtIs(stack, 'minecraft:swords')) return [1, stack.getMaxDamage()]
  if (item instanceof SRT_Armor) return [2, stack.getMaxDamage()]
  if (id.indexOf('torch') >= 0 || id.indexOf('lantern') >= 0) return [3, 1000]
  let food = stack.get(SRT_DC.FOOD)
  if (food) return [3, 100 + Number(food.nutrition())]
  if (item instanceof SRT_Potion || id === 'minecraft:totem_of_undying' || id === 'minecraft:golden_apple') return [3, 50]
  if (id.indexOf('create:') === 0) return [5, totals[id] || 0]
  if (srtIs(stack, 'c:ores')) return [6, 400]
  if (srtIs(stack, 'c:raw_materials')) return [6, 300]
  if (srtIs(stack, 'c:ingots') || srtIs(stack, 'c:gems')) return [6, 200]
  if (srtIs(stack, 'c:nuggets') || srtIs(stack, 'c:dusts')) return [6, 100]
  if (item instanceof SRT_BlockItem) return [4, totals[id] || 0]
  return [7, 0]
}

// Exact identity of a stack: item id + every component (enchantments, names, backpack ids, damage...).
function srtExact(s) { return srtId(s) + '|' + String(s.getComponentsPatch()) }
function srtCount(cont, from, to) {
  let m = {}
  for (let i = from; i < to; i++) { let s = cont.getItem(i); if (!s.isEmpty()) { let k = srtExact(s); m[k] = (m[k] || 0) + s.getCount() } }
  return m
}
function srtSame(a, b) {
  let ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length && ka.every(k => a[k] === b[k])
}

// Sort slots [from, to) of a Container. Returns a short result string.
// Why this can't lose items like the old client-side sort button did: it runs entirely on the server in ONE tick (no click
// packets that can fall out of sync), works on copies, refuses anything unusual (oversized stacks), and checks the exact
// count of every item+components afterwards; any mismatch or error puts the original stacks back.
function srtSort(cont, from, to) {
  let before = [], totals = {}
  let limit = cont.getMaxStackSize()
  for (let i = from; i < to; i++) {
    let s = cont.getItem(i)
    if (!s.isEmpty() && (s.getCount() > s.getMaxStackSize() || s.getCount() > limit)) return 'skipped (has oversized stacks, use its own sort)'
    before.push(s.copy())
    if (!s.isEmpty()) { let id = srtId(s); totals[id] = (totals[id] || 0) + s.getCount() }
  }
  let exactBefore = srtCount(cont, from, to)
  // merge same item + same components into full stacks
  let merged = []
  before.forEach(s => {
    if (s.isEmpty()) return
    let left = s.getCount()
    for (let k = 0; k < merged.length && left > 0; k++) {
      var m = merged[k]
      if (m.getCount() < m.getMaxStackSize() && SRT_ItemStack.isSameItemSameComponents(m, s)) {
        var add = Math.min(left, m.getMaxStackSize() - m.getCount())
        m.grow(add); left -= add
      }
    }
    while (left > 0) {
      var n = s.copy(); var c = Math.min(left, n.getMaxStackSize()); n.setCount(c); merged.push(n); left -= c
    }
  })
  if (merged.length > to - from) return 'skipped (would not fit)'
  let keyed = merged.map(s => ({ s: s, k: srtKey(s, totals), id: srtId(s) }))
  keyed.sort((a, b) => (a.k[0] - b.k[0]) || (b.k[1] - a.k[1]) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || (b.s.getCount() - a.s.getCount()))
  // dry check before touching the real container: the planned layout must hold exactly what's there now
  let planned = {}
  keyed.forEach(e => { let k = srtExact(e.s); planned[k] = (planned[k] || 0) + e.s.getCount() })
  if (!srtSame(planned, exactBefore)) { console.warn('[sort] plan mismatch, nothing touched'); return 'skipped safely (nothing changed)' }
  let ok = false
  try {
    for (let i = from; i < to; i++) {
      let j = i - from
      cont.setItem(i, j < keyed.length ? keyed[j].s : SRT_ItemStack.EMPTY)
    }
    // safety: every exact item count must match, otherwise put everything back
    ok = srtSame(srtCount(cont, from, to), exactBefore)
  } catch (e) { console.warn('[sort] error while writing: ' + e) }
  if (!ok) {
    for (let i = from; i < to; i++) cont.setItem(i, before[i - from])
    cont.setChanged()
    console.warn('[sort] totals mismatch, layout restored')
    return 'failed safely (nothing changed)'
  }
  cont.setChanged()
  return 'sorted ' + keyed.length + ' stacks'
}

// The storage Container at pos, or null (with a reason) for things we don't sort.
function srtContainerAt(level, pos) {
  let state = level.getBlockState(pos)
  let id = String(state.getBlock().builtInRegistryHolder().key().location())
  if (id.indexOf('lootr:') === 0) return { why: 'Loot chests sort themselves out once looted.' }
  if (id.indexOf('sophisticatedstorage:') === 0) return { why: 'Use the sort button inside Sophisticated Storage.' }
  let be = level.getBlockEntity(pos)
  if (!be) return { why: null }
  if (be instanceof SRT_ChestBE && state.getBlock() instanceof SRT_ChestBlock) {
    let c = SRT_ChestBlock.getContainer(state.getBlock(), state, level, pos, true)
    return c ? { c: c } : { why: 'That chest is blocked.' }
  }
  if (be instanceof SRT_BarrelBE || be instanceof SRT_ShulkerBE) return { c: be }
  // modded plain storage: a Container named like a chest/barrel/crate with 9+ slots
  if (be instanceof SRT_Container && be.getContainerSize() >= 9 && /chest|barrel|crate|cabinet|locker/.test(id)) return { c: be }
  return { why: null }
}

function srtLookedAt(p) {
  try {
    let hit = p.pick(5.0, 0.0, false)
    if (String(hit.getType()) !== 'BLOCK') return null
    return hit.getBlockPos()
  } catch (e) { return null }
}

function srtTell(p, text, color) { p.tell(Text.of(text).color(color || 'gray')) }

function srtRunFor(p) {
  let pos = srtLookedAt(p)
  if (pos) {
    let r = srtContainerAt(p.level, pos)
    if (r.c) { let res = srtSort(r.c, 0, r.c.getContainerSize()); srtTell(p, 'Chest ' + res + '.'); console.info('[sort] ' + p.username + ' chest at ' + pos.toShortString() + ': ' + res); return 1 }
    if (r.why) { srtTell(p, r.why, 'yellow'); return 0 }
  }
  let inv = p.getInventory()
  let res = srtSort(inv, 9, 36)   // main 27 slots; hotbar 0-8, armor and offhand stay as they are
  p.inventoryMenu.broadcastChanges()
  srtTell(p, 'Inventory ' + res + ' (hotbar left alone).')
  console.info('[sort] ' + p.username + ' inventory: ' + res)
  return 1
}

ServerEvents.commandRegistry(event => {
  const { commands: Commands, arguments: Arguments } = event
  event.register(Commands.literal('sort').executes(ctx => {
    let p = ctx.source.player
    if (!p) { ctx.source.sendFailure(Text.of('Players only.')); return 0 }
    try { return srtRunFor(p) } catch (e) { console.warn('[sort] error: ' + e); ctx.source.sendFailure(Text.of('Sort hit a snag, nothing was moved.')); return 0 }
  }))
  event.register(Commands.literal('hpsort').requires(s => s.hasPermission(2))
    .then(Commands.literal('at').then(Commands.argument('x', Arguments.INTEGER.create(event))
      .then(Commands.argument('y', Arguments.INTEGER.create(event)).then(Commands.argument('z', Arguments.INTEGER.create(event)).executes(ctx => {
        let pos = new SRT_BlockPos(Arguments.INTEGER.getResult(ctx, 'x'), Arguments.INTEGER.getResult(ctx, 'y'), Arguments.INTEGER.getResult(ctx, 'z'))
        let r = srtContainerAt(ctx.source.level, pos)
        let msg = r.c ? srtSort(r.c, 0, r.c.getContainerSize()) : ('not sortable: ' + (r.why || 'no storage there'))
        ctx.source.sendSuccess(Text.of('[sort] ' + msg), false)
        console.info('[sort] at ' + pos.toShortString() + ': ' + msg)
        return 1
      }))))))
})

BlockEvents.rightClicked(event => {
  let p = event.player
  if (!p || !p.isShiftKeyDown()) return
  if (String(event.hand).toLowerCase().indexOf('main') < 0) return
  if (!p.getMainHandItem().isEmpty()) return
  try {
    let r = srtContainerAt(event.level, event.block.pos)
    console.info('[sort] sneak-click by ' + p.username + ' on ' + event.block.id + (r.c ? '' : ' (not storage)'))
    if (!r.c) { if (r.why) srtTell(p, r.why, 'yellow'); return }
    let res = srtSort(r.c, 0, r.c.getContainerSize())
    srtTell(p, 'Chest ' + res + '.')
    console.info('[sort] ' + p.username + ' sneak-click chest: ' + res)
  } catch (e) { console.warn('[sort] sneak-click error: ' + e); return }
  event.cancel()   // LAST and outside try: cancel() exits the handler by throwing EventExit
})

// After a reload, new commands (/sort, /hpgive...) only reach players at their next join. Resend the command list once,
// a few seconds after the scripts load, so players online can use them right away.
let srtResendAt = -1
ServerEvents.tick(event => {
  let server = event.server
  if (srtResendAt < 0) srtResendAt = server.tickCount + 100
  if (srtResendAt === 0 || server.tickCount < srtResendAt) return
  srtResendAt = 0
  try {
    let n = 0
    server.players.forEach(p => { server.getPlayerList().sendPlayerPermissionLevel(p); n++ })
    if (n > 0) console.info('[sort] command list resent to ' + n + ' player(s)')
  } catch (e) { console.warn('[sort] could not resend commands: ' + e) }
})
