# 计费和部署

## Shopify App Pricing

使用当前应用实际支持的 Shopify App Pricing。核对 Shopify 官方最新文档与已启用计费模式，不因旧截图盲目切换。定价页的 public plans 与 private plans 不同；给普通商家销售需要公开套餐，不要只写 listing 文案。

后台套餐名称、内部 handle、价格、币种、周期、额度与代码及后端应一致。套餐名匹配优先，不能仅凭金额授予权限；若继承了金额兜底，应检查其适用范围。只接受实际有效的 ACTIVE 订阅，测试订阅必须限定开发/测试环境，不应向真实付费用户默认开放测试权限。

当前 Bulk Background Remover（示例，不是所有应用默认）：Free 总计 5 张，Starter $6.99/月 100 张，Pro $12.99/月 500 张，Business $19.99/月 2,000 张。用户可能后续修改，先读当前代码与后台。免费额度不是免费试用天数；默认不要擅自增加 trial days。开发店 Free to test、订阅 ACTIVE、商家账单已支付与开发者 payout 是不同状态，不能承诺某个订阅日后一定到账。

核对额度是自然月还是订阅账单周期。现有 node_server 部分实现按 UTC 自然月计算；若未改为账单周期，文案不能写“每个 billing cycle 重置”。

## 为什么 Redirect URL 是 /app

它是用户选完套餐后返回应用的导航路径，不是支付 webhook，不是支付成功凭证。当前 Remix 应用主界面是 `/app`：`app/routes/app.jsx` 验证 Shopify 身份，`app/routes/app._index.jsx` 查询当前应用真实有效订阅并同步后端额度。不能信任回跳 URL 中的价格、套餐参数直接发额度。

因此 Free 和付费套餐都可返回 `/app`。若未来应用首页在 `/apps/<slug>/app` 等子路径，应按实际路由填写；不要把 `/app` 固化为所有项目必须遵守的 Shopify 平台要求。订阅更新/卸载仍靠相应 webhook 和服务端查询保持一致。

## Vercel / node_server

- 用户当前偏好 Vercel。以平台实际分配且由用户拥有的域名为准，不猜 `项目名.vercel.app`。Bulk 现有域名是 `bulk-background-remover-five.vercel.app`，无 five 的地址不是本应用。
- 确保 App URL、回调、TOML、环境变量、定价跳转 handle 与实际 Shopify 应用一致。handle 可能自动增加 `-1` 后缀。
- Vercel 无状态部署使用远程会话存储，不能依赖本地 SQLite 长期保存会话；内部共享密钥必须在应用和 node_server 两端配置一致。真实密钥不进 Git、文案或聊天。
- 用户已确定后续默认采用一个统一 Vercel 项目，路径 `/{app_key}`。不要为每个新应用再次创建 Vercel 项目。统一入口尚未实现时，先建立并验证入口，再接入新应用；不能把简单转发包装成完整隔离架构。
- 建议路径：`/{app_key}` 为应用入口（在保留 Shopify 查询参数的情况下跳到 `/{app_key}/app`）；主界面 `/{app_key}/app`；认证 `/{app_key}/auth/*`；webhook `/{app_key}/webhooks/*`；隐私页 `/{app_key}/privacy`。每个应用的套餐回跳需填写带自己前缀的主界面路径。
- 服务端按注册的路径查找固定配置，选择 client ID、secret、Shopify handle、后端 appkey、作用域与套餐。未知 key 返回 404，不回退到其他应用。不要在并发请求中改写 process.env；使用隔离实例/配置注入或独立构建函数。验证 token audience 和 webhook HMAC 均使用路径对应的凭据。
- 路由前缀必须贯穿 Remix basename、静态资源、表单 action、认证跳转和 webhook 注册。多个应用可以共享组件与后端业务服务，但授权和订阅不可串用；同店安装两个应用也必须隔离。若同一后端 appkey 对应多个 Shopify client ID，应先扩展会话命名空间再接入，不能覆盖彼此会话。
- 一次 Git push 触发统一 Vercel 项目部署。实际域名确定后再配置 Shopify App URL 和重定向，不能凭示例域名进行线上修改。旧应用切换需先验证新路径、更新对应 Shopify 配置，再验证实际安装/处理/计费；保留旧部署用于回滚直至切换确认完成。
- node_server 改动仅在必要时提交推送，告知用户自行部署；只改 Vercel UI 时不要求用户重启后端。
- Shopify CLI 的配置发布与 Vercel 网页部署独立；只改页面一般不需要无意义地再次发布 Shopify 配置版本。

验收应覆盖认证、上传/商品选择、处理成功与失败退款、下载/新增媒体、套餐升级降级取消和重装。避免测试真实付费交易或修改无关生产商品。
