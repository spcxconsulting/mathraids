const params = new URLSearchParams(window.location.search);
const code = String(params.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const suppliedKey = params.get('key');
const storageKey = `mathraids:teacher:${code}`;
const teacherKey = suppliedKey || sessionStorage.getItem(storageKey);

const codeEl = document.querySelector('#raid-code');
const connectionEl = document.querySelector('#connection-status');
const startButton = document.querySelector('#start-raid');
const copyButton = document.querySelector('#copy-link');
const messageEl = document.querySelector('#teacher-message');
const rosterEl = document.querySelector('#roster');
const countEl = document.querySelector('#student-count');
const reportBody = document.querySelector('#report-body');
const raidStatus = document.querySelector('#raid-status');
const bossHealth = document.querySelector('#boss-health');
const teamQuestions = document.querySelector('#team-questions');
const teamAccuracy = document.querySelector('#team-accuracy');
const bossName = document.querySelector('#boss-name');

let socket;
let latestReport;

if (suppliedKey && code) {
  sessionStorage.setItem(storageKey, suppliedKey);
  history.replaceState({}, '', `/teacher/raid.html?code=${encodeURIComponent(code)}`);
}

codeEl.textContent = code || '------';

if (!code || !teacherKey) {
  connectionEl.textContent = 'Missing teacher key';
  messageEl.innerHTML = '<div class="notice error">This teacher console link is incomplete. Create a new raid from the teacher page.</div>';
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
    window.prompt('Copy this student join link:', joinUrl);
  }
});

startButton.addEventListener('click', () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  startButton.disabled = true;
  socket.send(JSON.stringify({ type: 'start_raid' }));
});

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/${encodeURIComponent(code)}?role=teacher&key=${encodeURIComponent(teacherKey)}`;
  socket = new WebSocket(wsUrl);

  socket.addEventListener('open', () => {
    connectionEl.textContent = 'Connected';
  });

  socket.addEventListener('close', () => {
    connectionEl.textContent = 'Disconnected';
    startButton.disabled = true;
  });

  socket.addEventListener('error', () => {
    connectionEl.textContent = 'Connection error';
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'teacher_state') render(payload.report);
    if (payload.type === 'error') {
      messageEl.innerHTML = `<div class="notice error">${escapeHtml(payload.message)}</div>`;
    }
    if (payload.type === 'raid_complete') {
      messageEl.innerHTML = `<div class="notice">Raid complete: <strong>${escapeHtml(payload.outcome)}</strong>.</div>`;
    }
  });
}

function render(report) {
  if (!report) return;
  latestReport = report;
  const students = report.students || [];

  bossName.textContent = report.boss?.name || 'Boss';
  raidStatus.textContent = titleCase(report.status || 'lobby');
  bossHealth.textContent = report.boss ? `${Math.ceil(report.boss.health)} / ${Math.ceil(report.boss.maxHealth)}` : '-';
  teamQuestions.textContent = String(report.team?.questions || 0);
  teamAccuracy.textContent = `${report.team?.accuracy || 0}%`;
  countEl.textContent = String(students.length);

  startButton.disabled = report.status !== 'lobby' || students.length === 0;
  startButton.textContent = report.status === 'lobby' ? 'Start raid' : report.status === 'running' ? 'Raid in progress' : 'Raid complete';

  rosterEl.replaceChildren();
  if (!students.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'Waiting for students to join...';
    rosterEl.append(empty);
  } else {
    for (const student of students) {
      const row = document.createElement('div');
      row.className = 'roster-row';
      const name = document.createElement('strong');
      name.textContent = student.name;
      const role = document.createElement('span');
      role.className = 'badge';
      role.textContent = student.class === 'healer' ? '✨ Healer' : '⚔️ DPS';
      row.append(name, role);
      rosterEl.append(row);
    }
  }

  reportBody.replaceChildren();
  if (!students.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.className = 'muted';
    cell.textContent = 'Waiting for students...';
    row.append(cell);
    reportBody.append(row);
  } else {
    for (const student of students) {
      const row = document.createElement('tr');
      const values = [
        student.name,
        student.class === 'healer' ? 'Healer' : 'DPS',
        student.attempted,
        student.correct,
        `${student.accuracy}%`,
        formatTime(student.averageResponseMs)
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
    const outcome = report.outcome === 'victory' ? 'Victory! Numberzilla has been defeated.' : 'The raid was defeated. Try again!';
    messageEl.innerHTML = `<div class="notice"><strong>${escapeHtml(outcome)}</strong> The private results above are ready for the teacher.</div>`;
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
