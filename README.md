# 煤矿顶板灾变智能预警与可视化决策系统

本项目面向“基于数字孪生的煤矿顶板灾变智能预警与可视化决策系统”比赛题目，提供已上线的三维数字孪生平台、多角色协同管控页面和 RoofRisk API v1 多源风险接口。

当前版本已完整接入老师提供的 20,000 行真实监测 CSV 和现有 XGBoost 模型。构建期 Python 工具执行源文件校验、按设备时间切段、卡尔曼平滑、标准化、数据质量编码与 XGBoost 推理，生成确定性 JSON；运行期由 Render 上的 Node 服务通过 RoofRisk API v1 向各角色提供一致结果，Supabase 持久化账户、角色、权限和审计数据。

## 主要功能

- 三维数字孪生：基于 Three.js 展示井下巷道、工作面、设备、风险场和灾变过程。
- 顶板风险场：支持应力场、位移场和综合风险场切换。
- 六阶段灾变演示：覆盖正常监测、应力集中、离层扩展、支护异常、垮落预警、应急处置。
- 多角色协同闭环：企业端负责现场监测与处置，监管端负责区域态势和闭环督办，智库端负责模型解释和复盘，只读端用于受限查看，超级管理员负责账户与权限管理。
- 算法预警与六智能体研判：XGBoost 负责 A1 感知预警，随后按 A2 知识检索 → A3 调度决策 → A5 资源评估 → A4 协同管控 → A6 反思迭代执行可审计状态流转。
- 统一接口：RoofRisk API v1 统一真实输入、四级概率、综合风险、特征证据、预警事件和闭环状态。
- 模型审计：智库端并列展示真实标签、XGBoost 预测、置信度、模型准确率、记录号与数据哈希。

## 真实数据与模型血缘

- 规范化数据：`data/teacher_roof_monitoring.csv`
- SHA-256：`86D4C2FB192721B2745F00076AEB00CF351C654ED936DDB098BFA6217E30AC6A`
- 规模：20,000 行、11 列
- 类别：低风险 7,432；一般风险 9,830；较大风险 2,071；重大风险 667
- 生成数据：`data/roof-risk-dataset.json`
- 模型：XGBoost，算法组交付的随机划分测试准确率 99.325%，全量回放标签一致率 99.665%。原流水线在划分前进行全量平滑和标准化，且使用测试集早停；这两项指标不能直接作为独立时序泛化性能。时间留出复核见 `docs/qa/2026-10-11-competition-audit.md`。

七项数值输入为顶板离层速率、锚杆轴力增量、锚索轴力增量、支架阻力、涌水量、微震能量、距水体/岩溶体距离，另含数据质量类别，共八项模型输入。界面展示原始测量值，模型推理使用卡尔曼平滑后的 `model_values`。

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
| 查看风险与事件 | 允许 | 允许 | 允许 | 允许 | 管理中心 |
| 推进处置 | 允许 | 允许 | 禁止 | 禁止 | 禁止 |
| 归档事件 | 禁止 | 允许 | 禁止 | 禁止 | 禁止 |
| 重置闭环 | 允许 | 禁止 | 禁止 | 禁止 | 禁止 |
| 创建账户与分配角色 | 禁止 | 禁止 | 禁止 | 禁止 | 允许 |
| 查看审计日志 | 禁止 | 禁止 | 禁止 | 禁止 | 允许 |

后端会再次校验每项权限，不能通过修改前端或直接调用 API 越权。只读端复用智库端的信息布局，但角色仍为 `viewer`，不继承写权限。生产账号保存在 Supabase；Web 会话由 Render 进程管理，服务重启后需要重新登录。

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
POST /api/multi-agent/run      # body: { "record_id": "REC-..." }
POST /api/multi-agent/reflect  # 基于运行结果和现场反馈生成定向返回建议
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
老师真实 CSV
-> 构建期卡尔曼预处理 + XGBoost 推理
-> data/roof-risk-dataset.json
-> RoofRisk API v1 标准 JSON
-> 三维孪生展示 / 企业端 / 监管端 / 智库端 / 只读端
```

多智能体决策链路：

```text
真实CSV + XGBoost四级预测
-> A1感知预警
-> A2知识检索
-> A3调度决策
-> A5资源评估
-> A4协同管控草案（dry-run，等待人工确认）
-> A6反思迭代（闭环或建议定向返回）
-> 三端人员执行、核验与复盘
```

六个 Agent 是机器研判链，企业端、监管端、智库端是人员业务链，两者不能混称。A2 返回的是七维标准化特征下的数据相似记录，不等同于已核验事故案例；A3—A6 当前属于规则辅助研判，不代表生产级自动控制。详细接口见 `docs/api/multi-agent-workflow-api.md`。

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

项目支持 Vercel + Render + Supabase 联动，不需要自定义域名。Vercel 提供 `*.vercel.app` 地址，Render 提供 `*.onrender.com` 地址。

- 生产登录页：`https://smart-mine-v2-balanced.vercel.app/login`
- 后端健康检查：`https://smart-mine-v2-balanced.onrender.com/healthz`

- Vercel：托管静态前端，并通过 `vercel.json` 代理 `/api/*`。
- Render：运行 Node API、权限校验和 RoofRisk 业务服务。
- Supabase：执行 `supabase/migrations/202609030001_rbac_foundation.sql`，保存用户角色、权限和管理员操作审计。迁移含事件/动作表，但当前演示工单、照片与三端状态尚未写入这些表；工单状态在同浏览器 localStorage，照片在 IndexedDB，服务端基础闭环在进程内存。跨设备同步和重启后的服务端闭环恢复仍需接入持久化。

部署前复制 `.env.example` 配置 Render 环境变量。`SUPABASE_SERVICE_ROLE_KEY` 只能放在 Render，不能提交到 Git 或暴露给浏览器。Vercel 配置中的 Render 地址部署后需替换为实际服务地址。

Render 健康检查地址为 `/healthz`。当前真实 CSV/XGBoost 构建产物由 Render 读取；Supabase 负责身份、角色、权限与审计持久化。Render 免费实例可能发生冷启动，首次访问时应先等待健康检查恢复。

启用 `AUTH_PROVIDER=supabase` 后，超级管理员访问 `/admin`。在管理中心可以创建账户、分配企业端/监管端/智库端/只读角色、停用账户并查看审计日志。Supabase SQL 编辑器执行迁移后，需先在 Supabase Auth 中创建一个用户，再在 `profiles` 和 `user_roles` 表将其角色设为 `super_admin`；管理员创建的新账户会自动写入这两张表。`SUPABASE_SERVICE_ROLE_KEY` 仅配置在 Render。
