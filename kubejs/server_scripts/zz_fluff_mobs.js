// Fluff mobs between bosses: a share of zombies spawn with one hidden trait. No name tags, no block damage.
//   runner  fast, fragile, comes with 2 more runners at night      brute    slow, armored, tanky, hits hard
//   bloater leaves a poison cloud when it dies                     shrieker first hit makes it scream: Darkness + nearby zombies speed up
//   burner  burns, immune to fire, sets you alight on hit          rotten   hits give Hunger + Weakness
// Loads after safety.js/regions.js (name order), so their helpers (hpCmd, hpDim, hpLvl) exist and their spawn rules run first.
const FLF_TRAIT_CHANCE = 0.3
const FLF_TRAITS = ['runner', 'brute', 'bloater', 'shrieker', 'burner', 'rotten']
const FLF_ZOMBIES = ['minecraft:zombie', 'minecraft:husk', 'minecraft:drowned', 'minecraft:zombie_villager']

function flfHasTag(e, tag) { try { return e.tags.contains(tag) } catch (err) { return false } }
function flfTrait(e) {
  for (let i = 0; i < FLF_TRAITS.length; i++) if (flfHasTag(e, 'hp_v_' + FLF_TRAITS[i])) return FLF_TRAITS[i]
  return ''
}
function flfAttr(server, e, attr, value) { hpCmd(server, 'attribute ' + e.uuid + ' minecraft:generic.' + attr + ' base set ' + value) }
function flfSetHealth(server, e, hp) { flfAttr(server, e, 'max_health', hp); hpCmd(server, 'data merge entity ' + e.uuid + ' {Health:' + hp + 'f}') }
function flfNight(server) { const t = Number(server.overworld().getDayTime()) % 24000; return t > 13000 && t < 23000 }

function flfApply(server, level, e, trait) {
  hpCmd(server, 'tag ' + e.uuid + ' add hp_v_' + trait)
  if (trait === 'runner') {
    flfAttr(server, e, 'movement_speed', 0.34)
    flfSetHealth(server, e, 12)
  } else if (trait === 'brute') {
    flfAttr(server, e, 'movement_speed', 0.19)
    flfAttr(server, e, 'armor', 10)
    flfAttr(server, e, 'attack_damage', 6)
    flfAttr(server, e, 'knockback_resistance', 0.6)
    flfSetHealth(server, e, 40)
  } else if (trait === 'burner') {
    hpCmd(server, 'effect give ' + e.uuid + ' minecraft:fire_resistance infinite 0 true')
    hpCmd(server, 'data merge entity ' + e.uuid + ' {Fire:600s}')
  } else if (trait === 'bloater') {
    flfSetHealth(server, e, 26)
  }
}

EntityEvents.spawned(event => {
  let e = event.entity
  let id = String(e.type)
  if (FLF_ZOMBIES.indexOf(id) < 0) return
  if (flfHasTag(e, 'hp_v')) return            // already decided (chunk reload, ambush, pack mate, figure)
  let server = event.server
  hpCmd(server, 'tag ' + e.uuid + ' add hp_v')
  if (Math.random() >= FLF_TRAIT_CHANCE) return
  let trait = FLF_TRAITS[Math.floor(Math.random() * FLF_TRAITS.length)]
  flfApply(server, event.level, e, trait)
  if (trait === 'runner' && flfNight(server)) {
    let dim = hpDim(event.level)
    for (let i = 0; i < 2; i++) {
      var x = e.x + (Math.random() * 4 - 2), z = e.z + (Math.random() * 4 - 2)
      hpCmd(server, 'execute in ' + dim + ' run summon ' + id + ' ' + x + ' ' + e.y + ' ' + z +
        ' {Tags:["hp_v","hp_v_runner"],Health:12f,attributes:[{id:"minecraft:generic.movement_speed",base:0.34},{id:"minecraft:generic.max_health",base:12}]}')
    }
  }
})

EntityEvents.afterHurt(event => {
  let victim = event.entity
  let server = event.server
  let attacker = null
  try { attacker = event.source.entity } catch (err) { }
  // Zombie hit a player
  if (attacker && victim.isPlayer()) {
    let t = flfTrait(attacker)
    if (t === 'burner') victim.setRemainingFireTicks(80)
    if (t === 'rotten') {
      hpCmd(server, 'effect give ' + victim.uuid + ' minecraft:hunger 10 1')
      hpCmd(server, 'effect give ' + victim.uuid + ' minecraft:weakness 8 0')
    }
  }
  // Shrieker got hit: scream once
  if (flfTrait(victim) === 'shrieker' && !flfHasTag(victim, 'hp_shrieked')) {
    hpCmd(server, 'tag ' + victim.uuid + ' add hp_shrieked')
    let pos = victim.x + ' ' + victim.y + ' ' + victim.z
    let dim = hpDim(hpLvl(victim))
    hpCmd(server, 'execute in ' + dim + ' positioned ' + pos + ' run playsound minecraft:entity.ghast.scream hostile @a ~ ~ ~ 2 0.6')
    hpCmd(server, 'execute in ' + dim + ' positioned ' + pos + ' run effect give @a[distance=..16] minecraft:darkness 5 0')
    hpCmd(server, 'execute in ' + dim + ' positioned ' + pos + ' run effect give @e[type=#minecraft:zombies,distance=..24] minecraft:speed 12 1')
  }
})

EntityEvents.death(event => {
  let e = event.entity
  if (flfTrait(e) !== 'bloater') return
  let dim = hpDim(hpLvl(e))
  hpCmd(event.server, 'execute in ' + dim + ' run summon minecraft:area_effect_cloud ' + e.x + ' ' + e.y + ' ' + e.z +
    ' {Radius:3.5f,Duration:120,RadiusPerTick:-0.01f,potion_contents:{potion:"minecraft:poison"}}')
  hpCmd(event.server, 'execute in ' + dim + ' run playsound minecraft:entity.slime.squish hostile @a ' + e.x + ' ' + e.y + ' ' + e.z + ' 1.5 0.5')
})
