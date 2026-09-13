const answers = document.querySelector('#answers');
const feedback = document.querySelector('#feedback');
const questionText = document.querySelector('#question-text');
const questionCategory = document.querySelector('#question-category');
const specialButton = document.querySelector('#special');
const leftButton = document.querySelector('#move-left');
const rightButton = document.querySelector('#move-right');
const jumpButton = document.querySelector('#jump');
const raidHealthBar = document.querySelector('#raid-health-bar');
const teamStats = document.querySelector('#team-stats');

let hardcore = false;
let knockedOut = false;

function disablePlayerInputs() {
  for (const button of answers?.querySelectorAll('button') || []) button.disabled = true;
  if (specialButton) specialButton.disabled = true;
  if (leftButton) leftButton.disabled = true;
  if (rightButton) rightButton.disabled = true;
  if (jumpButton) jumpButton.disabled = true;
}

function enableMovementInputs() {
  if (leftButton) leftButton.disabled = false;
  if (rightButton) rightButton.disabled = false;
  if (jumpButton) jumpButton.disabled = false;
}

window.addEventListener('mathraids:hardcorestate', (event) => {
  const state = event.detail?.state;
  const local = event.detail?.localPlayer;
  hardcore = Boolean(state?.hardcore);
  if (!hardcore) return;

  knockedOut = Boolean(local?.knockedOut);
  const alive = Number(state?.alivePlayers) || 0;
  const total = state?.players?.length || 0;

  if (teamStats && state?.status === 'running') {
    teamStats.textContent = `${alive} / ${total} raiders standing · ${state.team?.questions || 0} questions`;
  }

  if (raidHealthBar && state?.maxRaidHealth) {
    const pct = Math.max(0, Math.min(100, (state.raidHealth / state.maxRaidHealth) * 100));
    raidHealthBar.style.width = `${pct}%`;
  }

  if (knockedOut) {
    disablePlayerInputs();
    if (questionCategory) questionCategory.textContent = 'Knocked out';
    if (questionText) questionText.textContent = 'You are out for this attempt';
    if (feedback) {
      feedback.className = 'feedback bad';
      feedback.textContent = 'Watch the remaining raiders and cheer them on. If everyone goes down, the raid wipes.';
    }
  } else if (state?.status === 'running') {
    enableMovementInputs();
  }
});

window.addEventListener('mathraids:hardcoreattack', (event) => {
  const payload = event.detail?.payload;
  const localPlayerId = event.detail?.localPlayerId;
  if (!payload || !hardcore || !feedback) return;

  const hit = (payload.hitPlayerIds || []).includes(localPlayerId);
  const knocked = (payload.knockedOutPlayerIds || []).includes(localPlayerId);
  const dodged = (payload.dodgedPlayerIds || []).includes(localPlayerId);

  setTimeout(() => {
    if (knocked) {
      feedback.className = 'feedback bad';
      feedback.textContent = `You took ${payload.damage} damage and were knocked out.`;
      disablePlayerInputs();
    } else if (hit) {
      feedback.className = 'feedback bad';
      feedback.textContent = `Hit! You took ${payload.damage} damage.`;
    } else if (dodged) {
      feedback.className = 'feedback good';
      feedback.textContent = 'Dodged! You avoided the boss attack.';
    }
  }, 0);
});

window.addEventListener('mathraids:raidwipe', () => {
  setTimeout(() => {
    disablePlayerInputs();
    if (questionCategory) questionCategory.textContent = 'Raid wipe';
    if (questionText) questionText.textContent = 'RAID WIPE';
    if (feedback) {
      feedback.className = 'feedback bad';
      feedback.textContent = 'The whole group was knocked out. Reset, learn the mechanics, and try again.';
    }
  }, 0);
});

const observer = new MutationObserver(() => {
  if (!hardcore || !knockedOut) return;
  for (const button of answers?.querySelectorAll('button') || []) button.disabled = true;
});
if (answers) observer.observe(answers, { childList: true, subtree: true });
