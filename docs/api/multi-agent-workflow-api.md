# 六智能体保存事件协作 API

接口沿用平台登录会话。本文描述 `codex/teacher-feedback-v1` 本地验收代码，生产旧服务尚未部署该升级。A1 读取老师提供的 CSV 预计算 XGBoost 结果；数据采集及标签来源仍待核实。顺序为 A1 感知预警 → A2 知识检索 → A3 调度决策 → A5 资源评估 → A4 协同管控 → A6 反思迭代。

## 会话与权限

未登录返回 401。服务端从会话确定 actor，每次动作读取保存事件、校验角色和修订；客户端提交的 actor、模型风险、节点或替代运行对象不作为授权依据。

| 接口/动作 | 授权角色 | 条件与结果 |
|---|---|---|
| status、runs 列表、单事件 GET、reflect | 五种登录角色 | 读取，无业务签字 |
| POST run | enterprise | 新事件或同命令幂等快照 |
| ACKNOWLEDGE | enterprise | alert_triggered 且资源可行，确认当前方案 |
| SUBMIT_DISPOSAL | enterprise | disposal_in_progress 或 changes_requested，已确认可行方案 |
| REJECT / APPROVE | regulator | pending_review，退回或核验 |
| ARCHIVE | expert | verified，归档 |
| APPROVE_MEMORY | expert | archived，明确审核结论且未审核过 |
| UPDATE_RESOURCES / REPROCESS | enterprise | 未核验的活动事件 |

viewer、super_admin 可读，不可业务签字；super_admin 使用独立账户/审计管理 API。旧 `/api/roof-risk/select`、`closed-loop/advance` 保留原监测接口权限和基础闭环语义，不写入此处保存事件。

## 状态、发起与读取

```http
GET /api/multi-agent/status
```

返回运行模式、感知后端、节点顺序、安全边界，以及 `available`、`storage_provider`、`durable`、`advice_configured`、`learning_mode: reviewed_case_memory`。状态会尝试存储列表读取；`durable` 表示已选存储适配可用，云端磁盘、SQL 迁移及完整读写仍需实际验收。`advice_configured` 仅表示配置存在，实际来源读取方案中的 `advice.source`。

```http
POST /api/multi-agent/run
Content-Type: application/json

{
  "record_id": "REC-202511101149-02909",
  "command_id": "start-unique-command",
  "resource_snapshot": {
    "personnel_available": 6,
    "support_material_sets": 12,
    "inspection_devices": 3
  }
}
```

资源快照可省略，使用现有演示默认值；字段须为非负安全整数。低风险记录执行 A1，后续节点跳过，`demo_state.status: ready`、`current_phase: finish`，无方案或业务动作。资源不足会保留 A5 评估并阻止确认方案。A4 保持 `delivery_mode: dry_run`、`external_delivery: false`。客户端应生成并保留 command_id；旧调用省略时服务器生成 ID，无法由客户端保证重试幂等性。

```http
GET /api/multi-agent/runs?limit=20&record_id=REC-202511101149-02909
GET /api/multi-agent/runs/WF-...
```

列表返回 `{ "runs": [...] }`，record_id 可省略，默认 limit 为 20，存储适配范围 1–100；单事件返回完整对象。新事件 revision 从 0 开始，包括：

- workflow_run_id、warning_id、trace_id、created_at、updated_at、revision、phase、current_phase、next_action。
- algorithm：原 CSV 记录、XGBoost 类别、置信度、模型及数据哈希；20/45/70/95 类别映射和概率加权风险分未校准为灾害概率。
- nodes：节点状态、证据、摘要及输出；elapsed_ms 为兼容节点读取预计算结果等实际墙钟耗时，跳过节点为 0，未代表在线模型训练或推理耗时。
- demo_state：工单、监管核验、归档、照片元数据及人员时间线。
- plan_versions：版本、来源记录、资源、人工批准、建议来源、重评估返回目标及证据声明。每版含 `retrieved_context` 去身份检索快照（至多 20 条），A2.output.reviewed_workflows 对应当前版快照；与 `advice.evidence_ids` 实际引用列表分开保存。
- feedback、case_memory、events：权威人工反馈、显式审核记忆及 actor/time/command 审计历史；safety 标注人工确认及设备控制边界。

## 保存动作与并发

```http
POST /api/multi-agent/runs/WF-.../actions
Content-Type: application/json

{
  "type": "SUBMIT_DISPOSAL",
  "command_id": "submit-unique-command",
  "expected_revision": 1,
  "payload": {
    "measures": "复测并补充支护检查记录",
    "workOrder": "WO-1",
    "responsiblePerson": "现场负责人",
    "completedAt": "2026-10-12T10:00:00Z",
    "photos": [{ "id": "opaque-local-photo-id", "name": "inspection.jpg", "size": 42 }],
    "monitoring_trend": "stable",
    "execution_status": "completed"
  }
}
```

成功返回完整事件，新动作 revision 加一。command_id 为 1–128 字符，首位字母/数字，其余允许字母、数字、下划线、点、冒号、连字符。expected_revision 为非负安全整数。同 actor/command 重试返回原成功快照，即使最新事件继续推进，也不重复记账；随后 GET 最新事件，避免历史快照覆盖新状态。过期修订配新命令返回 409，先读取核对，再由人工决定后续动作。前端仅在传输结果不明确时自动重试一次同一序列化命令，不自动重试 HTTP 409/400/403。

| type | payload |
|---|---|
| ACKNOWLEDGE | `{}` |
| SUBMIT_DISPOSAL | 非空 measures、workOrder、responsiblePerson、completedAt，至少一条 photos 元数据；可选人工 trend/status |
| REJECT | 非空 opinion、deadline |
| APPROVE | 非空 opinion |
| ARCHIVE | 非空 conclusion |
| UPDATE_RESOURCES | `{ "resource_snapshot": { "personnel_available": 6 } }`；部分覆盖保存快照，未提交字段保留，零有效 |
| REPROCESS | `{ "confirmed": true, "feedback": { "monitoring_trend": "worsened", "execution_status": "completed", "reason": "人工反馈待复核" } }`；feedback 可省略，提供时仅接受这三类字段 |
| APPROVE_MEMORY | `{ "reviewed_conclusion": "明确的人工审核结论" }` |

trend 枚举 stable、worsened、improved；execution 枚举 completed、failed、pending_human_approval。REPROCESS reason 为非空且至多 2000 字符。REPROCESS 保存人工反馈后确定返回目标，复用原记录并保留 algorithm/A1、旧版本及历史；新候选方案须再次确认，最多五个方案版本。恶化反馈记录 `reprocess_from: return_to_perception`，未加入新监测测量。资源更新撤销当前确认，需重新确认可行方案。

照片保存 opaque ID、name、可选 size 与 `storage_source: browser-local`；服务端不接收原件。原件在上传浏览器 IndexedDB，其他浏览器读取元数据时显示原件不可用，无云端照片持久化接口。

保存事件无 RESET 动作。“重置”使用新 command_id 的 POST run 发起新事件，旧事件及证据保留。验收闭环为 START(0) → ACKNOWLEDGE(1) → SUBMIT_DISPOSAL(2) → REJECT(3) → SUBMIT_DISPOSAL(4) → APPROVE(5) → ARCHIVE(6) → APPROVE_MEMORY(7)。

## 反思与审核记忆

```http
POST /api/multi-agent/reflect
Content-Type: application/json

{ "run": { "workflow_run_id": "WF-..." } }
```

服务器根据 ID 读取保存事件及反馈，忽略客户端 feedback 和 run 内 nodes/风险替代字段。仅返回评估，不提交版本或保存动作。无反馈为 wait_for_feedback，其他目标为 finish、return_to_perception、return_to_decision、return_to_resource、return_to_control；低风险 reflect 返回 400。

仅 ARCHIVE 未允许记忆检索。显式 APPROVE_MEMORY 后，相关记录及相似记录的归档记忆可进入后续方案检索。建议适配器收到去身份的事件/记录 ID、模型等级、动作代码、归档结果、人工趋势/执行枚举，未收到人员、组织、工单、照片或审核正文。A2 相似 CSV 记录是监测示例，事故属性待核验。审核记忆和方案版本提供有限的改进机制，未在线训练 XGBoost，也未证明准确率提升或处置因果效果。

每次生成从当前记录及相似记录检索归档且经专家明确审核的工作流，合并重复源事件，检索快照截取至多 20 条。快照字段为 `workflow_run_id`、`record_id`、`evidence_id`、`review_version`（源审核记录的序号）、`review_revision`（实际保存的审核修订）、`reviewed_at`、`source_model: {name, mode}`、`risk_class`、`action_codes`、`outcome`、可选人工趋势/执行枚举。source_model 使用源事件已有 algorithm.model/model_mode；当前产物没有可核实模型版本，未补写版本。历史审核缺少 review_revision 时从对应已保存 APPROVE_MEMORY 事件推得修订，缺失时明确为 null。

工作流引用 ID 格式为 `case:<源workflow_run_id>:review:<审核序号>:r<审核修订>`，区分相同 CSV 的不同事件及审核记录。provider 允许引用本次已知特征 ID、相似 CSV ID 或 case-specific ID；CSV 示例引用与工作流审核引用语义分别保存。`retrieved_context` 表示本版检索到的上下文，`advice.evidence_ids` 表示建议实际引用；规则回退亦保留上下文，不宣称 DeepSeek 已引用它。REPROCESS 为新版取得新快照，旧版快照保留且重新 GET 不依赖临时 provider 输入。standalone expert advice 接口维持兼容。

A4 的 `status/dispatch_status` 从 `waiting_human/waiting_approval` 在确认后变为 `success/human_approved`，更新资源或重评估后回到等待确认，监管通过后为 `success/verified`，归档后为 `success/closed`；`human_approved` 投影当前方案批准值。始终保留 `delivery_mode: dry_run` 与 `external_delivery: false`，不表示真实设备下发。

## 存储与错误

本地认证开发默认 file 存储，目录 `.runtime/workflows`，支持 `createAppServer({ workflowStoreOptions: { directory } })` 注入；目录没有环境变量配置入口，示例中的无效目录变量已移除。生产/Render 不自动启用文件存储。Supabase 认证默认 Supabase 存储，失败后不静默回退到临时数据。

WORKFLOW_STORE_PROVIDER=supabase 需要服务器端 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY，先有 RBAC 基础迁移，再执行 `supabase/migrations/202610110001_workflow_runs.sql`。增量迁移建立 mine_workflow_runs、mine_workflow_commands 与受 service-role 约束的 create/save RPC，事务内处理修订和幂等快照。密钥不得交给浏览器。本次未执行云端迁移；SQL/适配器测试不代替真实 Supabase 验收。

状态码为 400（输入或转换非法）、401（未登录）、403（越权）、404（事件不存在）、409（修订/幂等内容冲突）、503（认证或存储不可用/损坏）。错误体含 error/message 等信息。数据库不可用时 available 为 false，业务请求明确失败；前端显示错误并保留未保存输入。

## 来源与验收边界

A3 保存建议来源为 deepseek 或 local-rule，回退记录 fallback_reason；配置查询不证明调用成功。生成建议为待确认提案，证据 ID 须来自已知证据，定性内容经校验，禁止改写 XGBoost 风险或下发设备控制。

可重复本地验收：`node tools/capture-teacher-feedback-qa.cjs`。显式注入本地认证、临时文件存储与禁用外部调用的建议适配器，验证 HTTP 闭环、两个独立客户端、两个顺序 Node 进程重启、新事件/重评估历史、记忆检索及错误状态。真实浏览器视觉检查、云 SQL 和实际 DeepSeek 生成仍待完成，详见 [升级 QA](../qa/2026-10-11-teacher-feedback-qa.md)。
