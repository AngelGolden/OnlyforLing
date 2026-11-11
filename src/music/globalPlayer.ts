/**
 * 全局音乐播放器：唯一的 <audio> 挂在 document.body 上，不随音乐 App 皮肤卸载。
 *
 * 因此在模拟器内切换 App（桌面 / WhatsApp / Notes…）时音频继续播放；
 * 只有打开抖音或 YouTube 时由 Phone 的 App 切换路径显式调用 pauseForVideo()。
 * 状态写 Runtime.ui.music（存档），刷新后恢复当前歌曲与进度但不自动续播；
 * 首次「真正开始播放」才派发 ui:music:firstPlayed 触发 WA_MUSIC_001，
 * 加载失败 / 播放被拒绝 / 仅打开 App / 仅切歌未播放都不会触发。
 *
 * 刻意不复用 src/audio.tsx 的 <audio> 组件（它绑定在皮肤内，切页即卸载）。
 */
export type Track = {
  id: string;
  title: string;
  artist: string;
  src: string;
};

export type MusicState = {
  index: number;
  time: number;
  playing: boolean;
  shuffle: boolean;
  /** 是否曾成功开始播放：与 WA_MUSIC_001 的 once / 变量一起做三重去重。 */
  started: boolean;
  trackCount: number;
};

export type MusicSink = {
  /** 静默写 Runtime（不派发事件），用于播放进度与播放状态。 */
  writeState: (state: MusicState) => void;
  /** 首次成功播放：写 ui:music:firstPlayed 并派发 variable 事件。 */
  fireFirstPlayed: () => void;
  /** 从存档恢复状态。 */
  readState: () => Partial<MusicState> | null;
};

export const MUSIC_UI_APP = "music";
export const MUSIC_STATE_KEY = "player";
export const MUSIC_FIRST_PLAYED_KEY = "firstPlayed";
export const MUSIC_FIRST_PLAYED_TARGET = "ui:music:firstPlayed";
/** 抖音与 YouTube 在项目中的实际 App ID（registry.ts / installedApps 已核对）。 */
export const MUSIC_VIDEO_APPS = ["douyin", "youtube"] as const;

const INITIAL: MusicState = {
  index: 0,
  time: 0,
  playing: false,
  shuffle: false,
  started: false,
  trackCount: 0,
};

let audio: HTMLAudioElement | null = null;
let tracks: Track[] = [];
let state: MusicState = INITIAL;
let sink: MusicSink | null = null;
let restored = false;
let lastWrite = 0;
const listeners = new Set<() => void>();

const WRITE_INTERVAL_MS = 2000;

function emit() {
  for (const fn of listeners) fn();
}

/** 把播放进度节流写回存档；普通 update 不会派发剧情事件。 */
function persist(force: boolean) {
  const now = Date.now();
  if (!force && now - lastWrite < WRITE_INTERVAL_MS) return;
  lastWrite = now;
  if (audio && Number.isFinite(audio.currentTime)) {
    const t = audio.currentTime;
    if (Math.abs(t - state.time) > 0.05) {
      state = { ...state, time: t };
      emit();
    }
  }
  sink?.writeState(state);
}

function ensureAudio(): HTMLAudioElement | null {
  if (audio) return audio;
  if (typeof document === "undefined") return null;
  const el = document.createElement("audio");
  el.id = "global-music-audio";
  el.dataset.globalMusic = "1";
  el.preload = "metadata";
  el.addEventListener("playing", () => {
    if (!state.playing) {
      state = { ...state, playing: true };
      emit();
    }
    if (!state.started) {
      state = { ...state, started: true };
      emit();
      // 先落盘 started，再派发事件；刷新后不会重复投递消息。
      persist(true);
      sink?.fireFirstPlayed();
    }
    persist(true);
  });
  el.addEventListener("pause", () => {
    if (state.playing) {
      state = { ...state, playing: false };
      emit();
    }
    persist(true);
  });
  el.addEventListener("timeupdate", () => persist(false));
  el.addEventListener("error", () => {
    // 加载 / 播放失败：不派发事件，也不改动 started。
    if (state.playing) {
      state = { ...state, playing: false };
      emit();
    }
  });
  el.addEventListener("ended", () => {
    state = {
      ...state,
      playing: false,
      time: Number.isFinite(el.currentTime) ? el.currentTime : state.time,
    };
    emit();
    persist(true);
  });
  el.addEventListener("loadedmetadata", () => {
    // 只在「刷新恢复」时把进度接回去；切歌时 state.time 已归零，不会误用上一首进度。
    if (!Number.isFinite(state.time) || state.time <= 0) return;
    const max = Number.isFinite(el.duration) ? el.duration : state.time;
    const t = Math.min(state.time, max);
    if (Math.abs(el.currentTime - t) > 0.2) el.currentTime = t;
  });
  // 挂在 body 而不是 .app-screen：Phone.captureApp() 会清理屏幕内的 audio/video。
  document.body.appendChild(el);
  audio = el;
  return el;
}

function normalize(i: number): number {
  const n = tracks.length;
  if (!n) return 0;
  return ((i % n) + n) % n;
}

function applySrc(el: HTMLAudioElement, index: number) {
  const src = tracks[index]?.src;
  if (!src || el.getAttribute("src") === src) return;
  el.setAttribute("src", src);
  el.load();
}

/** 成功开始播放才算「触发」；play() 被浏览器策略拒绝时只回到暂停态。 */
function start(index?: number) {
  const el = ensureAudio();
  if (!el || !tracks.length) return;
  const want = typeof index === "number" ? normalize(index) : state.index;
  const switching =
    want !== state.index || el.getAttribute("src") !== tracks[want]?.src;
  if (switching) {
    state = { ...state, index: want, time: 0 };
    applySrc(el, want);
    emit();
  }
  try {
    const p = el.play();
    if (p && typeof (p as Promise<void>).catch === "function")
      (p as Promise<void>).catch(() => {
        if (state.playing) {
          state = { ...state, playing: false };
          emit();
        }
      });
  } catch {
    if (state.playing) {
      state = { ...state, playing: false };
      emit();
    }
  }
}

function pause() {
  const el = ensureAudio();
  if (el) el.pause();
  state = {
    ...state,
    playing: false,
    time: el && Number.isFinite(el.currentTime) ? el.currentTime : state.time,
  };
  emit();
  persist(true);
}

export const musicStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  getState(): MusicState {
    return state;
  },
  getTracks(): Track[] {
    return tracks;
  },
  getAudio(): HTMLAudioElement | null {
    return audio;
  },
  configure(next: MusicSink | null) {
    sink = next;
  },
  /** 皮肤挂载时把 content.spotify 的曲目交给全局播放器；相同曲目不重载，避免从头播放。 */
  setTracks(next: Track[]) {
    const same =
      next.length === tracks.length &&
      next.every(
        (t, i) =>
          t.id === tracks[i]?.id &&
          t.src === tracks[i]?.src &&
          t.title === tracks[i]?.title &&
          t.artist === tracks[i]?.artist,
      );
    if (same) return;
    tracks = next;
    const index = next.length
      ? Math.min(Math.max(state.index, 0), next.length - 1)
      : 0;
    state = { ...state, index, trackCount: next.length };
    const el = ensureAudio();
    if (el && next.length) applySrc(el, index);
    emit();
  },
  /** 存档加载完成后恢复当前歌曲与进度；刻意不自动续播。 */
  restore() {
    if (restored) return;
    restored = true;
    const saved = sink?.readState();
    if (!saved) return;
    state = {
      ...state,
      index: typeof saved.index === "number" ? saved.index : state.index,
      time: typeof saved.time === "number" ? saved.time : state.time,
      shuffle: !!saved.shuffle,
      started: !!saved.started,
      playing: false,
    };
    const el = ensureAudio();
    if (el && tracks.length) applySrc(el, normalize(state.index));
    emit();
  },
  play(index?: number) {
    start(index);
  },
  pause,
  toggle() {
    if (state.playing) pause();
    else start();
  },
  next() {
    if (!tracks.length) return;
    start(normalize(state.index + 1));
  },
  prev() {
    if (!tracks.length) return;
    start(normalize(state.index - 1));
  },
  /** 随机播放：只有一首直接播放；没有歌曲时什么都不做，绝不触发剧情事件。 */
  shuffle() {
    if (!tracks.length) return;
    let next = 0;
    if (tracks.length > 1) {
      do {
        next = Math.floor(Math.random() * tracks.length);
      } while (next === state.index);
    }
    state = { ...state, shuffle: true };
    start(next);
  },
  /** 打开抖音 / YouTube 时由 App 切换路径调用：立即暂停并保存进度，不自动恢复。 */
  pauseForVideo() {
    const el = ensureAudio();
    if (el) el.pause();
    state = {
      ...state,
      playing: false,
      time: el && Number.isFinite(el.currentTime) ? el.currentTime : state.time,
    };
    emit();
    persist(true);
  },
};
