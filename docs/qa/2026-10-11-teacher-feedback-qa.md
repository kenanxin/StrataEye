# 教师首条建议升级验收记录

验收从 2026-10-11 开始，最新本地执行日期为 2026-10-12（北京时间）。对象为 `codex/teacher-feedback-v1`。本文分别保留 Task4 历史验收和最终修复批次结果；生产旧服务恢复单独记录，当前分支尚未推送或部署。

## 最终修复批次验收

最终审阅要求的 F1/F2/M1/M2/M4/M5 已完成本地修复，修复起点为 `5849b425ab8845a9e2c1885c43593e3748e87c8a`，最终运行时代码为 `a89198a72140ad1b5d64e4e8cb64c9ff6685dcf5`。该 SHA 覆盖所有代码、回归测试、配置与 README/API 更新；本节为其验收记录。M3 的既有模块警告明确延期。

企业确认框与所有登录角色可读的公共“协同事件”卡绑定所选保存事件的当前 plan_versions 最后一版。企业在确认前可见保存摘要、完整有界建议列表、DeepSeek/rule 来源、降级原因及实际引用 ID；监管与智库打开公共卡审阅同一方案。选择切换、读取中及读取失败会清除候选正文并禁用签字，新版替换当前展示。正文通过 textContent 写入；DOM fixture 的 `<script>` 文本保持为文本，不作为 HTML 执行。新区域复用已有深色证据卡样式，独立滚动并支持长 ID 换行；未进行 Chrome 视觉验收。

每版 `retrieved_context` 与当前 A2.output.reviewed_workflows 保存至多 20 条去身份检索快照，含源 workflow/CSV ID、case-specific 引用 ID、实际审核修订/时间及源审核序号；模型身份取已有 algorithm.model/model_mode，未添加不存在的模型版本。UI 将“已审核工作流检索上下文”与 `advice.evidence_ids` 实际引用分开呈现，A2 节点详情亦将工作流案例与相似 CSV 示例区分。规则回退保留检索上下文，未宣称由 DeepSeek 引用。两条已审核源工作流共享 CSV 时仍有不同引用 ID，未审核归档不被检索；重新研判取得新快照，旧版快照及重新 GET 保持一致。provider 输入仍排除人员/组织、工单、照片与自由审核正文。

A4 实值投影：开始为 waiting_human/waiting_approval；ACKNOWLEDGE 后为 success/human_approved；资源改变或 REPROCESS 后回到 waiting_human/waiting_approval；监管 APPROVE 后为 success/verified；ARCHIVE 后为 success/closed。human_approved 跟随当前方案批准值，delivery_mode 始终 dry_run，external_delivery 始终 false。ARCHIVE 时间线只陈述闭环归档，案例记忆仍须单独 APPROVE_MEMORY。配置示例移除了未支持的目录变量，本地目录继续使用默认值或程序显式注入。

所有命令均从 `D:/矿业/worktrees/teacher-feedback-v1` 执行，未安装依赖：

```powershell
& 'C:/Users/欣/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --test tests/agent-collaboration-service.test.mjs tests/expert-advice-service.test.mjs tests/warning-demo-ui.test.mjs
& 'C:/Users/欣/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --test tests/teacher-feedback-qa.test.mjs
& 'C:/Users/欣/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --test tests/agent-collaboration-service.test.mjs tests/expert-advice-service.test.mjs tests/warning-demo-ui.test.mjs tests/multi-agent-ui.test.mjs tests/warning-demo-state.test.mjs tests/teacher-feedback-qa.test.mjs
& 'C:/Users/欣/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --test
& 'C:/Users/欣/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' tools/capture-teacher-feedback-qa.cjs
& 'C:/Users/欣/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' tools/submission-preflight.mjs --offline
```

RED/GREEN：前三文件首次 37 tests、33 pass、4 fail，duration_ms=3730.9755；缺失 retrieved_context、A4 仍 waiting_human、case-specific 引用降级、确认框候选正文空白为预期失败。实现后同命令 37/37 pass、0 fail，duration_ms=4369.6193。IPC 回归首次 1 fail（屏障函数不存在），实现后 1/1 pass、0 fail，duration_ms=119.6632。最终 focused 回归覆盖上限、源审核版本、六条建议全文、监管/智库可见、A2 转义及旧捕获失效，54/54 pass、0 fail，duration_ms=4687.9077。

合并全部代码修复后完整 Node suite 仅执行一次：228 tests、228 pass、0 fail/cancelled/skipped/todo，duration_ms=6620.0402，exit 0。出现三条原有 MODULE_TYPELESS_PACKAGE_JSON 警告，两条来自 js/scene/asset-registry.js，一条来自 js/scene/mine-v2/focused-longwall.js；未改变 package 模块模式。额外的 Git 行尾提示仅说明 LF/CRLF 转换，git diff --check 未报告格式错误。

最终 HTTP 程序 started_at=2026-10-12T05:20:04.697Z、completed_at=2026-10-12T05:20:06.744Z，exit 0、ok=true。完整链 START(0)→ACKNOWLEDGE(1)→SUBMIT_DISPOSAL(2)→REJECT(3)→SUBMIT_DISPOSAL(4)→APPROVE(5)→ARCHIVE(6)→APPROVE_MEMORY(7)。两个独立 HTTP 客户端、两个顺序 Node 进程重启的完整快照相等；source=local-rule、fallback_reason=not_configured；重评估版本 [1,2]、返回 return_to_perception；algorithm_and_A1_preserved=true；400/403/404/409 断言通过；child_diagnostic_bytes=0、external_provider_calls=0、browser_visual_verified=false。

新断言同时核实：归档未审核时本版 retrieved_context=[]；审核且重启后新 plan 保存源 `WF-6f92f453-30fa-4828-8030-f40f113bdb90` / `REC-202511101149-02909`，review_revision=7，A2 与 plan 快照相等，第二客户端 GET 可见同一快照。IPC 捕获以服务器生成的 workflow_run_id:v<plan_version> 为关联 ID，父进程等待该确切调用，最长 10 秒；延迟回归先送旧运行和旧版本，等待保持未完成，随后对应版本到达才返回，缺失捕获会超时失败。HTTP 完成不再作为 IPC 已到达的依据。

离线预检 exit 0，输出为 `真实数据：20000 行，11 列，SHA-256 86D4C2FB192721B2745F00076AEB00CF351C654ED936DDB098BFA6217E30AC6A` 与 `预检通过。`，无预检警告/失败。“真实数据”为既有 CLI 标签，仅说明大小与哈希一致；本波未改 CSV、XGBoost 概率、场景、相机或图表内容，没有模型训练或准确率提升证据。HTTP 临时目录经唯一名称/父目录校验后清除并复查不存在，未保留口令、cookie、原始 provider 数据或日志。

本地修复与回归完成，仍须唯一 scoped re-review。外部验收继续待完成：新界面响应式/视觉、真实三角色与第二浏览器、IndexedDB 原件及缺失原件行为、Supabase SQL 实际执行与云并发/重启、获授权的真实 DeepSeek 生成。该批次未调用云端、真实 provider 或浏览器替代路径，未 push/deploy/merge，未修改生产账户。当前就绪范围为本地分支交接，外部验收待完成。

## Task4 历史本地 HTTP 证据

以下结果来自最终修复前的运行时代码基线 `dbf9c25f3e7a0b38172573d58c36360c773b057a`，不替代上节本波结果。

工作目录 `D:/矿业/worktrees/teacher-feedback-v1`，Node 为 `C:/Users/欣/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`。未安装依赖或修改 node_modules 链接。

```powershell
& 'C:/Users/欣/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' tools/capture-teacher-feedback-qa.cjs
```

实测开始 `2026-10-12T00:32:14.933Z`，完成 `2026-10-12T00:32:16.948Z`，HTTP 验收程序 exit 0、ok=true。程序在运行时生成合成口令，仅内存/子进程 IPC 传递，不输出口令、cookie 或认证响应。明确注入本地认证、临时文件存储与 configured=false 的规则建议适配器，外部 provider 调用为 0，子进程诊断字节为 0。

| 保存动作 | revision | 保存状态 |
|---|---:|---|
| START | 0 | alert_triggered |
| ACKNOWLEDGE | 1 | disposal_in_progress |
| SUBMIT_DISPOSAL | 2 | pending_review |
| REJECT | 3 | changes_requested |
| SUBMIT_DISPOSAL | 4 | pending_review |
| APPROVE | 5 | verified |
| ARCHIVE | 6 | archived |
| APPROVE_MEMORY | 7 | archived |

固定记录 `REC-202511101149-02909`：同一 HTTP cookie 客户端先后登录 enterprise、regulator、enterprise、regulator、expert 完成闭环。另一独立 cookie 客户端 GET 与完整快照深比较相等，证明共享后端可读。它们是两个 HTTP 客户端；本次未提供两个真实浏览器的证据。

先完整保存 revision=7、8 个事件及两条提交反馈，再停止第一个 Node 子进程；第二个 Node 子进程 PID 不同，使用同一确切临时目录，重新登录后两个客户端读取都与重启前完整 JSON 深比较相等。该实验证明所用本地文件目录可跨进程恢复，未证明 Render 临时磁盘或真实 Supabase 的持久性。

其他通过断言的行为：

- START 同命令返回原事件；早期 ACKNOWLEDGE 在最新 revision=4 时重试返回 revision=1 的原命令快照，最新 GET 仍保留 5 个事件，无重复事件。过期修订/新命令返回 409。
- 仅归档、尚未审核时，后续方案适配器收到 0 条记忆。显式审核后并跨进程重启，发起新事件时适配器实际收到 1 条已审核记忆：`WF-6f92f453-30fa-4828-8030-f40f113bdb90` / `REC-202511101149-02909`；适配器断言去身份数据没有 actor、审核正文、照片或负责人。这同时证明保存和检索。
- 重置以新命令 POST run 得到新 ID；原归档事件 GET 深比较完全相等，旧证据仍在。
- personnel_available=0 时不能确认（400），部分资源更新到 6 后其余 12 套材料/3 台设备保留。缺少明确确认的 REPROCESS 返回 400，旧修订的新命令返回 409。
- 确认 REPROCESS 同时保存合成 worsened 人工反馈，原事件 ID、algorithm、A1、已有事件和反馈保持；方案版本由 1 增至 2，返回来源为 return_to_perception，证据字段仍为 original_csv_record。新版本再次人工确认成功。该操作复用原记录，没有新增测量或改写风险概率。
- 监管尝试归档返回 403，缺失事件返回 404。reflect 忽略伪造的客户端反馈/节点，读取保存事件后仍为 wait_for_feedback。
- 低风险 `REC-202512062045-13620` 保持 ready/finish、零方案，尝试确认返回 400；最终列表包含 5 个保存事件。
- 保存建议 source=local-rule、fallback_reason=not_configured。照片 opaque ID、元数据及 browser-local 声明跨进程保存；程序未上传照片原件。跨浏览器 IndexedDB/原件查看仍需视觉与实际存储验证。

程序 finally 只删除它创建的唯一临时目录，校验父目录与 QA 名称前缀，并复查该目录不存在。保留的工具可再次运行，默认不写输出文件。

## Task4 历史全分支测试与离线预检

```powershell
& 'C:/Users/欣/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --test
& 'C:/Users/欣/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' tools/submission-preflight.mjs --offline
```

最终运行时代码全套结果：220 tests、220 pass、0 fail/cancelled/skipped/todo，duration_ms=6564.1756，exit 0。出现三条已有 MODULE_TYPELESS_PACKAGE_JSON 警告，两条来自 `js/scene/asset-registry.js`，一条来自 `js/scene/mine-v2/focused-longwall.js`；未改变全局模块模式。

全套包含真实控制器的 DOM fixtures、跨组件共享修订、命令重试、过期响应和照片异步失效、GET 成功但历史列表失败提示保留、权限及存储故障等测试。DOM fixtures 证明渲染值/事件与请求行为，未替代 Chrome 的视觉、尺寸和真实 IndexedDB 检查。几何、图表、回放等已有测试亦通过；本任务没有编辑 CSV、模型、场景、相机或图表。

离线预检输出为 `真实数据：20000 行，11 列，SHA-256 86D4C2FB192721B2745F00076AEB00CF351C654ED936DDB098BFA6217E30AC6A` 与 `预检通过。`，exit 0，无预检警告/失败。CLI 中“真实数据”为既有输出标签，仅证明文件大小和哈希核验，不证明现场采集或标签来源。当前文档采用老师提供的 CSV、采集和标签来源待核实的表述。

## 生产恢复的既有证据

以下为控制器在 2026-10-11 的脱敏检查结果及用户提供的信息，本任务未再次登录生产账户。

- 用户提供日期为 9/20 的 Supabase 暂停通知。恢复前四个授权账户返回 401；当时上游网络失败也可能被旧认证代码误报为 401，因此单个认证响应不足以确定根因。
- 用户恢复项目后，四个授权账户各执行一次 login/session，均返回 200，角色分别为 enterprise、regulator、expert、super_admin；不保存密码或会话。
- Render health 返回 200；建议配置 GET 表示 configured=true/provider=deepseek；旧六智能体 provider=node_compatibility_layer。未执行生成 POST。公开后端文件为旧 9/13 内容，恢复认证未部署本分支。
- 执行环境请求 Vercel 超时，用户 Chrome 截图显示生产域名企业端已登录并渲染。该组合不能推出生产域名全面不可用。

脱敏历史日志 [早期部署检查](2026-10-11-deployment.json)（checked_at=2026-10-11T11:05:52.795Z）显示两个入口当时为 200，backend_verified_release 与 frontend_verified_release 均 false；[早期账号检查](2026-10-11-live-services.json)（checked_at=2026-10-11T10:08:40.413Z）记录三个角色的早期 401。这些日志早于后续恢复，不应当作恢复后的失败结果。后续恢复结果来自本次控制器会话审计，在内部任务账本 `progress.md` 的 Restore audit 条目及 task-4-brief.md 中记录；本次没有生成或伪造新的云端原始日志。

## 尚待完成

新界面完成后的 Chrome inventory 再次耗时 32.9 秒并 kernel reset；此前也有超时。本次未重复无变化调用，未通过 CDP、原生操作或 Playwright 绕过。新界面响应式视觉、真实三角色同浏览器、第二浏览器共享显示、原浏览器照片原件及另一浏览器缺失提示均待可用浏览器环境验证。

Supabase 增量 SQL `202610110001_workflow_runs.sql`、真实云端并发/重启验收和实际 DeepSeek 生成未执行。自动批准审查此前拒绝真实 DeepSeek POST，理由是缺少明确授权向外部传输项目数据；本任务只用本地规则和已有 mock。推送、部署、生产账户修改与主分支集成未发生，须经过整分支审阅及相应授权后推进。

工程目标仍为 10/15 核心、10/16 测试修订、10/17 阶段交付，属于计划日期。

既有 99.325% 随机测试准确率及 99.665% 全量标签一致率保留原审计局限；本次未测量或宣称准确率提升。相似 CSV 是监测示例，事故属性待核验。风险分是模型类别映射/概率汇总，未校准为物理灾害概率。重评估与审核记忆未自训练 XGBoost，历史风险下降未证明整改因果效果。
