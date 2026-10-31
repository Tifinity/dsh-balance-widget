window.__ModuleLoader__.load({
  id: 'dsh-balance-widget',
  factory(require) {
    const React = require('react');
    const { useCallback, useEffect, useMemo, useRef, useState } = React;
    const h = React.createElement;

    /*__CORE__*/

    const NS = 'balance-widget';
    const REFRESH_INTERVAL_MS = 30_000;
    /** Matches the DSH build this plugin was written against; only sent as a Platform client header. */
    const CLIENT_VERSION = '0.2.1-rc.3';

    const zh = {
      balance: '余额',
      rechargeBalance: '充值余额',
      bonusBalance: '赠金余额',
      peak: '高峰',
      idle: '空闲',
      peakFull: '高峰时段',
      idleFull: '空闲时段',
      'reason.weekend': '周末',
      'reason.holiday': '法定节假日',
      'reason.peak-window': '高峰时段',
      'reason.off-hours': '非高峰时段',
      loading: '读取中',
      signedOut: '未登录',
      unavailable: '余额不可用',
      noWallet: '—',
      updated: '更新于',
      refreshHint: '点击刷新余额',
      signInHint: '在 设置 → 账号与余额 登录 DeepSeek 账号后显示余额',
      coverage: '节假日数据未覆盖该年份，仅按周末判断',
      nextToPeak: '距离进入高峰',
      nextToIdle: '距离进入空闲',
      status: '时段',
      left: '剩余',
    };

    const en = {
      balance: 'Balance',
      rechargeBalance: 'Recharge balance',
      bonusBalance: 'Bonus balance',
      peak: 'Peak',
      idle: 'Idle',
      peakFull: 'Peak hours',
      idleFull: 'Idle hours',
      'reason.weekend': 'weekend',
      'reason.holiday': 'statutory holiday',
      'reason.peak-window': 'peak hours',
      'reason.off-hours': 'outside peak hours',
      loading: 'Loading',
      signedOut: 'Signed out',
      unavailable: 'Unavailable',
      noWallet: '—',
      updated: 'Updated',
      refreshHint: 'Click to refresh the balance',
      signInHint: 'Sign in to DeepSeek under Settings → Account to show the balance',
      coverage: 'Holiday data does not cover this year; weekends only',
      nextToPeak: 'Peak in',
      nextToIdle: 'Idle in',
      status: 'Window',
      left: 'left',
    };

    function isChinese(locale) {
      return typeof locale === 'string' && /^zh/i.test(locale);
    }

    function walletSymbol(currency) {
      if (currency === 'CNY') return '¥';
      if (currency === 'USD') return '$';
      return `${currency} `;
    }

    /** @param {{currency: string, balance: string}} wallet */
    function walletText(wallet) {
      const amount = formatAmount(wallet.balance);
      if (amount === null) return null;
      const symbol = walletSymbol(wallet.currency);
      return amount === '<0.01' ? `<${symbol}0.01` : `${symbol}${amount}`;
    }

    function primaryWallet(wallets) {
      return wallets.find((wallet) => wallet.currency === 'CNY') ?? wallets[0] ?? null;
    }

    function compactDuration(ms, locale) {
      const parts = durationParts(ms);
      if (isChinese(locale)) {
        if (parts.days > 0) return `${parts.days}天${parts.hours}小时`;
        if (parts.hours > 0) return `${parts.hours}小时${parts.minutes}分`;
        return `${Math.max(1, parts.minutes)}分钟`;
      }
      if (parts.days > 0) return `${parts.days}d ${parts.hours}h`;
      if (parts.hours > 0) return `${parts.hours}h ${parts.minutes}m`;
      return `${Math.max(1, parts.minutes)}m`;
    }

    function fullDuration(ms, locale) {
      const parts = durationParts(ms);
      if (isChinese(locale)) {
        if (parts.days > 0) return `${parts.days} 天 ${parts.hours} 小时`;
        if (parts.hours > 0) return `${parts.hours} 小时 ${parts.minutes} 分`;
        if (parts.minutes > 0) return `${parts.minutes} 分 ${parts.seconds} 秒`;
        return `${parts.seconds} 秒`;
      }
      if (parts.days > 0) return `${parts.days}d ${parts.hours}h`;
      if (parts.hours > 0) return `${parts.hours}h ${parts.minutes}m`;
      if (parts.minutes > 0) return `${parts.minutes}m ${parts.seconds}s`;
      return `${parts.seconds}s`;
    }

    /** Metadata every account Remote method carries. */
    function accountClient(ctx) {
      return {
        version: CLIENT_VERSION,
        locale: ctx.locale.getSnapshot().active,
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      };
    }

    const CSS = `
.dshbw-anchor{min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}
.dshbw-pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}
.dshbw-pill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dshbw-pill:focus-visible{outline:2px solid var(--dsw-alias-state-focus-ring,#2f6fed);outline-offset:-1px}
.dshbw-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#16a34a)}
.dshbw-dot[data-state="peak"]{background:var(--dsw-alias-state-warning-primary,#d97706)}
.dshbw-amount{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.dshbw-sep{color:var(--dsw-alias-separator-primary);margin:0 1px}
.dshbw-slot{font-variant-numeric:normal}
.dshbw-remaining{color:var(--dsw-alias-label-tertiary);opacity:.85}
.dshbw-spinner{flex:none;width:9px;height:9px;border-radius:50%;border:1.5px solid var(--dsw-alias-separator-primary,currentColor);border-top-color:transparent;animation:dshbw-spin .8s linear infinite}
@keyframes dshbw-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.dshbw-spinner{animation:none}}
`;

    function createBalancePill(ctx) {
      return function BalancePill({ t }) {
      const locale = (() => {
        try {
          return ctx.locale.getSnapshot().active;
        } catch {
          return 'zh-CN';
        }
      })();
      const fallback = isChinese(locale) ? zh : en;
      const tr = (key) => (typeof t === 'function' ? t(key) : (fallback[key] ?? key));

      const [state, setState] = useState({ phase: 'loading' });
      const [now, setNow] = useState(() => Date.now());
      const [refreshing, setRefreshing] = useState(false);
      const requestSeq = useRef(0);
      const mounted = useRef(false);

      const refresh = useCallback(async () => {
        const id = ++requestSeq.current;
        if (mounted.current) setRefreshing(true);
        try {
          const result = await ctx.remote.account.getBalance(accountClient(ctx));
          if (!mounted.current || id !== requestSeq.current) return;
          if (!result || result.ok !== true) {
            setState({ phase: 'error' });
          } else if (result.value === null || result.value === undefined) {
            setState({ phase: 'signed-out' });
          } else if (result.value.status === 'ready') {
            setState({
              phase: 'ready',
              wallets: Array.isArray(result.value.value) ? result.value.value : [],
              bonusWallets: Array.isArray(result.value.bonusWallets) ? result.value.bonusWallets : [],
              at: Date.now(),
            });
          } else {
            setState({ phase: 'error' });
          }
        } catch {
          if (mounted.current && id === requestSeq.current) setState({ phase: 'error' });
        } finally {
          if (mounted.current && id === requestSeq.current) setRefreshing(false);
        }
      }, []);

      useEffect(() => {
        mounted.current = true;
        refresh();
        const timer = setInterval(() => {
          if (!document.hidden) refresh();
        }, REFRESH_INTERVAL_MS);
        const onVisibility = () => {
          if (!document.hidden) refresh();
        };
        const onFocus = () => refresh();
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('focus', onFocus);
        return () => {
          mounted.current = false;
          clearInterval(timer);
          document.removeEventListener('visibilitychange', onVisibility);
          window.removeEventListener('focus', onFocus);
        };
      }, [refresh]);

      useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
      }, []);

      const minuteKey = Math.floor(now / 60_000);
      // Peak/idle only changes on a minute boundary; recomputing per minute keeps
      // the scan out of the one-second clock tick while the countdown stays live.
      const slot = useMemo(() => slotAt(now), [minuteKey]); // eslint-disable-line react-hooks/exhaustive-deps

      const ready = state.phase === 'ready';
      const wallets = ready ? state.wallets : [];
      const bonusWallets = ready ? state.bonusWallets.filter((wallet) => formatAmount(wallet.balance) !== '0.00' && formatAmount(wallet.balance) !== null) : [];
      const primary = primaryWallet(wallets);
      const amountText = ready
        ? (primary === null ? tr('noWallet') : walletText(primary) ?? tr('noWallet'))
        : state.phase === 'loading'
          ? tr('loading')
          : state.phase === 'signed-out'
            ? tr('signedOut')
            : tr('unavailable');

      const statusLabel = slot.peak ? tr('peak') : tr('idle');
      const remaining = slot.next === null ? null : Math.max(0, slot.next.at - now);

      const lines = [];
      lines.push(`${tr('rechargeBalance')}: ${ready && primary !== null ? (walletText(primary) ?? '—') : amountText}`);
      for (const wallet of bonusWallets) {
        lines.push(`${tr('bonusBalance')} (${wallet.currency}): ${walletText(wallet) ?? '—'}`);
      }
      for (const wallet of wallets) {
        if (wallet !== primary) lines.push(`${wallet.currency}: ${walletText(wallet) ?? '—'}`);
      }
      if (ready) lines.push(`${tr('updated')}: ${beijingTime(state.at)}`);
      const reason = slot.holidayName === null ? tr(`reason.${slot.reason}`) : `${tr('reason.holiday')} · ${slot.holidayName}`;
      lines.push(`${tr('status')}: ${reason}`);
      if (slot.next !== null) {
        lines.push(
          `${slot.next.peak ? tr('nextToPeak') : tr('nextToIdle')}: ${beijingClock(slot.next.at)} (${fullDuration(slot.next.at - now, locale)})`,
        );
      }
      if (!slot.covered) lines.push(`${tr('coverage')}: ${slot.parts.year}`);
      if (state.phase === 'signed-out') lines.push(tr('signInHint'));
      lines.push(tr('refreshHint'));

      const title = lines.join('\n');
      const aria = `${tr('balance')} ${amountText} · ${statusLabel}${remaining === null ? '' : ` · ${compactDuration(remaining, locale)}`}`;

      return h(
        React.Fragment,
        null,
        h('style', { 'data-dsh-balance-widget': '' }, CSS),
        h(
          'span',
          { className: 'dshbw-anchor', 'data-composer-stat': 'balance-widget' },
          h(
            'button',
            {
              type: 'button',
              className: 'dshbw-pill',
              title,
              'aria-label': aria,
              'aria-busy': refreshing || undefined,
              onClick: refresh,
            },
            h('span', {
              className: 'dshbw-dot',
              'data-state': slot.peak ? 'peak' : 'idle',
              'aria-hidden': true,
            }),
            h('span', { className: 'dshbw-amount' }, amountText),
            h('span', { className: 'dshbw-sep' }, '·'),
            h('span', { className: 'dshbw-slot' }, statusLabel),
            remaining === null
              ? null
              : h('span', { className: 'dshbw-remaining' }, compactDuration(remaining, locale)),
            refreshing ? h('span', { className: 'dshbw-spinner', 'aria-hidden': true }) : null,
          ),
        ),
      );
      };
    }

    return {
      inject: ['slots', 'remote', 'remote.account', 'locale'],
      apply(ctx) {
        const BalancePill = createBalancePill(ctx);
        ctx.effect(
          () => ctx.locale.register(NS, { zh, en }),
          'balance-widget: dictionaries',
        );
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'balance-widget',
              order: 2,
              locale: NS,
            },
            BalancePill,
          ),
        );
      },
    };
  },
});
