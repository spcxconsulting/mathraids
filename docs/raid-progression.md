# MathRaids Raid Progression

MathRaids raids should feel like compact old-school MMO raid instances: a class works through a sequence of encounters together, collecting boss loot along the way, before reaching a final boss.

## Raid structure

A raid is a themed sequence of bosses and short transition stages rather than a single isolated fight.

Example structure:

1. Entry encounter / warm-up wave
2. Boss 1
3. Short transition
4. Boss 2
5. Short transition
6. Boss 3
7. Final boss
8. Raid completion screen

For classroom pacing, the MVP should begin with a shorter raid such as three bosses total rather than trying to imitate a full-length MMO raid session.

## Example MVP raid: City Under Siege

- Boss 1: Scrap Golem
- Boss 2: Sky Serpent
- Final Boss: Numberzilla

Each boss has different visual mechanics and its own cosmetic loot pool.

## Classroom pacing

Teachers should be able to select a raid length:

- Quick Raid: 1 boss
- Standard Raid: 3 bosses
- Full Raid: 5+ bosses later

This lets MathRaids work for a 10-minute activity or a larger class session.

The teacher should be able to end a raid safely after any completed boss and still receive a report for the completed encounters.

## Checkpoints

Each defeated boss creates a raid checkpoint.

At a checkpoint:

- boss results are committed
- the four-item shared loot table is generated
- each eligible student gets an independent personal roll from those four items
- the teacher can continue to the next encounter or finish the raid
- disconnected students can reconnect without losing completed raid progress

## Loot progression

Each boss has its own boss-specific loot catalogue.

After each boss defeat:

1. Four unique cosmetics are selected server-side from that boss's loot catalogue.
2. The same four-item table is revealed to the whole class.
3. Each eligible student receives an independent personal roll from those four items.
4. The student's reward is stored privately in their inventory.

The final boss can have a more prestigious pool, including set-completion pieces, rare pets, titles, capes, weapon skins, or raid-completion cosmetics.

## Raid-wide rewards

Completing the entire raid can additionally award:

- a raid completion badge
- profile XP
- a title or achievement on first completion
- a chance at a final-boss-only cosmetic
- collection progress

These rewards remain cosmetic and never increase academic or combat power.

## Boss mechanics

Bosses should have distinct mechanics so the raid feels like progression rather than repeated health bars.

Examples:

- lane attacks requiring left/right movement
- jump-over shockwaves
- telegraphed area attacks
- healer pressure phases
- temporary shields that require a number of correct answers to break
- add phases with smaller enemies
- enrage phases that increase movement pressure without changing academic difficulty

## Maths consistency

For Ranked Raid mode, the configured maths subject/category and difficulty band remain consistent through the raid so the result is comparable for rankings.

Boss difficulty should primarily change through encounter mechanics, health, timing and coordination, not by unexpectedly changing the academic question level.

## Persistence model

Likely entities:

- raid_definitions
- raid_encounters
- raid_sessions
- raid_session_encounters
- bosses
- raid_checkpoints
- raid_loot_tables
- raid_loot_table_items

A raid session should track the current encounter, defeated bosses, loot checkpoints, classroom participants and aggregate learning results.

## MVP recommendation

Build the first complete raid as three encounters:

- Scrap Golem
- Sky Serpent
- Numberzilla

This is long enough to prove progression, checkpoints and loot while still being practical for a classroom MVP.
