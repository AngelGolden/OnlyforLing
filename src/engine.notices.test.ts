import { describe, it, expect } from "vitest";
import { createWork } from "./demo";
import { dispatch } from "./engine";
import { initialRuntime, type Action } from "./schema";

/**
 * 通知 / 来电「一次投递」的幂等回归。
 * 真实剧本里 start-lock-notice 没有 once；这里刻意把 demo 的 start 节点改成
 * 无 once，模拟重复 dispatch、刷新后从存档恢复、旧存档字段缺失三种情况。
 */
function workWithoutOnce() {
  const w = createWork();
  delete (w.nodes[0] as { once?: boolean }).once;
  return w;
}

const firstNotice = () =>
  String(createWork().nodes[0].actions[0].value);

describe("notification / call idempotency", () => {
  it("无 once 的节点被重复 dispatch，通知只投递一次", () => {
    const w = workWithoutOnce();
    const s = dispatch(w, initialRuntime(w), "start");
    expect(s.notifications).toEqual([firstNotice()]);
    expect(s.deliveredNotices).toEqual(["start:0"]);

    const twice = dispatch(w, s, "start");
    const thrice = dispatch(w, twice, "start");
    expect(thrice.notifications).toEqual([firstNotice()]);
    expect(thrice.deliveredNotices).toEqual(["start:0"]);
    // 幂等只作用于通知副作用，节点本身的其它状态不被抹掉。
    expect(thrice.completed).toContain("start");
  });

  it("存档 JSON 往返后仍幂等；旧存档缺 deliveredNotices 时不重复投递", () => {
    const w = workWithoutOnce();
    const s = dispatch(w, initialRuntime(w), "start");

    const restored = JSON.parse(JSON.stringify(s));
    expect(dispatch(w, restored, "start").notifications).toEqual([
      firstNotice(),
    ]);

    // 模拟字段上线前的旧存档：通知已在数组里，但还没有幂等键。
    const legacy = JSON.parse(JSON.stringify(s));
    delete legacy.deliveredNotices;
    const migrated = dispatch(w, legacy, "start");
    expect(migrated.notifications).toEqual([firstNotice()]);
    expect(migrated.deliveredNotices).toEqual(["start:0"]);
    expect(dispatch(w, migrated, "start").notifications).toEqual([
      firstNotice(),
    ]);
  });

  it("call 与不同 action 下标各自独立，且不重复创建来电", () => {
    const w = workWithoutOnce();
    const callAction: Action = {
      type: "call",
      key: "contact-lingling",
      value: "邝学姐 💙",
    };
    w.nodes[0].actions.push(callAction);
    const s = dispatch(w, initialRuntime(w), "start");
    expect(s.notifications).toEqual([firstNotice(), "邝学姐 💙 来电"]);
    expect(s.incomingCall?.status).toBe("ringing");
    expect(s.deliveredNotices).toEqual(["start:0", "start:1"]);

    const again = dispatch(w, s, "start");
    expect(again.notifications).toHaveLength(2);
    expect(again.incomingCall).toEqual(s.incomingCall);
    expect(again.deliveredNotices).toEqual(["start:0", "start:1"]);
  });
});
