# StrataEye · 灵瞳勘顶

煤矿顶板灾变智能预警与可视化决策系统。最新代码和离线研究统一从本仓库 `main` 获取。队友先阅读[协作与创新点索引](docs/collaborator-guide.md)；离线实验原始结果在[研究 Release](https://github.com/kenanxin/StrataEye/releases/tag/research-2026-10-17)，代码与复现入口见[离线研究导读](research/README.md)。视频、字幕和旁白不纳入本仓库。

本项目面向煤矿顶板灾变风险识别、知识辅助研判和三端人员协作，包含井下三维展示、多角色页面和 RoofRisk API v1。2026-10-17核验时，线上后端健康接口报告功能提交 `4c3e5d2`；本次补齐研究交付材料，不改变业务接口与网站域名。

当前版本已接入老师提供的 20,000 行 CSV 和现有 XGBoost 模型。用户获知该资料来自矿业老师及往届研究生比赛，采集来源、现场对应关系和标签形成过程仍待核实。构建期 Python 工具执行源文件校验、按设备时间切段、卡尔曼平滑、标准化、数据质量编码与 XGBoost 推理，生成确定性 JSON；运行期 Node 服务通过 RoofRisk API v1 向各角色提供一致结果。生产使用 Supabase 认证与保存事件适配；本地默认使用文件存储。离线四观测力学实验和线上教师数据模型分别保留来源与评价范围。

## 主要功能

- 三维数字孪生：基于 Three.js 展示井下巷道、工作面、设备、风险场和灾变过程。
- 顶板风险场：支持应力场、位移场和综合风险场切换。
- 六阶段灾变演示：覆盖正常监测、应力集中、离层扩展、支护异常、垮落预警、应急处置。
- 多角色协同闭环：企业端负责现场监测与处置，监管端负责区域态势和闭环督办，智库端负责模型解释和复盘，只读端用于受限查看，超级管理员负责账户与权限管理。
- 算法预警与六智能体研判：XGBoost 负责 A1 感知预警，随后按 A2 知识检索 → A3 调度决策 → A5 资源评估 → A4 协同管控 → A6 反思迭代执行可审计状态流转。
- 统一接口：RoofRisk API v1 统一 CSV 输入、四级模型概率、综合风险、特征证据、预警事件和闭环状态。
- 模型审计：智库端并列展示原始数据标签、XGBoost 预测、置信度、既有模型指标、记录号与数据哈希。

## 老师提供的数据与模型血缘

- 规范化数据：`data/teacher_roof_monitoring.csv`
- SHA-256：`86D4C2FB192721B2745F00076AEB00CF351C654ED936DDB098BFA6217E30AC6A`
- 规模：20,000 行、11 列
- 类别：低风险 7,432；一般风险 9,830；较大风险 2,071；重大风险 667
- 生成数据：`data/roof-risk-dataset.json`
- 模型：XGBoost，算法组交付的随机划分测试准确率 99.325%，全量回放标签一致率 99.665%。原流水线在划分前进行全量平滑和标准化，且使用测试集早停；这两项指标不能直接作为独立时序泛化性能。时间留出复核见 `docs/qa/2026-10-11-competition-audit.md`。

七项数值输入为顶板离层速率、锚杆轴力增量、锚索轴力增量、支架阻力、涌水量、微震能量、距水体/岩溶体距离，另含数据质量类别，共八项模型输入。界面展示 CSV 原始值，模型推理使用卡尔曼平滑后的 `model_values`。20/45/70/95 分属于类别显示映射，综合风险分来自概率加权汇总，均未校准为物理灾害发生概率。

重新构建数据集：

```powershell
& '.\.venv-data\Scripts\python.exe' tools/data_integration/build_roof_risk_dataset.py `
  --csv data/teacher_roof_monitoring.csv `
  --model-dir ..\项目总代码交付\integrations\algorithm `
  --output data/roof-risk-dataset.json `
  --built-at '2026-09-02T13:00:00+08:00'
```

## 本地运行

```powershell
cd D:\矿业\smart-mine-v2-balanced
$env:PORT="8092"
npm start
```

浏览器打开：

```text
http://localhost:8092/
```

未登录时会跳转到统一登录页：

```text
http://localhost:8092/login
```

## 角色与权限

登录页不提供角色选择。账号经 Supabase 验证后，后端根据 RBAC 角色自动进入对应界面，并覆盖 URL 中冲突的 `portal` 参数。演示账户由超级管理员创建，密码通过现场私密账户卡提供，不写入仓库。

| 能力 | 企业端 | 监管端 | 智库端 | 只读端 | 超级管理员 |
|---|---:|---:|---:|---:|---:|
| 查看风险与保存事件 API | 允许 | 允许 | 允许 | 允许 | 允许 |
| 发起新事件、确认方案、提交/重新提交处置 | 允许 | 禁止 | 禁止 | 禁止 | 禁止 |
| 更新资源、确认重新评估 | 允许 | 禁止 | 禁止 | 禁止 | 禁止 |
| 退回整改、核验通过 | 禁止 | 允许 | 禁止 | 禁止 | 禁止 |
| 归档事件、审核复盘记忆 | 禁止 | 禁止 | 允许 | 禁止 | 禁止 |
| 重置为新保存事件 | 允许 | 禁止 | 禁止 | 禁止 | 禁止 |
| 创建账户与分配角色 | 禁止 | 禁止 | 禁止 | 禁止 | 允许 |
| 查看审计日志 | 禁止 | 禁止 | 禁止 | 禁止 | 允许 |

表中业务权限针对 `/api/multi-agent/*` 保存事件，后端从登录会话确定操作者并校验最新保存状态。只读端复用智库端的信息布局，角色为 `viewer`；超级管理员管理账户与审计，可读保存事件 API，无业务签字权限。保留的 `/api/roof-risk/select`、`closed-loop/advance` 属于旧监测/基础闭环接口，不等同于保存事件动作；选中保存事件后界面按该事件展示和签字。生产账号保存在 Supabase；Web 会话由 Render 进程管理，服务重启后需要重新登录，持久化事件不受该会话失效影响。

## 保存事件协作操作

企业端发起研判后，确认可行候选方案并提交处置工单及照片元数据。监管端可退回整改，企业端补充后重新提交；监管核验通过后由智库端归档，再填写明确的复盘审核结论，允许后续检索该案例的去身份摘要。资源更新支持部分字段和零值，资源不足时无法确认方案。重新评估须人工确认，可填写人工趋势、执行状态与原因，同一事件保留旧/新方案版本、工单、反馈和时间线，最多五个方案版本。

保存事件选择器可查看历史；“重置”发起新事件，旧事件与证据仍可读取。事件号、修订号、方案版本和实际建议来源可见。网络失败保留输入，冲突会刷新最新状态供人工核对；同一命令安全重试不会重复记账。低风险记录保持正常监测路径（`ready`/`finish`），不生成签字流程。页面轮询每十秒读取，最多六十次，之后可手动刷新。

照片原件保存在上传浏览器的 IndexedDB；服务端仅保存标为 `browser-local` 的元数据和不透明 ID。另一浏览器可获取元数据，原件需在原浏览器查看。本地双 HTTP 客户端验收已完成，真实双浏览器及新界面视觉验收仍待可用的浏览器自动化环境。

## RoofRisk API v1

平台内置接口：

```text
GET  /api/roof-risk/current
GET  /api/roof-risk/history
GET  /api/roof-risk/explain
POST /api/roof-risk/evaluate  # body: { "record_id": "REC-..." }
GET  /api/roof-risk/events
POST /api/roof-risk/select
POST /api/roof-risk/closed-loop/advance
GET  /api/multi-agent/status
POST /api/multi-agent/run      # body: { "record_id": "REC-...", "command_id": "..." }
GET  /api/multi-agent/runs
GET  /api/multi-agent/runs/:id
POST /api/multi-agent/runs/:id/actions # type, payload, command_id, expected_revision
POST /api/multi-agent/reflect  # 从保存事件读取反馈，返回反思建议
```

所有 `/api/roof-risk/*` 接口都要求有效登录会话。认证接口为：

```text
POST /api/auth/login
GET  /api/auth/session
POST /api/auth/logout
```

接口文档见：

```text
docs/api/roof-risk-api-v1.md
```

当前数据链路：

```text
老师提供的 CSV（采集及标签来源待核实）
-> 构建期卡尔曼预处理 + XGBoost 推理
-> data/roof-risk-dataset.json
-> RoofRisk API v1 标准 JSON
-> 三维孪生展示 / 企业端 / 监管端 / 智库端 / 只读端
```

多智能体决策链路：

```text
老师提供的 CSV + XGBoost四级预测
-> A1感知预警
-> A2知识检索
-> A3调度决策
-> A5资源评估
-> A4协同管控草案（dry-run，等待人工确认）
-> A6反思迭代（闭环或建议定向返回）
-> 三端人员执行、核验与复盘
```

六个 Agent 是机器研判链，企业端、监管端、智库端是人员业务链。A2 返回七维标准化特征下的相似监测示例，事故属性尚未核验。A3 候选建议按实际响应标注 `deepseek` 或 `local-rule` 及回退原因，配置完成仅表示配置存在；A3—A6 受人工确认和规则约束，不自动控制设备。复盘记忆与方案版本提供有限的改进机制，XGBoost 未在线自训练；后续 CSV 记录的风险降低也不足以证明整改因果效果。详细接口见 `docs/api/multi-agent-workflow-api.md`。

## 比赛提交资料

提交资料目录：

```text
competition_submission
```

已包含：

- `01-总体技术方案报告.docx`
- `02-平台系统设计与智能预警模型研究报告.docx`
- `03-核心算法代码`
- `04-运行说明`
- `05-演示视频录制说明.md`
- `提交物清单.md`
- `当前完成度与收尾说明.md`

## 技术栈

- Three.js
- ECharts
- Node.js
- HTML / CSS / JavaScript

## 云端部署

本节包含部署配置和2026-10-11的历史恢复记录；带“待验收”的旧状态记录对应当时版本。当前获取入口、已实现功能与研究交付见文首链接，勿将历史过程状态直接用作当前交付状态。

项目支持 Vercel + Render + Supabase 联动，不需要自定义域名。Vercel 提供 `*.vercel.app` 地址，Render 提供 `*.onrender.com` 地址。

- 生产登录页：`https://smart-mine-v2-balanced.vercel.app/login`
- 后端健康检查：`https://smart-mine-v2-balanced.onrender.com/healthz`

- Vercel：托管静态前端，并通过 `vercel.json` 代理 `/api/*`。
- Render：运行 Node API、权限校验和 RoofRisk 业务服务。
- Supabase：身份、角色和审计使用 `supabase/migrations/202609030001_rbac_foundation.sql`。新保存事件存储还需要执行增量迁移 `supabase/migrations/202610110001_workflow_runs.sql`；本次未执行该云端 SQL。旧生产与当前升级分支状态需分别验收。

本地开发默认文件存储目录为 `.runtime/workflows`，可通过 `createAppServer({ workflowStoreOptions: { directory } })` 显式指定；目录没有环境变量配置入口。`WORKFLOW_STORE_PROVIDER=supabase` 需要后端 URL、service-role key 与新迁移；生产/Render 禁用本地文件回退，数据库不可用会显示错误。文件存储恢复已通过两个独立 Node 进程验证；云端文件系统持久性和 Supabase 并发原子性仍需实际部署环境验收。

所选保存事件的当前候选方案可在公共“协同事件”卡和企业确认框查看，监管与智库从公共卡审阅同一方案。方案正文、完整建议列表、来源/降级原因与实际引用 ID 和已审核工作流检索上下文分别展示。每版保存至多 20 条去身份检索快照，含源事件/CSV ID、已有模型身份及审核版本/修订/时间；新版本保留旧版快照。A4 随人工确认、资源更新、重新研判及闭环同步状态，始终为 dry_run、external_delivery=false。

部署前复制 `.env.example` 配置 Render 环境变量。`SUPABASE_SERVICE_ROLE_KEY` 只能放在 Render，不能提交到 Git 或暴露给浏览器。Vercel 配置中的 Render 地址部署后需替换为实际服务地址。

Render 健康检查地址为 `/healthz`。现有 CSV/XGBoost 构建产物由 Render 读取；Supabase 负责身份、角色、权限与审计持久化。Render 免费实例可能发生冷启动，首次访问时应先等待健康检查恢复。

2026-10-11 恢复 Supabase 后，四个已授权生产账号的登录与会话读取均返回 200，角色正确；Render 健康检查返回 200，DeepSeek 配置接口报告已配置，但未执行实际生成。执行环境访问 Vercel 超时，用户 Chrome 截图显示生产企业端可正常登录渲染。该证据确认旧生产恢复，不确认本分支部署。新增界面视觉检查、Supabase 迁移及真实 DeepSeek 生成仍待分别完成；本次无推送、部署或账户修改。完整验收与边界见 [教师建议升级 QA](docs/qa/2026-10-11-teacher-feedback-qa.md)。

启用 `AUTH_PROVIDER=supabase` 后，超级管理员访问 `/admin`。在管理中心可以创建账户、分配企业端/监管端/智库端/只读角色、停用账户并查看审计日志。Supabase SQL 编辑器执行迁移后，需先在 Supabase Auth 中创建一个用户，再在 `profiles` 和 `user_roles` 表将其角色设为 `super_admin`；管理员创建的新账户会自动写入这两张表。`SUPABASE_SERVICE_ROLE_KEY` 仅配置在 Render。
