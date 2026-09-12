const TOPICS = new Set(['addition', 'subtraction', 'multiplication', 'division', 'mixed']);

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clampDifficulty(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(4, Math.max(1, parsed));
}

function addition(level) {
  const max = [10, 30, 100, 500][level - 1];
  const a = randomInt(0, max);
  const b = randomInt(0, max);
  return { prompt: `${a} + ${b}`, answer: a + b };
}

function subtraction(level) {
  const max = [10, 30, 100, 500][level - 1];
  const a = randomInt(0, max);
  const b = randomInt(0, a);
  return { prompt: `${a} − ${b}`, answer: a - b };
}

function multiplication(level) {
  if (level === 4) {
    const a = randomInt(10, 99);
    const b = randomInt(2, 12);
    return { prompt: `${a} × ${b}`, answer: a * b };
  }

  const max = [5, 10, 12][level - 1];
  const a = randomInt(1, max);
  const b = randomInt(1, max);
  return { prompt: `${a} × ${b}`, answer: a * b };
}

function division(level) {
  let divisor;
  let quotient;

  if (level === 4) {
    divisor = randomInt(2, 12);
    quotient = randomInt(10, 50);
  } else {
    const max = [5, 10, 12][level - 1];
    divisor = randomInt(1, max);
    quotient = randomInt(1, max);
  }

  const dividend = divisor * quotient;
  return { prompt: `${dividend} ÷ ${divisor}`, answer: quotient };
}

function buildDistractors(answer) {
  const values = new Set([answer]);
  const spread = Math.max(3, Math.ceil(Math.abs(answer) * 0.2));
  let guard = 0;

  while (values.size < 4 && guard < 100) {
    guard += 1;
    const offset = randomInt(-spread, spread);
    const candidate = Math.max(0, answer + (offset === 0 ? randomInt(1, 3) : offset));
    values.add(candidate);
  }

  while (values.size < 4) values.add(answer + values.size);

  return [...values].sort(() => Math.random() - 0.5);
}

export function normaliseQuestionConfig(topic = 'multiplication', difficulty = 2) {
  return {
    topic: TOPICS.has(topic) ? topic : 'multiplication',
    difficulty: clampDifficulty(difficulty)
  };
}

export function generateQuestion(topic = 'multiplication', difficulty = 2) {
  const config = normaliseQuestionConfig(topic, difficulty);
  let chosenTopic = config.topic;

  if (chosenTopic === 'mixed') {
    const options = ['addition', 'subtraction', 'multiplication', 'division'];
    chosenTopic = options[randomInt(0, options.length - 1)];
  }

  const factories = { addition, subtraction, multiplication, division };
  const generated = factories[chosenTopic](config.difficulty);

  return {
    id: crypto.randomUUID(),
    subject: 'math',
    category: chosenTopic,
    difficulty: config.difficulty,
    prompt: generated.prompt,
    choices: buildDistractors(generated.answer),
    correctAnswer: generated.answer,
    issuedAt: Date.now()
  };
}

export function publicQuestion(question) {
  if (!question) return null;
  return {
    id: question.id,
    subject: question.subject,
    category: question.category,
    difficulty: question.difficulty,
    prompt: question.prompt,
    choices: question.choices
  };
}
