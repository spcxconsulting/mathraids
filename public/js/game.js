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
const battlefield = document.querySelector('#battlefield');
const bossSprite = document.querySelector('#boss-sprite');
const playersLayer = document.querySelector('#players-layer');
const effectsLayer = document.querySelector('#effects-layer');
const dangerZone = document.querySelector('#danger-zone');
const shockwave = document.querySelector('#shockwave');
const bossWarning = document.querySelector('#boss-warning');
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
let activeTelegraphId = null;
let telegraphTimer;
let pointerDirection = null;
const keyState = { left: false, right: false };
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

raidCodeLabel.textContent = `Raid ${code}`;
connect();
setupMovementControls();

function setupMovementControls() {
  bindHoldButton(leftButton, 'left');
  bindHoldButton(rightButton, 'right');

  jumpButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    jumpButton.classList.add('active');
    send({ type: 'jump' });
    setTimeout(() => jumpButton.classList.remove('active'), 180);
  });

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (event.key === 'ArrowLeft' || key === 'a') {
      event.preventDefault();
      keyState.left = true;
      leftButton.classList.add('active');
    }
    if (event.key === 'ArrowRight' || key === 'd') {
      event.preventDefault();
      keyState.right = true;
      rightButton.classList.add('active');
    }
    if (!event.repeat && (event.key === 'ArrowUp' || event.key === ' ' || key === 'w')) {
      event.preventDefault();
      jumpButton.classList.add('active');
      send({ type: 'jump' });
      setTimeout(() => jumpButton.classList.remove('active'), 180);
    }
  });

  window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (event.key === 'ArrowLeft' || key === 'a') {
      keyState.left = false;
      leftButton.classList.remove('active');
    }
    if (event.key === 'ArrowRight' || key === 'd') {
      keyState.right = false;
      rightButton.classList.remove('active');
    }
  });

  window.addEventListener('blur', resetMovement);

  setInterval(() => {
    const direction = movementDirection();
    if (direction) send({ type: 'move', direction });
  }, 70);
}

function bindHoldButton(button, direction) {
  const stop = () => {
    if (pointerDirection === direction) pointerDirection = null;
    button.classList.remove('active');
  };

  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    pointerDirection = direction;
    button.classList.add('active');
    button.setPointerCapture?.(event.pointerId);
    send({ type: 'move', direction });
  });
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener('lostpointercapture', stop);
}

function resetMovement() {
  pointerDirection = null;
  keyState.left = false;
  keyState.right = false;
  leftButton.classList.remove('active');
  rightButton.classList.remove('active');
}

function movementDirection() {
  if (pointerDirection) return pointerDirection;
  if (keyState.left === keyState.right) return null;
  return keyState.left ? 'left' : 'right';
}

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
    try {
      handleMessage(JSON.parse(event.data));
    } catch {
      feedback.className = 'feedback bad';
      feedback.textContent = 'A raid update could not be read.';
    }
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
    animateMovement(payload.playerId, payload.x, payload.facing);
    return;
  }

  if (payload.type === 'player_jump') {
    animateJump(payload.playerId);
    return;
  }

  if (payload.type === 'player_action') {
    animatePlayerAction(payload);
    return;
  }

  if (payload.type === 'boss_telegraph') {
    showTelegraph(payload.attack);
    return;
  }

  if (payload.type === 'boss_attack') {
    resolveBossAttack(payload);
    return;
  }

  if (payload.type === 'stunned') {
    applyDaze(payload.until);
    return;
  }

  if (payload.type === 'error') {
    feedback.className = 'feedback bad';
    feedback.textContent = payload.message || 'Raid error.';
    return;
  }

  if (payload.type === 'raid_complete') {
    raidComplete = true;
    resetMovement();
    clearTelegraph();
    updateState(payload.state);
    disableAnswers();
    questionCategory.textContent = 'Raid complete';
    questionText.textContent = payload.outcome === 'victory' ? 'Numberzilla defeated!' : 'The raid was defeated';
    feedback.className = payload.outcome === 'victory' ? 'feedback good' : 'feedback bad';
    feedback.textContent = payload.outcome === 'victory'
      ? 'Victory! Your teacher has the private class report.'
      : 'Good attempt. Your teacher can start another raid.';
    if (payload.outcome === 'victory') bossSprite.classList.add('defeated');
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

  const dodgeText = state.team?.dodgeRate > 0 ? ` · ${state.team.dodgeRate}% dodge rate` : '';
  teamStats.textContent = `${state.team?.questions || 0} questions · ${state.players?.length || 0} raiders${dodgeText}`;

  renderPlayers(state.players || []);

  if (state.pendingAttack && state.pendingAttack.executeAt > Date.now()) {
    showTelegraph(state.pendingAttack);
  }

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
    node.classList.toggle('role-healer', player.class === 'healer');
    node.classList.toggle('role-dps', player.class !== 'healer');
    node.classList.toggle('facing-left', player.facing === 'left');
    node.classList.toggle('facing-right', player.facing !== 'left');
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
  feedback.textContent = join.class === 'healer'
    ? 'Correct answers cast a heal and still damage Numberzilla.'
    : 'Correct answers launch an attack at Numberzilla.';
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
    feedback.textContent = join.class === 'healer'
      ? `Correct! +${result.healing} raid healing and ${result.damage} boss damage.`
      : `Correct! ${result.damage} damage.`;
  } else {
    if (selected) selected.classList.add('wrong');
    feedback.className = 'feedback bad';
    feedback.textContent = `Not quite. The answer was ${result.correctAnswer}.`;
  }

  currentQuestion = null;
  const dazeDelay = result.stunnedUntil ? Math.max(0, result.stunnedUntil - Date.now()) : 0;
  if (result.stunnedUntil) applyDaze(result.stunnedUntil);

  if (result.nextQuestion && !raidComplete) {
    const feedbackDelay = result.correct ? 420 : 760;
    setTimeout(() => renderQuestion(result.nextQuestion), Math.max(feedbackDelay, dazeDelay));
  }
}

function animateMovement(id, x, facing) {
  const node = playerNode(id);
  if (!node) return;
  node.style.left = `${x}%`;
  node.classList.toggle('facing-left', facing === 'left');
  node.classList.toggle('facing-right', facing !== 'left');
  node.classList.add('moving');
  clearTimeout(node._moveTimer);
  node._moveTimer = setTimeout(() => node.classList.remove('moving'), 150);
}

function animateJump(id) {
  const node = playerNode(id);
  if (!node) return;
  node.classList.remove('jump');
  void node.offsetWidth;
  node.classList.add('jump');
  setTimeout(() => node.classList.remove('jump'), 680);
}

function animatePlayerAction(action) {
  const source = playerNode(action.playerId);
  if (!source) return;

  if (action.healing > 0) {
    pulseRaidHealth();
    floatAtPlayer(action.playerId, `+${action.healing}`, 'heal');
  }

  const sourceRect = source.querySelector('.avatar')?.getBoundingClientRect();
  const bossRect = bossSprite.getBoundingClientRect();
  const fieldRect = battlefield.getBoundingClientRect();
  if (!sourceRect || !bossRect) return;

  const startX = sourceRect.left + sourceRect.width / 2 - fieldRect.left;
  const startY = sourceRect.top + sourceRect.height / 2 - fieldRect.top;
  const endX = bossRect.left + bossRect.width / 2 - fieldRect.left;
  const endY = bossRect.top + bossRect.height * .42 - fieldRect.top;
  const dx = endX - startX;
  const dy = endY - startY;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  const projectile = document.createElement('div');
  projectile.className = `projectile ${action.action === 'heal' ? 'heal' : 'dps'}`;
  projectile.style.left = `${startX}px`;
  projectile.style.top = `${startY}px`;
  effectsLayer.append(projectile);

  const duration = prefersReducedMotion ? 1 : action.action === 'heal' ? 520 : 390;
  const animation = projectile.animate([
    { transform: `translate(0, 0) rotate(${angle}deg) scale(.8)`, opacity: .2 },
    { transform: `translate(${dx * .48}px, ${dy * .55 - 22}px) rotate(${angle}deg) scale(1.15)`, opacity: 1, offset: .55 },
    { transform: `translate(${dx}px, ${dy}px) rotate(${angle}deg) scale(1)`, opacity: 1 }
  ], { duration, easing: 'cubic-bezier(.2,.72,.2,1)', fill: 'forwards' });

  animation.addEventListener('finish', () => {
    projectile.remove();
    showImpact(endX, endY, action.action === 'heal');
    floatAt(endX, endY - 6, `-${action.damage}`, 'damage');
    bossSprite.classList.remove('hit');
    void bossSprite.offsetWidth;
    bossSprite.classList.add('hit');
    setTimeout(() => bossSprite.classList.remove('hit'), 300);
  });
}

function showImpact(x, y, healer) {
  const impact = document.createElement('div');
  impact.className = `impact${healer ? ' heal-impact' : ''}`;
  impact.style.left = `${x}px`;
  impact.style.top = `${y}px`;
  effectsLayer.append(impact);
  setTimeout(() => impact.remove(), 420);
}

function pulseRaidHealth() {
  raidHealthBar.classList.remove('raid-heal-flash');
  void raidHealthBar.offsetWidth;
  raidHealthBar.classList.add('raid-heal-flash');
  setTimeout(() => raidHealthBar.classList.remove('raid-heal-flash'), 460);
}

function showTelegraph(attack) {
  if (!attack || activeTelegraphId === attack.id) return;
  clearTelegraph();
  activeTelegraphId = attack.id;

  bossWarning.classList.add('active');
  if (attack.type === 'left_slam') {
    dangerZone.className = 'danger-zone active left';
    bossWarning.textContent = 'Left side danger! Move right!';
  } else if (attack.type === 'right_slam') {
    dangerZone.className = 'danger-zone active right';
    bossWarning.textContent = 'Right side danger! Move left!';
  } else {
    shockwave.className = 'shockwave active';
    bossWarning.textContent = 'Shockwave incoming! Jump!';
  }

  const remaining = Math.max(0, attack.executeAt - Date.now());
  telegraphTimer = setTimeout(() => {
    if (activeTelegraphId === attack.id) {
      bossWarning.textContent = 'Brace!';
    }
  }, Math.max(0, remaining - 260));
}

function clearTelegraph() {
  clearTimeout(telegraphTimer);
  activeTelegraphId = null;
  dangerZone.className = 'danger-zone';
  shockwave.className = 'shockwave';
  bossWarning.classList.remove('active');
  bossWarning.textContent = '';
}

function resolveBossAttack(payload) {
  const wasShockwave = payload.attackType === 'shockwave';
  clearTelegraph();

  bossSprite.classList.remove('attack');
  void bossSprite.offsetWidth;
  bossSprite.classList.add('attack');
  setTimeout(() => bossSprite.classList.remove('attack'), 480);

  if (wasShockwave) {
    shockwave.className = 'shockwave resolve';
    setTimeout(() => { shockwave.className = 'shockwave'; }, 500);
  }

  if (payload.damage > 0) {
    battlefield.classList.remove('screen-shake');
    void battlefield.offsetWidth;
    battlefield.classList.add('screen-shake');
    setTimeout(() => battlefield.classList.remove('screen-shake'), 320);
  }

  for (const id of payload.hitPlayerIds || []) {
    const node = playerNode(id);
    if (!node) continue;
    node.classList.add('hit-player');
    setTimeout(() => node.classList.remove('hit-player'), 420);
  }

  for (const id of payload.dodgedPlayerIds || []) {
    const node = playerNode(id);
    if (!node) continue;
    node.classList.add('dodged');
    setTimeout(() => node.classList.remove('dodged'), 620);
  }

  const iWasHit = (payload.hitPlayerIds || []).includes(playerId);
  const iDodged = (payload.dodgedPlayerIds || []).includes(playerId);
  if (iDodged) floatAtPlayer(playerId, 'DODGE!', 'dodge');

  bossWarning.textContent = payload.damage === 0
    ? 'Perfect dodge! No raid damage!'
    : iWasHit
      ? `Hit! Raid takes ${payload.damage} damage`
      : `Dodged! Raid takes ${payload.damage} damage`;
  bossWarning.classList.add('active');
  setTimeout(() => {
    bossWarning.classList.remove('active');
    bossWarning.textContent = '';
  }, 1050);
}

function floatAtPlayer(id, text, kind) {
  const node = playerNode(id);
  if (!node) return;
  const rect = node.getBoundingClientRect();
  const fieldRect = battlefield.getBoundingClientRect();
  floatAt(rect.left + rect.width / 2 - fieldRect.left, rect.top - fieldRect.top, text, kind);
}

function floatAt(x, y, text, kind) {
  const number = document.createElement('div');
  number.className = `floating-number ${kind}`;
  number.textContent = text;
  number.style.left = `${x}px`;
  number.style.top = `${y}px`;
  effectsLayer.append(number);
  setTimeout(() => number.remove(), 950);
}

function applyDaze(until) {
  const me = playerNode(playerId);
  if (me) me.classList.add('dazed');
  disableAnswers();
  feedback.className = 'feedback stun';
  feedback.textContent = 'Dazed! Slow down and think about the next answer.';
  const delay = Math.max(0, until - Date.now());
  setTimeout(() => {
    if (me) me.classList.remove('dazed');
  }, delay);
}

function playerNode(id) {
  return document.querySelector(`[data-player-id="${cssEscape(id)}"]`);
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
