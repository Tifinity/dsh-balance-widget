# dsh-balance-widget

DeepSeek Harness 客户端插件：在输入框下方的 composer dock 里实时显示 **账户余额**，并用颜色和小字标记当前处于 **高峰时段** 还是 **空闲时段**。

```
● ¥12.34 · 空闲 2h15m
```

- 圆点：绿色 = 空闲，橙色 = 高峰
- 金额：充值余额（CNY 优先；多币种在悬停提示里展开）
- 剩余时间：距离下一次时段切换还有多久，每秒刷新
- 悬停：完整明细（赠金、更新时间、判定原因、下次切换时间）
- 点击：立即刷新余额

## 时段规则

全部按 **北京时间（Asia/Shanghai，固定 UTC+8）** 判定：

| 条件 | 结果 |
| --- | --- |
| 周一至周五 09:00–12:00、14:00–18:00，且不是法定节假日 | 高峰 |
| 周一至周五 12:00–14:00、18:00–次日 09:00 | 空闲 |
| 周末全天 | 空闲 |
| 中国法定节假日全天 | 空闲 |

边界为左闭右开：12:00 整、18:00 整已经是空闲；09:00 整、14:00 整进入高峰。

「调休补班」的周末按周末处理（仍为空闲），因为规则是“周一至周五（不含法定节假日）”，而不是“国务院放假安排里的上班日”。

### 节假日数据

静态表在 [`src/core.js`](src/core.js) 的 `HOLIDAY_RANGES`，目前覆盖 **2025、2026** 年，来源为中国政府网发布的国务院办公厅通知：

- [2025 年放假安排（国办发明电〔2024〕12号）](https://www.gov.cn/zhengce/content/202411/content_6986382.htm)
- [2026 年放假安排（国办发明电〔2025〕7号）](https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm)

每年 11 月左右国务院会公布下一年安排。把新的年份追加到 `HOLIDAY_RANGES` 即可：

```js
2027: [
  ['2027-01-01', '2027-01-03', '元旦'],
  // …
],
```

没有覆盖到的年份不会报错：只按周末判断，悬停提示会注明“节假日数据未覆盖该年份”。

## 余额从哪里来

通过 Harness 的 `account` Remote 调用 `getBalance`（与「设置 → 账号与余额」同一数据源，即 DeepSeek 开放平台钱包）。因此：

- 需要在 Harness 里登录 **DeepSeek 账号**；只用 API Key 时没有余额接口，控件显示「未登录 / 余额不可用」。
- 余额每 **30 秒**刷新一次，窗口重新获得焦点、页面从后台恢复、点击控件时也会立即刷新。计时器在 `document.hidden` 时暂停，避免无意义请求。
- 金额格式与开放平台一致：两位小数、千分位、正数截断到分、不足一分显示 `<¥0.01`，负数按远离零舍入且绝对值不小于 0.01。

## 安装

这是一个 DSH profile 插件（bundle）。两种方式任选。

### 方式 A：plugin_manager 工具（有该工具时）

让 Agent 执行 `plugin_manager`：

```json
{ "action": "install_bundle", "target": "/绝对路径/dsh-balance-widget" }
```

安装会同时把 bundle 写进 profile，并在 HMR 开启时直接生效。

### 方式 B：CLI（没有 plugin_manager 时）

```sh
dsh plugin --profile desktop add /绝对路径/dsh-balance-widget
```

包声明了 `dsh.bundle.patch`，因此这条命令会同时完成两件事：把包加进 profile 依赖（`link:` 到本地目录），并把 `dsh-balance-widget` 追加到 `dsh.profile.bundles`。bundle 的 [`cordis.patch.yml`](cordis.patch.yml) 再插入插件行。profile 开启 HMR 时立即生效；本机安装时就是热加载，无需重启。

卸载：从 profile 的 `package.json` 依赖和 `dsh.profile.bundles` 中移除该包名，然后 `pnpm install`。

### 本机状态

已安装到 `desktop` profile 并在运行中的 GUI 里验证：输入框下方实际渲染为 `¥xx.xx · 空闲 1天17小时`（周六），悬停标题包含「更新于 / 时段: 周末 / 距离进入高峰 11-02 09:00」。余额与「设置 → 账号与余额」一致。

## 开发

纯 JavaScript，无构建依赖：

```sh
npm test        # node --test，直接测试 src/core.js
npm run build   # 把 src/core.js 内联进 client.js
npm run check   # build + 语法检查 + 测试
```

- `src/core.js`：时段/节假日/金额格式的纯逻辑，不含 DOM，可在 Node 里测试。
- `src/client.template.js`：浏览器模块（React + slots 注册 + 轮询）。
- `client.js`：构建产物，安装时加载的就是它。**改完 src 记得 `npm run build`。**
- `test/core.test.js`：边界、节假日、跨周末、跨长假、金额格式的用例。

### 实现要点

- 客户端模块用 `window.__ModuleLoader__.load({ id, factory })`，`id` 与包名一致。
- 通过 `ctx.slots.inject('conversation.composer.dock', …)` 注册，`id: 'balance-widget'`、`order: 2`（排在宿主 `activity`、`usage` 之后）。
- 文案走 `ctx.locale.register` 与槽位的 `locale` 选项，中英双语。
- 余额调用携带 `{ version, locale, timezoneOffsetSeconds }`，与宿主账号页一致；`version` 是该构建的客户端版本号，升级 Harness 后可按需同步。
- 时段计算不依赖系统时区，也不使用 `Intl`：把时间戳加 8 小时后用 UTC 字段读取，得到的就是北京时间。

## 已知限制

- 余额接口依赖登录态与网络；失败时显示「余额不可用」，悬停可看最近一次成功时间之外的说明。
- 节假日是静态表，跨年后需要按官方通知补一行；未覆盖年份只按周末判断。
- 每 30 秒一次 `get_user_summary` 请求；如果平台限流，可调大 `client.js` 里的 `REFRESH_INTERVAL_MS` 后重新构建。

## License

MIT
