# MathRaids

MathRaids is a cooperative maths game where players join a live raid, answer maths questions, and work together to defeat a shared boss.

It is designed to work in classrooms, at home, in tutoring, workplace learning, events, clubs, and other hosted group sessions.

## Core terminology

- **Host**: the person running the raid. This could be a teacher, parent, tutor, trainer, facilitator, team lead, or another organiser.
- **Player**: anyone joining the raid with a code.
- **Group**: the players participating in the same raid.
- **Raid**: the shared cooperative game session.

Classroom-specific wording should only appear where a feature is explicitly school-specific. Core routes, APIs, UI and gameplay should use the generic terminology above.

## Product principles

- Shared raid progress, private individual performance.
- No public individual performance leaderboards by default.
- Individual learning results are visible to the authorised host, not other players.
- Guest-first join flow for the MVP.
- Avoid pay-to-win mechanics and paid random loot.
- Ranked raids use standardised maths categories and difficulty bands so comparable groups can use the same challenge rules.
- Individual Mode can support differentiated difficulty, but personalised difficulty does not silently affect ranked results.

## Maths modes

### Ranked Raid

All participants answer questions from the same configured operation set and difficulty band. Initial operation sets are addition, subtraction, multiplication and division. Questions can differ between players, but they are generated from the same rules and difficulty profile.

Ranked Raid can support comparable group or event rankings later.

### Individual Mode

A host can enable Individual Mode when players need different difficulty levels while staying in the same raid. Players still contribute to the shared boss fight, but the raid is treated as unranked unless a future ranking model explicitly normalises personalised difficulty.

Individual performance remains private to the player and authorised host.

## MVP

The first vertical slice targets a host-created raid room, six-character join codes, up to 60 players, DPS and Healer roles, multiple-choice maths questions, simple left/right/jump raid mechanics, one city boss encounter, power abilities, and a private host report.

Production domain: https://mathraids.com
