import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Phone } from "../Phone";
import { db } from "../persistence";
import { validateWork, type Work } from "../schema";
import "../styles.css";
import "./player.css";
function StoryPlayer() {
  const [work, setWork] = useState<Work | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    const params = new URLSearchParams(location.search);
    // ?fresh=1：清掉这部作品的玩家进度，以刚捡到手机的初始状态打开。
    const fresh = params.get("fresh") === "1";
    const source =
      params.get("preview") === "test"
        ? "./test-work.json"
        : params.get("template") === "blank"
          ? "./blank-work.json"
          : "./work.json";
    fetch(source, { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw Error("缺少作品文件，请运行 npm run story:build");
        return r.json();
      })
      .then(async (x) => {
        const w = validateWork(x);
        if (fresh) {
          await db.saves.delete(w.id).catch(() => undefined);
          // 移除参数，避免本次流程中刷新页面被反复重置；想重来时再打开带参数的地址。
          params.delete("fresh");
          const rest = params.toString();
          history.replaceState(
            null,
            "",
            location.pathname + (rest ? "?" + rest : "") + location.hash,
          );
        }
        document.title =
          w.title === "捡手机" ? "捡手机" : w.title + " · 捡手机";
        setWork(w);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(String(e));
      });
    return () => abort.abort();
  }, []);
  return (
    <main className="story-runtime">
      {work ? (
        <Phone work={work} />
      ) : (
        <p role="status">{error || "正在打开手机…"}</p>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<StoryPlayer />);
