# 上架素材与审核

默认写文件给用户，不操控后台填表。交付到目标应用 `listing/`：

- `metadata.en.json`：可复用结构化字段。
- `English-Listing-Metadata.md`：按后台英文字段顺序整理，可直接复制。
- `上架文案.md`：中文填写说明与英文内容。
- `发布流程.md`：中文操作步骤、当前状态与尚未完成事项。
- `assets/`：Logo、Feature Image 和不同功能场景的真实截图。
- `<App-Name>-Shopify-assets.zip`：包含以上文案和最终可上传图片；打包前删除 `.DS_Store`、临时截图与旧素材。

当前核对基准（执行前重新查官方规则）：Logo 1200×1200 JPEG/PNG，按上传界面体积上限导出；Feature Image 1600×900；3–6 张桌面截图均为 1600×900。必须检查最终文件实际尺寸、体积与视觉内容，不能把生成提示词要求当成文件已经达标。按用户所需尺寸做规范导出；图像生成遵循当时可用 imagegen 工具规则。

常用字段：name≤30 字符，introduction 两个简短句子且≤100，details≤500，每项 feature≤80；subtitle、SEO 等按实际表单上限校验。默认一次交付三个互不重复的 Features，每项描述商家可感知的功能，不描述框架、模型或存储实现。写真实能力、限制、英文 UI 语言、支持邮箱、可访问隐私页；Canva/Adobe 共用 appkey 不代表存在面向商家的集成。

## Feature Image

Feature Image 是宣传主图，不是 App icon 的放大版。静态图必须让第一次看到应用的商家理解核心收益：用一个清晰的视觉焦点表现“输入/操作 → 结果”或“之前 → 之后”。可以把真实结果与简化的产品操作组合成宣传构图，但不能只放 Logo、图标、装饰插画或与功能无关的 AI 图。不要使用 Shopify 标志，也不要原样重复 App card subtitle。始终提供能具体描述功能和结果的 alt text。

上传前按缩略图尺寸查看一次；如果缩小后只能看见品牌 Logo，而看不出应用做什么，重新设计。自动检查提示 “only includes a logo, icon, or illustration” 时，只替换 Feature Image，不要误删合规的真实截图。

## 真实截图

截图只能来自已经部署并在开发店实际运行的最终 UI，不能用设计稿、生成式 mockup 或静态 HTML 冒充。完成一次端到端测试后再拍摄，推荐用三个不同场景覆盖核心路径：

1. 输入或选择素材的创建页，使用清晰、无敏感信息的示例数据。
2. 独立结果页，完整显示真实生成结果和主要操作。
3. 写入平台后的成功状态，例如选择商品并显示“已添加为新媒体”。

应用有其他核心功能时可补到 4–6 张。截图去掉账户信息、浏览器外框、地址栏和店铺侧栏，不加价格、评分、排名或效果保证。避免光标遮住主要信息。每张图提供不同且具体的 alt text，文件名采用可排序格式：

```text
assets/screenshots/01-create-1600x900.png
assets/screenshots/02-result-1600x900.png
assets/screenshots/03-add-to-product-1600x900.png
```

若开发店免费额度不足，可使用 Shopify 开发店的测试套餐完成截图，但必须确认页面明确标记为测试且不会真实扣款，并在交付说明中准确描述。

更新 UI、字段名称、结果流程或商品写入行为后重新生成相关截图和 Feature Image，避免旧素材误导。更新 `metadata.en.json`、Markdown 文案和 ZIP 中的文件，防止仓库文件与交付包不一致。

## 交付前验证

从仓库根目录运行 `scripts/validate_listing.py`，再人工检查以下内容：

- 三个 Features 已同时出现在 JSON 和 Markdown，且每项不超过 80 字符。
- App icon、Feature Image、3–6 张截图都存在且尺寸正确。
- Feature Image 能在一眼内说明功能，不是 Logo-only 图片。
- 每张截图展示不同真实场景，没有 PII、浏览器外框或后台账户信息。
- Alt text 与对应图片一致，不复用泛化描述。
- ZIP 已重新生成，包含最终图片和文案，不含 `.DS_Store` 与过时素材。

Testing instructions：安装后无需额外账号 → 上传或选商品图 → 处理 → 下载 → 保存新媒体 → 批量及订阅流程。只描述可验证操作。Screencast URL 是可访问的视频链接；用户自行录制/上传 YouTube 时给脚本和步骤，不伪造已录制视频或链接。

## 自动检查

Embedded app checks 自动检测 CDN App Bridge 与 session tokens，没有手动打钩入口。代码引用正确不等于平台检测已通过；在正确 client ID 的开发店安装并实际交互，查看真实脚本加载和认证请求，再等待检测周期。页面通常说明每 2 小时更新；不要承诺具体通过时间。持续未通过时按最新官方说明排查并准备 Partner Support 所需证据。不能通过改为非嵌入式或模拟遥测绕过。

AI self review 不等于 npm test。用户要求自查时使用 Shopify AI Toolkit 当前 `/shopify-app-store-review` 流程（先检查是否可用并按官方方式安装），对照适用要求出具发现和未验证项。不能凭项目单元测试通过就勾“全部要求已满足”；平台勾选也不构成代码合规的证明。

发布顺序：用户填写素材与公开套餐 → 检查支持/隐私地址及录屏链接 → 实测关键功能与计费 → 自动检查及实际自查 → 用户提交 → 等待 Shopify 审核。分别汇报每阶段状态。

官方来源：
- https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices
- https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- https://shopify.dev/docs/apps/build/ai-toolkit
- https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review
