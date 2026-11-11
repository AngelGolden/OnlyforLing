import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { SkinProps } from "./AppSkins";
import type { UiValue } from "./schema";
function matches(value: unknown, initial: UiValue): value is UiValue {
  return Array.isArray(initial)
    ? Array.isArray(value) && value.every((v) => typeof v === "string")
    : typeof value === typeof initial &&
        (typeof value !== "number" || Number.isFinite(value));
}
function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function useSkinState<T extends UiValue>(
  p: Pick<SkinProps, "ui" | "onUi">,
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const stored = p.ui?.[key];
  const [local, setLocal] = useState<T>(initial);
  // 权威值放在 ref 里：set 回调不再捕获渲染时的旧 value，
  // 连续调用 set 时后一次不会覆盖前一次（例如 revealedMessages 累积失效）。
  const ref = useRef<T>(initial);
  const lastWritten = useRef<unknown>(undefined);
  const seeded = useRef(false);
  if (!seeded.current) {
    seeded.current = true;
    ref.current = (matches(stored, initial) ? stored : local) as T;
    lastWritten.current = ref.current;
  } else if (
    stored !== undefined &&
    !same(stored, lastWritten.current) &&
    !same(stored, ref.current)
  ) {
    // 外部（例如从存档恢复）改写了这一项：以存档为准。
    ref.current = stored as T;
    lastWritten.current = stored;
  }
  const value = ref.current;
  const set: Dispatch<SetStateAction<T>> = (next) => {
    const updated =
      typeof next === "function"
        ? (next as (value: T) => T)(ref.current)
        : next;
    ref.current = updated;
    lastWritten.current = updated;
    setLocal(updated);
    p.onUi?.(key, updated);
  };
  return [value, set];
}
