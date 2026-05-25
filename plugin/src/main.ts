import {
  waitForEvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
  CreateStartUpPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk';

const API_BASE  = import.meta.env.VITE_API_BASE  ?? 'http://localhost:3000';
const AUTH_USER = import.meta.env.VITE_AUTH_USER ?? '';
const AUTH_PASS = import.meta.env.VITE_AUTH_PASS ?? '';
const AUTH_HEADER = AUTH_USER ? 'Basic ' + btoa(`${AUTH_USER}:${AUTH_PASS}`) : '';
const AUTO_REFRESH_MS = 15_000;

// ── 型定義 ──────────────────────────────────────────────────
interface BusInfo {
  scheduledTime: string;   // 予定時刻（時刻表通り）
  departureTime: string;   // 発車時刻（実際・遅延考慮後）
  minutesUntil: number;    // あと何分
  route: string;
  isDelayed: boolean;
  isCancelled: boolean;
  stopsPassed?: number;    // 何個前の停留所を通過したか
  currentStop?: string;    // 現在の停留所名
}
interface ApiResponse {
  buses: BusInfo[];
  fetchedAt: string;
  cached: boolean;
  error?: string;
}

// 文字列の表示幅（全角=2、半角=1）を返す
function displayWidth(s: string): number {
  return [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x7f ? 2 : 1), 0);
}

// ── 表示テキスト生成 ─────────────────────────────────────────
function buildText(buses: BusInfo[], fetchedAt: string, loading: boolean, errorMsg?: string): string {
  const lines: string[] = [];
  lines.push('ゆりのき台第三 → 八千代中央駅');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');

  if (loading) {
    lines.push('');
    lines.push('  ...  取得中...');
    return lines.join('\n');
  }

  if (buses.length === 0) {
    lines.push('');
    if (errorMsg) {
      lines.push('  [接続エラー]');
      for (let i = 0; i < Math.min(errorMsg.length, 64); i += 32) {
        lines.push('  ' + errorMsg.slice(i, i + 32));
      }
    } else {
      lines.push('  本日の運行は終了しました');
    }
  } else {
    // ── 先頭バス（詳細表示）──
    const first = buses[0];
    if (first.isCancelled) {
      lines.push('  X  運休');
      lines.push(`     予定: ${first.scheduledTime}`);
    } else {
      // 状態アイコン
      const icon = first.minutesUntil <= 2 ? '▶' : '○';
      const delay = first.isDelayed ? ' [遅延]' : '';

      // 予測時刻（発車）と予定時刻
      if (first.scheduledTime === first.departureTime) {
        lines.push(`  ${icon}  予定: ${first.scheduledTime}${delay}`);
      } else {
        lines.push(`  ${icon}  予測: ${first.departureTime}  予定: ${first.scheduledTime}${delay}`);
      }

      // 残り時間
      if (first.minutesUntil <= 0) {
        lines.push('     まもなく到着');
      } else {
        lines.push(`     あと ${first.minutesUntil}分`);
      }

      // 通過停留所数
      if (first.stopsPassed !== undefined) {
        if (first.currentStop) {
          lines.push(`     ${first.currentStop} 通過`);
          lines.push(`     (${first.stopsPassed}つ前の停留所)`);
        } else {
          lines.push(`     ${first.stopsPassed}つ前の停留所通過`);
        }
      }

      if (first.route) lines.push(`     ${first.route}`);
    }

    // ── 次のバス（予定時刻のみ）──
    if (buses.length >= 2) {
      const next = buses[1];
      lines.push('');
      lines.push('  ─────────────────────');
      if (next.isCancelled) {
        lines.push(`  次: ${next.scheduledTime} 予定  運休`);
      } else {
        lines.push(`  次: ${next.scheduledTime} 予定`);
      }
    }
  }

  // ── フッター：左=更新時刻、右=現在時刻 ──
  const fetched = new Date(fetchedAt);
  const fetchedStr = `更新:${String(fetched.getHours()).padStart(2,'0')}:${String(fetched.getMinutes()).padStart(2,'0')}:${String(fetched.getSeconds()).padStart(2,'0')}`;
  const now = new Date();
  const nowStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const LINE_WIDTH = 30; // 半角単位での行幅（要調整）
  const left = '  ' + fetchedStr;
  const spaces = Math.max(1, LINE_WIDTH - displayWidth(left) - displayWidth(nowStr));
  lines.push('');
  lines.push(left + ' '.repeat(spaces) + nowStr);
  return lines.join('\n');
}

// ── メイン ──────────────────────────────────────────────────
const bridge = await waitForEvenAppBridge();
console.log('[buscheck] bridge ready');

// 1. 初期ページ作成（テンプレートと同じパラメーター）
const makeTextContainer = (text: string) => new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'main',
  content: text,
  isEventCapture: 1,
});

let startResult = 1;
for (let i = 1; i <= 20; i++) {
  if (i > 1) await new Promise(r => setTimeout(r, 300));
  startResult = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [makeTextContainer('起動中...')] }),
  );
  console.log(`[buscheck] createStartUpPageContainer attempt ${i}:`, startResult);
  if (startResult === 0) break;
}
if (startResult !== 0) { console.error('[buscheck] createStartUpPageContainer failed'); }

// 2. 状態管理
let currentData: ApiResponse | null = null;
let isLoading = false;
let timer: ReturnType<typeof setTimeout> | null = null;    // データ取得タイマー
let clockTimer: ReturnType<typeof setInterval> | null = null; // 時計タイマー（1秒）

function startClock() {
  if (clockTimer) return;
  clockTimer = setInterval(async () => {
    if (!isLoading) await updateDisplay(false); // フェッチ中は衝突を避けてスキップ
  }, 1_000);
}

function stopClock() {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
}

// 3. 表示更新
async function updateDisplay(loading: boolean) {
  const text = buildText(
    currentData?.buses ?? [],
    currentData?.fetchedAt ?? new Date().toISOString(),
    loading,
    currentData?.error,
  );
  console.log('[buscheck] textContainerUpgrade len:', text.length);
  const ok = await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: 1,
      containerName: 'main',
      content: text,
      contentOffset: 0,
      contentLength: text.length,
    }),
  );
  console.log('[buscheck] textContainerUpgrade result:', ok);
}

// 4. データ取得（受信完了後にのみ画面を更新）
async function fetchAndDisplay(force = false) {
  if (isLoading) return;
  isLoading = true;
  if (timer) { clearTimeout(timer); timer = null; }
  try {
    const url = `${API_BASE}/api/bus${force ? '?refresh=1' : ''}`;
    console.log('[buscheck] fetch:', url);
    const headers: Record<string, string> = {};
    if (AUTH_HEADER) headers['Authorization'] = AUTH_HEADER;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const newData = await res.json() as ApiResponse;
    console.log('[buscheck] fetch ok, buses:', newData.buses.length);
    currentData = newData;              // 受信完了後にデータを差し替え
    await updateDisplay(false);        // 受信完了後にのみ画面を更新
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[buscheck] fetch error:', msg);
    // エラー時は fetchedAt を現在時刻で上書きしてエラー状態を表示
    currentData = {
      buses: currentData?.buses ?? [],          // 直前のバスデータがあれば保持
      fetchedAt: new Date().toISOString(),
      cached: false,
      error: msg,
    };
    await updateDisplay(false);
  } finally {
    isLoading = false;
    timer = setTimeout(() => fetchAndDisplay(), AUTO_REFRESH_MS);
  }
}

// 5. イベントハンドラ（テンプレートのルールに従う）
// タップ・ライフサイクル → sysEvent
// スクロール → textEvent
const unsubscribe = bridge.onEvenHubEvent(event => {
  // sysEvent: タップ・ダブルタップ・ライフサイクル
  const sysType = event.sysEvent?.eventType ?? null;
  if (sysType !== null) {
    // CLICK_EVENT(0) は protobuf の都合で undefined → ?? で 0 に
    const type = event.sysEvent!.eventType ?? 0;
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      fetchAndDisplay(true);   // 強制再取得
      return;
    }
    if (type === 0 /* CLICK_EVENT */) {
      fetchAndDisplay(false);
      return;
    }
    if (type === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
      startClock();
      fetchAndDisplay(false);
      return;
    }
    if (type === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
      stopClock();
      if (timer) { clearTimeout(timer); timer = null; }
      return;
    }
    if (type === OsEventTypeList.SYSTEM_EXIT_EVENT || type === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
      unsubscribe();
      return;
    }
  }

  // textEvent: スクロール（ネイティブスクロールに任せるため何もしない）
});

// 6. 起動時取得 + 時計スタート
startClock();
await fetchAndDisplay(false);
