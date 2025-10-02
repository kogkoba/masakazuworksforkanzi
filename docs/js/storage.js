/* =========================================================================
 * StorageManager
 *  - 設定・学習履歴を localStorage に保存
 *  - 端末内での集計/復習に利用
 *  - 任意で Google Apps Script (GAS) へ同期（オフライン対応: リトライキュー）
 * ========================================================================= */

(function (global) {
  const LS_KEY = "kanji-write-quiz:v1";           // データ本体
  const LS_BUF = "kanji-write-quiz:sync-buffer";  // 同期キュー
  const DEFAULTS = {
    config: {
      penWidth: 14,
      thresholdPct: 65,
      grid: true,
      eraseMode: false,
      pack: "default", // 出題パック名（任意）
    },
    results: {
      // 例: "漢": [{ts, scorePct, pass, durationMs}]
    },
    meta: {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      schema: 1,
    }
  };

  class StorageManager {
    constructor() {
      this.state = this._load() || this._init();
      this.remote = null; // {url, token} を setRemoteEndpoint で設定
      this.syncing = false;
      this._loadQueue();
    }

    /* ===================== 基本（設定） ===================== */

    getConfig() {
      return {...this.state.config};
    }
    saveConfig(partial) {
      this.state.config = { ...this.state.config, ...partial };
      this._commit();
    }

    /* ===================== 成績・履歴 ===================== */

    /**
     * 1件の受験結果を保存
     * @param {string} problem 出題（漢字）
     * @param {number} scorePct 0-100
     * @param {boolean} pass 合格
     * @param {object} extra 追加情報 {durationMs, device, pack, notes}
     */
    recordResult(problem, scorePct, pass, extra = {}) {
      const e = {
        ts: Date.now(),
        scorePct: Math.round(scorePct),
        pass: !!pass,
        durationMs: extra.durationMs ?? null,
        device: extra.device ?? this._guessDevice(),
        pack: extra.pack ?? this.state.config.pack ?? "default",
        notes: extra.notes ?? ""
      };
      if (!this.state.results[problem]) this.state.results[problem] = [];
      this.state.results[problem].push(e);
      this._commit();

      // リモートへ非同期送信（任意）
      if (this.remote?.url) {
        this._enqueueRemote({ type: "result", problem, payload: e });
        this.flush(); // 送信試行
      }
    }

    /**
     * 特定問題の履歴（新しい順）
     */
    getHistory(problem, {limit = 50} = {}) {
      const arr = (this.state.results[problem] || []).slice().reverse();
      return arr.slice(0, limit);
    }

    /**
     * 集計（全体）
     */
    getStats() {
      const entries = Object.values(this.state.results).flat();
      const total = entries.length;
      const pass = entries.filter(e => e.pass).length;
      const avg = total ? Math.round(entries.reduce((s, e) => s + e.scorePct, 0) / total) : 0;

      // 苦手（平均点が低い/合格率が低い順）
      const perProblem = Object.entries(this.state.results).map(([k, arr]) => {
        const n = arr.length;
        const p = arr.filter(e=>e.pass).length;
        const avgP = Math.round(arr.reduce((s,e)=>s+e.scorePct,0)/n);
        const rate = n ? Math.round((p/n)*100) : 0;
        return { problem: k, count: n, avg: avgP, passRate: rate };
      }).sort((a,b)=> (a.passRate-b.passRate) || (a.avg - b.avg));

      return { total, pass, passRate: total? Math.round(pass/total*100):0, avg, perProblem };
    }

    /**
     * 復習用：指定条件に合う出題の候補セットを返す
     * @param {object} opt {mode:"wrong|lowScore|new", limit:20, minTrials:2, scoreBelow:70}
     */
    getReviewSet(opt = {}) {
      const mode = opt.mode || "wrong"; // wrong / lowScore / new
      const limit = opt.limit ?? 20;
      const minTrials = opt.minTrials ?? 2;
      const scoreBelow = opt.scoreBelow ?? 70;

      const keys = Object.keys(this.state.results);
      const out = [];

      if (mode === "new") {
        // 履歴がないもの（外部の問題リストと突き合わせる場合は app 側で差集合を）
        for (const k of keys) {
          if ((this.state.results[k]||[]).length === 0) out.push(k);
        }
      } else if (mode === "wrong") {
        for (const k of keys) {
          const arr = this.state.results[k] || [];
          const tried = arr.length;
          const rate = tried ? arr.filter(e=>e.pass).length / tried : 1;
          if (tried >= minTrials && rate < 0.6) out.push(k);
        }
      } else if (mode === "lowScore") {
        for (const k of keys) {
          const arr = this.state.results[k] || [];
          if (!arr.length) continue;
          const avg = Math.round(arr.reduce((s,e)=>s+e.scorePct,0)/arr.length);
          if (avg < scoreBelow && arr.length >= minTrials) out.push(k);
        }
      }

      return out.slice(0, limit);
    }

    /* ===================== データ管理 ===================== */

    exportJSON() {
      return JSON.stringify(this.state);
    }
    importJSON(json) {
      try {
        const obj = JSON.parse(json);
        if (!obj?.config || !obj?.results) throw new Error("invalid payload");
        this.state = {
          config: { ...DEFAULTS.config, ...obj.config },
          results: obj.results || {},
          meta: { ...DEFAULTS.meta, ...obj.meta, updatedAt: Date.now() }
        };
        this._commit();
        return true;
      } catch (e) {
        console.error("import failed:", e);
        return false;
      }
    }
    resetAll() {
      this.state = this._init();
      this._commit();
    }

    /* ===================== リモート同期（任意/GAS） ===================== */

    /**
     * GAS などのエンドポイントを設定
     * @param {string} url  例) https://script.google.com/macros/s/XXXXX/exec
     * @param {string} token 任意の認証トークン（GAS 側で検証）
     */
    setRemoteEndpoint(url, token = "") {
      this.remote = { url, token };
    }

    /**
     * キューに溜めたイベントを送信（失敗時は残す）
     */
    async flush() {
      if (this.syncing || !this.remote?.url) return;
      if (this.queue.length === 0) return;

      this.syncing = true;
      try {
        while (this.queue.length > 0) {
          const item = this.queue[0];
          const ok = await this._postRemote(item);
          if (!ok) break; // 中断（ネット不良など）
          this.queue.shift();
          this._saveQueue();
        }
      } finally {
        this.syncing = false;
      }
    }

    /* ===================== 内部：localStorage ===================== */

    _init() {
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
    _load() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        // マイグレーションの余地がある場合はここで schema を見て処理
        return obj;
      } catch {
        return null;
      }
    }
    _commit() {
      this.state.meta.updatedAt = Date.now();
      localStorage.setItem(LS_KEY, JSON.stringify(this.state));
    }

    /* ===================== 内部：送信キュー ===================== */

    _loadQueue() {
      try {
        const raw = localStorage.getItem(LS_BUF);
        this.queue = raw ? JSON.parse(raw) : [];
      } catch {
        this.queue = [];
      }
    }
    _saveQueue() {
      localStorage.setItem(LS_BUF, JSON.stringify(this.queue));
    }
    _enqueueRemote(evt) {
      // evt: {type, problem, payload}
      this.queue.push({
        ...evt,
        ts: Date.now(),
        device: this._guessDevice(),
        app: "kanji-write-quiz",
        schema: 1
      });
      this._saveQueue();
    }

    async _postRemote(item) {
      try {
        const res = await fetch(this.remote.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.remote.token ? { "X-Auth-Token": this.remote.token } : {})
          },
          body: JSON.stringify(item),
        });
        return res.ok;
      } catch (e) {
        console.warn("remote post failed:", e);
        return false;
      }
    }

    _guessDevice() {
      const ua = navigator.userAgent || "";
      if (/iPhone|iPad|iPod|iOS/i.test(ua)) return "iOS";
      if (/Android/i.test(ua)) return "Android";
      if (/Macintosh/i.test(ua)) return "macOS";
      if (/Windows/i.test(ua)) return "Windows";
      return "Other";
    }
  }

  // グローバル公開
  global.StorageManager = StorageManager;
})(window);
