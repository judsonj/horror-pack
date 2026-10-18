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
