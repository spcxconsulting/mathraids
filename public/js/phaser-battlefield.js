// Backwards-compatible module name while the rest of the client still imports
// phaser-battlefield.js. The live renderer is a lightweight high-DPI Canvas2D
// engine using SVG source artwork, reusable boss presentation states, local
// player movement, Hardcore health/knockout rendering, and impact-timed boss attacks.
import { createRaidBattlefield as createHardcoreBattlefield } from './hardcore-battlefield.js';

export function createRaidBattlefield(options = {}) {
  const battlefield = createHardcoreBattlefield(options);
  let launchTimer = null;
  let scheduledAttackId = null;
  let launchedAttackId = null;

  function scheduleVisualLaunch(attack) {
    if (!attack?.id || !attack?.type) return;

    if (attack.phase === 'flight') {
      if (launchedAttackId === attack.id) return;
      launchedAttackId = attack.id;
      scheduledAttackId = attack.id;
      battlefield.launchBossAttack({
        attackType: attack.type,
        attackId: attack.id,
        impactAt: attack.impactAt
      });
      return;
    }

    const launchAt = Number(attack.launchAt || attack.executeAt) || 0;
    if (!launchAt || launchedAttackId === attack.id) return;
    if (scheduledAttackId === attack.id && launchTimer) return;

    clearTimeout(launchTimer);
    scheduledAttackId = attack.id;
    launchTimer = setTimeout(() => {
      launchTimer = null;
      launchedAttackId = attack.id;
      battlefield.launchBossAttack({
        attackType: attack.type,
        attackId: attack.id,
        impactAt: launchAt + 720
      });
    }, Math.max(0, launchAt - Date.now()));
  }

  return {
    ...battlefield,
    showTelegraph(attack) {
      battlefield.showTelegraph(attack);
      scheduleVisualLaunch(attack);
    },
    syncState(state) {
      battlefield.syncState(state);
      if (state?.pendingAttack) scheduleVisualLaunch(state.pendingAttack);
    },
    resolveBossAttack(payload) {
      if (payload?.attackId && payload.attackId === scheduledAttackId) {
        clearTimeout(launchTimer);
        launchTimer = null;
      }
      battlefield.resolveBossAttack(payload);
    },
    complete(outcome) {
      clearTimeout(launchTimer);
      launchTimer = null;
      battlefield.complete(outcome);
    },
    destroy() {
      clearTimeout(launchTimer);
      launchTimer = null;
      battlefield.destroy();
    }
  };
}
