# Question Engine

MathRaids should keep the raid engine subject-agnostic even though the MVP is maths-only.

## Core question shape

Each question should expose a common structure:

```js
{
  id: "q_123",
  subject: "maths",
  category: "multiplication",
  difficulty: 3,
  prompt: "What is 8 × 7?",
  choices: [48, 54, 56, 64],
  correctAnswer: 56
}
```

The server remains authoritative for correctness and scoring.

## Maths MVP

Initial categories:

- addition
- subtraction
- multiplication
- division
- mixed arithmetic

Ranked raids use a standardised category and difficulty profile so results can be compared fairly across classes and schools.

## Future subjects

The same contract should support future subject packs without changing the raid engine. Possible English categories include:

- synonyms
- antonyms
- spelling
- vocabulary
- grammar
- reading comprehension

Example future English question:

```js
{
  id: "q_english_123",
  subject: "english",
  category: "synonyms",
  difficulty: 2,
  prompt: "Which word is a synonym for happy?",
  choices: ["angry", "joyful", "tired", "quiet"],
  correctAnswer: "joyful"
}
```

English content is intentionally out of scope for the first MathRaids MVP. The architecture should merely avoid assumptions that every question is numeric.
