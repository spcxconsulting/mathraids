# MathRaids Game Rules

## Classroom raids

Classroom raids are cooperative. Students contribute to a shared boss fight while individual performance remains private to the student and authorised teacher.

Ranked raids use a common subject/category and difficulty band for all participants. Individual Mode can be enabled by the teacher for differentiated learning and is unranked by default.

## Personal practice

Students may have personal accounts for at-home practice, progression and cosmetics. Personal practice can use adaptive difficulty and does not need to follow ranked classroom rules.

Personal profiles can eventually track cosmetic unlocks, practice history and learning progress. Student accounts should not expose public academic leaderboards by default.

## Wrong answers and anti-spam

Wrong answers should not be treated as punishment. A normal incorrect answer should provide neutral feedback and immediately allow the student to continue learning.

To prevent random button-spamming, repeated rapid incorrect guesses can trigger a short temporary `dazed` state. During the dazed state, answer buttons are disabled briefly and the character can show a harmless stun animation.

Suggested initial rule:

- First incorrect answers: no gameplay penalty beyond no attack/heal being generated.
- Track incorrect answers over a rolling short window.
- Trigger dazed only after several rapid incorrect submissions, for example 3 incorrect answers within approximately 6 seconds.
- Initial dazed duration: approximately 2 seconds.
- Correct answers and normal-paced attempts naturally clear the rolling spam counter.
- Never remove points, loot or progression because a student answered incorrectly.
- Do not publicly expose who was dazed or how many mistakes another student made.

The server should enforce anti-spam timing so it cannot be bypassed by modifying the browser client.

## Roles

Initial MVP roles:

- DPS: correct answers generate attacks against the boss.
- Healer: correct answers generate healing or shields, with light fallback damage when healing is not currently required.

The educational difficulty is independent of role.
