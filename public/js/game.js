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
const victoryCelebration = document.querySelector('#victory-celebration');
const victoryConfetti = document.querySelector('#victory-confetti');
const victorySubtitle = victoryCelebration?.querySelector('.victory-subtitle');
const wipeScreen = document.querySelector('#wipe-screen');

let socket;
let playerId;
let currentQuestion;
let raidComplete = false;
let raidRunning = false;
let reconnectTimer;
let latestState;
let healTargeting = false;

function rolePowerProfile(playerClass = join?.class) {
  if (playerClass === 'healer') {
    return {
      ability: 'renewal_burst',
      abilityName: 'Renewal Burst',
      description: '5 correct in a row charges a powerful heal. In Hardcore, choose who receives it.'
    };
  }
  if (playerClass === 'tank') {
    return {
      ability: 'fortify',
      abilityName: 'Fortify',
      description: '5 correct in a row charges a protective bubble and restores some Tank health.'
    };
  }
  return {
    ability: 'power_shot',
    abilityName: 'Power Shot',
    description: '5 correct in a row charges a heavy boss strike.'
  };
}

const initialPower = rolePowerProfile();
let power = {
  streak: 0,
  threshold: 5,
  ready: false,
  ability: initialPower.ability,
  abilityName: initialPower.abilityName
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
  const profile = rolePowerProfile();
  const healer = join?.class === 'healer';
  const tank = join?.class === 'tank';
  powerPanel.classList.toggle('healer', healer);
  powerPanel.classList.toggle('tank', tank);
  powerName.textContent = profile.abilityName;
  specialLabel.textContent = `Use ${profile.abilityName}`;
  powerDescription.textContent = profile.description;
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

function cancelHealTargeting() {
  if (!healTargeting) return;
  healTargeting = false;
  battlefield.cancelHealTargeting?.();
  renderPower();
}

function activateSpecial() {
  if (!power.ready || !raidRunning || raidComplete || socket?.readyState !== WebSocket.OPEN) return;

  if (join?.class === 'healer' && latestState?.hardcore) {
    if (healTargeting) {
      cancelHealTargeting();
      feedback.className = 'feedback';
      feedback.textContent = 'Heal targeting cancelled.';
      return;
    }

    const started = battlefield.beginHealTargeting?.((targetPlayerId) => {
      healTargeting = false;
      specialButton.disabled = true;
      specialLabel.textContent = 'Casting Renewal Burst...';
      send({ type: 'special', targetPlayerId });
    });

    if (started) {
      healTargeting = true;
      specialLabel.textContent = 'Cancel heal targeting';
      specialButton.disabled = false;
      feedback.className = 'feedback good';
      feedback.textContent = 'Choose a glowing heal spot on the battlefield.';
      battlefieldStatus.textContent = 'Renewal Burst ready. Choose a living raider to heal.';
      return;
    }
  }

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
    cancelHealTargeting();
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
    cancelHealTargeting();
    feedback.className = 'feedback good';
    if (payload.ability === 'fortify') {
      feedback.textContent = payload.healing > 0
        ? `Fortify! Shield bubble active for 5 seconds. +${payload.healing} HP.`
        : 'Fortify! Shield bubble active for 5 seconds.';
    } else if (payload.ability === 'renewal_burst' && payload.targetName) {
      feedback.textContent = `Renewal Burst healed ${payload.targetName} for ${payload.healing} HP.`;
    } else {
      feedback.textContent = payload.healing > 0
        ? `${payload.abilityName}! +${payload.healing} healing and ${payload.damage} boss damage.`
        : `${payload.abilityName}! ${payload.damage} boss damage.`;
    }
    return;
  }

  if (payload.type === 'player_move') {
    battlefield.movePlayer(payload.playerId, payload.x, payload.facing, payload.airborneUntil);
    return;
  }

  if (payload.type === 'player_jump') {
    battlefield.jumpPlayer(
      payload.playerId,
      payload.airborneUntil,
      payload.jumpStrength,
      payload.jumpLockedUntil,
      payload.jumpFatigue
    );
    return;
  }

  if (payload.type === 'jump_exhausted') {
    battlefield.setJumpLock?.(payload.until);
    feedback.className = 'feedback';
    feedback.textContent = 'Jump exhausted. Recovering for 5 seconds.';
    battlefieldStatus.textContent = feedback.textContent;
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
    const guarded = (payload.protectedPlayerIds || []).includes(playerId);
    const guarding = (payload.guardTankIds || []).includes(playerId);
    const airborneReduced = (payload.airborneMitigatedPlayerIds || []).includes(playerId);
    const actualDamage = Number(payload.damageByPlayer?.[playerId] ?? payload.damage ?? 0);

    if (guarded && airborneReduced) {
      feedback.className = 'feedback good';
      feedback.textContent = `Airborne + Tank protection reduced the hit to ${actualDamage} damage.`;
    } else if (guarded) {
      feedback.className = 'feedback good';
      feedback.textContent = `Tank protection reduced the hit to ${actualDamage} damage.`;
    } else if (airborneReduced && hit) {
      feedback.className = 'feedback good';
      feedback.textContent = payload.hardcore
        ? `Airborne! The hit was reduced to ${actualDamage} damage.`
        : 'Airborne! Your jump reduced the raid damage from that hit.';
    } else if (guarding) {
      const protectedCount = (payload.protectedPlayerIds || []).length;
      feedback.className = 'feedback good';
      feedback.textContent = `Guard! You protected ${protectedCount} teammate${protectedCount === 1 ? '' : 's'} and absorbed extra damage.`;
    } else if (payload.hardcore) {
      feedback.className = hit ? 'feedback bad' : 'feedback good';
      feedback.textContent = hit
        ? `You were hit for ${actualDamage} damage.`
        : dodged
          ? 'Dodged! No damage taken.'
          : 'Boss attack resolved.';
    } else {
      feedback.className = hit ? 'feedback bad' : 'feedback good';
      feedback.textContent = payload.damage === 0
        ? 'Perfect raid dodge! No damage taken.'
        : hit
          ? `You were caught by the attack. Raid takes ${payload.damage} damage.`
          : dodged
            ? `Dodged! Raid takes ${payload.damage} damage.`
            : `Raid takes ${payload.damage} damage.`;
    }
    battlefieldStatus.textContent = feedback.textContent;
    return;
  }

  if (payload.type === 'player_knocked_out') {
    cancelHealTargeting();
    feedback.className = 'feedback bad';
    feedback.textContent = 'You are knocked out for this attempt. Watch the rest of the raid.';
    disableAnswers();
    return;
  }

  if (payload.type === 'stunned') {
    applyDaze(payload.until);
    return;
  }

  if (payload.type === 'error') {
    cancelHealTargeting();
    feedback.className = 'feedback bad';
    feedback.textContent = payload.message || 'Raid error.';
    renderPower();
    return;
  }

  if (payload.type === 'raid_complete') {
    raidComplete = true;
    raidRunning = false;
    cancelHealTargeting();
    battlefield.resetInput();
    updateState(payload.state);
    disableAnswers();
    specialButton.disabled = true;

    if (payload.outcome === 'victory') {
      startVictorySequence(payload.state);
    } else if (payload.outcome === 'wipe') {
      startWipeSequence();
    } else {
      battlefield.complete(payload.outcome);
    }

    questionCategory.textContent = 'Raid complete';
    questionText.textContent = payload.outcome === 'victory'
      ? `${payload.state?.boss?.name || 'Boss'} defeated!`
      : payload.outcome === 'wipe'
        ? 'RAID WIPE'
        : 'The raid was defeated';
    feedback.className = payload.outcome === 'victory' ? 'feedback good' : 'feedback bad';
    feedback.textContent = payload.outcome === 'victory'
      ? 'Victory! The host has the private group report.'
      : payload.outcome === 'wipe'
        ? 'Game over. Every raider was knocked out.'
        : 'Good attempt. The host can start another raid.';
    battlefieldStatus.textContent = feedback.textContent;
  }
}

function startWipeSequence() {
  battlefield.complete('wipe');
  wipeScreen?.classList.add('active');
  wipeScreen?.setAttribute('aria-hidden', 'false');
}

function startVictorySequence(state) {
  const bossName = state?.boss?.name || 'The boss';

  if (victorySubtitle) victorySubtitle.textContent = `${bossName} is down. The raid wins together.`;
  buildConfetti();
  victoryCelebration?.classList.add('active');
  victoryCelebration?.setAttribute('aria-hidden', 'false');
  battlefield.complete('victory');

  for (const delay of [300, 1250, 2200]) {
    setTimeout(() => {
      if (playerId) battlefield.jump();
      for (const player of state?.players || []) {
        if (player.id !== playerId) battlefield.jumpPlayer(player.id, Date.now() + 720);
      }
    }, delay);
  }
}

function buildConfetti() {
  if (!victoryConfetti || victoryConfetti.childElementCount) return;
  for (let index = 0; index < 34; index += 1) {
    const piece = document.createElement('span');
    const x = 2 + ((index * 29) % 96);
    const width = 4 + (index % 4) * 2;
    const hue = (index * 53) % 360;
    const rotation = `${(index * 37) % 180}deg`;
    const duration = `${2.2 + (index % 5) * 0.32}s`;
    const delay = `${(index % 9) * 0.11}s`;
    const drift = `${-75 + ((index * 41) % 150)}px`;
    piece.style.setProperty('--x', `${x}%`);
    piece.style.setProperty('--w', `${width}px`);
    piece.style.setProperty('--h', String(hue));
    piece.style.setProperty('--r', rotation);
    piece.style.setProperty('--d', duration);
    piece.style.setProperty('--delay', delay);
    piece.style.setProperty('--drift', drift);
    victoryConfetti.append(piece);
  }
}

function updatePower(nextPower) {
  if (!nextPower) return;
  power = { ...power, ...nextPower };
  if (!power.ready) cancelHealTargeting();
  battlefield.setLocalPowerReady(Boolean(power.ready));
  powerName.textContent = power.abilityName || rolePowerProfile().abilityName;
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
  specialLabel.textContent = healTargeting
    ? 'Cancel heal targeting'
    : `Use ${power.abilityName || rolePowerProfile().abilityName}`;

  if (healTargeting) {
    powerDescription.textContent = 'Tap a glowing heal spot on a living raider.';
  } else if (power.ready) {
    powerDescription.textContent = join?.class === 'healer' && latestState?.hardcore
      ? `${power.abilityName} is charged. Use it, then choose who to heal.`
      : `${power.abilityName} is charged. Use it when you are ready.`;
  } else {
    powerDescription.textContent = rolePowerProfile().description;
  }
}

function updateState(state) {
  if (!state) return;
  latestState = state;
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
  const aliveText = state.hardcore ? ` · ${state.alivePlayers || 0}/${state.players?.length || 0} standing` : '';
  teamStats.textContent = inLobby
    ? `${state.players?.length || 0} raiders assembling`
    : `${state.team?.questions || 0} questions · ${state.players?.length || 0} raiders${aliveText}${dodgeText}`;

  if (state.pendingAttack && state.pendingAttack.executeAt > Date.now()) battlefield.showTelegraph(state.pendingAttack);

  if (inLobby) {
    currentQuestion = null;
    questionCategory.textContent = state.hardcore ? 'Hardcore staging area' : 'Waiting area';
    questionText.textContent = 'Explore while everyone joins';
    answersEl.replaceChildren();
    if (!feedback.classList.contains('bad')) {
      feedback.className = 'feedback';
      feedback.textContent = state.hardcore
        ? 'Hardcore mode: dodge attacks, protect teammates and avoid a raid wipe.'
        : 'Move around, jump, and get ready for the host to start the raid.';
    }
    battlefieldStatus.textContent = 'Raid staging area. Players can move and jump while waiting for the host.';
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
  if (join.class === 'healer') {
    feedback.textContent = 'Correct answers restore an injured teammate and still damage the boss.';
  } else if (join.class === 'tank') {
    feedback.textContent = 'Correct answers deal reduced damage. Stack with teammates during attacks to Guard them.';
  } else {
    feedback.textContent = 'Correct answers launch an attack at the boss.';
  }
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
    if (join.class === 'healer') {
      feedback.textContent = `Correct! +${result.healing} healing and ${result.damage} boss damage.`;
    } else if (join.class === 'tank') {
      feedback.textContent = `Correct! ${result.damage} boss damage. Stay ready to Guard the group.`;
    } else {
      feedback.textContent = `Correct! ${result.damage} boss damage.`;
    }
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
  if (type === 'left_slam') return 'Boss attack warning: left side danger. Move right or jump to soften the hit.';
  if (type === 'right_slam') return 'Boss attack warning: right side danger. Move left or jump to soften the hit.';
  return 'Boss attack warning: shockwave incoming. Jump to avoid it completely.';
}

function titleCase(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}
