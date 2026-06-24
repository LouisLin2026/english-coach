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
  playMode: 'full',       // 'full' | 'fast' | 'review'
  pauseTime: 1.0,         // 句子/單字間停頓秒數（V1.1，預設 1 秒）
  categoryFilter: 'all',  // 'all' | '商務' | '俚語' | '電影' | '時事'（V1.1，播放時選擇，不持久化）
  favorites: [],          // 收藏句庫（V1.1）
  lastSession: null,      // 自動續播位置（V1.1）
  // ── Voice Character System V2.1 ──
  voiceStyle: 'sweet',    // 'normal' | 'sweet' | 'very_sweet'
  englishVoiceURI: null,  // 使用者選定的英文語音（voiceURI），null = 依優先序自動挑
  chineseVoiceURI: null,  // 使用者選定的中文語音
  englishPitch: 1.15,     // 0.8 ~ 1.5
  chinesePitch: 1.20,     // 0.8 ~ 1.5
  englishVolume: 1.0,     // 0.5 ~ 1.0
  chineseVolume: 1.0,     // 0.5 ~ 1.0
  carMode: {
    playing: false,
    paused: false,
    currentDayIdx: 0,
    currentLessonIdx: 0,
    phase: '',
    stage: 'lessons',     // 'lessons' | 'review' | 'summary' | 'done'
    reviewIdx: 0,
    summaryIdx: 0,
    runId: 0,             // 用來讓舊的播放迴圈自動失效，避免重複播放
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
      playMode:         State.playMode,
      pauseTime:        State.pauseTime,
      voiceStyle:       State.voiceStyle,
      englishVoiceURI:  State.englishVoiceURI,
      chineseVoiceURI:  State.chineseVoiceURI,
      englishPitch:     State.englishPitch,
      chinesePitch:     State.chinesePitch,
      englishVolume:    State.englishVolume,
      chineseVolume:    State.chineseVolume,
    }));
  },
  load() {
    try {
      const d = JSON.parse(localStorage.getItem('lfec_progress') || '{}');
      State.completedLessons = d.completedLessons || {};
      State.completedDays    = d.completedDays    || [];
      State.speed            = d.speed            || 1.0;
      State.theme            = d.theme            || 'auto';
      State.playMode         = d.playMode         || 'full';
      State.pauseTime        = (d.pauseTime != null) ? d.pauseTime : 1.0;
      State.voiceStyle       = d.voiceStyle        || 'sweet';
      State.englishVoiceURI  = d.englishVoiceURI   || null;
      State.chineseVoiceURI  = d.chineseVoiceURI   || null;
      State.englishPitch     = (d.englishPitch  != null) ? d.englishPitch  : 1.15;
      State.chinesePitch     = (d.chinesePitch  != null) ? d.chinesePitch  : 1.20;
      State.englishVolume    = (d.englishVolume != null) ? d.englishVolume : 1.0;
      State.chineseVolume    = (d.chineseVolume != null) ? d.chineseVolume : 1.0;
    } catch (e) { /* first run */ }
  },

  // 收藏與自動續播（V1.1，獨立的 localStorage key）
  loadExtras() {
    try { State.favorites   = JSON.parse(localStorage.getItem('lfec_favorites') || '[]'); } catch (e) { State.favorites = []; }
    try { State.lastSession = JSON.parse(localStorage.getItem('lfec_session')   || 'null'); } catch (e) { State.lastSession = null; }
  },
  saveFavorites() {
    localStorage.setItem('lfec_favorites', JSON.stringify(State.favorites));
  },
  saveSession() {
    const cm = State.carMode;
    State.lastSession = {
      dayIdx:     cm.currentDayIdx,
      lessonIdx:  cm.currentLessonIdx,
      stage:      cm.stage,
      reviewIdx:  cm.reviewIdx,
      summaryIdx: cm.summaryIdx,
      playMode:   State.playMode,
      speed:      State.speed,
      pauseTime:  State.pauseTime,
    };
    localStorage.setItem('lfec_session', JSON.stringify(State.lastSession));
  },
  clearSession() {
    State.lastSession = null;
    localStorage.removeItem('lfec_session');
  }
};

// ── Voice Picker (Voice Character System V2.1) ─────────────
// 依語系優先序挑選女聲；找不到指定語音時退而選同語系女聲，
// 再不行用系統女聲；絕不自動改用男聲。
const STYLE_PITCH = {
  normal:     { en: 1.00, zh: 1.05 },
  sweet:      { en: 1.15, zh: 1.20 },
  very_sweet: { en: 1.30, zh: 1.35 },
};

const FEMALE_HINTS = ['female','woman','girl','samantha','victoria','karen','tessa','moira','fiona',
  'serena','kate','stephanie','allison','ava','susan','zoe','amelie','anna','ellen','emma','aria',
  'zira','jenny','michelle','sonia','libby','natasha','clara','catherine','hazel','heera','nora',
  'mei','meijia','mei-jia','hsiao','yating','hanhan','tracy','sinji','sin-ji','ya-ling','tingting',
  'ting-ting','xiaoxiao','xiaoyi','huihui','yaoyao','婷','涵','曉','小','美','女'];
const MALE_HINTS = ['male','man','daniel','alex','fred','thomas','rishi','aaron','arthur','oliver',
  'george','james','ryan','guy','liang','kangkang','yunyang','danny','gordon','rocko','reed','eddy',
  'grandpa','junior','男'];

function isMaleVoice(name)   { const n = (name||'').toLowerCase(); return MALE_HINTS.some(m => n.includes(m)); }
function isFemaleVoice(name) { const n = (name||'').toLowerCase(); return !isMaleVoice(name) && FEMALE_HINTS.some(f => n.includes(f)); }

const Voices = {
  en: null,
  zh: null,
  list: [],
  loaded: false,
  EN_TIERS: ['en-gb', 'en-au', 'en-us', 'en'],   // 英文優先序
  ZH_TIERS: ['zh-tw', 'zh-hk', 'zh-cn', 'zh'],    // 中文優先序

  norm(l) { return (l || '').toLowerCase().replace('_', '-'); },

  resolve(tiers, savedURI) {
    const all = this.list;
    if (!all.length) return null;
    // 1) 使用者已選定且仍存在 → 直接用
    if (savedURI) {
      const saved = all.find(v => v.voiceURI === savedURI || v.name === savedURI);
      if (saved) return saved;
    }
    // 2) 依語系優先序找女聲
    for (const t of tiers) {
      const fem = all.find(v => this.norm(v.lang).startsWith(t) && isFemaleVoice(v.name));
      if (fem) return fem;
    }
    // 3) 依語系優先序找非男聲（避免誤用男聲）
    for (const t of tiers) {
      const any = all.find(v => this.norm(v.lang).startsWith(t) && !isMaleVoice(v.name));
      if (any) return any;
    }
    // 4) 系統任一女聲（同大語系）
    const broad = tiers[tiers.length - 1].slice(0, 2);
    const sysFem = all.find(v => this.norm(v.lang).startsWith(broad) && isFemaleVoice(v.name));
    if (sysFem) return sysFem;
    const sysAny = all.find(v => this.norm(v.lang).startsWith(broad) && !isMaleVoice(v.name));
    if (sysAny) return sysAny;
    // 5) 找不到女聲就回傳 null（用瀏覽器預設），不強制改用男聲
    return null;
  },

  refresh() {
    this.list = (typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : []) || [];
    if (!this.list.length) return;        // 有些瀏覽器首次回傳空陣列
    this.en = this.resolve(this.EN_TIERS, State.englishVoiceURI);
    this.zh = this.resolve(this.ZH_TIERS, State.chineseVoiceURI);
    this.loaded = true;
  },

  forLang(lang) {
    if (!this.loaded) this.refresh();
    return this.norm(lang).startsWith('zh') ? this.zh : this.en;
  },

  // 某語系可供選擇的（非男）語音清單，給 Settings 下拉用
  optionsFor(kind) {
    const tiers = kind === 'zh' ? this.ZH_TIERS : this.EN_TIERS;
    const broad = tiers[tiers.length - 1].slice(0, 2);
    return this.list.filter(v => this.norm(v.lang).startsWith(broad) && !isMaleVoice(v.name));
  }
};
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => Voices.refresh();
  Voices.refresh();
}

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
      const isZh = (lang || '').toLowerCase().startsWith('zh');
      const v = Voices.forLang(lang);
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = lang; }
      u.rate   = rate * State.speed;
      // Voice Character V2.1：英文/中文各自套用 pitch 與 volume
      u.pitch  = isZh ? State.chinesePitch  : State.englishPitch;
      u.volume = isZh ? State.chineseVolume : State.englishVolume;
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
  // opts.scenario === false 時略過情境（Fast 模式用）
  async playLesson(lesson, onPhase, opts = {}) {
    const includeScenario = opts.scenario !== false;
    const en  = (text) => this.speak(text, 'en-US');
    const zh  = (text) => this.speak(text, 'zh-TW');
    const gap = (ms)   => this.sleep(ms);

    const phases = [];

    // ── 第一階段：句子學習 ── EN → ZH → EN → EN → EN（英文 4 次、中文 1 次）
    phases.push({ label: '英文',       fn: () => en(lesson.english) });
    phases.push({ label: '中文',       fn: () => zh(lesson.chinese) });
    phases.push({ label: '英文重複 ①', fn: () => en(lesson.english) });
    phases.push({ label: '英文重複 ②', fn: () => en(lesson.english) });
    phases.push({ label: '英文重複 ③', fn: () => en(lesson.english) });

    // ── 第二階段：單字學習 ── 每個單字 EN → ZH → EN → EN → EN
    (lesson.vocabulary || []).forEach(v => {
      phases.push({ label: `單字 ${v.word}`,         fn: () => en(v.word) });
      phases.push({ label: `單字翻譯 ${v.meaning}`,  fn: () => zh(v.meaning) });
      phases.push({ label: `單字重複 ① ${v.word}`,   fn: () => en(v.word) });
      phases.push({ label: `單字重複 ② ${v.word}`,   fn: () => en(v.word) });
      phases.push({ label: `單字重複 ③ ${v.word}`,   fn: () => en(v.word) });
    });

    // ── 第三階段：情境 ── 只播一次（Fast 模式略過）
    if (includeScenario && lesson.scenario) {
      phases.push({ label: '情境', fn: () => zh(lesson.scenario) });
    }

    for (const phase of phases) {
      if (this.stopped) break;
      onPhase && onPhase(phase.label);
      await phase.fn();
      // V1.1：句子/單字間停頓時間（Settings 可調，預設 1 秒）
      await gap((State.pauseTime != null ? State.pauseTime : 1) * 1000);
    }

    // ── 第四階段：停頓 3 秒，然後自動進入下一個 Lesson ──
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
    Storage.loadExtras();
    Voices.refresh();   // 套用已儲存的語音選擇
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
      { title: '每日綜合會話 Daily Mix',         range: [1, 30]  },
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
            <div class="day-est" style="font-size:11px;color:var(--muted);margin-top:4px">≈ ${estimateDayMinutes(c)} 分</div>
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

    // V1.1 自動續播橫幅
    let resumeHTML = '';
    if (State.lastSession && State.courses[State.lastSession.dayIdx]) {
      const s = State.lastSession;
      const dnum = State.courses[s.dayIdx].day;
      const stageLabel = s.stage === 'review' ? '全日複習'
                       : s.stage === 'summary' ? '單字複習'
                       : `Lesson ${(s.lessonIdx || 0) + 1}`;
      resumeHTML = `
        <div class="resume-banner" onclick="App.resumeCarMode()" style="margin:0 0 18px;padding:16px 18px;background:var(--green);color:#021b14;border-radius:var(--radius);display:flex;align-items:center;justify-content:space-between;cursor:pointer">
          <div>
            <div style="font-size:12px;font-weight:700;opacity:.7">繼續上次課程</div>
            <div style="font-size:18px;font-weight:800;margin-top:2px">Day ${dnum} · ${stageLabel}</div>
          </div>
          <span style="font-size:24px">▶</span>
        </div>`;
    }

    document.getElementById('app').innerHTML = `
      <div class="topbar">
        <div class="topbar-logo">
          <div class="logo-icon">🎧</div>
          <span class="topbar-title">LFEC</span>
        </div>
        <div class="topbar-actions">
          <button class="btn-icon" onclick="App.renderFavorites()" title="收藏">⭐</button>
          <button class="btn-icon" onclick="App.renderSettings()" title="設定">⚙️</button>
        </div>
      </div>
      <div class="stats-bar">
        <div class="stat-card"><div class="stat-value">${doneCount}</div><div class="stat-label">Days Done</div></div>
        <div class="stat-card"><div class="stat-value">${lessonCount}</div><div class="stat-label">Lessons</div></div>
        <div class="stat-card"><div class="stat-value">${vocabCount}</div><div class="stat-label">Vocab</div></div>
        <div class="stat-card"><div class="stat-value">${streak}🔥</div><div class="stat-label">Streak</div></div>
      </div>
      ${resumeHTML}
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
            ${l.type ? `<span class="lesson-type type-${typeClass(l.type)}">${l.type}</span>` : ''}
            <div class="lesson-english">${l.english}</div>
            <div class="lesson-chinese">${l.chinese}</div>
          </div>
          <div class="lesson-arrow">›</div>
        </div>`;
    }).join('');

    const cats = ['all', '商務', '俚語', '電影', '時事'];
    const catChips = cats.map(cat =>
      `<button class="theme-chip ${State.categoryFilter === cat ? 'active' : ''}" onclick="App.setCategoryFilter('${cat}')">${cat === 'all' ? 'All' : cat}</button>`
    ).join('');

    document.getElementById('app').innerHTML = `
      <div class="day-view-header">
        <button class="back-btn" onclick="App.renderHome()">‹ 課程列表</button>
        <div class="day-view-title">Day ${course.day} · ${course.title}</div>
        <div class="day-view-sub">${course.category} · ${course.lessons.length} lessons · 約 ${estimateDayMinutes(course)} 分鐘</div>
        <div class="theme-chips" style="margin-top:14px">${catChips}</div>
        <button class="car-mode-btn" onclick="App.goCarMode(${State.courses.indexOf(course)})">
          ▶ Car Mode — ${State.categoryFilter === 'all' ? '自動播放全部' : '只播放「' + State.categoryFilter + '」'}
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
        <div class="day-view-title">Lesson ${lessonIdx + 1}${lesson.type ? ` <span class="lesson-type type-${typeClass(lesson.type)}">${lesson.type}</span>` : ''}</div>
      </div>
      <div class="lesson-player">
        <div class="lesson-player-header">
          <span class="lesson-counter">${lessonIdx + 1} / ${total}</span>
          <div style="display:flex;align-items:center;gap:12px">
            <button id="favBtn" onclick="App.toggleFavoriteLesson()" title="收藏" style="background:none;font-size:24px;line-height:1;padding:0">${this.isFav(course.day, lessonIdx) ? '⭐' : '☆'}</button>
            <button class="speak-btn" id="speakBtn" onclick="App.speakLesson()">🔊</button>
          </div>
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
    State.carMode = { playing: false, paused: false, currentDayIdx: dayIdx, currentLessonIdx: 0, phase: '', stage: 'lessons', reviewIdx: 0, summaryIdx: 0, runId: 0 };
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

  // Car: 主播放引擎。一天的流程：課程 → Day Review → Day Summary → 下一天
  // 用 runId 讓被中斷的舊迴圈自動失效，避免暫停/切換時重複播放。
  async carPlay() {
    const cm = State.carMode;
    TTS.reset();
    cm.playing = true;
    cm.paused  = false;
    const myRun = ++cm.runId;
    const alive = () => cm.playing && !cm.paused && myRun === cm.runId;
    this.updateCarUI();

    while (alive()) {
      const course = State.courses[cm.currentDayIdx];
      if (!course) {
        cm.playing = false; this.updateCarUI();
        Storage.clearSession();
        showToast('🎉 全部課程播放完畢！');
        return;
      }

      // ── 階段 1：逐課學習（Review Only 模式略過）──
      if (cm.stage === 'lessons') {
        if (State.playMode === 'review') {
          cm.stage = 'review'; cm.reviewIdx = 0;
        } else {
          while (cm.currentLessonIdx < course.lessons.length) {
            if (!alive()) return;
            const lesson = course.lessons[cm.currentLessonIdx];
            // V1.1 類型篩選：不符條件的課直接跳過（不標記完成）
            if (!matchesFilter(lesson)) { cm.currentLessonIdx++; this.updateCarContent(); continue; }
            const k = `${course.day}-${cm.currentLessonIdx}`;
            State.completedLessons[k] = true;
            checkDayComplete(course);
            Storage.save();
            cm.phase = '';
            this.updateCarContent();
            await TTS.playLesson(
              lesson,
              (phase) => { cm.phase = phase; this.updateCarContent(); },
              { scenario: State.playMode === 'full' }   // Fast 模式略過情境
            );
            if (!alive()) return;
            cm.currentLessonIdx++;
            this.updateCarContent();
          }
          cm.stage = 'review'; cm.reviewIdx = 0;
        }
      }

      // ── 階段 2：Day Review（只播英文，每句後停 1 秒）──
      if (cm.stage === 'review' && alive()) {
        const total = course.lessons.length;
        while (cm.reviewIdx < course.lessons.length) {
          if (!alive()) return;
          const lesson = course.lessons[cm.reviewIdx];
          // V1.1 類型篩選：不符條件的課跳過
          if (!matchesFilter(lesson)) { cm.reviewIdx++; continue; }
          const pct = total ? (cm.reviewIdx / total) * 100 : 0;
          this.setCarText(lesson.english, lesson.chinese,
            `🔁 Day Review ${cm.reviewIdx + 1}/${total}`, pct,
            `Day ${course.day} · 全日複習`);
          await TTS.speak(lesson.english, 'en-US');
          if (!alive()) return;
          await TTS.sleep(1000);
          cm.reviewIdx++;
        }
        cm.stage = (State.playMode === 'review') ? 'done' : 'summary';
        cm.summaryIdx = 0;
      }

      // ── 階段 3：Day Summary — Today's Key Vocabulary（EN → ZH → EN）──
      if (cm.stage === 'summary' && alive()) {
        const vocab = course.lessons.filter(matchesFilter).flatMap(l => l.vocabulary || []);
        const total = vocab.length;
        while (cm.summaryIdx < vocab.length) {
          if (!alive()) return;
          const v = vocab[cm.summaryIdx];
          const pct = total ? (cm.summaryIdx / total) * 100 : 0;
          this.setCarText(v.word, v.meaning,
            `📒 今日單字 ${cm.summaryIdx + 1}/${total}`, pct,
            `Day ${course.day} · 重點單字複習`);
          await TTS.speak(v.word, 'en-US');    if (!alive()) return;
          await TTS.speak(v.meaning, 'zh-TW'); if (!alive()) return;
          await TTS.speak(v.word, 'en-US');    if (!alive()) return;
          await TTS.sleep(800);
          cm.summaryIdx++;
        }
        cm.stage = 'done';
      }

      // ── 階段 4：進入下一天 ──
      if (cm.stage === 'done' && alive()) {
        cm.currentDayIdx++;
        cm.currentLessonIdx = 0;
        cm.reviewIdx = 0;
        cm.summaryIdx = 0;
        cm.stage = 'lessons';
        if (cm.currentDayIdx >= State.courses.length) {
          cm.playing = false; this.updateCarUI();
          Storage.clearSession();
          showToast('🎉 全部課程播放完畢！');
          return;
        }
        showToast(`Day ${State.courses[cm.currentDayIdx].day} 開始`);
        this.updateCarContent();
      }
    }

    if (cm.playing && !cm.paused) {
      cm.playing = false;
      this.updateCarUI();
    }
  },

  // 直接更新 Car Mode 畫面文字（Review / Summary 階段用，不經 updateCarContent）
  setCarText(en, zh, phase, pct, meta) {
    const el = (id) => document.getElementById(id);
    if (el('carEnglish')) el('carEnglish').textContent = en;
    if (el('carChinese')) el('carChinese').textContent = zh;
    if (phase != null && el('carStatus'))   el('carStatus').textContent  = phase;
    if (meta  != null && el('carMeta'))      el('carMeta').textContent    = meta;
    if (pct   != null && el('carProgress'))  el('carProgress').style.width = pct + '%';
    Storage.saveSession();
  },

  carToggle() {
    const cm = State.carMode;
    if (!cm.playing) {
      // 開始 / 從目前位置續播（會重唸目前這一句，行車時更清楚）
      TTS.reset();
      this.carPlay();
    } else {
      // 暫停：停止發聲並記住目前階段與位置，使迴圈失效避免重複
      cm.paused  = true;
      cm.playing = false;
      cm.runId++;
      TTS.stop();
      this.updateCarUI();
    }
  },

  carNext() {
    const cm = State.carMode;
    cm.runId++;
    TTS.stop();
    TTS.reset();
    cm.playing = false;
    cm.paused  = false;
    const course = State.courses[cm.currentDayIdx];
    if (!course) return;
    cm.stage = 'lessons';
    cm.reviewIdx = 0;
    cm.summaryIdx = 0;
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
    cm.runId++;
    TTS.stop();
    TTS.reset();
    cm.playing = false;
    cm.paused  = false;
    cm.stage = 'lessons';
    cm.reviewIdx = 0;
    cm.summaryIdx = 0;
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
    Storage.saveSession();
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

  // ── V1.1 自動續播 ──
  resumeCarMode() {
    const s = State.lastSession;
    if (!s || !State.courses[s.dayIdx]) { return this.goCarMode(0); }
    TTS.stop(); TTS.reset();
    if (s.playMode)          State.playMode = s.playMode;
    if (s.speed)             State.speed    = s.speed;
    if (s.pauseTime != null) State.pauseTime = s.pauseTime;
    State.currentDay = State.courses[s.dayIdx];
    State.carMode = {
      playing: false, paused: false,
      currentDayIdx: s.dayIdx, currentLessonIdx: s.lessonIdx || 0,
      phase: '', stage: s.stage || 'lessons',
      reviewIdx: s.reviewIdx || 0, summaryIdx: s.summaryIdx || 0, runId: 0,
    };
    State.view = 'car';
    this.renderCarMode();
    setTimeout(() => this.carPlay(), 600);
  },

  // ── V1.1 類型篩選 ──
  setCategoryFilter(cat) {
    State.categoryFilter = cat;
    if (State.currentDay) this.goDay(State.currentDay.day);
  },

  // ── V1.1 收藏句庫 ──
  toggleFavoriteLesson() {
    const course = State.currentDay;
    if (!course) return;
    const idx    = State.currentLessonIdx;
    const lesson = course.lessons[idx];
    if (!lesson) return;
    const id = `${course.day}-${idx}`;
    const i  = State.favorites.findIndex(f => f.id === id);
    if (i >= 0) {
      State.favorites.splice(i, 1);
      showToast('已移除收藏');
    } else {
      State.favorites.push({
        id, day: course.day, lessonIdx: idx,
        english: lesson.english, chinese: lesson.chinese,
        vocabulary: lesson.vocabulary || [], scenario: lesson.scenario || '',
        type: lesson.type || '',
      });
      showToast('⭐ 已收藏');
    }
    Storage.saveFavorites();
    this.goLesson(idx);   // 重繪以更新星號
  },

  removeFavorite(id) {
    const i = State.favorites.findIndex(f => f.id === id);
    if (i >= 0) State.favorites.splice(i, 1);
    Storage.saveFavorites();
    this.renderFavorites();
  },

  isFav(dayNum, lessonIdx) {
    return State.favorites.some(f => f.id === `${dayNum}-${lessonIdx}`);
  },

  renderFavorites() {
    State.view = 'favorites';
    const favs = State.favorites;
    const items = favs.length ? favs.map(f => `
      <div class="lesson-card" style="align-items:flex-start">
        <div class="lesson-info">
          ${f.type ? `<span class="lesson-type type-${typeClass(f.type)}">${f.type}</span>` : ''}
          <div class="lesson-english">${f.english}</div>
          <div class="lesson-chinese">${f.chinese}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:6px">Day ${f.day} · Lesson ${f.lessonIdx + 1}${f.scenario ? ' · ' + f.scenario : ''}</div>
        </div>
        <button onclick="App.removeFavorite('${f.id}')" title="刪除收藏" style="color:var(--red);background:none;font-size:18px;padding:4px 6px">🗑</button>
      </div>`).join('')
      : `<div style="text-align:center;color:var(--muted);padding:48px 16px;font-size:14px;line-height:1.8">尚無收藏。<br>在課程頁點 ☆ 即可加入收藏。</div>`;
    document.getElementById('app').innerHTML = `
      <div class="topbar">
        <button class="back-btn" onclick="App.renderHome()" style="display:flex;align-items:center;gap:6px;font-size:15px;color:var(--green);background:none">‹ 返回</button>
        <span class="topbar-title">收藏句庫</span>
        <div></div>
      </div>
      <div class="lesson-list" style="padding-top:8px">${items}</div>`;
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

    const modes = [
      { id: 'full',   label: 'Full 完整' },
      { id: 'fast',   label: 'Fast 快速' },
      { id: 'review', label: 'Review 複習' },
    ];
    const modeChips = modes.map(m =>
      `<button class="theme-chip ${State.playMode === m.id ? 'active' : ''}" onclick="App.setPlayMode('${m.id}')">${m.label}</button>`
    ).join('');

    const pauses = [0, 0.5, 1, 2, 3];
    const pauseChips = pauses.map(p =>
      `<button class="theme-chip ${State.pauseTime === p ? 'active' : ''}" onclick="App.setPauseTime(${p})">${p}s</button>`
    ).join('');

    // ── Voice Character V2.1 ──
    Voices.refresh();
    const styles = [
      { id: 'normal',     label: 'Normal' },
      { id: 'sweet',      label: 'Sweet' },
      { id: 'very_sweet', label: 'Very Sweet' },
    ];
    const styleChips = styles.map(s =>
      `<button class="theme-chip ${State.voiceStyle === s.id ? 'active' : ''}" onclick="App.setVoiceStyle('${s.id}')">${s.label}</button>`
    ).join('');

    const buildVoiceOptions = (kind, current) => {
      const list = Voices.optionsFor(kind);
      if (!list.length) return `<option value="">系統預設 Female</option>`;
      return list.map(v =>
        `<option value="${v.voiceURI}" ${current && current.voiceURI === v.voiceURI ? 'selected' : ''}>${v.name} (${v.lang})</option>`
      ).join('');
    };
    const enVoiceName = Voices.en ? `${Voices.en.name} (${Voices.en.lang})` : '系統預設 Female';
    const zhVoiceName = Voices.zh ? `${Voices.zh.name} (${Voices.zh.lang})` : '系統預設 Female';
    const enVoiceOptions = buildVoiceOptions('en', Voices.en);
    const zhVoiceOptions = buildVoiceOptions('zh', Voices.zh);
    const selStyle = 'flex:1;min-width:0;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:8px 10px;font-size:13px';
    const rngStyle = 'flex:1;accent-color:var(--green)';
    const valStyle = 'min-width:38px;text-align:right;color:var(--green);font-weight:700;font-size:13px';

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
          <div class="settings-group-label">Car Mode 播放模式</div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label">模式</span>
              <div class="theme-chips">${modeChips}</div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label" style="font-size:12px;color:var(--muted);line-height:1.5;font-weight:400">${playModeDesc(State.playMode)}</span>
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
          <div class="settings-group-label">Sentence Pause 句子停頓</div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label">停頓時間</span>
              <div class="theme-chips">${pauseChips}</div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label" style="font-size:12px;color:var(--muted);line-height:1.5;font-weight:400">每句英文/中文與單字之間的停頓秒數，越長越好跟讀。</span>
            </div>
          </div>
        </div>
        <div class="settings-group">
          <div class="settings-group-label">Voice Character 語音角色</div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label">英文老師 Emma</span>
              <select style="${selStyle}" onchange="App.setEnglishVoice(this.value)">${enVoiceOptions}</select>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label" style="font-size:11px;color:var(--muted);font-weight:400">目前：${enVoiceName}</span>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label">中文老師 小涵</span>
              <select style="${selStyle}" onchange="App.setChineseVoice(this.value)">${zhVoiceOptions}</select>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label" style="font-size:11px;color:var(--muted);font-weight:400">目前：${zhVoiceName}</span>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label">Voice Style</span>
              <div class="theme-chips">${styleChips}</div>
            </div>
          </div>
        </div>
        <div class="settings-group">
          <div class="settings-group-label">Advanced Voice Settings 進階語音</div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label">English Pitch</span>
              <input type="range" min="0.8" max="1.5" step="0.05" value="${State.englishPitch}" style="${rngStyle}" oninput="App.setEnglishPitch(this.value)">
              <span id="enPitchVal" style="${valStyle}">${Number(State.englishPitch).toFixed(2)}</span>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label">Chinese Pitch</span>
              <input type="range" min="0.8" max="1.5" step="0.05" value="${State.chinesePitch}" style="${rngStyle}" oninput="App.setChinesePitch(this.value)">
              <span id="zhPitchVal" style="${valStyle}">${Number(State.chinesePitch).toFixed(2)}</span>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label">English Volume</span>
              <input type="range" min="0.5" max="1.0" step="0.05" value="${State.englishVolume}" style="${rngStyle}" oninput="App.setEnglishVolume(this.value)">
              <span id="enVolVal" style="${valStyle}">${Number(State.englishVolume).toFixed(2)}</span>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label">Chinese Volume</span>
              <input type="range" min="0.5" max="1.0" step="0.05" value="${State.chineseVolume}" style="${rngStyle}" oninput="App.setChineseVolume(this.value)">
              <span id="zhVolVal" style="${valStyle}">${Number(State.chineseVolume).toFixed(2)}</span>
            </div>
          </div>
        </div>
        <div class="settings-group">
          <div class="settings-group-label">Voice Test 語音試聽</div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label">Test English Voice</span>
              <button class="theme-chip" onclick="App.testVoice('en')">▶ 試聽</button>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-item">
              <span class="settings-item-label">Test Chinese Voice</span>
              <button class="theme-chip" onclick="App.testVoice('zh')">▶ 試聽</button>
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

  setPlayMode(m) {
    State.playMode = m;
    Storage.save();
    this.renderSettings();
  },

  setPauseTime(p) {
    State.pauseTime = p;
    Storage.save();
    this.renderSettings();
  },

  // ── Voice Character V2.1 handlers ──
  setVoiceStyle(style) {
    State.voiceStyle = style;
    const p = STYLE_PITCH[style] || STYLE_PITCH.sweet;
    State.englishPitch = p.en;
    State.chinesePitch = p.zh;
    Storage.save();
    this.renderSettings();
  },
  setEnglishVoice(uri) {
    State.englishVoiceURI = uri || null;
    Voices.refresh();
    Storage.save();
    this.renderSettings();
  },
  setChineseVoice(uri) {
    State.chineseVoiceURI = uri || null;
    Voices.refresh();
    Storage.save();
    this.renderSettings();
  },
  setEnglishPitch(v) {
    State.englishPitch = parseFloat(v);
    Storage.save();
    const el = document.getElementById('enPitchVal');
    if (el) el.textContent = Number(v).toFixed(2);
  },
  setChinesePitch(v) {
    State.chinesePitch = parseFloat(v);
    Storage.save();
    const el = document.getElementById('zhPitchVal');
    if (el) el.textContent = Number(v).toFixed(2);
  },
  setEnglishVolume(v) {
    State.englishVolume = parseFloat(v);
    Storage.save();
    const el = document.getElementById('enVolVal');
    if (el) el.textContent = Number(v).toFixed(2);
  },
  setChineseVolume(v) {
    State.chineseVolume = parseFloat(v);
    Storage.save();
    const el = document.getElementById('zhVolVal');
    if (el) el.textContent = Number(v).toFixed(2);
  },
  testVoice(kind) {
    TTS.stop();
    TTS.reset();
    if (kind === 'zh') {
      TTS.speak('歡迎使用 Louis Food English Coach。', 'zh-TW');
    } else {
      TTS.speak('Good morning, welcome to Louis Food English Coach.', 'en-US');
    }
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

// 類型 → 色彩 class
function typeClass(type) {
  return ({ '商務': 'biz', '俚語': 'slang', '電影': 'movie', '時事': 'news' })[type] || 'biz';
}

// V1.1 類型篩選：判斷某課是否符合目前篩選
function matchesFilter(lesson) {
  return State.categoryFilter === 'all' || (lesson && lesson.type === State.categoryFilter);
}

// V1.1 課程時間預估（分鐘）。依：課數、單字數、播放模式、語速、停頓時間動態估算。
function estimateDayMinutes(course) {
  const speed = State.speed || 1;
  const pause = (State.pauseTime != null) ? State.pauseTime : 1;
  const mode  = State.playMode || 'full';
  const lessons = (course && course.lessons) || [];

  // 粗估單句朗讀秒數（1x 語速下）
  const enSec = (t) => Math.max(0.5, String(t || '').trim().split(/\s+/).filter(Boolean).length / 2.6);
  const zhSec = (t) => Math.max(0.5, String(t || '').length / 4.5);

  let speak = 0;   // 受語速影響
  let gaps  = 0;   // 不受語速影響（停頓）

  // 階段 1：逐課（Review Only 略過）
  if (mode !== 'review') {
    lessons.forEach(l => {
      const vocab = l.vocabulary || [];
      let utter = 0;
      speak += enSec(l.english) * 4 + zhSec(l.chinese); utter += 5;          // 句子 4 英 + 1 中
      vocab.forEach(v => { speak += enSec(v.word) * 4 + zhSec(v.meaning); utter += 5; }); // 每字 4 英 + 1 中
      if (mode === 'full' && l.scenario) { speak += zhSec(l.scenario); utter += 1; }       // 情境（Full）
      gaps += utter * pause + 3;   // 每句後停頓 + 課末 3 秒
    });
  }
  // 階段 2：Day Review（每句 1 英 + 1 秒）
  lessons.forEach(l => { speak += enSec(l.english); gaps += 1; });
  // 階段 3：Day Summary（Review Only 不播；其餘每字 2 英 + 1 中 + 0.8 秒）
  if (mode !== 'review') {
    lessons.forEach(l => (l.vocabulary || []).forEach(v => {
      speak += enSec(v.word) * 2 + zhSec(v.meaning); gaps += 0.8;
    }));
  }

  const totalSec = speak / speed + gaps;
  return Math.max(1, Math.round(totalSec / 60));
}

// Car Mode 播放模式說明
function playModeDesc(mode) {
  return ({
    full:   'Full：句子 + 單字 + 情境，全日結束後接 Day Review（英文複習）+ 今日單字複習。',
    fast:   'Fast：句子 + 單字（略過情境），全日結束後接 Day Review + 今日單字複習。',
    review: 'Review Only：只播放 Day Review，逐句重聽當天英文，不播中文/單字/情境。',
  })[mode] || '';
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
