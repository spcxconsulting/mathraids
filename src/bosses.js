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
      aggression: 3,
      attackPower: 3,
      warningMs: 1650
    },
    victory: {
      bossFallMs: 4200,
      celebrationMs: 6500
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
