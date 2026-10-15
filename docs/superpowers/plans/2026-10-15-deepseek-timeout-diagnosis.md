# DeepSeek超时分段定位 Implementation Plan

> 当前会话内执行并自审，不派发子智能体。用户本轮允许最多3次小规模真实生成；不发布、不改云端配置。

**Goal:** 区分连接/响应头、提供方等待、读取正文、JSON解析和业务内容校验，找出可复核的超时证据。

**Architecture:** 独立诊断工具读取已有服务端环境变量，使用现有官方端点。先运行最小请求，再用依赖注入观测现有RAG服务的同一请求，不输出密钥、完整提示词或响应正文。业务服务与UI行为保持原样。

**Tech Stack:** Node内置fetch、AbortController、crypto、现有建议与模拟服务，无新增依赖。

## 约束

- 每次真实生成需显式传入`--allow-generation`，一次进程只发送一次；不自动重试。
- 仅官方`https://api.deepseek.com/chat/completions`可使用该诊断工具；不向外部地址带出密钥。
- 单次输出上限1600 tokens；最小请求只需32 tokens；超时仍有限制。
- 日志只记录固定事件名、耗时、状态码、长度、心跳数量、已知引用ID与安全错误枚举，不打印供应商原始错误正文。
- 不把HTTP 200、保活空行、规则回退或本地测试通过计作AI生成成功。
- 保留现有未提交改动和历史验收记录；不读余额、不修改云端环境或数据库。

## Task 1：分段诊断工具

Files: `tools/diagnose-deepseek.cjs`（新建）；`docs/qa/2026-10-15-deepseek-timeout-diagnosis.md`（结果）。

- [ ] 实现一次性`minimal`与`rag`模式。请求输出`request_started`；收到响应头输出`headers_received`；首段正文输出`body_first_chunk`，只含bytes/non-whitespace；中间每15秒最多输出一次心跳状态；完成后输出`body_complete`。
- [ ] `rag`模式将观测fetch传给`createExpertAdviceService({timeoutMs:65000,fetchImpl})`，再传给模拟服务。只调用`explain({caseId:'soft-support',step:20})`一次，输出原服务的source/fallback/validation_errors与引用ID。
- [ ] 无密钥、未知模式、缺少授权开关、非官方端点时在发起请求前退出。运行`node --check tools/diagnose-deepseek.cjs`和无授权模式验证拒绝。

## Task 2：在授权预算内定位

- [ ] 先运行最小JSON请求，记录网络阶段和状态；与同密钥模型列表认证200的已有证据比较。
- [ ] 运行现有RAG完整请求。若两者都有空行心跳且无最终JSON，则优先归为提供方生成/排队阶段；若最小成功而RAG失败，优先核对输入/输出约束和长度；若头部也收不到，核对传输与路由。
- [ ] 第三次只用于一个明确对照变量（例如JSON输出开关或同提供方另一个已列出的模型），不盲目重试。
- [ ] 在QA记录写清每次请求、生成次数、阶段证据与尚未确定的原因。对代码缺陷与外部波动分别提出修复建议；本诊断任务不直接修改业务行为或发布。

## 自审

完成标准为有可复核的阶段证据和明确下一步，不承诺第三方永不超时。生成响应即使成功，仍需通过既有引用及数值校验才能进入展示。按当前用户授权顺序执行，不在未取得新授权时超过3次生成。

## 执行结果

上述工具、三次诊断与结果记录均已执行。前两次JSON请求收到200后仅有保活空白；第三次不带JSON模式的短文本12.134秒成功。官方同期有部分中断。尚未用同一RAG输入成对复核JSON开关，不能据顺序测试认定唯一根因。诊断与建议保存在`docs/qa/2026-10-15-deepseek-timeout-diagnosis.md`，无业务行为修改或部署。
