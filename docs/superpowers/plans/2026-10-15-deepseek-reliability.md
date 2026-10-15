# DeepSeek可靠性修复 Implementation Plan

> 用户已授权按上一轮超时、诊断和真实结果备份方案继续修复，并允许真实对照测试。当前会话逐项实现、自审，不派发子智能体，不提交或部署。

**Goal:** 完整RAG建议可验证地生成，外部失败时有界等待、如实回退，并复用同证据已验证的历史结果。

**Architecture:** 独立传输模块记录安全阶段信息；现有建议服务保持输入去身份、严格JSON和引用/数值校验。缓存仅收录校验成功的AI输出，以模型、提示版本、请求格式与完整安全输入哈希匹配；UI区分实时、历史与规则，禁止自动重试。

**Tech Stack:** Node内置fetch/crypto/fs、现有浏览器模块与node:test，不增加依赖。

## 范围与取舍

- 已比较仅延长超时、改请求格式并保留校验、增加其他供应商三条路。采用第二条并补足有界超时；第三条需要新供应商密钥与额外授权，不实施。
- 当前默认JSON约束接口改为普通文本通道，提示词仍要求有效JSON；解析失败、数字阈值或未知引用一律回退，不展示自由文本。JSON约束通道保留配置选项用于对照。
- 默认总等待45000 ms，环境变量可调整并上限90000 ms；既有测试的显式短超时仍有效。Vercel外部转发官方上限120秒，Render冷启动需独立预热，不能把90秒当成全链路保证。
- 缓存24小时、至多64项，默认进程内；Web服务使用已忽略且静态访问禁止的`.runtime/expert-advice-cache`。本地文件不是云端跨实例数据库，Render重建会丢失，不作持久性承诺。
- 只缓存校验通过的完整建议，不缓存规则回退、秘密、原始请求或原始供应商错误。缓存命中仍为人工待确认候选，不创建已执行状态。
- 本轮只修复本地，不改数据库或云端配置，不对外发布。
- 安全审查后进一步收窄外发资料：仅允许已核对的官方通知、研究摘要和教材转述及其公开域名，不外发项目内部说明或源码定位；内部卡片留在本地检索展示。

## Task 1：安全传输与缓存

Create `server/deepseek-transport.js`、`server/expert-advice-cache.js`；test `tests/deepseek-reliability.test.mjs`。

- [ ] 先写测试：正文挂起仍能超时；区分awaiting_headers/reading_body；错误不含密钥；超大正文终止；缓存过期、变更证据、不合格结果和对象修改均不能误用。
- [ ] 传输接口`requestDeepSeek({fetchImpl,endpoint,apiKey,body,timeoutMs})`返回payload或固定失败原因，包含phase/elapsed_ms/http_status/body_bytes等安全诊断，最多256KB正文。总截止覆盖fetch与json，依赖signal和Promise.race双重限时。
- [ ] 缓存接口`createAdviceCache({directory,ttlMs,limit,now}).get(key)/set(key,value)`，key为SHA-256。文件原子写入、读取有限大小，损坏或不可写时不影响建议；不保存完整输入。

## Task 2：整合服务并保持校验

Modify `server/expert-advice-service.js`、`server.js`、`.env.example`；extend existing advice/API tests。

- [ ] 先写测试：默认不带response_format、显式json_object仍可用；默认超时45秒且有界；已校验结果包含generated_at/provider_model/delivery；同输入复用，改输入重新生成；规则不入缓存；重启文件缓存仍需通过当前校验。
- [ ] 两个建议入口共用传输；RAG保持定性数字约束与引用白名单，保留独立risk。成功结果按`sha256({prompt_version,model,response_format,safe})`缓存，读取时重新校验。
- [ ] 同证据并发共用一次请求，避免重复费用；不自动重试。状态接口新增不含业务正文的最后结果与等待配置。
- [ ] 运行建议、模拟、原协同测试，再运行完整套件。测试不得触发真实付费请求。

## Task 3：演示状态与真实核验

Modify `js/support-simulation-ui.mjs`、`js/main.js`、`js/multi-agent-workflow-ui.mjs`；extend UI tests；update QA。

- [ ] UI分别显示DeepSeek实时生成、DeepSeek历史结果和规则回退，历史结果显示原生成时间；切换工况清空旧建议保持不变。
- [ ] 支护研究请求增加客户端有界等待和延迟提示，确保按钮最终恢复，不自动重试。解释失败不影响曲线、数据和三维。
- [ ] 使用独立对照核验同RAG输入的普通文本通道；通过服务校验后，再在实际Chrome点击同工况，确认缓存标签与引用。再做一次不同工况实时生成，避免仅验证缓存。
- [ ] 记录真实成功/失败、耗时、供应商状态与缓存边界，保存截图。不宣称第三方永不故障，不将历史生成冒充实时。

## 自审

缓存key包含全部安全输入及资料哈希，绝不跨工况套用；服务状态不含任何秘密；数值和引用检查不为追求成功率而删除。完成以完整RAG真实通过、回归和浏览器证据为准。如供应商持续异常，保留实测证据并明确未完成部分。

## 执行结果

Task 1–3已完成。最终278/278测试通过；两个工况完整RAG真实生成通过，Chrome分别验证文件缓存历史结果与新工况实时结果。安全审查后知识外发仅含公开来源，内部说明留本地。新增截断响应拒绝、缓存损坏和跨实例读取测试。未提交、推送或部署，验收见`docs/qa/2026-10-15-deepseek-reliability-fixed.md`。
