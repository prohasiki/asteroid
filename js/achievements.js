/**
 * achievements.js — достижения, прогресс изучения разделов и рекорды.
 * Состояние сохраняется в localStorage (если хранилище недоступно —
 * например, в приватном режиме — всё работает в пределах сессии).
 */
import { ACHIEVEMENTS } from './data.js';
import { formatNumber } from './ui.js';

const STORAGE_KEY = 'planet-earth-3d:v1';

export class Progress {
  /**
   * @param {import('./ui.js').UI} ui
   */
  constructor(ui) {
    this.ui = ui;
    this.audio = null;
    this.state = this.load();
    this.unlocked = new Set(this.state.achievements.filter((id) => ACHIEVEMENTS.some((a) => a.id === id)));
    this.ui.renderAchievements(ACHIEVEMENTS, this.unlocked);
    this.ui.setVisited(this.state.visited);
    this.updateBest();
  }

  load() {
    const empty = { achievements: [], visited: [], bestQuiz: null, bestFind: null };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return empty;
      const s = JSON.parse(raw);
      return {
        achievements: Array.isArray(s.achievements) ? s.achievements : [],
        visited: Array.isArray(s.visited) ? s.visited : [],
        bestQuiz: s.bestQuiz ?? null,
        bestFind: s.bestFind ?? null,
      };
    } catch {
      return empty;
    }
  }

  save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        achievements: [...this.unlocked],
        visited: this.state.visited,
        bestQuiz: this.state.bestQuiz,
        bestFind: this.state.bestFind,
      }));
    } catch {
      /* хранилище недоступно — прогресс живёт только в текущей сессии */
    }
  }

  /** Открыть достижение; возвращает true, если оно новое. */
  unlock(id) {
    if (this.unlocked.has(id)) return false;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return false;
    this.unlocked.add(id);
    this.save();
    this.ui.toast({ title: `Достижение: ${a.title}`, text: a.desc, iconName: a.icon });
    this.ui.renderAchievements(ACHIEVEMENTS, this.unlocked);
    this.audio?.achievement();
    return true;
  }

  markVisited(id, count, total) {
    if (!this.state.visited.includes(id)) {
      this.state.visited.push(id);
      this.save();
    }
    if (count >= 5) this.unlock('explorer');
    if (count >= total) this.unlock('encyclopedist');
  }

  recordQuiz(score) {
    if (this.state.bestQuiz == null || score > this.state.bestQuiz) {
      this.state.bestQuiz = score;
      this.save();
      this.updateBest();
      return true;
    }
    return false;
  }

  recordFind(score) {
    if (this.state.bestFind == null || score > this.state.bestFind) {
      this.state.bestFind = score;
      this.save();
      this.updateBest();
      return true;
    }
    return false;
  }

  updateBest() {
    const parts = [];
    if (this.state.bestQuiz != null) parts.push(`викторина — ${formatNumber(this.state.bestQuiz)} очк.`);
    if (this.state.bestFind != null) parts.push(`«Найди на глобусе» — ${formatNumber(this.state.bestFind)} очк.`);
    this.ui.setBestScores(parts.length ? `Рекорды: ${parts.join(', ')}` : 'Проверьте свои знания и чувство географии!');
  }
}
