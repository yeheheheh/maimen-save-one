# MCP 集成说明

## 1. 使用的 MCP Server

- 名称：麦当劳中国 MCP Server
- 地址：`https://mcp.mcd.cn`
- 传输：Streamable HTTP
- 鉴权：`Authorization: Bearer <MCD_MCP_TOKEN>`，Token 仅保存在服务端环境变量，不下发到浏览器。

## 2. 使用的 Tool

实时模式使用以下只读工具：

| Tool | 用途 | 本项目中的调用位置 |
|---|---|---|
| `query-nearby-stores` | 根据城市/商圈查询附近可下单门店 | `lib/mcp-live.js` · `LiveMcp.nearbyStores` |
| `query-meals` | 获取门店当前在售菜单与餐品价格 | `LiveMcp.menu` → `normalizeMenu` |
| `query-store-coupons` | 获取当前门店可用券 | `LiveMcp.coupons` → `normalizeCoupons` |
| `list-nutrition-foods` | 获取餐品营养数据，用于热量/蛋白约束 | `LiveMcp.nutrition` → `normalizeNutrition` |
| `calculate-price` | 对候选方案逐单核价 | `LiveMcp.price` → `optimizeLive` |

当前版本不调用 `auto-bind-coupons`、`create-order`、`cancel-order` 等写操作，避免替用户领券或提交真实订单。

## 3. 调用流程

```text
浏览器
  │  只发送预算 / 目标 / 人数 / 忌口 / 门店
  ▼
省一单 Node 服务端
  │  1. query-nearby-stores  定位门店
  │  2. query-meals          拉取在售菜单
  │  3. query-store-coupons  拉取当前门店可用券
  │  4. list-nutrition-foods 匹配热量 / 蛋白质
  │  5. 本地确定性优化器      生成候选组合
  │  6. calculate-price       对 Top 方案逐单核价
  ▼
返回三套方案：最省 / 最饱 / 最均衡
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
- 前端不接收账号、订单、手机号等个人信息。
- API 响应不包含 Token、原始 MCP 请求头或账号凭证。
- 服务仅监听 `127.0.0.1`，由 Nginx 反向代理对外提供页面。
- 当前版本为只读模式，不自动领券、不下单、不支付。
- 演示模式与实时模式在页面顶部有明确标识。

## 6. 实时模式启用

在服务端 `.env` 中配置：

```bash
MCD_MCP_TOKEN=你的_MCP_Token
ENABLE_LIVE=true
```

重启服务后，页面顶部会从“演示数据”变为“实时数据”。如果门店、菜单或核价接口异常，服务会自动回退到演示模式并提示原因。

## 7. 降级策略

| 异常 | 处理 |
|---|---|
| 未配置 Token | 使用演示数据，页面显示“演示数据” |
| Token 失效 / 401 | 回退演示数据，并提示实时接口不可用 |
| 实时菜单为空 | 回退演示数据 |
| `calculate-price` 失败 | 保留本地试算价，标注“本地试算”，并提示官方核价暂未成功 |
| 外送模式缺少账号地址 | 实时模式暂不支持，回退演示外送数据 |

## 8. 数据口径

- 演示数据为产品演示用示例价格，不代表任何真实门店库存或实际售价。
- 实时模式价格来自麦当劳 MCP，最终以官方结算页为准。
- 营养数据用于排序和展示，不构成医疗或营养建议。
