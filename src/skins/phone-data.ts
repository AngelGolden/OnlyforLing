/**
 * 由 scripts/import-phone.mjs 从 data/phone-app/电话模块搭建规格.txt 逐字生成。
 * 请勿手工改写台词、顺序或发言人；重新运行导入脚本即可再生成。
 * 通话剧本是固定内容：运行时只按索引读取，不允许临场生成对话。
 */
export type CallLine = {
  side: "peer" | "owner";
  text: string;
  speaker?: string;
};

export const PHONE_CONTACTS = [{"key":"lingling","name":"鄺學姐 💙","number":"+852 6*** 0511","note":"联系频率不算高，但经常聊天"},{"key":"mimi","name":"Mimi","number":"+852 5*** 1907","note":"闺蜜"},{"key":"mother","name":"妈妈","number":"+86 1** **** 2386","note":"家人"}] as ReadonlyArray<{
  key: string;
  name: string;
  number: string;
  note: string;
}>;

export const PHONE_HISTORY = [{"id":"call_hist_001","time":"2026-11-10 20:26","name":"妈妈","direction":"呼入","status":"未接来电","duration":""},{"id":"call_hist_002","time":"2026-11-10 18:43","name":"Mimi","direction":"呼出","status":"已接听","duration":"06:12"},{"id":"call_hist_003","time":"2026-11-10 16:17","name":"+852 5*** 7316","direction":"呼入","status":"已接听","duration":"00:18"},{"id":"call_hist_004","time":"2026-11-09 22:31","name":"鄺學姐 💙","direction":"呼入","status":"已接听","duration":"00:42"},{"id":"call_hist_006","time":"2026-11-09 12:18","name":"+852 3*** 1184","direction":"呼入","status":"未接来电","duration":""},{"id":"call_hist_008","time":"2026-11-08 15:26","name":"+852 2*** 9073","direction":"呼入","status":"未接来电","duration":""}] as ReadonlyArray<{
  id: string;
  time: string;
  name: string;
  direction: string;
  status: string;
  duration: string;
}>;

export const UNKNOWN_NUMBERS: readonly string[] = ["+852 5*** 7316","+852 3*** 1184","+852 2*** 9073"];

export const MOM_SCRIPT: readonly CallLine[] = [{"side":"peer","text":"今天有没有吃晚饭？","speaker":"妈妈"},{"side":"owner","text":"吃了"},{"side":"peer","text":"吃的什么？","speaker":"妈妈"},{"side":"owner","text":"学校附近随便吃了点"},{"side":"peer","text":"又随便吃","speaker":"妈妈"},{"side":"owner","text":"哈哈哈，真的吃了"},{"side":"peer","text":"天气慢慢凉了，多穿一点","speaker":"妈妈"},{"side":"owner","text":"好的"},{"side":"peer","text":"有时间多给家里打个电话","speaker":"妈妈"},{"side":"owner","text":"周末再打给你"}];
export const MIMI_SCRIPT: readonly CallLine[] = [{"side":"peer","text":"喂，终于接了？","speaker":"Mimi"},{"side":"owner","text":"你不是刚刚才给我发消息吗？"},{"side":"peer","text":"发消息和打电话是两回事啊。","speaker":"Mimi"},{"side":"peer","text":"怎么，打电话就不能找你？","speaker":"Mimi"},{"side":"owner","text":"可以，什么事？"},{"side":"peer","text":"没什么大事，想问你周末有没有空。","speaker":"Mimi"},{"side":"owner","text":"怎么了？"},{"side":"peer","text":"学校附近那家新开的甜品店你不是收藏了吗？我想去试试。","speaker":"Mimi"},{"side":"owner","text":"你不是说最近要少吃甜的吗？"},{"side":"peer","text":"我说的是少吃，又不是戒掉。","speaker":"Mimi"},{"side":"owner","text":"差别还挺大。"},{"side":"peer","text":"而且我已经想好吃完去哪逛了。","speaker":"Mimi"},{"side":"owner","text":"合着你是把我一天都安排好了。"},{"side":"peer","text":"怎么，不乐意？","speaker":"Mimi"},{"side":"owner","text":"考虑一下。"},{"side":"peer","text":"你最近是不是又熬夜？","speaker":"Mimi"},{"side":"owner","text":"还好。"},{"side":"peer","text":"你每次说还好，我就知道不太好。","speaker":"Mimi"},{"side":"owner","text":"……"},{"side":"peer","text":"反正周末出来，顺便给你补顿好的。","speaker":"Mimi"},{"side":"owner","text":"好，等你定时间。"},{"side":"peer","text":"行，挂了，别又忘了吃饭。","speaker":"Mimi"}];
export const LINGLING_SCRIPT: readonly CallLine[] = [{"side":"owner","text":"学姐很忙吗？"},{"side":"peer","text":"啱啱忙完一陣。你連打幾次，係咪有咩急事？","speaker":"鄺學姐"},{"side":"owner","text":"也不算急事，就是想问学姐什么时候有空。"},{"side":"peer","text":"咁都唔算急事呀？","speaker":"鄺學姐"},{"side":"owner","text":"学姐不是说急事可以多打两次吗？"},{"side":"peer","text":"我係話有急事先 call 多兩次，冇叫你試到第四次喎。","speaker":"鄺學姐"},{"side":"owner","text":"那学姐这次不是接了吗？"},{"side":"peer","text":"係呀，唔係你又要話我唔理你啦。","speaker":"鄺學姐"},{"side":"owner","text":"我哪有。"},{"side":"peer","text":"好啦，唔逗你。最近點呀？有冇好好食飯？","speaker":"鄺學姐"},{"side":"owner","text":"有啊。"},{"side":"peer","text":"真係？唔好又話喺學校附近隨便食咗啲。","speaker":"鄺學姐"},{"side":"owner","text":"……"},{"side":"peer","text":"我就知。","speaker":"鄺學姐"},{"side":"peer","text":"對了，你上次話最近想搵間餐廳，揀好未？","speaker":"鄺學姐"},{"side":"owner","text":"还没有，在看几家。"},{"side":"peer","text":"咁耐都未揀好？","speaker":"鄺學姐"},{"side":"owner","text":"想找一家最合适的。"},{"side":"peer","text":"係同邊個去呀？要求咁高。","speaker":"鄺學姐"},{"side":"owner","text":"学姐明知故问。"},{"side":"peer","text":"揀好之後 send 畀我","speaker":"鄺學姐"},{"side":"owner","text":"知道了。"},{"side":"peer","text":"咁我等你消息啦。","speaker":"鄺學姐"},{"side":"owner","text":"好，那学姐先忙。"}];

export const FIRST_CALL_WA: readonly string[] = ["忙，暫時唔得閒聽電話，有事發訊息。","急事嘅話，多 call 兩次。"];

/** 响铃 / 忙音 / 无人接听时长（毫秒），取规格允许区间的下界，便于验收。 */
export const RING_MS = 2400;
export const BUSY_MS = 3500;
export const NO_ANSWER_MS = 8000;
export const FIRST_LINGLING_CONNECTED_MS = 5000;
/** 逐字出现速度，与 WhatsApp v1.2 固定回复保持同一手感。 */
export const CHAR_MS = 28;
export const LINE_GAP_MS = 260;
