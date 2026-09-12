const shell = document.querySelector('.game-shell');
const bossLabel = document.querySelector('#boss-label');
const bossHpLabel = document.querySelector('#boss-hp-label');
const teamStats = document.querySelector('#team-stats');
const questionCategory = document.querySelector('#question-category');
const questionText = document.querySelector('#question-text');
const feedback = document.querySelector('#feedback');
const transition = document.querySelector('#raid-transition');

let lobbyActive = false;
let transitionTimer;

const observer = new MutationObserver(syncLobbyState);
observer.observe(bossHpLabel, { childList: true, characterData: true, subtree: true });
observer.observe(bossLabel, { childList: true, characterData: true, subtree: true });
observer.observe(teamStats, { childList: true, characterData: true, subtree: true });
observer.observe(questionCategory, { childList: true, characterData: true, subtree: true });
observer.observe(questionText, { childList: true, characterData: true, subtree: true });

queueMicrotask(syncLobbyState);

function syncLobbyState() {
  const isLobby = bossHpLabel.textContent.trim() === 'Waiting for the raid to start';

  if (isLobby) {
    enterLobby();
    return;
  }

  if (lobbyActive) leaveLobby();
}

function enterLobby() {
  lobbyActive = true;
  shell.classList.add('lobby-mode');
  shell.classList.remove('raid-mode');

  if (bossLabel.textContent !== 'Raid staging area') bossLabel.textContent = 'Raid staging area';
  if (questionCategory.textContent !== 'Waiting area') questionCategory.textContent = 'Waiting area';
  if (questionText.textContent !== 'Explore while everyone joins') questionText.textContent = 'Explore while everyone joins';

  if (!feedback.textContent || feedback.textContent === 'Connected to raid.') {
    feedback.className = 'feedback';
    feedback.textContent = 'Move around, jump, and get ready for the teacher to start the raid.';
  }
}

function leaveLobby() {
  lobbyActive = false;
  shell.classList.remove('lobby-mode');
  shell.classList.add('raid-mode');
  if (bossLabel.textContent === 'Raid staging area') bossLabel.textContent = 'Numberzilla';

  clearTimeout(transitionTimer);
  transition.classList.remove('active');
  void transition.offsetWidth;
  transition.classList.add('active');
  transitionTimer = setTimeout(() => transition.classList.remove('active'), 1100);
}
