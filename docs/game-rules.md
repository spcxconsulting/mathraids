# MathRaids Game Rules

## Hosted group raids

MathRaids raids are cooperative. Players contribute to a shared boss fight while individual performance remains private to the player and authorised host.

The host can be a teacher, parent, tutor, trainer, facilitator, team lead, or another organiser. Core game rules should not depend on a classroom setting.

Ranked raids use a common subject/category and difficulty band for all participants. Individual Mode can be enabled by the host for differentiated learning and is unranked by default.

## Personal practice

Players may eventually have personal accounts for at-home practice, progression and cosmetics. Personal practice can use adaptive difficulty and does not need to follow ranked group rules.

Personal profiles can eventually track cosmetic unlocks, practice history and learning progress. Accounts should not expose public academic leaderboards by default.

## Wrong answers and anti-spam

Wrong answers should not be treated as punishment. A normal incorrect answer should provide neutral feedback and immediately allow the player to continue learning.

To prevent random button-spamming, repeated rapid incorrect guesses can trigger a short temporary `dazed` state. During the dazed state, answer buttons are disabled briefly and the character can show a harmless stun animation.

Suggested initial rule:

- First incorrect answers: no gameplay penalty beyond no attack/heal being generated.
- Track incorrect answers over a rolling short window.
- Trigger dazed only after several rapid incorrect submissions, for example 3 incorrect answers within approximately 6 seconds.
- Initial dazed duration: approximately 2 seconds.
- Correct answers and normal-paced attempts naturally clear the rolling spam counter.
- Never remove points, loot or progression because a player answered incorrectly.
- Do not publicly expose who was dazed or how many mistakes another player made.

The server should enforce anti-spam timing so it cannot be bypassed by modifying the browser client.

## Roles

Initial MVP roles:

- DPS: correct answers generate attacks against the boss.
- Healer: correct answers generate healing or shields, with light fallback damage when healing is not currently required.

The learning difficulty is independent of role.
