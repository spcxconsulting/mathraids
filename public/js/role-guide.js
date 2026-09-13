const params = new URLSearchParams(window.location.search);
const code = String(params.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const savedJoin = code ? sessionStorage.getItem(`mathraids:join:${code}`) : null;
const join = savedJoin ? JSON.parse(savedJoin) : null;

const battlefield = document.querySelector('#battlefield');
const bossLabel = document.querySelector('#boss-label');
const questionCategory = document.querySelector('#question-category');

if (battlefield && join) {
  let dismissed = false;
  let hardcore = false;

  const guide = document.createElement('aside');
  guide.className = 'role-guide';
  guide.setAttribute('aria-label', 'How to play your role');

  const header = document.createElement('div');
  header.className = 'role-guide-header';

  const headingWrap = document.createElement('div');
  const eyebrow = document.createElement('div');
  eyebrow.className = 'role-guide-eyebrow';
  eyebrow.textContent = 'HOW TO PLAY YOUR ROLE';

  const title = document.createElement('div');
  title.className = 'role-guide-title';

  const mode = document.createElement('span');
  mode.className = 'role-guide-mode';

  headingWrap.append(eyebrow, title, mode);

  const hideButton = document.createElement('button');
  hideButton.type = 'button';
  hideButton.className = 'role-guide-hide';
  hideButton.textContent = 'Hide';
  hideButton.setAttribute('aria-label', 'Hide role guide');

  header.append(headingWrap, hideButton);

  const summary = document.createElement('p');
  summary.className = 'role-guide-summary';

  const steps = document.createElement('div');
  steps.className = 'role-guide-steps';

  const special = document.createElement('div');
  special.className = 'role-guide-special';

  guide.append(header, summary, steps, special);
  battlefield.append(guide);

  function profile(playerClass, isHardcore) {
    if (playerClass === 'healer') {
      return {
        icon: '✨',
        name: 'HEALER',
        summary: isHardcore
          ? 'Keep the group alive while still damaging the boss.'
          : 'Support the group by restoring shared raid health while still damaging the boss.',
        steps: isHardcore
          ? [
              ['Answer correctly', 'Your correct answers heal the most injured surviving player and still hurt the boss.'],
              ['Stay alive', 'You only have 100 HP, so dodge mechanics instead of trying to heal through everything.'],
              ['Choose your big heal', 'When Renewal Burst is ready, activate it and tap the glowing heal spot on the living raider who needs it most.']
            ]
          : [
              ['Answer correctly', 'Your correct answers restore shared raid health and still hurt the boss.'],
              ['Keep moving', 'Dodge side attacks and jump shockwaves so the group loses less health.'],
              ['Support the group', 'Your lower damage is balanced by keeping everyone in the fight longer.']
            ],
        special: isHardcore
          ? '5 correct answers in a row charges Renewal Burst. Activate it, then choose a living raider to receive the heal.'
          : '5 correct answers in a row charges Renewal Burst, a strong shared heal plus a boss strike.'
      };
    }

    if (playerClass === 'tank') {
      return {
        icon: '🛡️',
        name: 'TANK',
        summary: isHardcore
          ? 'Protect teammates by taking the dangerous hits they cannot avoid.'
          : 'Reduce group damage by positioning with teammates during boss attacks.',
        steps: isHardcore
          ? [
              ['You are tougher', 'You have 160 HP, but your correct answers deal less boss damage than DPS.'],
              ['Call the stack', 'Teammates close to you when an attack lands are guarded and take much less damage.'],
              ['Use Fortify visibly', 'Fortify creates a large protective bubble around you. Anyone inside it when the attack impacts gets the strongest protection.']
            ]
          : [
              ['Lower damage, more defence', 'Your correct answers deal less boss damage, but your positioning can reduce shared raid damage.'],
              ['Stack together', 'Teammates close to you during the incoming attack count as guarded.'],
              ['Use Fortify', 'Your special creates a visible protection bubble so teammates know exactly where to stand.']
            ],
        special: '5 correct answers in a row charges Fortify, creating a 5-second protection bubble and restoring some Tank health.'
      };
    }

    return {
      icon: '⚔️',
      name: 'DPS',
      summary: isHardcore
        ? 'Deal heavy boss damage while staying alive long enough to finish the fight.'
        : 'Your job is to push the boss health down as quickly as possible.',
      steps: isHardcore
        ? [
            ['Answer correctly', 'Each correct answer launches your strongest regular attack at the boss.'],
            ['Protect your HP', 'You have 100 HP. Dodge the warning zones and jump shockwaves whenever possible.'],
            ['Use your Tank', 'If you cannot escape, get inside the Tank’s Fortify bubble or stack close enough for Guard before impact.']
          ]
        : [
            ['Answer correctly', 'Each correct answer launches your strongest regular attack at the boss.'],
            ['Dodge mechanics', 'Move away from side attacks and jump over shockwaves to protect shared raid health.'],
            ['Keep the pressure up', 'Fast, accurate answers are how your role contributes most to the group.']
          ],
      special: '5 correct answers in a row charges Power Shot, a heavy burst of boss damage.'
    };
  }

  function render() {
    const role = profile(join.class, hardcore);
    title.textContent = `${role.icon} ${role.name}`;
    mode.textContent = hardcore ? 'HARDCORE RAID' : 'NORMAL RAID';
    summary.textContent = role.summary;
    steps.replaceChildren();

    for (const [stepTitle, stepCopy] of role.steps) {
      const item = document.createElement('div');
      item.className = 'role-guide-step';
      const strong = document.createElement('strong');
      strong.textContent = stepTitle;
      const copy = document.createElement('span');
      copy.textContent = stepCopy;
      item.append(strong, copy);
      steps.append(item);
    }

    special.textContent = role.special;
  }

  function syncVisibility() {
    const inLobby = bossLabel?.textContent?.trim() === 'Raid staging area';
    guide.classList.toggle('is-hidden', dismissed || !inLobby);
  }

  hideButton.addEventListener('click', () => {
    dismissed = true;
    syncVisibility();
  });

  const observer = new MutationObserver(() => {
    const nextHardcore = questionCategory?.textContent?.includes('Hardcore') || false;
    if (nextHardcore !== hardcore) {
      hardcore = nextHardcore;
      render();
    }
    syncVisibility();
  });

  if (bossLabel) observer.observe(bossLabel, { childList: true, characterData: true, subtree: true });
  if (questionCategory) observer.observe(questionCategory, { childList: true, characterData: true, subtree: true });

  render();
  syncVisibility();

  if (code) {
    fetch(`/api/raids/${encodeURIComponent(code)}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((state) => {
        if (!state) return;
        hardcore = Boolean(state.hardcore || state.config?.mode === 'hardcore');
        render();
        if (state.status !== 'lobby') guide.classList.add('is-hidden');
      })
      .catch(() => {});
  }
}
