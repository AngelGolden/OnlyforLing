import { rmSync } from "node:fs";
import { localIconPlugin } from "./scripts/local-icon-plugin";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig(({ command }) => ({
  base: "./",
  optimizeDeps: { entries: ["index.html"] },
  // dist/yt-media 放的是用户提供的本地视频（百 MB 级）。Vite 默认每次构建
  // 清空 dist，在 Windows 回收站机制下删除这么大的目录会失败，使第二次构建
  // 直接报错。改为不清空，只由下面的插件清掉小体积的旧构建产物。
  build: { emptyOutDir: false },
  plugins: [
    {
      name: "clean-stale-runtime-assets",
      apply: "build",
      buildStart() {
        rmSync("dist/assets", { recursive: true, force: true });
      },
    },
    localIconPlugin(command),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "捡手机",
        short_name: "捡手机",
        display: "standalone",
        background_color: "#000000",
        theme_color: "#000000",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      workbox: {
        clientsClaim: true,
        globPatterns: ["**/*.{js,css,html,svg,json,txt,png,jpg}"],
        // work.json 是单文件剧情数据，随固定内容增长；留 ~5% 余量，
        // 仍保留「单文件不得异常膨胀（例如内联大图）」的护栏。
        // WA_LC_002 的 46 条固定私聊消息让 work.json 增至约 4.29MB；
        // 仍保留单文件预缓存上限，防止剧情数据异常膨胀。
        maximumFileSizeToCacheInBytes: 4500000,
      },
    }),
  ],
}));
