// The Builders' three super weapons (behaviour in kubejs/server_scripts/super_weapons.js, recipes in
// kubejs/data/horrorpack/recipe/). Registry entries: the client pack and the server must ship these together.
// Names and tooltips live in kubejs/assets/horrorpack/lang/en_us.json. Vanilla textures, so no art is needed.
StartupEvents.registry('item', event => {
  event.create('horrorpack:rail_lance').texture('minecraft:item/blaze_rod').maxStackSize(1).glow(true).rarity('epic')
  event.create('horrorpack:sunbreaker').texture('minecraft:item/nether_star').maxStackSize(1).glow(true).rarity('epic')
  event.create('horrorpack:last_whistle').texture('minecraft:item/goat_horn').maxStackSize(1).glow(true).rarity('rare')
})

// The Scarecrow: stands in for a player so the 3x3 chunks around it keep running with nobody online
// (behaviour in kubejs/server_scripts/scarecrow.js, recipe in kubejs/data/horrorpack/recipe/scarecrow.json).
// Vanilla textures: pumpkin top, carved face on every side, hay bottom.
StartupEvents.registry('block', event => {
  event.create('horrorpack:scarecrow')
    .parentModel('minecraft:block/cube')
    .textures({
      particle: 'minecraft:block/pumpkin_side',
      up: 'minecraft:block/pumpkin_top', down: 'minecraft:block/hay_block_top',
      north: 'minecraft:block/carved_pumpkin', south: 'minecraft:block/carved_pumpkin',
      east: 'minecraft:block/carved_pumpkin', west: 'minecraft:block/carved_pumpkin'
    })
    .soundType('grass')
    .mapColor('color_orange')
    .hardness(1.0)
    .resistance(6.0)
    .tagBlock('minecraft:mineable/axe')
})
