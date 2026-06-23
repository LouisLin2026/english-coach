/* ============================================================
   Louis Food English Coach — app.js
   Engine: Dynamic JSON loading, SpeechSynthesis, Car Mode
   ============================================================ */

// ── State ──────────────────────────────────────────────────
const State = {
  courses: [],            // loaded from courses.json
  view: 'home',           // 'home' | 'day' | 'lesson' | 'car' | 'settings'
  currentDay: null,       // day object
  currentLessonIdx: 0,
  completedLessons: {},   // { "1-0": true, "1-1": true, ... }
  completedDays: [],      // [1, 3, 5, ...]
  speed: 1.0,
  theme: 'auto',          // 'dark' | 'light' | 'auto'
  carMode: {
    playing: false,
    paused: false,
    currentDayIdx: 0,
    currentLessonIdx: 0,
    phase: '',
  }
};

// ── Persistence ────────────────────────────────────────────
const Storage = {
  save() {
    localStorage.setItem('lfec_progress', JSON.stringify({
      completedLessons: State.completedLessons,
      completedDays:    State.completedDays,
      speed:            State.speed,
      theme:            State.theme,
    }));
  },
  load() {
    try {
      const d = JSON.parse(localStorage.getItem('lfec_progress') || '{}');
      State.completedLessons = d.completedLessons || {};
      State.completedDays    = d.completedDays    || [];
      State.speed            = d.speed            || 1.0;
      State.theme            = d.theme            || 'auto';
    } catch (e) { /* first run */ }
  }
};

// ── TTS Engine ─────────────────────────────────────────────
const TTS = {
  queue: [],
  active: null,
  stopped: false,

  // Speak one utterance; returns a Promise
  speak(text, lang = 'en-US', rate = 1.0) {
    return new Promise((resolve) => {
      if (this.stopped) { resolve(); return; }
      const u = new SpeechSynthesisUtterance(text);
      u.lang  = lang;
      u.rate  = rate * State.speed;
      u.pitch = lang.startsWith('zh') ? 1.1 : 1.0;
      u.volume = 1.0;
      u.onend     = resolve;
      u.onerror   = resolve;   // don't stall on error
      this.active = u;
      speechSynthesis.speak(u);
    });
  },

  // Pause / Resume
  pause()  { speechSynthesis.pause(); },
  resume() { speechSynthesis.resume(); },

  // Full stop
  stop() {
    this.stopped = true;
    speechSynthesis.cancel();
    this.active = null;
    this.queue  = [];
  },

  // Reset for next session
  reset() { this.stopped = false; },

  // Sleep helper
  sleep(ms) {
    return new Promise(resolve => {
      if (this.stopped) { resolve(); return; }
      setTimeout(resolve, ms);
    });
  },

  // Play the full sequence for one lesson
  async playLesson(lesson, onPhase) {
    const en = (text) => this.speak(text, 'en-US');
    const zh = (text) => this.speak(text, 'zh-TW');
    const gap = (ms)  => this.sleep(ms);

    const phases = [
      { label: '英文',     fn: () => en(lesson.english) },
      { label: '中文',     fn: () => zh(lesson.chinese) },
      { label: '英文重複', fn: () => en(lesson.english) },
      { label: '英文加強', fn: () => en(lesson.english) },
    ];

    // Vocabulary
    lesson.vocabulary.forEach(v => {
      phases.push({
        label: `單字 ${v.word}`,
        fn: () => en(`${v.word} means ${v.meaning}`)
      });
    });

    // Scenario
    if (lesson.scenario) {
      phases.push({
        label: '情境',
        fn: () => zh(lesson.scenario)
      });
    }

    for (const phase of phases) {
      if (this.stopped) break;
      onPhase && onPhase(phase.label);
      await phase.fn();
      await gap(500);
    }

    // 3-second pause before next lesson
    if (!this.stopped) {
      onPhase && onPhase('下一句準備中...');
      await gap(3000);
    }
  }
};

// ── Router / Render ────────────────────────────────────────
const App = {

  async init() {
    document.getElementById('app').innerHTML = loadingHTML();
    Storage.load();
    applyTheme(State.theme);

    try {
      const res = await fetch('./courses.json');
      State.courses = await res.json();
    } catch (e) {
      document.getElementById('app').innerHTML =
        `<div class="loading-screen"><p>⚠️ 無法載入課程資料。</p><button onclick="App.init()" style="color:var(--green);background:none;font-size:16px;margin-top:12px">重試</button></div>`;
      return;
    }

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    }

    // Check for ?mode=car shortcut
    if (new URLSearchParams(location.search).get('mode') === 'car') {
      this.goCarMode(0);
      return;
    }

    this.renderHome();
  },

  // ── Home ──
  renderHome() {
    State.view = 'home';
    const total     = State.courses.length;
    const doneCount = State.completedDays.length;
    const lessonCount = Object.keys(State.completedLessons).length;
    const vocabCount  = State.courses
      .flatMap(c => c.lessons)
      .filter((_, i) => State.completedLessons[lessonKey(_, i)])
      .flatMap(l => l.vocabulary).length;
    const streak = calcStreak();

    // Category sections
    const sections = [
      { title: 'Business English',                 range: [1, 30]  },
      { title: 'Food Factory English',             range: [31, 60] },
      { title: 'International Equipment English',  range: [61, 90] },
    ];

    const sectionHTML = sections.map(sec => {
      const [start, end] = sec.range;
      const days = State.courses.filter(c => c.day >= start && c.day <= end);
      const secDone = days.filter(c => State.completedDays.includes(c.day)).length;
      const pct = days.length ? Math.round((secDone / days.length) * 100) : 0;

      const cards = days.map(c => {
        const isDone    = State.completedDays.includes(c.day);
        const isCurrent = !isDone && isPrevDone(c.day);
        const cls = isDone ? 'completed' : isCurrent ? 'current' : '';
        return `
          <div class="day-card ${cls}" onclick="App.goDay(${c.day})">
            ${isDone ? '<span class="day-check">✓</span>' : isCurrent ? '<span class="day-dot"></span>' : ''}
            <div class="day-num">D${c.day}</div>
            <div class="day-name">${c.title}</div>
          </div>`;
      }).join('');

      // Fill placeholders for days not yet in JSON
      const placeholder = [];
      for (let i = start + days.length; i <= end; i++) {
        placeholder.push(`<div class="day-card locked"><div class="day-num">D${i}</div></div>`);
      }

      return `
        <div class="section-header">
          <span class="section-title">${sec.title}</span>
          <span class="section-badge">Day ${start}–${end}</span>
        </div>
        <div class="section-progress">
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="progress-text">${secDone} / ${end - start + 1} days completed</div>
        </div>
        <div class="day-grid">${cards}${placeholder.join('')}</div>`;
    }).join('');

    document.getElementById('app').innerHTML = `
      <div class="topbar">
        <div class="topbar-logo">
          <div class="logo-icon">🎧</div>
          <span class="topbar-title">LFEC</span>
        </div>
        <div class="topbar-actions">
          <button class="btn-icon" onclick="App.renderSettings()" title="設定">⚙️</button>
        </div>
      </div>
      <div class="stats-bar">
        <div class="stat-card"><div class="stat-value">${doneCount}</div><div class="stat-label">Days Done</div></div>
        <div class="stat-card"><div class="stat-value">${lessonCount}</div><div class="stat-label">Lessons</div></div>
        <div class="stat-card"><div class="stat-value">${vocabCount}</div><div class="stat-label">Vocab</div></div>
        <div class="stat-card"><div class="stat-value">${streak}🔥</div><div class="stat-label">Streak</div></div>
      </div>
      ${sectionHTML}
      <div style="height:32px"></div>`;
  },

  // ── Day View ──
  goDay(dayNum) {
    const course = State.courses.find(c => c.day === dayNum);
    if (!course) return;
    State.currentDay = course;
    State.view = 'day';

    const lessonItems = course.lessons.map((l, i) => {
      const k   = `${dayNum}-${i}`;
      const done = !!State.completedLessons[k];
      return `
        <div class="lesson-card ${done ? 'done' : ''}" onclick="App.goLesson(${i})">
          <div class="lesson-num-badge">${done ? '✓' : i + 1}</div>
          <div class="lesson-info">
            <div class="lesson-english">${l.english}</div>
            <div class="lesson-chinese">${l.chinese}</div>
          </div>
          <div class="lesson-arrow">›</div>
        </div>`;
    }).join('');

    document.getElementById('app').innerHTML = `
      <div class="day-view-header">
        <button class="back-btn" onclick="App.renderHome()">‹ 課程列表</button>
        <div class="day-view-title">Day ${course.day} · ${course.title}</div>
        <div class="day-view-sub">${course.category} · ${course.lessons.length} lessons</div>
        <button class="car-mode-btn" onclick="App.goCarMode(${State.courses.indexOf(course)})">
          ▶ Car Mode — 自動播放全部
        </button>
      </div>
      <div class="lesson-list">${lessonItems}</div>`;
  },

  // ── Lesson Player ──
  goLesson(lessonIdx) {
    const course = State.currentDay;
    if (!course) return;
    State.currentLessonIdx = lessonIdx;
    const lesson  = course.lessons[lessonIdx];
    const total   = course.lessons.length;
    const k       = `${course.day}-${lessonIdx}`;
    const isSpeaking = false;

    const vocabHTML = lesson.vocabulary.map(v =>
      `<div class="vocab-item">
        <span class="vocab-word">${v.word}</span>
        <span class="vocab-sep">=</span>
        <span class="vocab-meaning">${v.meaning}</span>
      </div>`
    ).join('');

    document.getElementById('app').innerHTML = `
      <div class="day-view-header">
        <button class="back-btn" onclick="App.goDay(${course.day})">‹ Day ${course.day}</button>
        <div class="day-view-title">Lesson ${lessonIdx + 1}</div>
      </div>
      <div class="lesson-player">
        <div class="lesson-player-header">
          <span class="lesson-counter">${lessonIdx + 1} / ${total}</span>
          <button class="speak-btn" id="speakBtn" onclick="App.speakLesson()">🔊</button>
        </div>
        <div class="english-sentence">${lesson.english}</div>
        <div class="chinese-sentence">${lesson.chinese}</div>
        <div class="vocab-section">
          <div class="section-label">Vocabulary</div>
          <div class="vocab-list">${vocabHTML}</div>
        </div>
        ${lesson.scenario ? `
        <div class="scenario-section">
          <div class="section-label">Scenario 使用情境</div>
          <div class="scenario-text">${lesson.scenario}</div>
        </div>` : ''}
        <div class="lesson-nav">
          <button class="nav-btn" onclick="App.goLesson(${lessonIdx - 1})" ${lessonIdx === 0 ? 'disabled' : ''}>← 上一句</button>
          <div></div>
          <button class="nav-btn next-btn" onclick="App.nextLesson(${lessonIdx}, ${total})">
            ${lessonIdx === total - 1 ? '完成 ✓' : '下一句 →'}
          </button>
        </div>
      </div>`;

    // Mark as completed
    State.completedLessons[k] = true;
    checkDayComplete(course);
    Storage.save();
  },

  speakLesson() {
    const course = State.currentDay;
    const lesson = course.lessons[State.currentLessonIdx];
    const btn    = document.getElementById('speakBtn');
    if (!btn) return;

    if (TTS.active) { TTS.stop(); TTS.reset(); btn.classList.remove('speaking'); return; }

    TTS.reset();
    btn.classList.add('speaking');
    TTS.playLesson(lesson, () => {}).then(() => {
      TTS.reset();
      if (btn) btn.classList.remove('speaking');
    });
  },

  nextLesson(idx, total) {
    if (idx + 1 < total) {
      this.goLesson(idx + 1);
    } else {
      // Day complete
      this.goDay(State.currentDay.day);
      showToast(`Day ${State.currentDay.day} 完成！ 🎉`);
    }
  },

  // ── Car Mode ──
  goCarMode(dayIdx) {
    if (dayIdx === undefined || dayIdx === null) {
      dayIdx = State.courses.findIndex(c => !State.completedDays.includes(c.day));
      if (dayIdx < 0) dayIdx = 0;
    }
    TTS.stop();
    TTS.reset();
    State.carMode = { playing: false, paused: false, currentDayIdx: dayIdx, currentLessonIdx: 0, phase: '' };
    State.view = 'car';
    this.renderCarMode();
    // Auto-start
    setTimeout(() => this.carPlay(), 600);
  },

  renderCarMode() {
    const cm = State.carMode;
    const course  = State.courses[cm.currentDayIdx];
    if (!course) return;
    const lesson  = course.lessons[cm.currentLessonIdx];
    const totalLessons = course.lessons.length;
    const progress = totalLessons > 0 ? ((cm.currentLessonIdx) / totalLessons) * 100 : 0;

    const speeds = [0.5, 0.7, 1.0, 1.2];
    const speedChips = speeds.map(s =>
      `<button class="speed-chip ${State.speed === s ? 'active' : ''}" onclick="App.setSpeed(${s})">${s}x</button>`
    ).join('');

    document.getElementById('app').innerHTML = `
      <div class="car-mode-screen" id="carScreen">
        <div class="car-topbar">
          <button class="car-close-btn" onclick="App.exitCar()">✕ 結束</button>
          <div class="car-speed-row">${speedChips}</div>
        </div>
        <div class="car-progress-track">
          <div class="car-progress-fill" id="carProgress" style="width:${progress}%"></div>
        </div>
        <div class="car-content">
          <div class="car-meta" id="carMeta">Day ${course.day} · Lesson ${cm.currentLessonIdx + 1} of ${totalLessons}</div>
          <div class="car-status-label" id="carStatus">${cm.phase || '準備播放...'}</div>
          <div class="car-english" id="carEnglish">${lesson.english}</div>
          <div class="car-chinese" id="carChinese">${lesson.chinese}</div>
          <div class="waveform ${cm.playing ? 'playing' : ''}" id="carWave">
            <div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>
            <div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>
            <div class="wave-bar"></div>
          </div>
        </div>
        <div class="car-controls">
          <button class="car-btn car-btn-secondary" onclick="App.carPrev()" id="carPrevBtn">
            <span class="car-btn-icon">⏮</span>上一句
          </button>
          <button class="car-btn car-btn-primary" onclick="App.carToggle()" id="carPlayBtn">
            <span class="car-btn-icon" id="carPlayIcon">${cm.playing && !cm.paused ? '⏸' : '▶'}</span>
            <span id="carPlayLabel">${cm.playing && !cm.paused ? '暫停' : '播放'}</span>
          </button>
          <button class="car-btn car-btn-secondary" onclick="App.carNext()" id="carNextBtn">
            <span class="car-btn-icon">⏭</span>下一句
          </button>
        </div>
      </div>`;
  },

  // Car: start or resume play
  async carPlay() {
    const cm = State.carMode;
    cm.playing = true;
    cm.paused  = false;
    this.updateCarUI();

    while (cm.playing && !cm.paused) {
      const course = State.courses[cm.currentDayIdx];
      if (!course) break;
      const lesson = course.lessons[cm.currentLessonIdx];
      if (!lesson) { this.carNextDay(); break; }

      // Mark lesson complete
      const k = `${course.day}-${cm.currentLessonIdx}`;
      State.completedLessons[k] = true;
      checkDayComplete(course);
      Storage.save();

      await TTS.playLesson(lesson, (phase) => {
        cm.phase = phase;
        this.updateCarContent();
      });

      if (!cm.playing || cm.paused) break;

      // Advance
      cm.currentLessonIdx++;
      if (cm.currentLessonIdx >= course.lessons.length) {
        this.carNextDay();
        break;
      }
      this.updateCarContent();
    }

    if (cm.playing && !cm.paused) {
      cm.playing = false;
      this.updateCarUI();
    }
  },

  carNextDay() {
    const cm = State.carMode;
    cm.currentDayIdx++;
    cm.currentLessonIdx = 0;
    if (cm.currentDayIdx >= State.courses.length) {
      cm.playing = false;
      this.updateCarUI();
      showToast('🎉 全部課程播放完畢！');
      return;
    }
    showToast(`Day ${State.courses[cm.currentDayIdx].day} 開始`);
    this.updateCarContent();
    this.carPlay();
  },

  carToggle() {
    const cm = State.carMode;
    if (!cm.playing) {
      TTS.reset();
      this.carPlay();
    } else if (cm.paused) {
      cm.paused = false;
      TTS.resume();
      this.updateCarUI();
      this.carPlay();
    } else {
      cm.paused = true;
      cm.playing = false;
      TTS.pause();
      this.updateCarUI();
    }
  },

  carNext() {
    const cm = State.carMode;
    TTS.stop();
    TTS.reset();
    cm.playing = false;
    const course = State.courses[cm.currentDayIdx];
    if (!course) return;
    cm.currentLessonIdx++;
    if (cm.currentLessonIdx >= course.lessons.length) {
      cm.currentDayIdx++;
      cm.currentLessonIdx = 0;
    }
    if (cm.currentDayIdx >= State.courses.length) { cm.currentDayIdx = State.courses.length - 1; cm.currentLessonIdx = 0; }
    cm.phase = '';
    this.updateCarContent();
    setTimeout(() => this.carPlay(), 300);
  },

  carPrev() {
    const cm = State.carMode;
    TTS.stop();
    TTS.reset();
    cm.playing = false;
    if (cm.currentLessonIdx > 0) {
      cm.currentLessonIdx--;
    } else if (cm.currentDayIdx > 0) {
      cm.currentDayIdx--;
      cm.currentLessonIdx = State.courses[cm.currentDayIdx].lessons.length - 1;
    }
    cm.phase = '';
    this.updateCarContent();
    setTimeout(() => this.carPlay(), 300);
  },

  updateCarContent() {
    const cm = State.carMode;
    const course = State.courses[cm.currentDayIdx];
    if (!course) return;
    const lesson = course.lessons[cm.currentLessonIdx];
    if (!lesson) return;
    const total = course.lessons.length;
    const pct   = total > 0 ? ((cm.currentLessonIdx) / total) * 100 : 0;

    const el = (id) => document.getElementById(id);
    if (el('carEnglish'))  el('carEnglish').textContent  = lesson.english;
    if (el('carChinese'))  el('carChinese').textContent  = lesson.chinese;
    if (el('carStatus'))   el('carStatus').textContent   = cm.phase || '';
    if (el('carMeta'))     el('carMeta').textContent     = `Day ${course.day} · Lesson ${cm.currentLessonIdx + 1} of ${total}`;
    if (el('carProgress')) el('carProgress').style.width = pct + '%';
  },

  updateCarUI() {
    const cm = State.carMode;
    const el = (id) => document.getElementById(id);
    const playing = cm.playing && !cm.paused;
    if (el('carPlayIcon'))  el('carPlayIcon').textContent  = playing ? '⏸' : '▶';
    if (el('carPlayLabel')) el('carPlayLabel').textContent = playing ? '暫停' : '播放';
    const wave = el('carWave');
    if (wave) wave.className = `waveform ${playing ? 'playing' : ''}`;
  },

  exitCar() {
    TTS.stop();
    State.carMode.playing = false;
    if (State.currentDay) {
      this.goDay(State.currentDay.day);
    } else {
      this.renderHome();
    }
  },

  setSpeed(s) {
    State.speed = s;
    Storage.save();
    // Re-render speed chips
    document.querySelectorAll('.speed-chip').forEach(c => {
      c.classList.toggle('active', parseFloat(c.textContent) === s);
    });
  },

  // ── Settings ──
  renderSettings() {
    State.view = 'settings';
    const themes = [
      { id: 'dark',  label: '深色' },
      { id: 'light', label: '淺色' },
      { id: 'auto',  label: '自動' },
    ];
    const themeChips = themes.map(t =>
      `<button class="theme-chip ${State.theme === t.id ? 'active' : ''}" onclick="App.setTheme('${t.id}')">${t.label}</button>`
    ).join('');

    const speeds = [0.5, 0.7, 1.0, 1.2];
    const speedChips = speeds.map(s =>
      `<button class="theme-chip ${State.speed === s ? 'active' : ''}" onclick="App.setSpeedSetting(${s})">${s}x</button>`
    ).join('');

    document.getElementById('app').innerHTML = `
      <div class="topbar">
        <button class="back-btn" onclick="App.renderHome()" style="display:flex;align-items:center;gap:6px;font-size:15px;color:var(--green);background:none">‹ 返回</button>
        <span class="topbar-title">設定</span>
        <div></div>
      </div>
      <div class="settings-panel">
        <div class="settings-group">
          <div class="settings-group-label">外觀</div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label">主題</span>
              <div class="theme-chips">${themeChips}</div>
            </div>
          </div>
        </div>
        <div class="settings-group">
          <div class="settings-group-label">播放速度</div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label">語速</span>
              <div class="theme-chips">${speedChips}</div>
            </div>
          </div>
        </div>
        <div class="settings-group">
          <div class="settings-group-label">進度</div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label">已完成天數</span>
              <span style="color:var(--green);font-weight:700">${State.completedDays.length} days</span>
            </div>
            <div class="settings-item">
              <span class="settings-item-label">已學單字</span>
              <span style="color:var(--blue);font-weight:700">${Object.keys(State.completedLessons).length * 3} words</span>
            </div>
          </div>
        </div>
        <div class="settings-group">
          <div class="settings-group-label">危險區域</div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label">重置所有進度</span>
              <button onclick="App.resetProgress()" style="color:var(--red);background:none;font-size:14px;font-weight:600">重置</button>
            </div>
          </div>
        </div>
      </div>`;
  },

  setTheme(t) {
    State.theme = t;
    applyTheme(t);
    Storage.save();
    this.renderSettings();
  },

  setSpeedSetting(s) {
    State.speed = s;
    Storage.save();
    this.renderSettings();
  },

  resetProgress() {
    if (!confirm('確定要重置所有學習進度？')) return;
    State.completedLessons = {};
    State.completedDays    = [];
    Storage.save();
    this.renderHome();
  }
};

// ── Helpers ────────────────────────────────────────────────
function lessonKey(lesson, idx) { return `?-${idx}`; }

function checkDayComplete(course) {
  const all = course.lessons.every((_, i) => State.completedLessons[`${course.day}-${i}`]);
  if (all && !State.completedDays.includes(course.day)) {
    State.completedDays.push(course.day);
  }
}

function isPrevDone(dayNum) {
  if (dayNum <= 1) return true;
  const prev = dayNum - 1;
  const prevCourse = State.courses.find(c => c.day === prev);
  if (!prevCourse) return true;
  return State.completedDays.includes(prev);
}

function calcStreak() {
  // Simplified: count consecutive completed days from latest
  let streak = 0;
  const sorted = [...State.completedDays].sort((a, b) => b - a);
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || sorted[i - 1] - sorted[i] === 1) { streak++; }
    else break;
  }
  return streak;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function loadingHTML() {
  return `<div class="loading-screen">
    <div class="spinner"></div>
    <span style="font-size:14px">課程載入中...</span>
  </div>`;
}

function showToast(msg, duration = 2500) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// ── Boot ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
