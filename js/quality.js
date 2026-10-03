/**
 * quality.js — автоматический выбор уровня качества по частоте кадров.
 *
 * Правила (режим «Авто»):
 *  • первые 4 с после старта не учитываются (компиляция шейдеров);
 *  • средний FPS < 42 в течение 3 с подряд → уровень ниже;
 *  • средний FPS > 57 в течение 12 с подряд → уровень выше, но не чаще
 *    раза в 30 с и не выше уровня, с которого уже приходилось «откатываться»;
 *  • в фоновой вкладке измерения приостанавливаются.
 */

export const LEVELS = ['low', 'medium', 'high'];

export class QualityManager {
  /**
   * @param {{initial: string, onChange: (level: string, reason: string) => void}} opts
   */
  constructor({ initial = 'high', onChange }) {
    this.level = initial;
    this.onChange = onChange;
    this.enabled = true;
    this.samples = [];
    this.elapsed = 0;
    this.lowFor = 0;
    this.highFor = 0;
    this.sinceChange = 0;
    this.ceiling = 'high'; // максимум, выше которого не поднимаемся после «отката»
  }

  setEnabled(on) {
    this.enabled = on;
    this.samples.length = 0;
    this.lowFor = 0;
    this.highFor = 0;
  }

  setLevel(level) {
    this.level = level;
    this.sinceChange = 0;
    this.samples.length = 0;
  }

  /** Средний FPS по последним кадрам (скользящее окно ≈ 1 с). */
  get fps() {
    if (!this.samples.length) return 60;
    const total = this.samples.reduce((a, b) => a + b, 0);
    return (this.samples.length / total) || 60;
  }

  /** Вызывать каждый кадр с длительностью кадра в секундах (без ограничения сверху). */
  sample(frameSeconds) {
    if (!this.enabled || document.hidden) return;
    this.elapsed += frameSeconds;
    this.sinceChange += frameSeconds;
    if (this.elapsed < 4) return;
    this.samples.push(Math.max(1e-4, frameSeconds));
    let sum = this.samples.reduce((a, b) => a + b, 0);
    while (sum > 1 && this.samples.length > 10) sum -= this.samples.shift();

    const fps = this.fps;
    const idx = LEVELS.indexOf(this.level);
    if (fps < 42) {
      this.lowFor += frameSeconds;
      this.highFor = 0;
    } else if (fps > 57) {
      this.highFor += frameSeconds;
      this.lowFor = 0;
    } else {
      this.lowFor = 0;
      this.highFor = 0;
    }

    if (this.lowFor > 3 && idx > 0 && this.sinceChange > 3) {
      const next = LEVELS[idx - 1];
      // Если понизились сразу после повышения — фиксируем потолок.
      if (this.sinceChange < 20) this.ceiling = next;
      this.change(next, `FPS ≈ ${Math.round(fps)}`);
    } else if (this.highFor > 12 && idx < LEVELS.indexOf(this.ceiling) && this.sinceChange > 30) {
      this.change(LEVELS[idx + 1], `FPS ≈ ${Math.round(fps)}`);
    }
  }

  change(level, reason) {
    this.setLevel(level);
    this.lowFor = 0;
    this.highFor = 0;
    this.onChange?.(level, reason);
  }
}
