// Named regions (the ArdaRegions idea): the overworld is cut into REG_CELL-block squares, each with a fixed name
// (from the world seed, so everyone sees the same one) and a kind from the biome at its centre. Walking into a new
// square shows its name; underground near track you are in "The Under-Line". Each kind has owners: the horrors that
// belong there. A headline horror trying to join somewhere it doesn't own is turned away REG_STRANGER_CANCEL of the
// time, so each place keeps its own fear without starving the director. Ambient horrors (Watcher, Whispering Spirits,
// SCP ambient) are never touched here.
// Also: fog in the subways (ash drifting around players underground near track, seen only by them), and a per-kind
// ambient sound on entering. Needs safety.js (hpDim, hpCmd, hpSound, safState).
// Op command: /hpworld region <x z> prints the name, kind and owners there (the batch test uses it).

const REG_CELL = 640
const REG_STRANGER_CANCEL = 0.35
const REG_FIRST = ['Cinder', 'Hollow', 'Signal', 'Ashen', 'Quiet', 'Rust', 'Lantern', 'Drowned', 'Long', 'Pale', 'Black', 'Iron',
  'Grey', 'Last', 'Broken', 'Weeping', 'Cold', 'Mourning', 'Sunken', 'Burnt', 'Whistling', 'Empty', 'Slow', 'Old Line']
const REG_KINDS = {
  open: { words: ['Mile', 'Reach', 'Flats', 'Crossing', 'Fields', 'Junction', 'Plain'], owners: ['the_ravenous:', 'kenny:'], sound: 'minecraft:ambient.basalt_deltas.mood' },
  woods: { words: ['Wood', 'Thicket', 'Pines', 'Copse', 'Wilds', 'Timber'], owners: ['the_obsessed:', 'kenny:', 'the_backwoods:'], sound: 'minecraft:ambient.crimson_forest.mood' },
  cold: { words: ['Drifts', 'Waste', 'Pass', 'Heights', 'Sleet'], owners: ['the_ravenous:', 'the_boy_and_the_bath:'], sound: 'minecraft:ambient.soul_sand_valley.mood' },
  dry: { words: ['Barrens', 'Dust', 'Cut', 'Badlands', 'Kilns'], owners: ['arphex:', 'the_backwoods:'], sound: 'minecraft:ambient.nether_wastes.mood' },
  shore: { words: ['Shore', 'Landing', 'Strand', 'Harbour', 'Docks'], owners: ['the_boy_and_the_bath:', 'weeping_angels:'], sound: 'minecraft:ambient.underwater.loop.additions.rare' },
  under: { words: ['Under-Line'], owners: ['cave_dweller:', 'arphex:', 'scp_ultimate:'], sound: 'minecraft:ambient.cave' }
}
// Headline horrors the owner rule applies to. Angels and the Knocker keep their own homes (statues, your base).
const REG_HEADLINE = ['kenny:', 'the_obsessed:', 'the_ravenous:', 'cave_dweller:', 'the_boy_and_the_bath:', 'arphex:', 'the_backwoods:']

const REG_BlockPos = Java.loadClass('net.minecraft.core.BlockPos')
let regSeen = {}   // player name -> last region key shown
let regSeed = null

function regHash(a, b) {
  let h = (regSeed || 0) ^ Math.imul(a, 73856093) ^ Math.imul(b, 19349663)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}

function regKindAt(level, x, z) {
  let id = ''
  try { id = String(level.getBiome(REG_BlockPos.containing(x, 64, z)).unwrapKey().get().location()) } catch (e) { id = '' }
  if (/ocean|river|beach|shore|swamp/.test(id)) return 'shore'
  if (/snow|frozen|ice|grove|peaks|slopes/.test(id)) return 'cold'
  if (/desert|badlands|savanna|mesa/.test(id)) return 'dry'
  if (/forest|taiga|jungle|wood|dark|grove|birch|cherry/.test(id)) return 'woods'
  return 'open'
}

function regAt(server, level, x, y, z, under) {
  if (regSeed === null) { try { regSeed = Number(server.overworld().getSeed()) | 0 } catch (e) { regSeed = 0 } }
  if (under) return { key: 'under', name: 'The Under-Line', kind: 'under' }
  let cx = Math.floor(x / REG_CELL), cz = Math.floor(z / REG_CELL)
  let kind = regKindAt(level, (cx + 0.5) * REG_CELL, (cz + 0.5) * REG_CELL)
  let h = regHash(cx, cz)
  let words = REG_KINDS[kind].words
  return { key: cx + ',' + cz, name: 'The ' + REG_FIRST[h % REG_FIRST.length] + ' ' + words[(h >>> 8) % words.length], kind: kind }
}

ServerEvents.tick(event => {
  let server = event.server
  if (server.tickCount % 40 !== 7) return
  server.players.forEach(p => regTickPlayer(server, p))
})

// One player's region card and subway fog (also run by /hpworld playertest with a stand-in player).
function regTickPlayer(server, p) {
  let level = hpLvl(p)
  if (hpDim(level) !== 'minecraft:overworld') return
  let name = String(p.username)
  let st = safState[name]
  let underLine = !!(st && st.under && st.track >= 3)
  let r = regAt(server, level, p.x, p.y, p.z, underLine)
  if (underLine && Math.random() < 0.6)
    hpCmd(server, 'execute as ' + name + ' at @s run particle minecraft:white_ash ~ ~1 ~ 6 2 6 0 50 normal @s')
  if (regSeen[name] === r.key) return
  let first = regSeen[name] === undefined
  regSeen[name] = r.key
  if (first) return  // no card on login, only on travel
  hpCmd(server, 'title ' + name + ' times 15 50 25')
  hpCmd(server, 'title ' + name + ' subtitle ' + JSON.stringify({ text: '' }))
  hpCmd(server, 'title ' + name + ' title ' + JSON.stringify({ text: r.name, color: 'gray', italic: true }))
  hpSound(server, name, REG_KINDS[r.kind].sound, 0.8, 0.8)
}

// Runs before safety.js's spawn hook (files load in name order), which marks allowed mobs hp_seen.
EntityEvents.spawned(event => {
  let e = event.entity
  let id = String(e.type)
  if (!REG_HEADLINE.some(p => id.startsWith(p)) || e.persistentData.getBoolean('hp_seen')) return
  let level = event.level
  if (hpDim(level) !== 'minecraft:overworld') return
  let under = false
  try { under = !level.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)).canSeeSky && e.y < 50 } catch (err) { }
  let r = regAt(event.server, level, e.x, e.y, e.z, under)
  if (REG_KINDS[r.kind].owners.some(p => id.startsWith(p))) return
  if (Math.random() < REG_STRANGER_CANCEL) {
    console.info('[regions] ' + id + ' is a stranger in ' + r.name + ' (' + r.kind + '): turned away')
    event.cancel()
  }
})

ServerEvents.commandRegistry(event => {
  let { commands: Commands, arguments: Arguments } = event
  event.register(Commands.literal('hpregion').requires(s => s.hasPermission(2))
    .then(Commands.argument('pos', Arguments.BLOCK_POS.create(event)).executes(ctx => {
      let pos = Arguments.BLOCK_POS.getResult(ctx, 'pos')
      let r = regAt(ctx.source.server, ctx.source.level, pos.x, pos.y, pos.z, false)
      let text = 'region at ' + pos.x + ' ' + pos.z + ': ' + r.name + ' (' + r.kind + '), owners ' + REG_KINDS[r.kind].owners.join(' ')
      ctx.source.sendSuccess(Text.of(text), false)
      console.info('[hpworld] ' + text)
      return 1
    })))
})
