# MathRaids reusable raid definition

MathRaids should treat the live raid engine as generic infrastructure and keep encounter content in data-driven raid definitions.

## Goal

A built-in raid such as Numberzilla and a future user-created raid should ultimately use the same runtime shape. The engine should not need a new Durable Object class for every boss.

## Proposed raid definition

```js
{
  id: "city-under-siege",
  name: "City Under Siege",
  subject: "math",
  boss: {
    id: "numberzilla",
    name: "Numberzilla",
    art: {
      boss: "r2://.../boss.svg",
      backgroundBack: "r2://.../city-back.svg",
      backgroundFront: "r2://.../city-front.svg"
    },
    mechanics: {
      attacks: ["left_slam", "right_slam", "shockwave"],
      minHealth: 300,
      healthPerPlayer: 100,
      aggression: 3,
      attackPower: 3,
      warningMs: 1650
    },
    victory: {
      bossFallMs: 4200,
      celebrationMs: 6500
    }
  },
  questions: {
    source: "generated",
    topic: "multiplication",
    difficulty: 2
  }
}
```

## Host tuning

The Host dashboard may override selected mechanics for an individual raid session. Initial safe tuning controls are:

- health per player
- minimum boss health
- aggression (1-5)
- attack power (1-5)
- attack warning duration

Session overrides should be validated server-side and locked when the raid starts.

## Future custom raid builder

A creator should eventually be able to build and save a raid with:

- raid name and description
- custom question sets or generated question rules
- boss name and image
- foreground/background art
- boss health and difficulty tuning
- allowed attack mechanics
- victory presentation
- optional music and sound effects
- role rules and special abilities

### Storage direction

- D1: raid metadata, ownership, question sets, versions and publishing state
- R2: uploaded boss art, backgrounds, audio and other large assets
- Durable Objects: only the live session state for an active raid

Published raid definitions should be immutable/versioned for active sessions. Editing a raid creates a new draft/version rather than changing the definition under a running room.

## Safety and validation

User-uploaded content should be validated before it can be used in a public/shared raid. Asset size/type restrictions and content moderation will be needed before public publishing is enabled.

Custom questions should preserve the existing privacy model: individual answer performance is private to the player and authorised host by default.
