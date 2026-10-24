# 麦门省一单 · M-SAVE ONE

> 麦当劳一屏省钱助手：打开就省，不用配置，不用比价，不用来回跳转。

**M-CODE 2026 麦当劳程序员创意开发大赛参赛作品 · 省钱赛道整合方案**

![麦门省一单界面](docs/screenshot.png)

## 在线体验

- 演示站：<http://47.94.222.72/maimen/>
- 当前为演示数据模式；实时 MCP 配置见 [MCP_INTEGRATION.md](./MCP_INTEGRATION.md)。

## 参赛状态

- 报名 Issue：[M-China/mcd-developer-innovation-challenge#1182](https://github.com/M-China/mcd-developer-innovation-challenge/issues/1182)
- 线上演示：<http://47.94.222.72/maimen/>
- 当前部署为演示数据模式；配置服务端 MCP Token 后可切换实时数据。

---

## 一、产品定位

「麦门省一单」不是又一个券库，也不是点餐 App 的替代品。它把麦当劳点餐前最费时的四件事——**查门店、领券、比价、核价**——压缩成**一个输入、一次点击、三套方案**。

- **一个入口**：预算、目标、人数、忌口在一个页面里完成。
- **一个引擎**：预算 / 热量 / 蛋白质 / 人数 / 忌口同时进入确定性优化器。
- **一屏完成**：最省、最饱、最均衡三套方案，带商品明细、券后价、积分抵扣和凑单陷阱提示。
- **零客户端配置**：MCP Token 只放在服务端，终端用户打开网页即可使用，不需要安装 MCP Client、不需要填写 Token。
- **不跳转完成决策**：从打开到看到最优方案，所有计算和选择都在同一页完成；支付按官方合规要求前往麦当劳官方渠道。

**目标用户**：价格敏感的学生 / 上班族、健身控卡人群、2–4 人小团队、需要快速决定“今天怎么点”的普通用户。

**一句话差异**：别人帮你查“有哪些券”，麦门省一单直接告诉你“这一单怎么买、用哪张券、凑不凑、最后付多少”。

---

## 二、前十名省钱项目的能力整合

| 来源项目 | 被整合的能力 | 在「麦门省一单」中的落点 |
|---|---|---|
| mcd-saver-strategist | 四路券池合并 + 组合优化 + 官方核价闭环 | 券池归一化、候选枚举、`calculate-price` 核价 |
| mcd-budget-meal | 预算内多份餐单、换饮料重算 | 三套预算内方案、加购/替换后的重新求解 |
| mcd-coupon-strategist | 凑单陷阱检测 | 计算“为触发满减加购”前后的实付差，提示避开陷阱 |
| mcd-budget-planner | 预算 + 营养双约束、门店券可用性 | 金额/热量/蛋白质联合约束，券按门店与模式过滤 |
| mcd-deal-detective | 单点 / 套餐 / 券 / 开卡四种买法比价 | 单点、套餐、1+1、加购组合统一进入候选池 |
| mcd-compass | 轻量精算入口 | 默认预算 + 一键算，零表单也能出结果 |
| maimai-saver | 领券 → 选券 → 双价比价 → 积分抵扣四步 | 自动选最优券、积分抵扣、原价/券后/实付拆解 |
| mcd-hui-life | 金额 + 热量双预算、最近可下单门店 | 双预算约束、门店锚点、确认卡式结果 |
| mcd-optimizer | 预算/热量/人数/忌口多约束求解 | 多人数量缩放、忌口标签过滤、三方案选择 |
| mcd-saver-planner | 全渠道最低到手价、多渠道比较 | 自取/外送费用计入，整单实付排序 |

### 执行自动化边界

- **领券**：只做“确认后领取单张最优券”，不做全量自动领券。演示模式模拟领取；实时模式仅在单用户私有模式解锁后调用 `auto-bind-coupons`。
- **下单**：只做“确认后创建待支付订单”，不做无人值守下单。实时模式调用 `create-order`，支付仍在麦当劳官方渠道完成。
- **支付**：不自动支付。MCP 不提供支付工具，支付必须由用户在官方页面完成。
- **取消/退款**：可取消未支付重复订单；已支付订单不自动取消或退款，走官方客服。
- **固定套餐复购**：支持金额上限、每日次数、间隔和随时关闭；自动复购默认关闭，达到上限自动暂停。
- **不伪造实时价格**：演示模式使用明确标注的示例数据；实时模式金额以官方 `calculate-price` 为准。

### 执行能力与安全开关

| 能力 | 演示模式 | 实时私有模式 |
|---|---|---|
| 报价快照 | 可用 | 可用 |
| 领取单张最优券 | 模拟 | `ENABLE_COUPON_CLAIM=true` + 解锁 |
| 创建待支付订单 | 模拟 | `ENABLE_ORDER_CREATE=true` + 解锁 |
| 订单状态轮询 | 模拟 | 调用 `query-order` |
| 取消未支付订单 | 可用 | `cancel-order` |
| 重复订单对账 | 自动取消演示重复单 | 需 `ENABLE_AUTO_CANCEL_UNPAID=true` |
| 固定套餐复购 | 模拟 | `ENABLE_AUTO_REPURCHASE=true` + 单用户私有模式 |

实时写操作必须同时满足：`ENABLE_WRITE=true`、`SINGLE_USER_MODE=true`、`WRITE_PASSCODE` 非空，并在页面解锁。所有写操作受 `MAX_ORDER_CENTS`、`MAX_DAILY_ORDERS` 和固定套餐自身上限约束。

> 界面截图（`docs/*.png`）为 1.1.0 版本，管家模块合并执行中心与提醒中心后布局有调整，以实际页面为准。

---

## 三、关键用户路径

### 路径 1：3 秒最省（默认路径）

1. 打开页面，默认「上海 · 人民广场 / ¥30 / 最省 / 1 人」。
2. 点「一键算最省」。
3. 页面依次显示：定位门店 → 读取菜单 → 合并券包 → 逐组核价 → 生成方案。
4. 得到三张卡：最省、最饱、最均衡。
5. 点「选这套」→「复制清单」→ 前往麦当劳官方渠道下单。

**全程 0 配置、0 登录、0 页面跳转。**

### 路径 2：目标导向

- 选「吃饱」：优先热量与满足感，预算内选最扛饿的组合。
- 选「高蛋白」：优先蛋白质，适合健身/增肌。
- 选「控卡」：优先低热量，可叠加 600/800 kcal 上限。

### 路径 3：多人 / 办公室

- 选 2–4 人，输入总预算。
- 优化器按人数缩放餐品数量，给出整单实付与人均价格。
- 适合办公室拼单、宿舍合点、小组下午茶。

### 路径 4：忌口 / 特殊需求

- 「不吃牛肉」「不吃辣」「不喝奶」三个标签做硬过滤。
- 过滤后仍会重新求解，不会返回含忌口成分的“看起来便宜”的方案。

### 路径 5：外送 vs 自取

- 切换「到店自取 / 麦乐送」。
- 外送会额外计入配送费和包装费，再参与整单比价。
- 同一套餐品可以直观看到“多花多少钱换送上门”。

### 路径 6：分享与复用

- 「复制清单」：生成可直接发给饭搭子的文本。
- 「分享战报」：调用系统分享或复制战报。
- 「我的省钱记录」：本机保存最近 20 次模拟节省，随时回看。

### 路径 7：确认后执行

1. 在结果页点「一键算最省」，管家自动备单：服务端生成报价快照，锁定门店、餐品、券和金额（5 分钟有效）。
2. 报价含最优券时，管家自动领取（演示模拟；私有实时需解锁），状态条显示「券已领」。
3. 点状态条或底部条的「确认下单」→ 出现确认卡（方案、门店、取餐方式、券、实付）。
4. 点「确认生成待支付订单」；创建前再次核价，价格变化会中止并要求重新确认（无需勾选复选框）。
5. 订单卡里打开官方支付、刷新状态、取消未支付订单；演示模式可模拟支付，管家每 5 秒轮询一次。
6. 报价剩余不足 30 秒时管家自动续期；支付提醒、券到期、重复订单对账都在管家中心「待办」里。

### 路径 8：固定套餐复购

1. 在管家中心「这一单」点「存为固定套餐」。
2. 设置单次金额上限、每日最多复购次数、复购间隔。
3. 自动复购默认关闭；开启后达到每日上限会自动暂停。
4. 可随时在管家中心「权益与固定套餐」关闭或删除；实时自动复购只在单用户私有模式生效。

---

## 四、产品界面与交互原则

1. **一屏只留一个主按钮**：所有复杂参数折叠在「更多选项」里，默认路径只需要点一次。
2. **结果先给结论**：大字号实付价、省多少钱、三套方案，不先给长表格。
3. **管家只接管重复动作**：算完之后，备单、领券、续报价、轮询、对账自动衔接；用户只保留「算」和「确认下单」两次主动操作。
4. **状态条说人话**：结果区顶部一条状态（管家已接管 / 报价倒计时 / 券已领 / 数据模式），右侧永远是当前唯一该做的动作。
5. **自动化的开关是诚实的**：端上 5 项可逐项关闭并持久化；服务端 3 项只展示门控说明，不给无效开关。
6. **金额可拆解**：每套方案都能展开商品小计、配送费、包装费、券、积分和实付。
7. **不确定性显式化**：演示价、实时核价、本地试算、营养待匹配、演示管道都有明确标签。
8. **移动端优先**：360px 宽度可用，底部固定条承接「确认下单」，复制清单退到方案明细弹窗。
9. **可安装（HTTPS/localhost）**：PWA manifest + service worker，在 HTTPS 或 localhost 下可添加到主屏幕；当前纯 IP HTTP 部署下仍可正常使用，但浏览器不启用 Service Worker。

---

## 五、技术架构

```text
浏览器（PWA 单页）
  │  仅提交：预算 / 目标 / 人数 / 取餐方式 / 忌口
  ▼
Node.js 18 HTTP 服务（无框架）
  ├─ 静态资源 + 安全响应头 + 限流
  ├─ 确定性优化器（lib/optimizer.js）
  │    ├─ 候选枚举：单点 / 套餐 / 1+1 / 加购 / 多人缩放
  │    ├─ 券匹配：门槛、门店、模式、品类、指定商品
  │    ├─ 积分抵扣：最多抵订单 20%
  │    ├─ 凑单陷阱：加购前后实付对比
  │    └─ 三方案选择：最省 / 最饱 / 最均衡
  └─ 可选实时 MCP 适配器（lib/mcp-live.js）
       ├─ query-nearby-stores
       ├─ query-meals
       ├─ query-store-coupons
       ├─ list-nutrition-foods
       └─ calculate-price
```

- **无框架**：Node 内置 `http`，部署轻、启动快、依赖少。
- **确定性计算**：优化器不使用 LLM 猜价格，所有金额来自菜单价、券规则和官方核价。
- **服务端 Token**：MCP Token 只在服务端环境变量，浏览器永远拿不到。
- **双模式**：未配置 Token 时使用演示数据；配置 Token 后可切换实时 MCP，异常自动降级并提示。
- **PWA（HTTPS/localhost）**：静态资源离线缓存；API 不缓存，避免展示过期价格。纯 IP HTTP 访问下浏览器不启用 Service Worker，但页面功能不受影响。

### 目录

```text
maimen-save-one/
  server.js                 # HTTP 服务、API、静态资源、限流与安全头
  lib/
    demo-data.js            # 演示门店、菜单、套餐、券、积分、活动
    optimizer.js            # 确定性省钱优化器
    action-service.js       # 报价、领券、订单、提醒、对账、固定套餐
    steward.js              # 管家聚合视图（纯函数：管道状态、自动化目录、最近报价/订单摘要）
    live-config.js          # Token 形状校验、错误分类、0600 落盘与读取
    runtime-store.js        # JSON 持久化 + 写队列 + 审计
    mcp-live.js             # 麦当劳 MCP 实时适配器（只读 + 私有写操作 + 调用轨迹）
  data/                     # 运行时数据（gitignored，不提交）
  public/
    index.html              # 单页应用
    styles.css              # 移动端优先样式
    app.js                  # 交互、管家编排、管家中心、PWA
    manifest.webmanifest    # PWA 清单
    sw.js                   # Service Worker
    icons/                  # 应用图标
  test/
    optimizer.test.js       # 9 项优化器测试
    action-service.test.js  # 5 项执行/订单/复购测试
    steward.test.js         # 9 项管家视图测试（管道推导 / 摘要 / 门控矩阵）
    live-config.test.js     # 6 项 Token 校验、错误分类与落盘测试
  MCP_INTEGRATION.md        # MCP 工具、调用流程与业务价值
  CONTEST_DECLARATION.md    # 官方参赛声明（内容未修改）
```

---

## 六、本地运行

```bash
cd maimen-save-one
cp .env.example .env
# 可选：编辑 .env，填入 MCD_MCP_TOKEN 并设置 ENABLE_LIVE=true
npm install                 # 仅实时 MCP 模式需要
npm test
npm start
# 打开 http://127.0.0.1:8899/
```

默认 `ENABLE_LIVE=false`，无需 Token 即可体验完整交互。接入实时数据有两条路：

**方式一（推荐给终端用户）：在页面上填。**

打开首页的「接入麦当劳 MCP」卡片 → 粘贴 Token → 点「保存并校验」。服务端会立即连接 MCP 并试调一个只读工具，通过后才写入 `data/live-token.json`（权限 `0600`，已 gitignore），页面随即切换到实时数据。

**方式二（推荐给部署者）：用环境变量。**

```bash
MCD_MCP_TOKEN=你的_MCP_Token
ENABLE_LIVE=true
```

> Token 只存在服务端（环境变量或 `data/live-token.json`），不会写入浏览器存储、不会出现在任何 API 响应里。环境变量优先于页面保存的值。
> 想彻底关闭页面填写入口，设 `DISABLE_LIVE_SETUP=true`。
> 实时模式下**写操作**（领券、下单）仍然需要单用户私有模式 + 口令解锁，这是刻意保留的安全边界。

---

## 七、生产部署

推荐使用 systemd + Nginx 反向代理，应用只监听 `127.0.0.1`：

```bash
# 1. 目录与用户
useradd --system --no-create-home --shell /sbin/nologin mcdsaver || true
mkdir -p /opt/mcd-saver
# 将本项目上传到 /opt/mcd-saver
chown -R mcdsaver:mcdsaver /opt/mcd-saver

# 2. 安装依赖（仅实时模式需要）
cd /opt/mcd-saver
npm install --omit=dev

# 3. 配置
cp .env.example .env
chmod 600 .env
chown mcdsaver:mcdsaver .env

# 4. systemd
cat >/etc/systemd/system/mcd-saver.service <<'EOF'
[Unit]
Description=Maimen Save One - McDonald's savings assistant
After=network.target

[Service]
Type=simple
User=mcdsaver
Group=mcdsaver
WorkingDirectory=/opt/mcd-saver
EnvironmentFile=/opt/mcd-saver/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now mcd-saver

# 5. Nginx（示例：挂在 /maimen/ 路径）
# 在现有 server 块中加入：
# location = /maimen { return 302 /maimen/; }
# location /maimen/ {
#   proxy_pass http://127.0.0.1:8899/;
#   proxy_http_version 1.1;
#   proxy_set_header Host $host;
#   proxy_set_header X-Real-IP $remote_addr;
#   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
#   proxy_read_timeout 60s;
# }
nginx -t && systemctl reload nginx
```

### 验证

```bash
curl -s http://127.0.0.1:8899/api/health
curl -s http://127.0.0.1:8899/api/bootstrap
curl -s -X POST http://127.0.0.1:8899/api/optimize \
  -H 'Content-Type: application/json' \
  -d '{"budgetCents":3000,"goal":"save","people":1,"mode":"pickup"}'
```

### 执行 API

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/capabilities` | 当前数据模式与写操作开关 |
| GET | `/api/live/status` | 实时接入状态：是否连接、来源（env/stored）、上次校验时间与错误 |
| POST | `/api/live/token` | 校验并保存 Token（同源 + 5 次/分钟限流；校验通过才落盘） |
| POST | `/api/live/disconnect` | 断开实时连接并清除页面保存的 Token |
| GET | `/api/steward` | 管家聚合视图：模式、MCP 管道 5 步、8 项自动化、最近报价/订单摘要 |
| POST | `/api/quote` | 生成报价快照与一次性确认令牌 |
| POST | `/api/coupons/claim` | 领取报价中的单张最优券 |
| POST | `/api/orders` | 创建待支付订单 |
| GET | `/api/orders/:id` | 查询/轮询订单状态 |
| POST | `/api/orders/:id/cancel` | 取消未支付订单 |
| POST | `/api/orders/:id/mock-pay` | 演示模式模拟支付 |
| POST | `/api/orders/reconcile` | 重复未支付订单对账 |
| GET | `/api/reminders` | 支付、券到期、报价过期等提醒 |
| POST | `/api/reminders/:id/read` | 标记提醒已读 |
| GET | `/api/account` | 积分、券包、活动 |
| GET/POST | `/api/subscriptions` | 查看/创建固定套餐 |
| POST | `/api/subscriptions/:id/toggle` | 开启/暂停固定套餐 |
| POST | `/api/subscriptions/:id/run` | 立即复购（受上限约束） |
| DELETE | `/api/subscriptions/:id` | 删除固定套餐 |
| GET | `/api/audit` | 最近写操作审计 |
| POST | `/api/private/unlock` | 解锁单用户私有模式 |
| POST | `/api/private/lock` | 锁定私有模式 |

---

## 八、数据与安全边界

- 演示数据为示例，不代表真实门店库存、价格或优惠；实际以麦当劳官方渠道为准。
- 实时模式默认只读；写操作只在单用户私有模式解锁后开启，受金额、频次和 kill switch 限制。
- 每次写操作都需要报价快照与一次性确认令牌；创建订单前二次核价，价格变化会中止并要求重新确认。
- 页面填写 Token 时，Token 只在提交瞬间经过同源 HTTPS/HTTP 到服务端，服务端用一次只读工具调用校验后才写入 `data/live-token.json`（`0600`，已 gitignore）；浏览器不写 localStorage、不回显、接口不返回。
- `/api/live/token` 只接受同源请求，并限制每分钟 5 次校验；设置 `DISABLE_LIVE_SETUP=true` 可整体关闭页面接入。
- 订单状态机记录 `quoted → confirmed → pending_payment → paid/cancelled`；未支付重复单可对账取消，已支付订单不自动退款。
- MCP Token 不进入前端、不进入 API 响应、不写入日志。
- 页面有 CSP、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 等安全头。
- API 有基础限流；应用只监听 127.0.0.1，由 Nginx 对外。
- 营养信息仅用于排序与展示，不构成医疗或营养建议。

---

## 九、测试

```bash
npm test
```

覆盖：

- 三套完整餐方案与预算约束
- 外送费/包装费计入
- 多人方案人均价
- 忌口过滤
- 低预算兜底
- 无法满足忌口时的明确报错
- 凑单陷阱提示
- 1+1 组合
- 积分开关
- 报价 → 领券 → 订单 → 模拟支付闭环
- 无效确认令牌拒绝
- 金额上限拦截
- 重复未支付订单对账
- 固定套餐上限、到期与自动暂停
- 管家视图：管道状态推导（done/failed/pending/demo）、报价与订单摘要、自动化门控矩阵
- Token 接入：形状校验、401/超时/网络错误分类、保存与清除不落脏数据

---

## 十、参赛材料

- `CONTEST_DECLARATION.md`：官方参赛声明，内容未修改。
- `MCP_INTEGRATION.md`：MCP Server、Tool、调用流程、业务价值与降级策略。
- 本 README：项目介绍、安装方法、使用示例、目标用户与部署说明。

**麦门省一单：把省钱这件事，做成一个动作。**
