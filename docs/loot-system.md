# MathRaids Loot System

MathRaids uses boss-specific cosmetic loot to make raids feel collectible and rewarding without creating academic or combat power advantages.

## Principles

- Loot is cosmetic-only.
- No student gains stronger maths damage, healing, survivability, or ranked advantage from gear.
- Bosses have distinct loot tables and themed sets.
- Completing raids should feel rewarding even when a rare item does not drop.
- Individual loot is private to the student unless they choose to display equipped cosmetics in-game.
- No paid random loot boxes for students.

## Boss loot tables

Each boss has its own loot table containing themed cosmetic items.

Example: Numberzilla

- Numberzilla Crown
- Numberzilla Chestplate
- Numberzilla Gloves
- Numberzilla Boots
- Numberzilla Bow Skin
- Numberzilla Staff Skin
- Tiny Numberzilla Pet
- City Defender Cape
- Numberzilla Victory Emote

## Gear sets

Cosmetic equipment can belong to collectible sets.

Example set:

Numberzilla Defender Set

- Head
- Chest
- Hands
- Feet
- Back/Cape
- Weapon skin

Completing a full set may unlock an additional cosmetic reward such as a title, aura, emote, colour variant, or profile badge. It must not grant combat power.

## Suggested rarity bands

- Common
- Uncommon
- Rare
- Epic
- Legendary

Rarity controls visual prestige and drop probability only.

Initial example weights:

- Common: 55%
- Uncommon: 25%
- Rare: 13%
- Epic: 6%
- Legendary: 1%

These values are placeholders and should be adjusted through playtesting.

## Raid rewards

On a successful raid, each eligible student receives their own independent loot roll. One student's drop does not reduce another student's chance.

A student should not need to compete with classmates for an item.

Recommended reward flow:

1. Boss defeated.
2. Victory screen appears.
3. Raid contribution and learning results are processed privately.
4. Each eligible student receives a loot reveal.
5. Item is added to the student's collection if they have an account.
6. Guest players can receive temporary raid rewards, with account creation offered later if product/privacy design allows the reward to be claimed safely.

## Duplicate handling

Duplicates should not feel wasted.

Recommended approach:

- First copy unlocks the cosmetic.
- Later duplicates convert into a non-purchasable collection currency such as `Raid Shards`.
- Raid Shards can eventually unlock deterministic cosmetic recolours, legacy set pieces, or duplicate-protection rewards.

This currency must not improve academic or combat performance.

## Bad-luck protection

For rare set collecting, MathRaids should eventually support lightweight duplicate/bad-luck protection so students are not forced into excessive grinding.

Possible model:

- Track boss victories since the last new set item.
- Gradually increase the chance of receiving an unowned item from that boss's set.
- Reset or reduce the protection counter when a new item is awarded.

The exact algorithm can be tuned later.

## Eligibility

Loot should primarily reward participation and raid completion rather than individual academic performance.

A student should not receive worse loot because they answered fewer questions correctly than classmates.

Anti-abuse checks may require that a participant was genuinely active in the raid before receiving a drop.

## Personal practice

Personal practice can award:

- profile XP
- basic cosmetic progression
- practice achievements
- occasional practice-specific cosmetics

Boss-specific raid sets should primarily come from fighting those bosses so the collection retains meaning.

## Future seasonal content

The same system can support:

- seasonal gear sets
- holiday bosses
- event cosmetics
- school event trophies
- raid achievements
- limited visual variants

Time-limited content should be used carefully so the product does not create excessive pressure or fear of missing out for children.

## Data model direction

Likely persistent entities:

- cosmetic_items
- cosmetic_sets
- bosses
- boss_loot_entries
- student_inventory
- student_equipment
- loot_rolls
- duplicate_currency_ledger

Loot rolls must be generated server-side and persisted atomically to prevent client manipulation or duplicate claims.
