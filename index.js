/**
 * Host half of dsh-desktop-web-refresh.
 *
 * 「刷新」按钮必须先确认**没有任何对话正在运行**才能按下（用户要求：刷新会把
 * 运行中的对话截断）。浏览器半拿不到 Host 的 agent 名册，所以这里开一个小查询：
 *
 *   GET /plugins/dsh-desktop-web-refresh/api/active
 *   → { ok: true, known: true,  count: 2, running: [{ id, title }] }
 *   → { ok: true, known: false, count: 0, running: [] }   // 拿不到名册时如实说「未知」
 *
 * 「正在运行」的判据与桌面壳的退出检查（quit inspection）一致：agent 的
 * status 是 'running'，或者 inbox 里还排着 nextTurn / nextStep —— 只要还有
 * 没跑完的工作就算活跃，不允许刷新。
 *
 * 拿不到 agents 服务时如实答复 known:false，浏览器半会保守地把按钮留在禁用态：
 * 只有确认全静默才允许 refresh，宁可少刷不可误刷。
 */
export const name = 'dsh-desktop-web-refresh';

/** 只依赖 web 服务器；agents 服务用 ctx.get 读取，缺失时降级为「未知」。 */
export const inject = ['webServer'];

const API_PREFIX = '/plugins/dsh-desktop-web-refresh/api';

/** 一个对话是否仍在活跃（running，或还有排队未跑的工作）。 */
function isActive(agent) {
  if (!agent) return false;
  if (agent.status === 'running') return true;
  const inbox = agent.inbox;
  if (!inbox) return false;
  const turn = inbox.nextTurn;
  const step = inbox.nextStep;
  return (Array.isArray(turn) && turn.length > 0) || (Array.isArray(step) && step.length > 0);
}

/** 弹窗只要 n 与标题，这里带上 id / title 供排查。 */
function runningView(agent) {
  const id = String(agent.id ?? '');
  return { id, title: String(agent.title ?? agent.name ?? id) };
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

export function apply(ctx) {
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: API_PREFIX + '/active',
      handler: (req, res) => {
        try {
          const agents = ctx.get('agents');
          if (!agents || typeof agents.list !== 'function') {
            sendJson(res, 200, { ok: true, known: false, count: 0, running: [] });
            return;
          }
          const running = agents.list().filter(isActive).map(runningView);
          sendJson(res, 200, { ok: true, known: true, count: running.length, running });
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message || error) });
        }
      },
    });
    return () => dispose();
  });
}
