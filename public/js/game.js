import { createRaidBattlefield } from './phaser-battlefield.js';

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
const battlefieldStatus = document.querySelector('#battlefield-status');
const questionCategory = document.querySelector('#question-category');
const questionText = document.querySelector('#question-text');
const answersEl = document.querySelector('#answers');
const feedback = document.querySelector('#feedback');
const leftButton = document.querySelector('#move-left');
const rightButton = document.querySelector('#move-right');
const jumpButton = document.querySelector('#jump');
const powerPanel = document.querySelector('#power-panel');
const powerName = document.querySelector('#power-name');
const powerDescription = document.querySelector('#power-description');
const powerStatus = document.querySelector('#power-status');
const powerMeterBar = document.querySelector('#power-meter-bar');
const specialButton = document.querySelector('#special');
const specialLabel = document.querySelector('#special-label');

let socket;
let playerId;
let currentQuestion;
let raidComplete = false;
let raidRunning = false;
let reconnectTimer;
let power = {
  streak: 0,
  threshold: 5,
  ready: false,
  ability: join?.class === 'healer' ? 'renewal_burst' : 'power_shot',
  abilityName: join?.class === 'healer' ? 'Renewal Burst' : 'Power Shot'
};

const battlefield = createRaidBattlefield({
  parent: 'phaser-game',
  onPosition: ({ x, facing }) => send({ type: 'position', x, facing }),
  onJump: () => send({ type: 'jump' })
});

raidCodeLabel.textContent = `Raid ${code}`;
configurePowerUi();
setupMovementButtons();
connect();

function configurePowerUi() {
  const healer = join?.class === 'healer';
  powerPanel.classList.toggle('healer', healer);
  powerName.textContent = healer ? 'Renewal Burst' : 'Power Shot';
  specialLabel.textContent = healer ? 'Use Renewal Burst' : 'Use Power Shot';
  powerDescription.textContent = healer
    ? '5 correct in a row charges a raid heal and boss strike.'
    : '5 correct in a row charges a heavy boss strike.';
  renderPower();
}

function setupMovementButtons() {
  bindHoldButton(leftButton, 'left');
  bindHoldButton(rightButton, 'right');

  jumpButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    jumpButton.classList.add('active');
    battlefield.jump();
    setTimeout(() => jumpButton.classList.remove('active'), 150);
  });

  specialButton.addEventListener('click', activateSpecial);
  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.key.toLowerCase() !== 'e') return;
    event.preventDefault();
    activateSpecial();
  });

  window.addEventListener('blur', () => battlefield.resetInput());
}

function activateSpecial() {
  if (!power.ready || !raidRunning || raidComplete || socket?.readyState !== WebSocket.OPEN) return;
  specialButton.disabled = true;
  send({ type: 'special' });
}

function bindHoldButton(button, direction) {
  const stop = () => {
    battlefield.setMoveButton(direction, false);
    button.classList.remove('active');
  };

  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    battlefield.setMoveButton(direction, true);
    button.classList.add('active');
  });
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener('lostpointercapture', stop);
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
    battlefield.resetInput();
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
    battlefield.setLocalPlayerId(playerId);
    updateState(payload.state);
    if (payload.question) renderQuestion(payload.question);
    send({ type: 'get_power' });
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

  if (payload.type === 'power_state') {
    updatePower(payload.power);
    return;
  }

  if (payload.type === 'special_result') {
    feedback.className = 'feedback good';
    feedback.textContent = payload.healing > 0
      ? `${payload.abilityName}! +${payload.healing} raid healing and ${payload.damage} boss damage.`
      : `${payload.abilityName}! ${payload.damage} boss damage.`;
    return;
  }

  if (payload.type === 'player_move') {
    battlefield.movePlayer(payload.playerId, payload.x, payload.facing, payload.airborneUntil);
    return;
  }

  if (payload.type === 'player_jump') {
    battlefield.jumpPlayer(payload.playerId, payload.airborneUntil);
    return;
  }

  if (payload.type === 'player_action') {
    battlefield.playerAction(payload);
    return;
  }

  if (payload.type === 'player_special') {
    battlefield.playerSpecial(payload);
    return;
  }

  if (payload.type === 'boss_telegraph') {
    battlefield.showTelegraph(payload.attack);
    battlefieldStatus.textContent = telegraphText(payload.attack?.type);
    return;
  }

  if (payload.type === 'boss_attack') {
    battlefield.resolveBossAttack(payload);
    const hit = (payload.hitPlayerIds || []).includes(playerId);
    const dodged = (payload.dodgedPlayerIds || []).includes(playerId);
    feedback.className = hit ? 'feedback bad' : 'feedback good';
    feedback.textContent = payload.damage === 0
      ? 'Perfect raid dodge! No damage taken.'
      : hit
        ? `You were caught by the attack. Raid takes ${payload.damage} damage.`
        : dodged
          ? `Dodged! Raid takes ${payload.damage} damage.`
          : `Raid takes ${payload.damage} damage.`;
    battlefieldStatus.textContent = feedback.textContent;
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
    raidRunning = false;
    battlefield.resetInput();
    battlefield.complete(payload.outcome);
    updateState(payload.state);
    disableAnswers();
    specialButton.disabled = true;
    questionCategory.textContent = 'Raid complete';
    questionText.textContent = payload.outcome === 'victory' ? 'Numberzilla defeated!' : 'The raid was defeated';
    feedback.className = payload.outcome === 'victory' ? 'feedback good' : 'feedback bad';
    feedback.textContent = payload.outcome === 'victory'
      ? 'Victory! Your teacher has the private class report.'
      : 'Good attempt. Your teacher can start another raid.';
    battlefieldStatus.textContent = feedback.textContent;
  }
}

function updatePower(nextPower) {
  if (!nextPower) return;
  power = { ...power, ...nextPower };
  battlefield.setLocalPowerReady(Boolean(power.ready));
  renderPower();
}

function renderPower() {
  const threshold = Math.max(1, Number(power.threshold) || 5);
  const streak = Math.min(threshold, Math.max(0, Number(power.streak) || 0));
  const percent = power.ready ? 100 : (streak / threshold) * 100;

  powerPanel.classList.toggle('ready', Boolean(power.ready));
  specialButton.classList.toggle('ready', Boolean(power.ready));
  powerMeterBar.style.width = `${percent}%`;
  powerStatus.textContent = power.ready ? 'READY' : `${streak} / ${threshold}`;
  specialButton.disabled = !power.ready || !raidRunning || raidComplete;

  if (power.ready) {
    powerDescription.textContent = `${power.abilityName} is charged. Use it when you are ready.`;
  } else if (join?.class === 'healer') {
    powerDescription.textContent = '5 correct in a row charges a raid heal and boss strike.';
  } else {
    powerDescription.textContent = '5 correct in a row charges a heavy boss strike.';
  }
}

function updateState(state) {
  if (!state) return;
  battlefield.syncState(state);

  const inLobby = state.status === 'lobby';
  raidRunning = state.status === 'running';
  bossLabel.textContent = inLobby ? 'Raid staging area' : state.boss?.name || 'Boss';

  const bossPercent = state.boss?.maxHealth ? (state.boss.health / state.boss.maxHealth) * 100 : 100;
  bossBar.style.width = `${Math.max(0, bossPercent)}%`;
  bossBar.parentElement.classList.toggle('is-lobby', inLobby);
  bossHpLabel.textContent = inLobby
    ? 'Waiting for the raid to start'
    : `${Math.ceil(state.boss.health)} / ${Math.ceil(state.boss.maxHealth)} HP`;

  const raidPercent = state.maxRaidHealth ? (state.raidHealth / state.maxRaidHealth) * 100 : 100;
  raidHealthBar.style.width = `${Math.max(0, raidPercent)}%`;

  const dodgeText = state.team?.dodgeRate > 0 ? ` · ${state.team.dodgeRate}% dodge rate` : '';
  teamStats.textContent = inLobby
    ? `${state.players?.length || 0} raiders assembling`
    : `${state.team?.questions || 0} questions · ${state.players?.length || 0} raiders${dodgeText}`;

  if (state.pendingAttack && state.pendingAttack.executeAt > Date.now()) {
    battlefield.showTelegraph(state.pendingAttack);
  }

  if (inLobby) {
    currentQuestion = null;
    questionCategory.textContent = 'Waiting area';
    questionText.textContent = 'Explore while everyone joins';
    answersEl.replaceChildren();
    if (!feedback.classList.contains('bad')) {
      feedback.className = 'feedback';
      feedback.textContent = 'Move around, jump, and get ready for the teacher to start the raid.';
    }
    battlefieldStatus.textContent = 'Raid staging area. Students can move and jump while waiting for the teacher.';
  } else if (state.status === 'running') {
    battlefieldStatus.textContent = 'Raid in progress. Watch the battlefield for boss attack warnings.';
  }

  renderPower();
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
      : `Correct! ${result.damage} boss damage.`;
  } else {
    if (selected) selected.classList.add('wrong');
    feedback.className = 'feedback bad';
    feedback.textContent = `Not quite. The answer was ${result.correctAnswer}.`;
  }

  currentQuestion = null;
  const dazeDelay = result.stunnedUntil ? Math.max(0, result.stunnedUntil - Date.now()) : 0;
  if (result.stunnedUntil) applyDaze(result.stunnedUntil);

  if (result.nextQuestion && !raidComplete) {
    const feedbackDelay = result.correct ? 430 : 760;
    setTimeout(() => renderQuestion(result.nextQuestion), Math.max(feedbackDelay, dazeDelay));
  }
}

function applyDaze(until) {
  battlefield.setDazed(playerId, until);
  disableAnswers();
  feedback.className = 'feedback stun';
  feedback.textContent = 'Dazed! Slow down and think about the next answer.';
}

function disableAnswers() {
  for (const button of answersEl.querySelectorAll('button')) button.disabled = true;
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function telegraphText(type) {
  if (type === 'left_slam') return 'Boss attack warning: left side danger. Move right.';
  if (type === 'right_slam') return 'Boss attack warning: right side danger. Move left.';
  return 'Boss attack warning: shockwave incoming. Jump.';
}

function titleCase(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}
