# MathRaids Loot System

MathRaids uses boss-specific cosmetic loot to make raids feel collectible and rewarding without creating academic or combat power advantages.

## Principles

- Loot is cosmetic-only.
- No student gains stronger maths damage, healing, survivability, or ranked advantage from gear.
- Bosses have distinct loot tables and themed sets.
- Completing raids should feel rewarding even when a rare item does not drop.
- Individual loot is private to the student unless they choose to display equipped cosmetics in-game.
- No paid random loot boxes for students.

## Shared raid loot table

When a boss is defeated, the server generates one shared raid loot table containing four distinct cosmetic items selected from that boss's full loot pool.

The same four items are shown to every eligible participant in the raid.

Example Numberzilla raid table:

1. Numberzilla Crown - Rare
2. City Defender Cape - Uncommon
3. Numberzilla Bow Skin - Epic
4. Numberzilla Boots - Common

Every eligible student then receives their own independent personal roll against those same four items.

One student's result never removes an item from the table and never affects another student's odds. Multiple students may receive the same cosmetic from the same raid.

The four-item table creates a shared classroom moment while preserving individual ownership and avoiding competition between students.

## Table generation

The four shared raid items should be selected server-side from the boss's full cosmetic pool.

Recommended initial rules:

- Four unique items per successful boss kill.
- Item rarity influences how likely an item is to appear in the four-item table.
- Once the four items are selected, each item initially has an equal chance of being awarded to an eligible student.
- Exact rarity and selection weights are configurable and should be tuned through playtesting.
- Bad-luck and duplicate protection may influence a student's personal award without changing the shared four-item display.

This gives rarity two useful meanings: rare cosmetics appear in the shared table less often, and seeing one appear becomes exciting for the whole classroom.

## Boss loot pools

Each boss has its own larger pool of themed cosmetics from which the four-item raid table is generated.

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

Rarity controls visual prestige and the probability that an item appears in a raid's shared four-item table.

Initial example selection weights:

- Common: 55%
- Uncommon: 25%
- Rare: 13%
- Epic: 6%
- Legendary: 1%

These values are placeholders and should be adjusted through playtesting.

## Raid reward flow

Recommended reward flow:

1. Boss defeated.
2. The server generates the raid's four-item shared loot table.
3. Victory screen reveals the same four items to the classroom.
4. Each eligible student receives an independent personal roll against those four items.
5. The student's awarded item is revealed on their own device.
6. The item is added to the student's collection if they have an account.
7. Guest players may receive temporary raid rewards, with account creation offered later if the product and privacy design allow the reward to be claimed safely.

The public classroom display should show the shared four-item table, not a public list of which student received which item.

## Duplicate handling

Duplicates should not feel wasted.

Recommended approach:

- First copy unlocks the cosmetic.
- Later duplicates convert into a non-purchasable collection currency such as `Raid Shards`.
- Raid Shards can eventually unlock deterministic cosmetic recolours, legacy set pieces, or duplicate-protection rewards.

This currency must not improve academic or combat performance.

## Bad-luck protection

For rare set collecting, MathRaids should eventually support lightweight duplicate and bad-luck protection so students are not forced into excessive grinding.

Possible model:

- Track boss victories since the last new set item.
- Gradually increase the chance that the student's personal award is an unowned item when one is present in the shared four-item table.
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
- raid_loot_tables
- raid_loot_table_items
- student_inventory
- student_equipment
- loot_rolls
- duplicate_currency_ledger

The shared four-item raid table and every student's personal roll must be generated server-side and persisted atomically to prevent client manipulation or duplicate claims.
