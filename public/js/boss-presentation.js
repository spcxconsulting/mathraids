function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

export class BossPresentation {
  constructor(config = {}) {
    this.configure(config);
  }

  configure(config = {}) {
    const presentation = config.presentation || config;
    const victory = config.victory || {};

    this.config = {
      idleSway: Number(presentation.idleSway) || 4.5,
      idleBob: Number(presentation.idleBob) || 2.4,
      idleBreath: Number(presentation.idleBreath) || 0.006,
      hitRecoil: Number(presentation.hitRecoil) || 16,
      defeatSink: Number(presentation.defeatSink) || 410,
      defeatDrift: Number(presentation.defeatDrift) || -10,
      defeatTilt: Number(presentation.defeatTilt) || 0.08,
      bossFallMs: Math.max(1800, Number(victory.bossFallMs) || 4200)
    };
  }

  pose({
    now,
    telegraph,
    bossAttackUntil,
    bossAttackType,
    bossHitUntil,
    bossHitFromX,
    bossX,
    complete,
    completedAt
  }) {
    if (complete === 'victory') {
      return this.defeatPose(now, completedAt);
    }

    const idleSway = Math.sin(now / 1700) * this.config.idleSway;
    const idleBob = Math.sin(now / 1250) * this.config.idleBob;
    const idleScale = 1 + Math.sin(now / 1050) * this.config.idleBreath;
    const menace = Math.max(0, Math.sin(now / 1550)) * 0.004;

    let x = idleSway;
    let y = idleBob - menace * 80;
    let scaleX = idleScale + menace;
    let scaleY = idleScale + menace;
    let rotation = Math.sin(now / 2400) * 0.004;
    let aura = 0;

    if (telegraph) {
      const start = telegraph.warnedAt || (telegraph.executeAt - 1650);
      const duration = Math.max(1, telegraph.executeAt - start);
      const progress = clamp((Date.now() - start) / duration, 0, 1);
      const pulse = (Math.sin(now / 70) + 1) / 2;
      aura = 0.12 + progress * 0.24 + pulse * 0.08;
      scaleX += progress * 0.026;
      scaleY += progress * 0.026;
      y += progress * 7;

      if (telegraph.type === 'left_slam') rotation -= progress * 0.028;
      if (telegraph.type === 'right_slam') rotation += progress * 0.028;
      if (telegraph.type === 'shockwave') {
        scaleX += progress * 0.018;
        scaleY -= progress * 0.025;
        y += progress * 7;
      }

      if (progress > 0.75) x += Math.sin(now / 25) * 3 * ((progress - 0.75) / 0.25);
    }

    if (now < bossAttackUntil) {
      const remaining = clamp((bossAttackUntil - now) / 650, 0, 1);
      const force = Math.sin((1 - remaining) * Math.PI);
      if (bossAttackType === 'left_slam') {
        x -= force * 25;
        rotation -= force * 0.05;
      } else if (bossAttackType === 'right_slam') {
        x += force * 25;
        rotation += force * 0.05;
      } else {
        y += force * 18;
        scaleX += force * 0.035;
        scaleY -= force * 0.04;
      }
    }

    if (now < bossHitUntil) {
      const remaining = clamp((bossHitUntil - now) / 230, 0, 1);
      const away = bossHitFromX < bossX ? 1 : -1;
      x += away * remaining * this.config.hitRecoil + Math.sin(now / 13) * remaining * 5;
      rotation += away * remaining * 0.025;
      scaleX -= remaining * 0.018;
      scaleY += remaining * 0.012;
    }

    return { x, y, scaleX, scaleY, rotation, aura, defeatedProgress: 0 };
  }

  defeatPose(now, completedAt) {
    const elapsed = Math.max(0, now - completedAt);
    const progress = clamp(elapsed / this.config.bossFallMs, 0, 1);

    // Give the hit a moment to register, then sink the boss slowly behind the
    // foreground skyline. Smoothstep keeps the start and finish heavy rather
    // than making the sprite fall at a constant arcade speed.
    const recoilProgress = clamp(progress / 0.12, 0, 1);
    const sinkProgress = smoothstep(clamp((progress - 0.08) / 0.92, 0, 1));
    const shudder = Math.sin(now / 45) * (1 - progress) * 2.5;

    return {
      x: this.config.defeatDrift * sinkProgress + shudder,
      y: -10 * Math.sin(recoilProgress * Math.PI) + this.config.defeatSink * sinkProgress,
      scaleX: 1 - sinkProgress * 0.035,
      scaleY: 1 + sinkProgress * 0.018,
      rotation: this.config.defeatTilt * sinkProgress + shudder * 0.0015,
      aura: 0,
      defeatedProgress: progress
    };
  }
}
