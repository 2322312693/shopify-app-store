---
name: canva-to-shopify
description: 将本仓库体系下的 Canva 应用迁移为独立 Shopify 应用，复用 node_server appkey，开发 Shopify 商品和上传工作流，部署 Vercel，并生成供用户手动填写的上架文案与图片素材。用于新增 Canva 的 Shopify 版本或维护这些迁移应用。
---

# Canva → Shopify

## 用户约定

- “把 Canva 应用做到 Shopify”默认指发布一个新的独立 Shopify 应用。不要把功能塞进已有 Product Image Cleaner AI 或其他无关应用；用户明确要求扩展现有应用时例外。
- 同一产品沿用 Canva / Adobe 的 node_server appkey。Shopify 有独立 client ID、secret、handle 和会话身份；目录名不等于后端 appkey，不能为了平台前缀额外造一个 appkey。
- 默认交付上架文案、合规尺寸 Logo、宣传图和中文步骤，由用户手动填写后台并提交。不要自动代填、打审核勾或提交；用户另行明确要求时按其范围执行。
- node_server 需要改动时改代码、测试、push，并给用户提交号和环境变量名；用户自己在服务器 pull、重启。不要默认要求服务器密码或接管服务器。
- 用户选择自己录屏时停止录制，交付可录屏的正式应用。上架图片、元数据和录屏应匹配最终 UI。

- 后续默认只使用一个统一 Vercel 项目，以 `/{app_key}` 区分 Shopify 应用。新增应用应加入统一路由与配置注册表，不重复创建 Vercel 项目。每个 Shopify 应用仍有独立 client ID、secret、handle、会话及订阅配置。当前旧项目迁移需按实际授权单独执行，不能把这一约定描述成已经完成的架构。

## 定位与开发

以此 SKILL 所在位置向上定位 shopify_app_store 仓库；Canva 与 node_server 通常是该仓库的兄弟目录。先找到目标 Canva 项目，确认真实模型、输入输出、后端调用和 appkey。不要从应用名猜模型。

参考项目：`shopify_bulk_background_remover`（批量去背景）与 `product_image_cleaner_ai`（擦除/指令编辑）。只借用必要基础设施，不把参考项目特有功能、名称、价格和 prompt 一并带入新应用。

可用脚手架：`scripts/create-shopify-app.mjs`。使用前阅读脚本：它当前以 Product Image Cleaner AI 为源，并将第一个参数同时用于目标目录及 appkey。若目录与共享 key 不同，要显式校正 `app/app-config.js`；已有共享 key 不需要重复创建后端配置。不要复制真实 .env、会话、token、.shopify 或 .vercel 目录。

## 平台工作流

- Shopify 内直接使用店铺身份，不额外要求 Canva / Adobe 登录；从已授权的 Shopify shop 联系资料补齐店主邮箱，邮箱用于联系，不作为跨店铺身份合并依据。不要把临时占位邮箱当作真实邮箱。
- 为适用的图片应用提供电脑上传及商品图库选择。上传区用自定义按钮和拖拽卡片，原生 file input 可以隐藏作为文件选择机制；不要裸露浏览器原生控件作为整个上传 UI。
- 图库使用缩略图卡片、搜索、已选数量和清楚的选中状态。提供空结果、上传验证、忙碌禁用、进度、失败重试和移除待处理项；兼顾键盘与窄屏。
- 去背景产品沿用 Canva 对应去背景模型，不误切换成 GPT 图像编辑模型。文字/指令编辑则检查 node_server 当前模型映射，不根据历史对话断言模型版本。
- 图片先通过签名上传送入 R2，再把 URL 给 AI 后端，避免把大块 base64 穿过 Nginx 导致 413。参考现有签名 URL 校验、上传测试和超时配置；区分“前端经 Vercel 上传”与“浏览器直接上传”，准确描述实际链路。
- 生成前验证订阅和预留额度，失败退还，成功完成计数。保留商品原图，结果作为新媒体添加；支持透明 PNG 下载。
- 批次数、文件格式和大小由目标产品及平台限制决定。当前背景移除参考值为每批 20 张、JPG/PNG/WebP、单图 3 MB，不要把这些数字硬套所有应用。

## 计费、部署与验收

开发或排查时阅读 [计费和部署](references/billing-deployment.md)。不同应用的套餐独立配置；用户改 Shopify 价格时同步代码、识别逻辑、文案，并验证小写名称/handle。

运行与修改有关的测试和生产构建。部署后打开真正的 Shopify 内嵌应用，验证实际界面和关键工作流；push 成功不等于部署完成。明确区分：代码推送、Vercel Ready、Shopify 配置版本发布、商店草稿、已提交审核、审核通过并公开上架。

## 上架交付

准备上架时阅读 [上架素材与审核](references/listing-review.md)。上架交付默认必须同时包含三个简短 Features、3–6 张真实 UI 截图、能解释产品价值的 Feature Image、各图片 alt text、逐字段英文文案和一个完整素材 ZIP；不要等用户逐项追问才补齐。

生成素材后运行：

```bash
python3 .agents/skills/canva-to-shopify/scripts/validate_listing.py <应用目录>/listing
```

修复全部错误并人工查看每张图片。尺寸通过不代表内容合规；尤其不能把只有应用 Logo、图标或抽象插画的图片当作 Feature Image。只声明已验证的能力和已完成的检查；任何平台等待、计费未配好、额度服务异常等都应写入交付说明。不要用截图或假数据掩盖功能故障。
