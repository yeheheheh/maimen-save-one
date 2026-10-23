# MCP 集成说明

## 1. 使用的 MCP Server

- 名称：麦当劳中国 MCP Server
- 地址：`https://mcp.mcd.cn`
- 传输：Streamable HTTP
- 鉴权：`Authorization: Bearer <MCD_MCP_TOKEN>`，Token 仅保存在服务端环境变量，不下发到浏览器。

## 2. 使用的 Tool

### 只读工具

| Tool | 用途 | 本项目中的调用位置 |
|---|---|---|
| `query-nearby-stores` | 根据城市/商圈查询附近可下单门店 | `lib/mcp-live.js` · `LiveMcp.nearbyStores` |
| `query-meals` | 获取门店当前在售菜单与餐品价格 | `LiveMcp.menu` → `normalizeMenu` |
| `query-store-coupons` | 获取当前门店可用券 | `LiveMcp.coupons` → `normalizeCoupons` |
| `list-nutrition-foods` | 获取餐品营养数据，用于热量/蛋白约束 | `LiveMcp.nutrition` → `normalizeNutrition` |
| `calculate-price` | 对候选方案逐单核价 | `LiveMcp.price` / `LiveMcp.priceQuote` |
| `query-my-coupons` | 实时券包（账号级） | `LiveMcp.accountData` |
| `query-my-account` | 实时积分（账号级） | `LiveMcp.accountData` |
| `campaign-calendar` | 活动日历 | `LiveMcp.accountData` |
| `query-order` / `order-list` | 订单状态轮询与对账 | `LiveMcp.queryOrder` / `listOrders` |

### 写工具（仅单用户私有模式）

| Tool | 用途 | 开关 |
|---|---|---|
| `auto-bind-coupons` | 领取报价中的单张最优券 | `ENABLE_COUPON_CLAIM=true` |
| `create-order` | 创建待支付订单 | `ENABLE_ORDER_CREATE=true` |
| `cancel-order` | 取消未支付重复订单 | `ENABLE_ORDER_CREATE=true` |

写工具只在 `ENABLE_WRITE=true` + `SINGLE_USER_MODE=true` + `WRITE_PASSCODE` 已配置 + 页面已解锁时调用。演示模式只模拟状态，不会触发真实写操作。

> 写工具的具体参数、幂等语义和返回结构需在真实 Token 联调时以官方 MCP schema 为准。未完成联调前，请保持 `ENABLE_WRITE=false`，只使用演示执行。

## 3. 调用流程

### 只读决策流程

```text
浏览器
  │  只发送预算 / 目标 / 人数 / 忌口 / 门店
  ▼
麦门省一单 Node 服务端
  │  1. query-nearby-stores  定位门店
  │  2. query-meals          拉取在售菜单
  │  3. query-store-coupons  拉取当前门店可用券
  │  4. list-nutrition-foods 匹配热量 / 蛋白质
  │  5. 本地确定性优化器      生成候选组合
  │  6. calculate-price       对 Top 方案逐单核价
  ▼
返回三套方案：最省 / 最饱 / 最均衡
```

### 执行流程（演示模拟 / 私有实时）

```text
选择方案
  → 生成报价快照（锁定门店/商品/券/金额，5 分钟有效）
  → 领取单张最优券（需确认）
  → 创建待支付订单（需勾选确认，二次核价）
  → 返回订单号与官方支付链接
  → 轮询 query-order / 演示模拟支付
  → 未支付重复单对账并 cancel-order
```

优化器只负责枚举、约束过滤和排序，不做价格猜测；实时模式最终金额以 `calculate-price` 返回为准。若任一实时工具失败，服务端自动降级为演示数据，并在页面明确提示，不会静默使用假价格。

## 4. 业务价值

1. **把“领券 + 选品 + 比价 + 核价”压缩成一个动作。** 用户不需要理解券门槛、套餐结构和渠道差异。
2. **把分散的省钱能力合并成一个决策结果。** 预算、热量、人数、忌口、积分抵扣同时进入求解器，输出可执行的三套方案。
3. **把“凑单陷阱”显式化。** 当为触发满减而加购会导致实付上升时，方案中会标注“已避开 N 个凑单陷阱”。
4. **零客户端配置。** MCP Token 在服务端统一管理，终端用户打开网页即可使用，不需要安装 MCP Client 或填写 Token。
5. **可审计。** 每个金额都有商品小计、券、积分、配送/包装费拆解；实时模式保留 `calculate-price` 核价标记。

## 5. 隐私与安全

- Token 只从服务端环境变量读取，不写入前端、不返回 API。
- 前端不接收账号、订单、手机号等个人信息；实时账号数据只在服务端调用。
- API 响应不包含 Token、原始 MCP 请求头或账号凭证。
- 服务仅监听 `127.0.0.1`，由 Nginx 反向代理对外提供页面。
- 演示模式只模拟写操作；实时写操作需要单用户私有模式 + 口令解锁。
- 写操作使用一次性确认令牌、二次核价、金额/频次上限、幂等状态机与审计日志。
- 不自动支付；支付在麦当劳官方渠道完成；已支付订单不自动取消或退款。
- 演示模式与实时模式、演示执行与私有实时在页面有明确标识。

## 6. 实时模式启用

只读实时模式：

```bash
MCD_MCP_TOKEN=你的_MCP_Token
ENABLE_LIVE=true
```

私有实时写模式：

```bash
MCD_MCP_TOKEN=你的_MCP_Token
ENABLE_LIVE=true
SINGLE_USER_MODE=true
ENABLE_WRITE=true
ENABLE_COUPON_CLAIM=true
ENABLE_ORDER_CREATE=true
ENABLE_AUTO_REPURCHASE=true
ENABLE_AUTO_CANCEL_UNPAID=true
WRITE_PASSCODE=设置一个私有口令
SESSION_SECRET=设置一个随机长字符串
MAX_ORDER_CENTS=5000
MAX_DAILY_ORDERS=5
```

重启服务后：

1. 页面顶部从“演示数据”变为“实时数据”；
2. 执行中心显示“私有实时 · 待解锁”；
3. 输入 `WRITE_PASSCODE` 解锁后，才可领券/下单；
4. 所有写操作仍受金额、频次、报价有效期和二次核价约束。

## 7. 降级策略

| 异常 | 处理 |
|---|---|
| 未配置 Token | 使用演示数据，页面显示“演示数据” |
| Token 失效 / 401 | 回退演示数据，并提示实时接口不可用 |
| 实时菜单为空 | 回退演示数据 |
| `calculate-price` 失败 | 保留本地试算价，标注“本地试算”，并提示官方核价暂未成功 |
| 外送模式缺少账号地址 | 实时模式暂不支持，回退演示外送数据 |
| 写操作未开启 / 未解锁 | 返回 `WRITE_DISABLED` / `WRITE_LOCKED`，不产生任何写操作 |
| 创建订单时价格变化 | 返回 `PRICE_CHANGED`，中止下单并要求重新生成报价 |
| 创建订单超时 | 不盲目重试；通过 `order-list` / `query-order` 对账 |
| 重复未支付订单 | 对账后取消重复单；已支付订单转官方客服 |
| 自动复购达到上限 | 自动关闭该固定套餐并写入提醒 |
| 自动复购异常 | 记录失败运行、保留下一次排期，不无限重试 |

## 8. 数据口径

- 演示数据为产品演示用示例价格，不代表任何真实门店库存或实际售价。
- 演示写操作只改变本地运行时状态，不产生真实订单或扣款。
- 实时模式价格来自麦当劳 MCP，最终以官方结算页为准。
- 实时写操作只在单用户私有模式解锁后开启；支付、退款、客诉均以麦当劳官方渠道为准。
- 营养数据用于排序和展示，不构成医疗或营养建议。
