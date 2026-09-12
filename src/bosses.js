export const BOSS_DEFINITIONS = {
  numberzilla: {
    id: 'numberzilla',
    name: 'Numberzilla',
    encounter: 'City Under Siege',
    attacks: ['left_slam', 'right_slam', 'shockwave'],
    art: {
      boss: '/art/numberzilla.svg',
      backgroundBack: '/art/city-back.svg',
      backgroundFront: '/art/city-front.svg'
    },
    defaults: {
      minHealth: 300,
      healthPerPlayer: 100,
      aggression: 4,
      attackPower: 3,
      warningMs: 1650
    },
    presentation: {
      width: 560,
      height: 490,
      top: -92,
      idleSway: 5,
      idleBob: 2.5,
      idleBreath: 0.007,
      hitRecoil: 17,
      defeatSink: 430,
      defeatDrift: -12,
      defeatTilt: 0.085
    },
    victory: {
      bossFallMs: 4800,
      celebrationMs: 7000
    }
  }
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getBossDefinition(id = 'numberzilla') {
  return BOSS_DEFINITIONS[id] || BOSS_DEFINITIONS.numberzilla;
}

export function normaliseBossTuning(value = {}, definition = BOSS_DEFINITIONS.numberzilla) {
  const defaults = definition.defaults;
  return {
    minHealth: clamp(Math.round(Number(value.minHealth) || defaults.minHealth), 100, 5000),
    healthPerPlayer: clamp(Math.round(Number(value.healthPerPlayer) || defaults.healthPerPlayer), 25, 500),
    aggression: clamp(Math.round(Number(value.aggression) || defaults.aggression), 1, 5),
    attackPower: clamp(Math.round(Number(value.attackPower) || defaults.attackPower), 1, 5),
    warningMs: clamp(Math.round(Number(value.warningMs) || defaults.warningMs), 700, 4000)
  };
}

export function bossHealthForPlayers(playerCount, tuning) {
  return Math.max(tuning.minHealth, Math.max(1, playerCount) * tuning.healthPerPlayer);
}

// Correct-answer pressure is a secondary trigger. The main boss cadence is now
// time-based so the boss remains threatening even when the group pauses.
export function attackEveryForAggression(playerCount, aggression) {
  const profiles = {
    1: { min: 18, perPlayer: 3 },
    2: { min: 15, perPlayer: 2.5 },
    3: { min: 12, perPlayer: 2 },
    4: { min: 9, perPlayer: 1.5 },
    5: { min: 6, perPlayer: 1 }
  };
  const profile = profiles[clamp(Math.round(aggression), 1, 5)];
  return Math.max(profile.min, Math.ceil(Math.max(1, playerCount) * profile.perPlayer));
}

export function attackIntervalForAggression(aggression) {
  const intervals = {
    1: 15000,
    2: 12000,
    3: 9000,
    4: 7000,
    5: 5200
  };
  return intervals[clamp(Math.round(aggression), 1, 5)];
}

export function initialAttackDelayForAggression(aggression) {
  const interval = attackIntervalForAggression(aggression);
  return Math.max(2600, Math.round(interval * 0.55));
}

export function attackDamageForPower(hitCount, playerCount, attackPower) {
  if (!hitCount) return 0;
  const ratio = hitCount / Math.max(1, playerCount);
  const multiplier = [0, 0.65, 0.82, 1, 1.22, 1.48][clamp(Math.round(attackPower), 1, 5)];
  return clamp(Math.round((4 + ratio * 18) * multiplier), 2, 40);
}

export function chooseAttack(definition) {
  const attacks = definition.attacks?.length ? definition.attacks : ['shockwave'];
  const byte = crypto.getRandomValues(new Uint8Array(1))[0];
  return attacks[byte % attacks.length];
}
