/**
 * 音乐 App｜本地歌曲列表 + 全局播放器控制界面。
 *
 * 约束（对应规格第二、四、七章）：
 *  - 目标 App 是手机里已安装的那个音乐 App（registry id = spotify），不新增第二个音乐 App。
 *  - 列表每行只有「歌曲名 / 歌手名」两个信息；不显示封面、歌词、专辑、评论或点赞数。
 *  - 所有播放动作只调用 src/music/globalPlayer.ts 的模块级单例：它把唯一的 <audio>
 *    挂在 document.body，不随皮肤卸载，所以返回桌面 / 打开其它 App 音乐继续播放。
 *  - 不调用 p.onItem / p.onRead，听歌不派发剧情 read 事件、不产生通知；
 *    剧情只由首次真正 "playing" 时 Phone 桥接的 ui:music:firstPlayed 事件投递。
 *  - 抖音 / YouTube 的自动暂停由 Phone.open() 的 App 切换事件调用，不在这里轮询。
 *  - 没有白名单本地音轨时（例如 Studio 编辑器里的旧式 data URL 音频）原样交给旧
 *    SpotifySkin，避免改动其它既有内容的行为。
 */
import { Pause, Play, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { musicStore, type Track } from "../music/globalPlayer";
import { SpotifySkin } from "./MediaSkins";
import { musicAsset } from "./music-data";
import { Header, type Props } from "./shared";
import "./music.css";

export function MusicSkin(p: Props) {
  const tracks = useMemo<Track[]>(
    () =>
      p.items
        .map((i) => ({
          id: i.id,
          title: i.title,
          artist: i.sender,
          src: musicAsset(i.meta),
        }))
        .filter((t): t is Track => !!t.src),
    [p.items],
  );
  if (!tracks.length) return <SpotifySkin {...p} />;
  return <LocalMusic p={p} tracks={tracks} />;
}

function LocalMusic({ p, tracks }: { p: Props; tracks: Track[] }) {
  // 全局播放器的状态在模块里；皮肤只订阅变化并重绘，不持有音频元素。
  const [, tick] = useState(0);
  useEffect(() => musicStore.subscribe(() => tick((v) => v + 1)), []);
  // 曲目清单变化时交给单例；setTracks 内部去重，相同清单不会重载、不会从头播放。
  const signature = tracks.map((t) => `${t.id}=${t.src}`).join("|");
  useEffect(() => {
    musicStore.setTracks(tracks);
    // deps 刻意只用 signature（本项目未启用 react-hooks 插件，不用 disable 注释）。
  }, [signature]);

  const state = musicStore.getState();
  const index = Math.max(0, Math.min(state.index, tracks.length - 1));
  const current = tracks[index];
  const playing = state.playing;

  return (
    <div className="catalog-skin music-ui">
      <Header p={p} />
      <div className="catalog-scroll music-scroll">
        <h1 className="music-heading">歌曲</h1>
        <div className="music-list" data-music-list>
          {tracks.map((t, n) => (
            <button
              key={t.id}
              type="button"
              className={`music-row${n === index ? " is-current" : ""}`}
              data-music-track={t.id}
              data-music-index={n}
              aria-label={`播放 ${t.title}`}
              onClick={() => musicStore.play(n)}
            >
              <strong>{t.title}</strong>
              <small>{t.artist}</small>
            </button>
          ))}
        </div>
        <p className="music-hint" data-music-hint>
          点击歌曲即可播放
        </p>
      </div>
      <div className="music-controls" data-music-controls>
        <button
          type="button"
          data-music-control="prev"
          aria-label="上一首"
          onClick={() => musicStore.prev()}
        >
          <SkipBack size={18} />
          <span>上一首</span>
        </button>
        <button
          type="button"
          data-music-control="play"
          aria-label={playing ? "暂停" : "播放"}
          onClick={() => musicStore.toggle()}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
          <span>{playing ? "暂停" : "播放"}</span>
        </button>
        <button
          type="button"
          data-music-control="next"
          aria-label="下一首"
          onClick={() => musicStore.next()}
        >
          <SkipForward size={18} />
          <span>下一首</span>
        </button>
        <button
          type="button"
          data-music-control="shuffle"
          aria-label="随机播放"
          className={state.shuffle ? "is-on" : ""}
          onClick={() => musicStore.shuffle()}
        >
          <Shuffle size={18} />
          <span>随机播放</span>
        </button>
      </div>
      <div className="music-mini" data-music-mini>
        <div className="music-mini-text">
          <strong data-music-current-title>{current?.title ?? ""}</strong>
          <small data-music-current-artist>{current?.artist ?? ""}</small>
        </div>
        <button
          type="button"
          data-music-mini-play
          aria-label={playing ? "迷你播放器暂停" : "迷你播放器播放"}
          onClick={() => musicStore.toggle()}
        >
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
      </div>
    </div>
  );
}
