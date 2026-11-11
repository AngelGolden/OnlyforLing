/**
 * 把用户提供的本地 mp4（3 条常规视频 + 4 条 Shorts）导入 public/yt-media/，
 * 并借助本机 Chrome 读取真实时长、抽取视频自身的真实帧作为封面。
 *
 * - 不下载任何内容、不使用 AI 生成图片或说明文字；
 * - 封面是用户视频里的一帧（默认 25% 处），仅做缩放与 JPEG 压缩；
 *   指定 posterAt: 0 的条目改用视频首帧（不 seek，等 loadeddata 后取第 1 帧）；
 * - 输出 data/youtube-media.json 供 import-youtube-videos.mjs 使用；
 * - 可重复执行：源文件字节数一致时跳过复制，其余步骤重新计算；
 * - shorts:true 的条目由 import 脚本写入 folder="Shorts"，只在 Shorts 标签出现。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
  createReadStream,
} from "node:fs";
import { basename, join } from "node:path";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";

const OUT = "public/yt-media";
const PORT = 4199;
const VIDEOS = [
  {
    id: "yt_lingling_just_love_you",
    source:
      "D:/หลิงหลิงคอง南寧見面會 cover 只是太愛你 4K (張敬軒).mp4",
    file: "yt-just-love-you.mp4",
    poster: "yt-just-love-you.jpg",
    title: "邝玲玲 cover 《只是太爱你》",
    sender: "邝玲玲",
    shorts: false,
  },
  {
    id: "yt_lingling_hai_kuo_tian_kong",
    source:
      "D:/250111 LO Fanmeeting  in Hong Kong  鄺玲玲—海闊天空 cover.mp4",
    file: "yt-hai-kuo-tian-kong.mp4",
    poster: "yt-hai-kuo-tian-kong.jpg",
    title: "邝玲玲 cover 《海阔天空》",
    sender: "邝玲玲",
    shorts: false,
  },
  {
    id: "yt_lingling_until_i_found_you",
    source:
      "D:/[4k Fancam] Lingling Kwong - Until I found You _ 261017 LingOrm Between Us concert.mp4",
    file: "yt-until-i-found-you.mp4",
    poster: "yt-until-i-found-you.jpg",
    title: "邝玲玲 cover 《Until I found You》",
    sender: "邝玲玲",
    shorts: false,
  },
  {
    id: "yt_xiaozhu_piano",
    source: "D:/workbuddy/检手机素材/小猪弹琴.mp4",
    file: "yt-xiaozhu-piano.mp4",
    poster: "yt-xiaozhu-piano.jpg",
    title: "小猪弹琴",
    sender: "小猪",
    shorts: true,
  },
  {
    id: "yt_xiaozhu_selfie",
    source: "D:/workbuddy/检手机素材/小猪自拍.mp4",
    file: "yt-xiaozhu-selfie.mp4",
    poster: "yt-xiaozhu-selfie.jpg",
    title: "小猪自拍",
    sender: "小猪",
    shorts: true,
  },
  {
    id: "yt_xiaozhu_cool",
    source: "D:/workbuddy/检手机素材/小猪耍帅.mp4",
    file: "yt-xiaozhu-cool.mp4",
    poster: "yt-xiaozhu-cool.jpg",
    title: "小猪耍帅",
    sender: "小猪",
    shorts: true,
    // 用户指定：这条 Shorts 的封面用视频首帧，不用 25% 处的抽帧。
    posterAt: 0,
  },
  {
    id: "yt_xiaozhu_cute",
    source: "D:/workbuddy/检手机素材/小猪卖萌.mp4",
    file: "yt-xiaozhu-cute.mp4",
    poster: "yt-xiaozhu-cute.jpg",
    title: "小猪卖萌",
    sender: "小猪",
    shorts: true,
  },
];

mkdirSync(OUT, { recursive: true });

for (const v of VIDEOS) {
  const src = v.source;
  if (!existsSync(src)) throw new Error(`找不到用户提供的视频：${src}`);
  const size = statSync(src).size;
  const dst = join(OUT, v.file);
  if (!existsSync(dst) || statSync(dst).size !== size) {
    copyFileSync(src, dst);
    console.log(`复制 ${basename(src)} → ${dst} (${size} B)`);
  } else {
    console.log(`已存在 ${dst} (${size} B)，跳过复制`);
  }
  v.bytes = size;
  v.sourceName = basename(src);
}

const server = createServer((req, res) => {
  const name = decodeURIComponent(
    new URL(req.url || "/", "http://127.0.0.1").pathname,
  ).replace(/^\/+/, "");
  if (name === "" || name === "index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!doctype html><meta charset=utf-8><title>yt-media</title>");
    return;
  }
  if (!/^[a-z0-9-]+\.(mp4|jpg)$/i.test(name)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const path = join(OUT, name);
  if (!existsSync(path)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const size = statSync(path).size;
  const type = name.endsWith(".mp4") ? "video/mp4" : "image/jpeg";
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
    });
    createReadStream(path, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": size,
    "Accept-Ranges": "bytes",
  });
  createReadStream(path).pipe(res);
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  for (const v of VIDEOS) {
    const r = await page.evaluate(async ({ file, posterAt }) => {
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "auto";
      video.playsInline = true;
      video.src = "/" + file;
      video.style.cssText = "position:fixed;left:-9999px;top:0;width:640px";
      document.body.appendChild(video);
      const once = (el, ev) =>
        new Promise((ok, bad) => {
          el.addEventListener(ev, ok, { once: true });
          el.addEventListener("error", bad, { once: true });
        });
      await once(video, "loadedmetadata");
      const duration = video.duration;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) throw new Error(`无法读取视频尺寸：${file}`);
      const at =
        typeof posterAt === "number"
          ? Math.max(0, posterAt)
          : Number.isFinite(duration)
            ? Math.min(Math.max(5, duration * 0.25), Math.max(5, duration - 1))
            : 8;
      if (at > 0) {
        try {
          video.currentTime = at;
          await Promise.race([
            once(video, "seeked"),
            new Promise((_, bad) =>
              setTimeout(() => bad(new Error("seek timeout")), 15000),
            ),
          ]);
        } catch {
          // 某些分片 MP4 不允许直接 seek，退回当前帧。
        }
      } else if (video.readyState < 2) {
        // posterAt: 0 → 视频首帧：不 seek，等第 1 帧解码完成后直接取画面。
        try {
          await Promise.race([
            once(video, "loadeddata"),
            new Promise((_, bad) =>
              setTimeout(() => bad(new Error("first frame timeout")), 15000),
            ),
          ]);
        } catch {
          // 解码事件没来时退回当前帧，避免整批封面失败。
        }
      }
      await new Promise((ok) =>
        requestAnimationFrame(() => requestAnimationFrame(ok)),
      );
      const canvas = document.createElement("canvas");
      const w = 640;
      const h = Math.round((w * height) / width);
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(video, 0, 0, w, h);
      const data = canvas.toDataURL("image/jpeg", 0.85);
      video.remove();
      return { duration, width, height, at, data };
    }, { file: v.file, posterAt: v.posterAt });
    if (!r.data.startsWith("data:image/jpeg;base64,"))
      throw new Error(`封面抽取失败：${v.file}`);
    writeFileSync(
      join(OUT, v.poster),
      Buffer.from(r.data.slice("data:image/jpeg;base64,".length), "base64"),
    );
    v.duration = Number.isFinite(r.duration)
      ? Math.max(0, Math.round(r.duration))
      : 0;
    v.videoWidth = r.width;
    v.videoHeight = r.height;
    v.posterAt = Math.round(r.at * 10) / 10;
    console.log(
      `${v.file}: ${r.width}x${r.height}, ${v.duration}s, 封面帧 @${v.posterAt}s`,
    );
  }
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

mkdirSync("data", { recursive: true });
writeFileSync(
  "data/youtube-media.json",
  JSON.stringify(
    VIDEOS.map(({ source, ...v }) => v),
    null,
    2,
  ) + "\n",
);
console.log("已写入 data/youtube-media.json");
