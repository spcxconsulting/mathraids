const params = new URLSearchParams(window.location.search);
const code = String(params.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const savedJoin = sessionStorage.getItem(`mathraids:join:${code}`);

if (!code || !savedJoin) {
  window.location.replace(`/join/${code ? `?code=${encodeURIComponent(code)}` : ''}`);
}

const join = savedJoin ? JSON.parse(savedJoin) : null;
const bossLabel = document.querySelector('#boss-label');
const bossBar = document.querySelector('#boss-bar');
const bossHpLabel = document.querySelector('#boss-hp-label');
const raidHealthBar = document.querySelector('#raid-health-bar');
const teamStats = document.querySelector('#team-stats');
const raidCodeLabel = document.querySelector('#raid-code-label');
const bossSprite = document.querySelector('#boss-sprite');
const playersLayer = document.querySelector('#players-layer');
const questionCategory = document.querySelector('#question-category');
const questionText = document.querySelector('#question-text');
const answersEl = document.querySelector('#answers');
const feedback = document.querySelector('#feedback');
const leftButton = document.querySelector('#move-left');
const rightButton = document.querySelector('#move-right');
const jumpButton = document.querySelector('#jump');

let socket;
let playerId;
let currentQuestion;
let latestState;
let raidComplete = false;
let reconnectTimer;

raidCodeLabel.textContent = `Raid ${code}`;
connect();

leftButton.addEventListener('click', () => send({ type: 'move', direction: 'left' }));
rightButton.addEventListener('click', () => send({ type: 'move', direction: 'right' }));
jumpButton.addEventListener('click', () => send({ type: 'jump' }));

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
    event.preventDefault();
    send({ type: 'move', direction: 'left' });
  }
  if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
    event.preventDefault();
    send({ type: 'move', direction: 'right' });
  }
  if (event.key === 'ArrowUp' || event.key === ' ' || event.key.toLowerCase() === 'w') {
    event.preventDefault();
    send({ type: 'jump' });
  }
});

function connect() {
  if (!join || raidComplete) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = new URLSearchParams({
    role: 'student',
    name: join.name,
    class: join.class,
    clientId: join.clientId
  });
  socket = new WebSocket(`${protocol}//${window.location.host}/ws/${encodeURIComponent(code)}?${query}`);

  socket.addEventListener('open', () => {
    feedback.className = 'feedback';
    feedback.textContent = 'Connected to raid.';
  });

  socket.addEventListener('close', () => {
    if (raidComplete) return;
    feedback.className = 'feedback bad';
    feedback.textContent = 'Connection lost. Reconnecting...';
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    handleMessage(payload);
  });
}

function handleMessage(payload) {
  if (payload.type === 'connected') {
    playerId = payload.playerId;
    updateState(payload.state);
    if (payload.question) renderQuestion(payload.question);
    return;
  }

  if (payload.type === 'state' || payload.type === 'raid_started') {
    updateState(payload.state);
    return;
  }

  if (payload.type === 'question') {
    renderQuestion(payload.question);
    return;
  }

  if (payload.type === 'answer_result') {
    handleAnswerResult(payload);
    return;
  }

  if (payload.type === 'player_move') {
    const node = document.querySelector(`[data-player-id="${cssEscape(payload.playerId)}"]`);
    if (node) node.style.left = `${payload.x}%`;
    return;
  }

  if (payload.type === 'player_jump') {
    animateJump(payload.playerId);
    return;
  }

  if (payload.type === 'boss_attack') {
    bossSprite.classList.add('attack');
    setTimeout(() => bossSprite.classList.remove('attack'), 260);
    feedback.className = 'feedback bad';
    feedback.textContent = `Numberzilla attacks the raid for ${payload.damage}!`;
    return;
  }

  if (payload.type === 'stunned') {
    applyDaze(payload.until);
    return;
  }

  if (payload.type === 'raid_complete') {
    raidComplete = true;
    updateState(payload.state);
    disableAnswers();
    questionCategory.textContent = 'Raid complete';
    questionText.textContent = payload.outcome === 'victory' ? 'Numberzilla defeated!' : 'The raid was defeated';
    feedback.className = payload.outcome === 'victory' ? 'feedback good' : 'feedback bad';
    feedback.textContent = payload.outcome === 'victory'
      ? 'Victory! Your teacher has the private class report.'
      : 'Good attempt. Your teacher can start another raid.';
  }
}

function updateState(state) {
  if (!state) return;
  latestState = state;
  bossLabel.textContent = state.boss?.name || 'Boss';

  const bossPercent = state.boss?.maxHealth ? (state.boss.health / state.boss.maxHealth) * 100 : 100;
  bossBar.style.width = `${Math.max(0, bossPercent)}%`;
  bossHpLabel.textContent = state.status === 'lobby'
    ? 'Waiting for the raid to start'
    : `${Math.ceil(state.boss.health)} / ${Math.ceil(state.boss.maxHealth)} HP`;

  const raidPercent = state.maxRaidHealth ? (state.raidHealth / state.maxRaidHealth) * 100 : 100;
  raidHealthBar.style.width = `${Math.max(0, raidPercent)}%`;
  teamStats.textContent = `${state.team?.questions || 0} questions answered · ${state.players?.length || 0} raiders`;

  renderPlayers(state.players || []);

  if (state.status === 'lobby') {
    currentQuestion = null;
    questionCategory.textContent = 'Waiting for the teacher to start the raid';
    questionText.textContent = 'Get ready...';
    answersEl.replaceChildren();
  }
}

function renderPlayers(players) {
  const activeIds = new Set(players.map((player) => player.id));
  for (const node of [...playersLayer.children]) {
    if (!activeIds.has(node.dataset.playerId)) node.remove();
  }

  for (const player of players) {
    let node = [...playersLayer.children].find((entry) => entry.dataset.playerId === player.id);
    if (!node) {
      node = document.createElement('div');
      node.className = 'player';
      node.dataset.playerId = player.id;
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      const name = document.createElement('div');
      name.className = 'name';
      node.append(avatar, name);
      playersLayer.append(node);
    }

    node.classList.toggle('me', player.id === playerId);
    node.style.left = `${player.x}%`;
    node.querySelector('.avatar').textContent = player.class === 'healer' ? '🧙' : '🏹';
    node.querySelector('.name').textContent = player.id === playerId ? `${player.name} (you)` : player.name;
  }
}

function renderQuestion(question) {
  if (!question || raidComplete) return;
  currentQuestion = question;
  questionCategory.textContent = `${titleCase(question.category)} · Level ${question.difficulty}`;
  questionText.textContent = question.prompt;
  feedback.className = 'feedback';
  feedback.textContent = join.class === 'healer' ? 'Correct answers heal the raid and damage the boss.' : 'Correct answers fire at the boss.';
  answersEl.replaceChildren();

  for (const choice of question.choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'answer-btn';
    button.textContent = String(choice);
    button.addEventListener('click', () => submitAnswer(choice, button));
    answersEl.append(button);
  }
}

function submitAnswer(choice, clickedButton) {
  if (!currentQuestion || !socket || socket.readyState !== WebSocket.OPEN) return;
  for (const button of answersEl.querySelectorAll('button')) button.disabled = true;
  clickedButton.dataset.selected = 'true';
  send({ type: 'answer', questionId: currentQuestion.id, answer: choice });
}

function handleAnswerResult(result) {
  const selected = answersEl.querySelector('[data-selected="true"]');
  if (result.correct) {
    if (selected) selected.classList.add('correct');
    feedback.className = 'feedback good';
    const effect = join.class === 'healer'
      ? `Correct! +${result.healing} raid healing and ${result.damage} boss damage.`
      : `Correct! You hit Numberzilla for ${result.damage}.`;
    feedback.textContent = effect;
    bossSprite.classList.add('hit');
    setTimeout(() => bossSprite.classList.remove('hit'), 190);
  } else {
    if (selected) selected.classList.add('wrong');
    feedback.className = 'feedback bad';
    feedback.textContent = `Not quite. The answer was ${result.correctAnswer}.`;
  }

  currentQuestion = null;
  const dazeDelay = result.stunnedUntil ? Math.max(0, result.stunnedUntil - Date.now()) : 0;
  if (result.stunnedUntil) applyDaze(result.stunnedUntil);

  if (result.nextQuestion && !raidComplete) {
    setTimeout(() => renderQuestion(result.nextQuestion), Math.max(650, dazeDelay));
  }
}

function applyDaze(until) {
  const me = document.querySelector(`[data-player-id="${cssEscape(playerId)}"]`);
  if (me) me.classList.add('dazed');
  disableAnswers();
  feedback.className = 'feedback stun';
  feedback.textContent = 'Dazed! Slow down and think about the next answer.';
  const delay = Math.max(0, until - Date.now());
  setTimeout(() => {
    if (me) me.classList.remove('dazed');
  }, delay);
}

function animateJump(id) {
  const node = document.querySelector(`[data-player-id="${cssEscape(id)}"]`);
  if (!node) return;
  node.classList.add('jump');
  setTimeout(() => node.classList.remove('jump'), 360);
}

function disableAnswers() {
  for (const button of answersEl.querySelectorAll('button')) button.disabled = true;
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function titleCase(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, '');
}
