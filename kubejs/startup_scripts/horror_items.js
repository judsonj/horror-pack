// The Builders' three super weapons (behaviour in kubejs/server_scripts/super_weapons.js, recipes in
// kubejs/data/horrorpack/recipe/). Registry entries: the client pack and the server must ship these together.
// Names and tooltips live in kubejs/assets/horrorpack/lang/en_us.json. Vanilla textures, so no art is needed.
StartupEvents.registry('item', event => {
  event.create('horrorpack:rail_lance').texture('minecraft:item/blaze_rod').maxStackSize(1).glow(true).rarity('epic')
  event.create('horrorpack:sunbreaker').texture('minecraft:item/nether_star').maxStackSize(1).glow(true).rarity('epic')
  event.create('horrorpack:last_whistle').texture('minecraft:item/goat_horn').maxStackSize(1).glow(true).rarity('rare')
})
