/**
 * quiz.js — викторина «Планета Земля»: 15 вопросов (5 лёгких, 5 средних,
 * 5 сложных), таймер 20 с, очки за скорость, множитель комбо и итоговый ранг.
 */
import { QUIZ_QUESTIONS, QUIZ_RANKS } from './data.js';
import { formatNumber, hydrateIcons, plural } from './ui.js';

const TOTAL = 15;
const PER_LEVEL = 5;
const TIME_LIMIT = 20;
const BASE_POINTS = { easy: 100, medium: 200, hard: 300 };
const LEVEL_NAME = { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный' };
const RING = 2 * Math.PI * 22;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Quiz {
  /**
   * @param {{root:HTMLElement, card:HTMLElement, audio?:Object, onFinish?:Function, onCombo?:Function}} opts
   */
  constructor({ root, card, audio, onFinish, onCombo }) {
    this.root = root;
    this.card = card;
    this.audio = audio;
    this.onFinish = onFinish;
    this.onCombo = onCombo;
    this.active = false;
    this.timer = null;
    this.onKey = (e) => this.handleKey(e);
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
  }

  /** Сформировать набор из 15 вопросов возрастающей сложности с перемешанными ответами. */
  static buildSet() {
    const pick = (level) => shuffle(QUIZ_QUESTIONS.filter((q) => q.level === level)).slice(0, PER_LEVEL);
    return [...pick('easy'), ...pick('medium'), ...pick('hard')].map((q) => {
      const order = shuffle(q.a.map((_, i) => i));
      return { ...q, a: order.map((i) => q.a[i]), c: order.indexOf(q.c) };
    });
  }

  start() {
    this.questions = Quiz.buildSet();
    this.index = 0;
    this.score = 0;
    this.correct = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.totalTime = 0;
    this.active = true;
    this.root.classList.remove('hidden');
    window.addEventListener('keydown', this.onKey);
    this.renderQuestion();
  }

  close() {
    this.stopTimer();
    this.active = false;
    this.root.classList.add('hidden');
    window.removeEventListener('keydown', this.onKey);
  }

  stopTimer() {
    clearInterval(this.timer);
    this.timer = null;
  }

  renderQuestion() {
    const q = this.questions[this.index];
    this.answered = false;
    this.timeLeft = TIME_LIMIT;
    const mult = this.multiplier(this.streak + 1);
    this.card.innerHTML = `
      <div class="quiz-top">
        <div class="quiz-meta">
          <span class="pill">Вопрос ${this.index + 1}/${TOTAL}</span>
          <span class="pill ${q.level}">${LEVEL_NAME[q.level]} · ${BASE_POINTS[q.level]}</span>
          ${this.streak > 0 ? `<span class="pill combo">Комбо ×${mult.toFixed(2).replace('.', ',')}</span>` : ''}
          <span class="pill">Очки: ${formatNumber(this.score)}</span>
        </div>
        <div class="timer" id="quiz-timer">
          <svg viewBox="0 0 52 52"><circle class="t-bg" cx="26" cy="26" r="22"/><circle class="t-fg" cx="26" cy="26" r="22" stroke-dasharray="${RING.toFixed(2)}" stroke-dashoffset="0"/></svg>
          <span>${TIME_LIMIT}</span>
        </div>
      </div>
      <div class="quiz-progress"><div style="width:${(this.index / TOTAL) * 100}%"></div></div>
      <div class="quiz-q reveal">${esc(q.q)}</div>
      <div class="quiz-answers">
        ${q.a.map((a, i) => `<button class="answer reveal" style="--i:${i + 1}" type="button" data-i="${i}"><kbd>${i + 1}</kbd><span>${esc(a)}</span></button>`).join('')}
      </div>
      <div id="quiz-explain"></div>
      <div class="quiz-foot">
        <button class="btn" type="button" data-quiz="close" data-icon-left="close">Завершить</button>
        <button class="btn btn-accent hidden" type="button" data-quiz="next" data-icon-left="play">Далее</button>
      </div>`;
    hydrateIcons(this.card);
    this.card.querySelectorAll('.answer').forEach((b) => b.addEventListener('click', () => this.answer(Number(b.dataset.i))));
    this.card.querySelector('[data-quiz="close"]').addEventListener('click', () => this.close());
    this.card.querySelector('[data-quiz="next"]').addEventListener('click', () => this.next());

    this.stopTimer();
    const started = performance.now();
    this.timer = setInterval(() => {
      this.timeLeft = Math.max(0, TIME_LIMIT - (performance.now() - started) / 1000);
      this.updateTimer();
      if (this.timeLeft <= 0) this.answer(-1);
    }, 100);
  }

  updateTimer() {
    const t = this.card.querySelector('#quiz-timer');
    if (!t) return;
    t.querySelector('.t-fg').setAttribute('stroke-dashoffset', (RING * (1 - this.timeLeft / TIME_LIMIT)).toFixed(2));
    t.querySelector('span').textContent = Math.ceil(this.timeLeft);
    t.classList.toggle('warn', this.timeLeft <= 5);
  }

  multiplier(streak) {
    return Math.min(2, 1 + 0.25 * Math.max(0, streak - 1));
  }

  answer(i) {
    if (this.answered) return;
    this.answered = true;
    this.stopTimer();
    const q = this.questions[this.index];
    this.totalTime += TIME_LIMIT - this.timeLeft;
    const buttons = [...this.card.querySelectorAll('.answer')];
    buttons.forEach((b) => { b.disabled = true; });
    buttons[q.c].classList.add('correct');
    let gained = 0;
    if (i === q.c) {
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.correct += 1;
      const base = BASE_POINTS[q.level];
      gained = Math.round((base + base * 0.5 * (this.timeLeft / TIME_LIMIT)) * this.multiplier(this.streak));
      this.score += gained;
      this.floatScore(buttons[i], `+${gained}`);
      this.audio?.success();
      if (this.streak === 5) this.onCombo?.(this.streak);
    } else {
      this.streak = 0;
      if (i >= 0) buttons[i].classList.add('wrong');
      this.audio?.error();
    }
    const verdict = i === q.c ? '✓ Верно!' : i < 0 ? '⏱ Время вышло.' : '✗ Неверно.';
    this.card.querySelector('#quiz-explain').innerHTML = `<div class="quiz-explain reveal"><b>${verdict}</b> ${esc(q.e)}</div>`;
    const nextBtn = this.card.querySelector('[data-quiz="next"]');
    nextBtn.classList.remove('hidden');
    nextBtn.lastChild.textContent = this.index + 1 >= TOTAL ? 'Результаты' : 'Далее';
    nextBtn.focus({ preventScroll: true });
  }

  floatScore(anchor, text) {
    const r = anchor.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'float-score';
    el.textContent = text;
    el.style.left = `${r.right - 70}px`;
    el.style.top = `${r.top}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  next() {
    if (!this.answered) return;
    this.index += 1;
    if (this.index >= TOTAL) this.finish();
    else this.renderQuestion();
  }

  finish() {
    this.stopTimer();
    const rank = QUIZ_RANKS.find((r) => this.correct >= r.min);
    const avg = this.totalTime / TOTAL;
    this.card.innerHTML = `
      <div class="quiz-top"><span class="pill">Викторина завершена</span><span class="pill combo">Лучшее комбо: ${this.bestStreak}</span></div>
      <div style="text-align:center;margin:8px 0 4px">
        <div class="hud-label">Ваш ранг</div>
        <div class="rank gradient-text reveal">${esc(rank.title)}</div>
        <div class="score-big reveal" style="--i:1">${formatNumber(this.score)}</div>
        <div class="hint">${plural(this.score, ['очко', 'очка', 'очков'])}</div>
      </div>
      <div class="result-grid">
        <div class="stat"><span class="stat-label">Верных ответов</span><span class="stat-value">${this.correct}/${TOTAL}</span></div>
        <div class="stat"><span class="stat-label">Серия подряд</span><span class="stat-value">${this.bestStreak}</span></div>
        <div class="stat"><span class="stat-label">Среднее время</span><span class="stat-value">${avg.toFixed(1).replace('.', ',')} с</span></div>
      </div>
      <p class="section-lead" style="text-align:center">${esc(rank.desc)}</p>
      <div class="quiz-foot">
        <button class="btn" type="button" data-quiz="close" data-icon-left="close">Закрыть</button>
        <button class="btn btn-accent" type="button" data-quiz="again" data-icon-left="reset">Ещё раз</button>
      </div>`;
    hydrateIcons(this.card);
    this.card.querySelector('[data-quiz="close"]').addEventListener('click', () => this.close());
    this.card.querySelector('[data-quiz="again"]').addEventListener('click', () => this.start());
    this.answered = true;
    this.onFinish?.({ score: this.score, correct: this.correct, rank: rank.title, bestStreak: this.bestStreak });
    if (this.correct >= QUIZ_RANKS[0].min) this.audio?.achievement();
  }

  handleKey(e) {
    if (!this.active) return;
    if (e.key === 'Escape') {
      this.close();
      return;
    }
    if (!this.answered && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      this.answer(Number(e.key) - 1);
    } else if (this.answered && (e.key === 'Enter' || e.code === 'Space') && this.index < TOTAL) {
      e.preventDefault();
      this.next();
    }
  }
}

