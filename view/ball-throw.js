// from pokerogue src/phases/attempt-capture-phase.ts @ 7d7da4a8 (AGPL-3.0-only)
// from pokerogue src/data/pokeball.ts (doPokeballBounceAnim, getPokeballTintColor) @ 7d7da4a8 (AGPL-3.0-only)
// from pokerogue src/animations.ts (addPokeballOpenParticles, addPokeballCaptureStars) @ 7d7da4a8 (AGPL-3.0-only)
// Modified for PokeTale on 2026-10-28. See view/LICENSE-NOTE.md.

import BAG_ICONS from '../data/bag-icons.json' with { type: 'json' };
import { ballFrame } from './ui/bag.js';
import { tween, delay } from './lifetime.js';

export const BALL_SOUNDS = ['se/pb_throw.wav', 'se/crit_throw.wav', 'se/pb_rel.wav', 'se/pb_catch.wav', 'se/pb_bounce_1.wav', 'se/pb_move.wav', 'se/pb_lock.wav'];

const TINTS = { pb: 0xd52929, gb: 0x94b4de, ub: 0xe6cd31, rb: 0xd52929, mb: 0xa441bd, lb: 0xffde6a };

// Ball image key (ballFrame) -> tint color (getPokeballTintColor). Also used for sending out (scene.summon)
export const ballTint = key => TINTS[key] ?? TINTS.pb;
const FRAME_MS = 1000 / 60;
const sin = (index, amplitude) => amplitude * Math.sin(index * (Math.PI / 128));
const cos = (index, amplitude) => amplitude * Math.cos(index * (Math.PI / 128));
const gauss = stdev => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()) * stdev;

// Ball throw images and sounds (prefetched during the entrance sequence - scene.warmUp)
export function loadBallThrow(scene) {
  return Promise.all([
    scene.assets.image('pb_particles', 'images/effects/pb_particles.png', BAG_ICONS.pb_particles),
    ...BALL_SOUNDS.map(path => scene.audio.load(path).ready),
  ]);
}

export async function throwBall(scene, ball, outcome) {

  const times = { throwAt: null, shrinkAt: null };
  globalThis.performance?.mark?.('pb:ball-start', { detail: { ball } });
  try { return await play(scene, ball, outcome, times); }
  finally { globalThis.performance?.mark?.('pb:ball-end', { detail: { ball, ...times } }); }
}

// position: the field position aimed at ('enemy', or 'enemy2' in a double battle)
async function play(scene, ball, { shakes = 0, result, critical = false, position = 'enemy' } = {}, times) {
  scene.requireReady();
  if (!['caught', 'broke', 'blocked'].includes(result)) throw new Error(`Invalid ball result: ${result}`);
  const pokemon = scene.requireMon(position);
  await loadBallThrow(scene);
  scene.life.check();
  const key = ballFrame(ball), sound = (path, volume) => { scene.audio.play(path, 1, volume); };

  if (result !== 'blocked') scene.effects.showDoll(position, false);
  const container = pokemon.container, originalY = container.y, scale = pokemon.getSpriteScale();
  const [fx, fy] = pokemon.getFieldPositionOffset();

  const pb = scene.add.sprite(16, 80, 'pb', key).setOrigin(0.5, 0.625);
  scene.field.add(pb);
  times.throwAt = globalThis.performance?.now?.() ?? null;
  sound(critical ? 'se/crit_throw.wav' : 'se/pb_throw.wav');
  scene.time.delayedCall(300, () => { if (pb.scene && container.scene) scene.field.moveBelow(pb, container); });
  await tween(scene, { targets: pb, x: { value: 236 + fx, ease: 'Linear' }, y: { value: 16 + fy, ease: 'Cubic.easeOut' }, duration: 500 });

  if (result === 'blocked') {

    sound('se/pb_bounce_1.wav');
    await tween(scene, { targets: pb, x: pb.x - 60, y: 96, angle: -720, alpha: 0, duration: 600, ease: 'Cubic.easeOut' });
    pb.destroy();
    return;
  }

  // Open: _opening -> 17ms -> _open, release sound, enemy tinted with the ball color, ball particles
  const setFrame = (frame, after) => { pb.setFrame(frame); scene.time.delayedCall(17, () => { if (pb.scene) pb.setFrame(after); }); };
  setFrame(`${key}_opening`, `${key}_open`);
  sound('se/pb_rel.wav');
  pokemon.tint(ballTint(key));
  openParticles(scene, pb.x, pb.y, key);

  times.shrinkAt = globalThis.performance?.now?.() ?? null;
  await tween(scene, { targets: container, duration: 500, ease: 'Sine.easeIn', scale: 0.25 * scale, y: 20 });

  setFrame(`${key}_opening`, key);
  container.setVisible(false);
  sound('se/pb_catch.wav');
  await delay(scene, 250);
  await bounce(scene, pb, 16, 72, 350, critical, sound);

  const shown = critical ? 1 : result === 'caught' ? 3 : Math.max(0, Math.min(3, shakes));
  const pbX = pb.x;
  await delay(scene, 1000);
  for (let k = 1; k <= shown; k++) {
    sound('se/pb_move.wav');
    const direction = k % 2 === 1 ? 1 : -1, wobble = { value: 0 };
    await tween(scene, { targets: wobble, value: 1, duration: 250, ease: 'Cubic.easeOut', yoyo: true,
      onUpdate: () => { pb.setX(pbX + wobble.value * 4 * direction); pb.setAngle(wobble.value * 27.5 * direction); } });
    pb.setX(pbX).setAngle(0);
    await delay(scene, 500);
  }

  if (result === 'broke') {

    sound('se/pb_rel.wav');
    container.y = originalY;
    if (pokemon.mon.status !== 'slp') scene.audio.cry(pokemon.mon, pokemon.mon.hp / pokemon.mon.maxhp <= 0.25);
    pokemon.tint(ballTint(key));
    container.setVisible(true);
    scene.effects.showDoll(position, true);
    setFrame(`${key}_opening`, `${key}_open`);
    await Promise.all([
      pokemon.untint(250, 'Sine.easeOut'),
      tween(scene, { targets: container, duration: 250, ease: 'Sine.easeOut', scale }),
      tween(scene, { targets: pb, duration: 250, delay: 250, ease: 'Sine.easeIn', alpha: 0 }),
    ]);
    pb.destroy();
    return;
  }

  sound('se/pb_lock.wav');
  captureStars(scene, pb);
  const flash = scene.add.sprite(pb.x, pb.y, 'pb', 'pb').setOrigin(pb.originX, pb.originY).setTintFill(0).setAlpha(0);
  scene.field.add(flash);

  await Promise.all([
    (async () => {
      await tween(scene, { targets: flash, alpha: 0.375, duration: 200, ease: 'Sine.easeOut' });
      await tween(scene, { targets: flash, alpha: 0, duration: 200, ease: 'Sine.easeIn' });
      flash.destroy();
    })(),
    delay(scene, 500),
  ]);

}

async function bounce(scene, pb, y1, y2, base, critical, sound) {
  const x0 = pb.x;
  if (critical) {
    await delay(scene, 500);
    for (let i = 0; i < 4; i++) {
      await tween(scene, { targets: pb, x: x0 - 3, duration: 125, ease: 'Linear' });
      await tween(scene, { targets: pb, x: x0 + 3, duration: 125, ease: 'Linear' });
    }
    await tween(scene, { targets: pb, x: x0, duration: 60, ease: 'Linear' });
    await delay(scene, 500);
  }
  let power = 1;
  const yd = y2 - y1;
  while (true) {
    await tween(scene, { targets: pb, y: y2, duration: power * base, ease: 'Cubic.easeIn' });
    sound('se/pb_bounce_1.wav', 0.6 * power);
    power = power > 0.01 ? power * 0.5 : 0;
    if (!power) return;
    await tween(scene, { targets: pb, y: y2 - yd * power, duration: power * base, ease: 'Cubic.easeOut' });
  }
}

export function openParticles(scene, x, y, key) {
  if (key === 'pb' || key === 'gb') return defaultParticles(scene, x, y, key === 'pb' ? 48 : 96);
  if (key === 'ub') return fanParticles(scene, x, y, Array.from({ length: 10 }, (_, i) => [i * 25, 1, 1, 5, 8]));
  if (key === 'mb') {
    for (let i = 0; i < 2; i++) fanParticles(scene, x, y, Array.from({ length: 8 }, (_, j) => [j * 32, i ? 1 : 2, j ? 2 : 1, 8, 4]));
  }
}
function defaultParticles(scene, x, y, radius) {
  if (!scene.anims.exists('pb_open_particle')) {
    scene.anims.create({ key: 'pb_open_particle', frameRate: 16, repeat: -1,
      frames: [0, 1, 2, 3].map(n => ({ key: 'pb_particles', frame: `${n}.png` })) });
  }
  let count = 0;
  scene.time.addEvent({ delay: 20, repeat: 16, callback: () => {
    const index = ++count, angle = index * 45;
    const particle = scene.add.sprite(x, y, 'pb_particles', '0.png');
    scene.field.add(particle);
    scene.tweens.add({ targets: particle, x: x + radius * Math.cos(angle * Math.PI / 180), y: y + radius * Math.sin(angle * Math.PI / 180), duration: 575 });
    particle.play({ key: 'pb_open_particle', startFrame: (index + 3) % 4, frameRate: Math.floor(16 * scene.gameSpeed.speed) });
    scene.tweens.add({ targets: particle, delay: 500, duration: 75, alpha: 0, ease: 'Sine.easeIn', onComplete: () => particle.destroy() });
  } });
}
function fanParticles(scene, x, y, specs) {
  const particles = specs.map(([trigIndex, xSpeed, ySpeed, angle, frameIndex]) => {
    const particle = scene.add.image(x, y, 'pb_particles', `${frameIndex}.png`);
    scene.field.add(particle);
    let f = 0, trig = trigIndex;
    const timer = scene.time.addEvent({ delay: FRAME_MS, loop: true, callback: () => {
      if (!particle.scene) return timer.remove();
      particle.setPosition(x + sin(trig, f * xSpeed), y + cos(trig, f * ySpeed));
      trig += angle; f++;
    } });
    return particle;
  });
  scene.tweens.add({ targets: particles, delay: 750, duration: 250, alpha: 0, ease: 'Sine.easeIn', onComplete: () => particles.forEach(p => p.destroy()) });
}

function captureStars(scene, pb) {
  for (let i = 0; i < 3; i++) {
    const particle = scene.add.sprite(pb.x, pb.y, 'pb_particles', '4.png').setOrigin(pb.originX, pb.originY).setAlpha(0.5);
    scene.field.add(particle);
    scene.tweens.add({ targets: particle, y: pb.y - 10, ease: 'Sine.easeOut', duration: 250,
      onComplete: () => scene.tweens.add({ targets: particle, y: pb.y, alpha: 0, ease: 'Sine.easeIn', duration: 250 }) });
    scene.tweens.add({ targets: particle, x: pb.x + gauss(25), duration: 500 });
    scene.tweens.add({ targets: particle, alpha: 0, delay: 425, duration: 75, onComplete: () => particle.destroy() });
  }
}
