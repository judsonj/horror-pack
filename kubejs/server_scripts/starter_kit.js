// Gives every player the spec starter kit once, on their first login to this world.
PlayerEvents.loggedIn(event => {
  const player = event.player
  if (player.persistentData.getBoolean('horror_starter_kit')) return
  player.persistentData.putBoolean('horror_starter_kit', true)
  ;[
    'ftbquests:book', 'sophisticatedbackpacks:backpack',
    'minecraft:stone_sword', 'minecraft:stone_pickaxe', 'minecraft:stone_axe',
    '32x minecraft:torch', '16x minecraft:bread', 'minecraft:white_bed'
  ].forEach(item => player.give(item))
})

// The Builders' sidearm: everyone gets it once, new and existing players alike (the Builders' Armoury, 2026-10-23).
// More guns and ammo turn up in city and rail chests; Create's press makes ammo (kubejs/data/horrorpack/recipe/ammo_*).
PlayerEvents.loggedIn(event => {
  const player = event.player
  if (player.persistentData.getBoolean('horror_sidearm')) return
  player.persistentData.putBoolean('horror_sidearm', true)
  ;['superbwarfare:m_1911', '32x superbwarfare:handgun_ammo', 'superbwarfare:crowbar'].forEach(item => player.give(item))
  player.tell(Text.gray("A Builders' sidearm. Loud: anything listening will know where you are."))
})
