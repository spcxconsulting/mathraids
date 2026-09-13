const params = new URLSearchParams(window.location.search);
const code = String(params.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const suppliedKey = params.get('key');
const storageKey = `mathraids:host:${code}`;
const legacyStorageKey = `mathraids:teacher:${code}`;
const hostKey = suppliedKey || sessionStorage.getItem(storageKey) || sessionStorage.getItem(legacyStorageKey);

const codeEl = document.querySelector('#raid-code');
const connectionEl = document.querySelector('#connection-status');
const startButton = document.querySelector('#start-raid');
const copyButton = document.querySelector('#copy-link');
const messageEl = document.querySelector('#host-message');
const rosterEl = document.querySelector('#roster');
const countEl = document.querySelector('#player-count');
const reportBody = document.querySelector('#report-body');
const raidStatus = document.querySelector('#raid-status');
const bossHealth = document.querySelector('#boss-health');
const teamQuestions = document.querySelector('#team-questions');
const teamAccuracy = document.querySelector('#team-accuracy');
const bossName = document.querySelector('#boss-name');

const customRulesCard = document.querySelector('#custom-rules-card');
const customHealthMode = document.querySelector('#custom-health-mode-host');
const customKnockouts = document.querySelector('#custom-knockouts-host');
const customTankGuard = document.querySelector('#custom-tank-guard-host');
const customFortify = document.querySelector('#custom-fortify-host');
const customJumpFatigue = document.querySelector('#custom-jump-fatigue-host');
const customAirborneMitigation = document.querySelector('#custom-airborne-mitigation-host');
const saveCustomRulesButton = document.querySelector('#save-custom-rules');
const customRulesStatus = document.querySelector('#custom-rules-status');

const bossTuningCard = document.querySelector('#boss-tuning-card');
const healthPerPlayerInput = document.querySelector('#boss-health-per-player');
const minHealthInput = document.querySelector('#boss-min-health');
const aggressionInput = document.querySelector('#boss-aggression');
const aggressionLabel = document.querySelector('#boss-aggression-label');
const attackPowerInput = document.querySelector('#boss-attack-power');
const attackPowerLabel = document.querySelector('#boss-attack-power-label');
const warningInput = document.querySelector('#boss-warning-ms');
const saveTuningButton = document.querySelector('#save-boss-tuning');
const tuningStatus = document.querySelector('#boss-tuning-status');

let socket;
let latestReport;

if (suppliedKey && code) {
  sessionStorage.setItem(storageKey, suppliedKey);
  history.replaceState({}, '', `/host/raid.html?code=${encodeURIComponent(code)}`);
}

codeEl.textContent = code || '------';
updateRangeLabels();
aggressionInput?.addEventListener('input', updateRangeLabels);
attackPowerInput?.addEventListener('input', updateRangeLabels);
saveTuningButton?.addEventListener('click', saveBossTuning);
saveCustomRulesButton?.addEventListener('click', saveCustomRules);
customHealthMode?.addEventListener('change', updateCustomRuleDependencies);

if (!code || !hostKey) {
  connectionEl.textContent = 'Missing host key';
  messageEl.innerHTML = '<div class="notice error">This host link is incomplete. Create a new raid from the host page.</div>';
  startButton.disabled = true;
} else {
  connect();
}

copyButton.addEventListener('click', async () => {
  const joinUrl = `${window.location.origin}/join/?code=${encodeURIComponent(code)}`;
  try {
    await navigator.clipboard.writeText(joinUrl);
    copyButton.textContent = 'Copied!';
    setTimeout(() => { copyButton.textContent = 'Copy join link'; }, 1400);
  } catch {
    window.prompt('Copy this player join link:', joinUrl);
  }
});

startButton.addEventListener('click', () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  startButton.disabled = true;
  socket.send(JSON.stringify({ type: 'start_raid' }));
});

function isCustomRaid(report = latestReport) {
  return report?.config?.mode === 'custom';
}

function saveBossTuning() {
  if (!isCustomRaid() || !socket || socket.readyState !== WebSocket.OPEN || latestReport?.status !== 'lobby') return;
  saveTuningButton.disabled = true;
  tuningStatus.textContent = 'Saving...';
  socket.send(JSON.stringify({
    type: 'update_boss_tuning',
    tuning: {
      healthPerPlayer: Number(healthPerPlayerInput.value),
      minHealth: Number(minHealthInput.value),
      aggression: Number(aggressionInput.value),
      attackPower: Number(attackPowerInput.value),
      warningMs: Number(warningInput.value)
    }
  }));
}

function saveCustomRules() {
  if (!isCustomRaid() || !socket || socket.readyState !== WebSocket.OPEN || latestReport?.status !== 'lobby') return;
  saveCustomRulesButton.disabled = true;
  customRulesStatus.textContent = 'Saving...';
  socket.send(JSON.stringify({
    type: 'update_custom_rules',
    rules: {
      healthMode: customHealthMode.value === 'individual' ? 'individual' : 'shared',
      knockouts: Boolean(customKnockouts.checked),
      tankGuard: Boolean(customTankGuard.checked),
      fortify: Boolean(customFortify.checked),
      jumpFatigue: Boolean(customJumpFatigue.checked),
      airborneMitigation: Boolean(customAirborneMitigation.checked)
    }
  }));
}

function updateRangeLabels() {
  if (aggressionLabel && aggressionInput) aggressionLabel.textContent = `${aggressionInput.value} / 5`;
  if (attackPowerLabel && attackPowerInput) attackPowerLabel.textContent = `${attackPowerInput.value} / 5`;
}

function renderTuning(tuning, editable) {
  if (!tuning) return;
  healthPerPlayerInput.value = String(tuning.healthPerPlayer ?? 100);
  minHealthInput.value = String(tuning.minHealth ?? 300);
  aggressionInput.value = String(tuning.aggression ?? 3);
  attackPowerInput.value = String(tuning.attackPower ?? 3);
  warningInput.value = String(tuning.warningMs ?? 1650);
  updateRangeLabels();

  for (const control of [healthPerPlayerInput, minHealthInput, aggressionInput, attackPowerInput, warningInput]) {
    control.disabled = !editable;
  }
  saveTuningButton.disabled = !editable;
  tuningStatus.textContent = editable
    ? 'Change the encounter and save before starting.'
    : 'Boss tuning is locked once the raid starts.';
}

function renderCustomRules(rules = {}, editable = false) {
  customHealthMode.value = rules.healthMode === 'individual' ? 'individual' : 'shared';
  customKnockouts.checked = rules.knockouts !== false && customHealthMode.value === 'individual';
  customTankGuard.checked = rules.tankGuard !== false;
  customFortify.checked = rules.fortify !== false;
  customJumpFatigue.checked = rules.jumpFatigue !== false;
  customAirborneMitigation.checked = rules.airborneMitigation !== false;

  for (const control of [customHealthMode, customTankGuard, customFortify, customJumpFatigue, customAirborneMitigation]) {
    control.disabled = !editable;
  }
  updateCustomRuleDependencies(editable);
  saveCustomRulesButton.disabled = !editable;
  customRulesStatus.textContent = editable
    ? 'Custom raids do not award achievements, progression or loot. Save changes before starting.'
    : 'Custom raid rules are locked once the raid starts.';
}

function updateCustomRuleDependencies(editable = latestReport?.status === 'lobby') {
  if (!customHealthMode || !customKnockouts) return;
  const individual = customHealthMode.value === 'individual';
  customKnockouts.disabled = !editable || !individual;
  if (!individual) customKnockouts.checked = false;
}

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/${encodeURIComponent(code)}?role=host&key=${encodeURIComponent(hostKey)}`;
  socket = new WebSocket(wsUrl);

  socket.addEventListener('open', () => {
    connectionEl.textContent = 'Connected';
  });

  socket.addEventListener('close', () => {
    connectionEl.textContent = 'Disconnected';
    startButton.disabled = true;
    if (saveTuningButton) saveTuningButton.disabled = true;
    if (saveCustomRulesButton) saveCustomRulesButton.disabled = true;
  });

  socket.addEventListener('error', () => {
    connectionEl.textContent = 'Connection error';
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'host_state') render(payload.report);
    if (payload.type === 'boss_tuning_saved') {
      renderTuning(payload.tuning, true);
      tuningStatus.textContent = 'Boss tuning saved.';
    }
    if (payload.type === 'custom_rules_saved') {
      renderCustomRules(payload.rules, true);
      customRulesStatus.textContent = 'Custom raid rules saved.';
    }
    if (payload.type === 'error') {
      messageEl.innerHTML = `<div class="notice error">${escapeHtml(payload.message)}</div>`;
      if (latestReport?.status === 'lobby' && isCustomRaid()) {
        saveTuningButton.disabled = false;
        saveCustomRulesButton.disabled = false;
      }
    }
    if (payload.type === 'raid_complete') {
      messageEl.innerHTML = `<div class="notice">Raid complete: <strong>${escapeHtml(payload.outcome)}</strong>.</div>`;
    }
  });
}

function render(report) {
  if (!report) return;
  latestReport = report;
  const players = report.players || [];
  const custom = isCustomRaid(report);
  const editable = report.status === 'lobby';

  bossName.textContent = report.boss?.name || 'Boss';
  raidStatus.textContent = custom ? `Custom · ${titleCase(report.status || 'lobby')}` : titleCase(report.status || 'lobby');
  bossHealth.textContent = report.boss ? `${Math.ceil(report.boss.health)} / ${Math.ceil(report.boss.maxHealth)}` : '-';
  teamQuestions.textContent = String(report.team?.questions || 0);
  teamAccuracy.textContent = `${report.team?.accuracy || 0}%`;
  countEl.textContent = String(players.length);

  customRulesCard.hidden = !custom;
  bossTuningCard.hidden = !custom;
  if (custom) {
    renderCustomRules(report.config?.customRules || {}, editable);
    renderTuning(report.boss?.tuning, editable);
  }

  startButton.disabled = report.status !== 'lobby' || players.length === 0;
  startButton.textContent = report.status === 'lobby' ? 'Start raid' : report.status === 'running' ? 'Raid in progress' : 'Raid complete';

  rosterEl.replaceChildren();
  if (!players.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'Waiting for players to join...';
    rosterEl.append(empty);
  } else {
    for (const player of players) {
      const row = document.createElement('div');
      row.className = 'roster-row';
      const name = document.createElement('strong');
      name.textContent = player.name;
      const role = document.createElement('span');
      role.className = 'badge';
      role.textContent = player.class === 'healer' ? '✨ Healer' : player.class === 'tank' ? '🛡️ Tank' : '⚔️ DPS';
      row.append(name, role);
      rosterEl.append(row);
    }
  }

  reportBody.replaceChildren();
  if (!players.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.className = 'muted';
    cell.textContent = 'Waiting for players...';
    row.append(cell);
    reportBody.append(row);
  } else {
    for (const player of players) {
      const row = document.createElement('tr');
      const role = player.class === 'healer' ? 'Healer' : player.class === 'tank' ? 'Tank' : 'DPS';
      const values = [
        player.name,
        role,
        player.attempted,
        player.correct,
        `${player.accuracy}%`,
        formatTime(player.averageResponseMs)
      ];
      for (const value of values) {
        const cell = document.createElement('td');
        cell.textContent = String(value);
        row.append(cell);
      }
      reportBody.append(row);
    }
  }

  if (report.status === 'complete') {
    const outcome = report.outcome === 'victory'
      ? `Victory! ${report.boss?.name || 'The boss'} has been defeated.`
      : report.outcome === 'wipe'
        ? 'Raid wipe. Every raider was knocked out.'
        : 'The raid was defeated. Try again!';
    const sandbox = custom ? ' This Custom raid does not award achievements, progression or loot.' : '';
    messageEl.innerHTML = `<div class="notice"><strong>${escapeHtml(outcome)}</strong> The private results above are ready for the host.${escapeHtml(sandbox)}</div>`;
  }
}

function formatTime(ms) {
  if (!ms) return '-';
  return `${(ms / 1000).toFixed(1)}s`;
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}
