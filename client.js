/**
 * dsh-desktop-web-refresh — 「刷新」按钮（浏览器半）。
 *
 * 背景：DSH Desktop（Windows）的窗口标题栏那一行（与「最小化 / 还原 / 关闭」
 * 原生窗口按钮同栏）左侧的菜单栏——「应用菜单」「编辑」——不是 Web 应用的
 * React 插槽，而是 Electron preload（lib/preload-app.cjs 的 installWindowsMenu）
 * 直接挂到 document.body 的 <div data-windows-menu>，内部是一个 open shadow
 * root，里面 [role=menubar] 依次放着两个按钮，按钮样式由同一 shadow root 里的
 * <style> 统一给出。
 *
 * 因此这里做的是同源 DOM 手术：等那个 menubar 出现后，把「刷新」按钮追加到
 * 它的末尾——正好在「编辑」右侧。按钮外观在同一个 shadow root 里用
 * `button[data-dsh-web-refresh]` 覆盖为蓝底白字圆角矩形 + 阴影伪 3D。
 *
 * 运行保护（用户要求）：刷新会把正在运行的对话截断，所以——
 *   · 有任何对话在运行时，按钮**不允许使能**（aria-disabled + 灰化），点它只弹出
 *     警告：「刷新操作会使当前运行的 n 个对话截断，请等待运行结束或手动中止运行」；
 *   · 只有确认所有对话全静默（不运行）才执行 refresh；
 *   · 状态查不到（Host 名册不可用 / 请求失败）时保守地当作"不可刷新"。
 * 运行中的对话数由 Host 半的 /api/active 提供，2 秒轮询刷新按钮态，按下时再查
 * 一次作为权威判定（轮询只管视觉，判定一定走最新数据）。
 *
 * 几何约束（用户要求）：
 *   - 大小、位置与上一版按钮完全一致：文案去掉「网页」二字后宽度不得收缩，
 *     挂载时先按原文案「网页刷新」量出既有宽高，再换成「刷新」并把宽高锁死；
 *   - 按钮不得侵入标题栏下方的工具栏：外阴影向下控制在 5px 以内（按钮在 40px
 *     标题栏带里垂直居中，下方本有 6px 空隙），并在 :host 上加 overflow:hidden
 *     兜底，任何意外溢出都裁在标题栏带内。
 *
 * 确认可以刷新后即 window.location.reload()，重新加载 DSH Desktop 的页面（Host
 * 进程不受影响，会话仍保留在 Host 侧）。Web 浏览器版 GUI 没有这栏菜单（preload
 * 不运行），此包在那里安静地什么都不做。
 */
window.__ModuleLoader__.load({
  id: 'dsh-desktop-web-refresh',
  factory(require) {
    'use strict';

    /** 按钮的幂等标记属性，同时用于避免重复注入。 */
    const BUTTON_ATTR = 'data-dsh-web-refresh';
    /** 按钮外观样式节点的幂等标记属性。 */
    const STYLE_ATTR = 'data-dsh-web-refresh-style';
    /** 弹窗样式节点的幂等标记属性。 */
    const DIALOG_STYLE_ATTR = 'data-dsh-web-refresh-dialog-style';
    /** 弹窗根节点的幂等标记属性。 */
    const DIALOG_ATTR = 'data-dsh-web-refresh-dialog';
    /** 按钮文案（去掉「网页」二字后）。 */
    const LABEL = '刷新';
    /** 上一版按钮文案：用它量出既有几何尺寸，保证删字后按钮大小、位置不变。 */
    const LEGACY_LABEL = '网页刷新';
    /** 量不到布局时的兜底尺寸 = 「网页刷新」4 字 ×14px + 左右各 10px padding。 */
    const FALLBACK_WIDTH = 76;
    /** 同栏按钮既有高度（preload 的 button 规则）。 */
    const FALLBACK_HEIGHT = 28;
    /** 悬停提示（全静默、可刷新）。 */
    const TITLE_READY = '重新加载 DSH Desktop 页面';
    /** 悬停提示（有对话在运行）。 */
    const TITLE_BUSY = (n) => '有 ' + n + ' 个对话正在运行，暂不可刷新';
    /** 悬停提示（状态未知）。 */
    const TITLE_UNKNOWN = '无法确认对话运行状态，暂不可刷新';
    /** Host 半的活跃对话查询。 */
    const API = '/plugins/dsh-desktop-web-refresh/api/active';
    /** 按钮态轮询间隔（只管视觉；按下时一定重新查一次）。 */
    const POLL_MS = 2000;
    /** 轮询 menubar 的最小间隔，避免流式渲染时高频 DOM 查询。 */
    const PROBE_INTERVAL_MS = 300;
    /** 警告正文（用户指定文案）。 */
    const WARN_TEXT = (n) => '刷新操作会使当前运行的' + n + '个对话截断，请等待运行结束或手动中止运行';
    /** 状态未知时的保守提示。 */
    const WARN_UNKNOWN_TEXT = '暂时无法确认当前对话的运行状态。为避免截断运行中的对话，已禁止刷新，请稍后重试。';

    /**
     * 按钮外观：蓝底白字圆角矩形，多层阴影做伪 3D 凸起。
     * 特异性压过 preload 的 `button` / `button:hover` 规则。
     *
     * 阴影几何（不得侵入下方工具栏）：`0 2px 0` 是底边厚度（2px），
     * `0 3px 5px -1px` 是投影，可见向下约 3+2.5−1≈4.5px；hover 最深约 5px。
     * 按钮在 40px 标题栏带里垂直居中，下方空隙 6px，故始终留在带内。
     */
    const STYLE_CSS = [
      '/* 硬保险：任何意外溢出都裁在标题栏带内，绝不侵入下方工具栏。 */',
      ':host { overflow: hidden; }',
      'button[' + BUTTON_ATTR + '] {',
      '  box-sizing: border-box;',
      '  background: #2563eb;',
      '  color: #ffffff;',
      '  border-radius: 8px;',
      '  text-align: center;',
      '  cursor: pointer;',
      '  box-shadow:',
      '    inset 0 1px 0 rgba(255, 255, 255, 0.32),',
      '    inset 0 -1px 0 rgba(0, 0, 0, 0.20),',
      '    0 2px 0 0 rgba(0, 0, 0, 0.22),',
      '    0 3px 5px -1px rgba(16, 64, 180, 0.38);',
      '}',
      'button[' + BUTTON_ATTR + ']:hover {',
      '  background: #3b82f6;',
      '  color: #ffffff;',
      '  box-shadow:',
      '    inset 0 1px 0 rgba(255, 255, 255, 0.38),',
      '    inset 0 -1px 0 rgba(0, 0, 0, 0.20),',
      '    0 2px 0 0 rgba(0, 0, 0, 0.24),',
      '    0 3px 6px -1px rgba(16, 64, 180, 0.50);',
      '}',
      'button[' + BUTTON_ATTR + ']:active {',
      '  background: #1d4ed8;',
      '  box-shadow:',
      '    inset 0 2px 3px rgba(0, 0, 0, 0.30),',
      '    0 1px 0 0 rgba(0, 0, 0, 0.22),',
      '    0 1px 2px -1px rgba(16, 64, 180, 0.35);',
      '}',
      'button[' + BUTTON_ATTR + ']:focus-visible {',
      '  outline: 2px solid #ffffff;',
      '  outline-offset: -2px;',
      '}',
      '/* 禁用态：有对话在运行（或状态未知），不允许使能。灰化 + 只留 1px 厚度。 */',
      "button[" + BUTTON_ATTR + "][aria-disabled='true'],",
      "button[" + BUTTON_ATTR + "][aria-disabled='true']:hover,",
      "button[" + BUTTON_ATTR + "][aria-disabled='true']:active {",
      '  background: #7f96b8;',
      '  color: rgba(255, 255, 255, 0.85);',
      '  cursor: not-allowed;',
      '  box-shadow:',
      '    inset 0 1px 0 rgba(255, 255, 255, 0.18),',
      '    inset 0 -1px 0 rgba(0, 0, 0, 0.14),',
      '    0 1px 0 0 rgba(0, 0, 0, 0.16);',
      '}',
    ].join('\n');

    /** 警告弹窗样式（挂在页面层，盖住整个窗口）。 */
    const DIALOG_CSS = [
      '.dshwr-mask {',
      '  position: fixed; inset: 0; z-index: 2147483000;',
      '  background: rgba(15, 18, 24, 0.45);',
      '  display: flex; align-items: center; justify-content: center;',
      '}',
      '.dshwr-card {',
      '  width: min(420px, calc(100vw - 48px)); box-sizing: border-box;',
      '  border-radius: 14px; padding: 22px 24px 18px;',
      '  background: var(--dsw-alias-bg-layer-1, #ffffff);',
      '  color: var(--dsw-alias-label-primary, #1f2328);',
      '  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));',
      '  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);',
      '}',
      '.dshwr-title {',
      '  display: flex; align-items: center; gap: 8px;',
      '  font-size: 16px; font-weight: 600; line-height: 24px; color: #b26a00;',
      '}',
      '.dshwr-text {',
      '  margin-top: 10px; font-size: 14px; line-height: 22px;',
      '  color: var(--dsw-alias-label-secondary, #4b5563);',
      '}',
      '.dshwr-actions { display: flex; justify-content: flex-end; margin-top: 18px; }',
      '.dshwr-ok {',
      '  height: 32px; padding: 0 16px; border: 0; border-radius: 8px;',
      '  background: #2563eb; color: #ffffff; font-size: 14px; cursor: pointer;',
      '  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.18);',
      '}',
      '.dshwr-ok:hover { background: #3b82f6; }',
      '.dshwr-ok:active { background: #1d4ed8; }',
    ].join('\n');

    /** 取桌面端标题栏菜单栏（Electron preload 注入的 open shadow root 内）。 */
    function findMenubar() {
      const host = document.querySelector('[data-windows-menu]');
      const shadow = host ? host.shadowRoot : null;
      if (!shadow) return null;
      const bar = shadow.querySelector('[role="menubar"]');
      return bar ? { shadow: shadow, bar: bar } : null;
    }

    /** 查询当前活跃对话数；任何失败都答「未知」，让调用方保守处理。 */
    async function fetchActive() {
      try {
        const res = await fetch(API, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok || data.ok === false) return { known: false, count: 0 };
        return { known: data.known === true, count: Number(data.count) || 0 };
      } catch (error) {
        return { known: false, count: 0 };
      }
    }

    function apply(ctx) {
      let button = null;
      let styleEl = null;
      let dialogStyleEl = null;
      let observer = null;
      let pendingProbe = null;
      let lastProbe = 0;
      let pollTimer = null;
      let disposed = false;
      /** 最近一次已知的运行中对话数。 */
      let busyCount = 0;
      /** 名册是否可信；false = 未知，按钮保守禁用。 */
      let statusKnown = false;
      /** 异步竞态序号：只认最后一次查询。 */
      let stateVersion = 0;

      // ---------- 警告弹窗 ----------
      function ensureDialogStyle() {
        if (dialogStyleEl) return;
        const existing = document.querySelector('[' + DIALOG_STYLE_ATTR + ']');
        if (existing) { dialogStyleEl = existing; return; }
        const style = document.createElement('style');
        style.setAttribute(DIALOG_STYLE_ATTR, '');
        style.textContent = DIALOG_CSS;
        (document.head || document.body).appendChild(style);
        dialogStyleEl = style;
      }

      function hideWarning() {
        const existing = document.querySelector('[' + DIALOG_ATTR + ']');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      }

      /** count 为数字 = 有 n 个对话在运行；为 null = 状态未知。 */
      function showWarning(count) {
        ensureDialogStyle();
        hideWarning();
        const mask = document.createElement('div');
        mask.setAttribute(DIALOG_ATTR, '');
        mask.setAttribute('role', 'alertdialog');
        mask.setAttribute('aria-modal', 'true');
        mask.setAttribute('class', 'dshwr-mask');

        const card = document.createElement('div');
        card.setAttribute('class', 'dshwr-card');

        const title = document.createElement('div');
        title.setAttribute('class', 'dshwr-title');
        title.textContent = '⚠ 警告';

        const text = document.createElement('div');
        text.setAttribute('class', 'dshwr-text');
        text.textContent = count === null ? WARN_UNKNOWN_TEXT : WARN_TEXT(count);

        const actions = document.createElement('div');
        actions.setAttribute('class', 'dshwr-actions');
        const ok = document.createElement('button');
        ok.setAttribute('class', 'dshwr-ok');
        ok.type = 'button';
        ok.textContent = '知道了';
        ok.addEventListener('click', function () {
          hideWarning();
        });
        actions.appendChild(ok);

        card.appendChild(title);
        card.appendChild(text);
        card.appendChild(actions);
        mask.appendChild(card);
        // 点遮罩关闭，点卡片不关。
        mask.addEventListener('click', function (event) {
          if (event && event.target === mask) hideWarning();
        });

        document.body.appendChild(mask);
        if (typeof ok.focus === 'function') ok.focus();
      }

      function onKeydown(event) {
        if (event && event.key === 'Escape') hideWarning();
      }

      // ---------- 按钮使能态 ----------
      function renderState() {
        if (!button) return;
        if (!statusKnown) {
          button.setAttribute('aria-disabled', 'true');
          button.title = TITLE_UNKNOWN;
        } else if (busyCount > 0) {
          button.setAttribute('aria-disabled', 'true');
          button.title = TITLE_BUSY(busyCount);
        } else {
          button.removeAttribute('aria-disabled');
          button.title = TITLE_READY;
        }
      }

      async function refreshState() {
        const version = ++stateVersion;
        const state = await fetchActive();
        if (disposed || version !== stateVersion) return;
        statusKnown = state.known;
        busyCount = state.count;
        renderState();
      }

      /** 按下按钮：以最新数据权威判定，全静默才刷新，否则弹警告。 */
      async function onPress() {
        const version = ++stateVersion;
        const state = await fetchActive();
        if (disposed || version !== stateVersion) return;
        statusKnown = state.known;
        busyCount = state.count;
        renderState();
        if (!state.known) { showWarning(null); return; }
        if (state.count > 0) { showWarning(state.count); return; }
        window.location.reload();
      }

      // ---------- 挂载 ----------
      /** 把按钮外观样式装进 preload 的同一个 shadow root（幂等）。 */
      function installStyle(shadow) {
        if (styleEl) return;
        const existing = shadow.querySelector('[' + STYLE_ATTR + ']');
        if (existing) { styleEl = existing; return; }
        const style = document.createElement('style');
        style.setAttribute(STYLE_ATTR, '');
        style.textContent = STYLE_CSS;
        shadow.appendChild(style);
        styleEl = style;
      }

      /**
       * 把按钮挂到 menubar 末尾（即「编辑」右侧），并锁死几何尺寸。
       * @returns {boolean} 是否已挂好。
       */
      function mount() {
        if (button) return true;
        const found = findMenubar();
        if (!found) return false;
        installStyle(found.shadow);
        // 幂等：同一 menubar 里只留一个按钮（HMR / 重复 apply 时不叠加）。
        const existing = found.bar.querySelector('[' + BUTTON_ATTR + ']');
        if (existing) { button = existing; return true; }
        const el = document.createElement('button');
        el.type = 'button';
        // 与同栏按钮一致的 menubar 项语义；但它直接执行动作，不弹出子菜单。
        el.setAttribute('role', 'menuitem');
        el.tabIndex = 0;
        el.setAttribute(BUTTON_ATTR, '');
        el.addEventListener('click', function () {
          onPress();
        });
        // 先按上一版文案量出既有宽高，再换成「刷新」并锁死：
        // 去掉「网页」二字后按钮大小、位置都不变（宽度不随文字收缩）。
        el.textContent = LEGACY_LABEL;
        found.bar.appendChild(el);
        const rect = el.getBoundingClientRect();
        const width = rect.width > 0 ? rect.width : FALLBACK_WIDTH;
        const height = rect.height > 0 ? rect.height : FALLBACK_HEIGHT;
        el.textContent = LABEL;
        el.style.boxSizing = 'border-box';
        el.style.width = width + 'px';
        el.style.height = height + 'px';
        button = el;
        renderState();
        return true;
      }

      function stopProbe() {
        if (observer) { observer.disconnect(); observer = null; }
        if (pendingProbe !== null) { clearTimeout(pendingProbe); pendingProbe = null; }
      }

      function probe() {
        pendingProbe = null;
        lastProbe = Date.now();
        if (mount()) stopProbe();
      }

      // preload 在 DOMContentLoaded 前后注入 menubar，与本包的 apply 谁先谁后
      // 不定：先试一次，没等到就观察 DOM 直到它出现（带节流 + 尾随重试）。
      if (!mount()) {
        observer = new MutationObserver(function () {
          const wait = PROBE_INTERVAL_MS - (Date.now() - lastProbe);
          if (wait <= 0) probe();
          else if (pendingProbe === null) pendingProbe = setTimeout(probe, wait);
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }

      // 状态轮询：只管按钮视觉；按下时一定重新查一次。
      refreshState();
      pollTimer = setInterval(function () {
        refreshState();
      }, POLL_MS);
      document.addEventListener('keydown', onKeydown);

      function teardown() {
        disposed = true;
        stopProbe();
        if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
        document.removeEventListener('keydown', onKeydown);
        hideWarning();
        if (button) {
          if (button.parentNode) button.parentNode.removeChild(button);
          button = null;
        }
        if (styleEl) {
          if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
          styleEl = null;
        }
        if (dialogStyleEl) {
          if (dialogStyleEl.parentNode) dialogStyleEl.parentNode.removeChild(dialogStyleEl);
          dialogStyleEl = null;
        }
      }

      if (typeof ctx.effect === 'function') ctx.effect(() => teardown, 'dsh-desktop-web-refresh: 刷新按钮');
      return teardown;
    }

    return { inject: [], apply };
  },
});
