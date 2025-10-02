/* =========================================================================
 * Pen: キャンバスの手書き管理クラス
 *  - マウス/タッチ対応
 *  - ペン/消しゴム切替
 *  - UNDO/全消去/リプレイ
 *  - 線幅変更
 *  - 方眼ガイド描画（任意）
 * ========================================================================= */

(function (global) {
  class Pen {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Object} options
     *  - lineWidth: 初期線幅 (default 14)
     *  - strokeColor: ペン色 (default #e5e7eb)
     *  - eraseMode: 初期は消しゴムモードか (default false)
     *  - drawGrid: 初期に方眼を描くか (default true)
     *  - gridDiv: 方眼の分割数 (default 8)
     */
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.paths = [];          // {points:[{x,y}...], width:number, erase:boolean}[]
      this.currentPath = null;
      this.isDrawing = false;
      this.eraseMode = !!options.eraseMode;
      this.lineWidth = options.lineWidth ?? 14;
      this.strokeColor = options.strokeColor ?? "#e5e7eb";
      this.drawGridFlag = options.drawGrid ?? true;
      this.gridDiv = options.gridDiv ?? 8;

      // 入力イベント登録
      this._bindEvents();

      // 初期化
      this.clear(true); // true=ガイド込み初期化
    }

    /* ========== 外部公開API ========== */

    /** 方眼ガイドを描く/消す切替 */
    setGridVisible(visible) {
      this.drawGridFlag = !!visible;
      this.redraw();
    }

    /** 線幅変更 */
    setLineWidth(w) {
      this.lineWidth = Math.max(1, +w || 1);
    }

    /** 消しゴムモードON/OFF */
    setEraseMode(on) {
      this.eraseMode = !!on;
    }

    /** 消しゴムのトグル */
    toggleEraseMode() {
      this.eraseMode = !this.eraseMode;
      return this.eraseMode;
    }

    /** 全消去（履歴も消す） */
    clear(init = false) {
      this.paths = [];
      this._clearCanvas();
      if (this.drawGridFlag || init) this._drawGrid();
    }

    /** 一手戻す */
    undo() {
      if (this.paths.length === 0) return;
      this.paths.pop();
      this.redraw();
    }

    /** 再描画（履歴から） */
    redraw() {
      this._clearCanvas();
      if (this.drawGridFlag) this._drawGrid();
      this._replayPaths();
    }

    /** 現在の履歴を取得（保存用途） */
    getPaths() {
      return JSON.parse(JSON.stringify(this.paths));
    }

    /** 履歴をセットして描画（復元用途） */
    setPaths(paths) {
      this.paths = Array.isArray(paths) ? JSON.parse(JSON.stringify(paths)) : [];
      this.redraw();
    }

    /** いまのキャンバスを2Dコンテキストで返す（採点側で使うなら） */
    getContext2D() {
      return this.ctx;
    }

    /* ========== 内部実装 ========== */

    _bindEvents() {
      const c = this.canvas;

      // PC
      c.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const p = this._toCanvasXY(e);
        this._beginStroke(p.x, p.y);
      });
      c.addEventListener("mousemove", (e) => {
        e.preventDefault();
        if (!this.isDrawing) return;
        const p = this._toCanvasXY(e);
        this._continueStroke(p.x, p.y);
      });
      window.addEventListener("mouseup", () => this._endStroke());

      // タッチ
      c.addEventListener("touchstart", (e) => {
        e.preventDefault();
        const p = this._toCanvasXY(e.touches[0]);
        this._beginStroke(p.x, p.y);
      }, { passive: false });

      c.addEventListener("touchmove", (e) => {
        e.preventDefault();
        if (!this.isDrawing) return;
        const p = this._toCanvasXY(e.touches[0]);
        this._continueStroke(p.x, p.y);
      }, { passive: false });

      c.addEventListener("touchend", (e) => {
        e.preventDefault();
        this._endStroke();
      }, { passive: false });

      // 画面リサイズ時に下敷き等とズレないよう再描画（座標は内部座標なので安全）
      window.addEventListener("resize", () => this.redraw());
    }

    _toCanvasXY(evt) {
      const rect = this.canvas.getBoundingClientRect();
      const x = (evt.clientX - rect.left) * (this.canvas.width / rect.width);
      const y = (evt.clientY - rect.top) * (this.canvas.height / rect.height);
      return { x, y };
    }

    _beginStroke(x, y) {
      this.isDrawing = true;
      this.currentPath = { points: [{ x, y }], width: this.lineWidth, erase: this.eraseMode };
    }

    _continueStroke(x, y) {
      if (!this.isDrawing || !this.currentPath) return;
      const pts = this.currentPath.points;
      const last = pts[pts.length - 1];
      pts.push({ x, y });

      const ctx = this.ctx;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = this.currentPath.width;

      if (this.currentPath.erase) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = this.strokeColor;
      }

      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }

    _endStroke() {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      if (this.currentPath && this.currentPath.points.length > 1) {
        this.paths.push(this.currentPath);
      }
      this.currentPath = null;
      // 書き終わりで作業モードを戻したい場合はここで処理（今回は保持）
    }

    _replayPaths() {
      const ctx = this.ctx;
      for (const p of this.paths) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = p.width;

        if (p.erase) {
          ctx.globalCompositeOperation = "destination-out";
          ctx.strokeStyle = "rgba(0,0,0,1)";
        } else {
          ctx.globalCompositeOperation = "source-over";
          ctx.strokeStyle = this.strokeColor;
        }

        for (let i = 1; i < p.points.length; i++) {
          const a = p.points[i - 1], b = p.points[i];
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = "source-over";
    }

    _clearCanvas() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    _drawGrid() {
      const ctx = this.ctx;
      const N = this.gridDiv;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.06)";
      for (let i = 0; i <= N; i++) {
        const p = (this.canvas.width / N) * i;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, this.canvas.height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(this.canvas.width, p); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // グローバル公開
  global.Pen = Pen;
})(window);
