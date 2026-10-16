# 交付算法与六 Agent 只读核验

核验时间：2026-10-12。目录：`D:/矿业/算法Agent总代码交付`。用途：第二项力学模拟改进的设计依据。未执行交付脚本、反序列化未知 pickle 或调用外部接口，原文件保持不变。

## 原模型究竟用了什么

原 20,000 条数据同时用于随机森林与 XGBoost 单点四分类。`algorithm/揭榜挂帅/train_model.py:316` 将同一份 pointwise 数据分别送入两模型，`:341` 依据所报告测试 Macro-F1 选择模型。两者独立横评，没有实现模型投票融合。网站目前接入的是构建期 XGBoost 结果。

`preprocess_data.py:38` 定义七项数值（离层速率、锚杆轴力增量、锚索轴力增量、支架阻力、涌水量、微震能量、水文地质距离），`:184` 另拼一项数据质量，`:188` 直接编码 CSV 中的风险等级。数据质量在该 CSV 内全为正常。原文件没有可以核对的采集地点、标签评审过程和事故记录，故统一写作“教师/算法组提供的 CSV”。

CSV SHA-256：`86D4C2FB192721B2745F00076AEB00CF351C654ED936DDB098BFA6217E30AC6A`。20,000 行、11 列的既有逐行核验见 `2026-10-11-competition-audit.md`。哈希验证文件一致性，不证明采集真实性。

`metrics.json:2` 保存 RF 准确率 0.99325、Macro-F1 0.9908087；`:86` 保存 XGBoost 准确率 0.99325、Macro-F1 0.9910074。这里均为交付随机划分的 4,000 条测试口径，不能写为跨矿井或独立时序验证。MOA 测试支持数为 3,964，测试对象也有差异。

## 需要保留的评估限制

- `preprocess_data.py:163` 在划分前拟合 Kalman，`:167` 对全时间段做回顾性平滑，`:177` 全量拟合 StandardScaler；`:200` 之后才随机切分。平滑能使用段内未来值，预处理也见到了后续测试记录。
- `preprocess_data.py:114` 先创建重叠滑窗，`:206` 随机拆分窗口，可能把同一原始帧分到训练和测试窗口。
- `train_model.py:204` 使用测试集早停 XGBoost，随后报告同一集合的指标，`:341` 又用测试表现选最佳模型。独立最终测试仍需另行定义。
- `fastapi_inference.py:176` 直接标准化输入，没有复现训练期 Kalman 平滑。接口检查的 11/11 只检查响应结构；`test_report.json:59` 中低风险代表输入预测为一般风险仍通过，不能把接口通过数当作预测准确数。

## 随机生成脚本与教师数据的区别

`algorithm/揭榜挂帅/generate data.py:7` 生成 `mock_mine_data.csv`。它用正态/泊松数产生 432 条、五数值、二分类样本，最后 60 帧叠加趋势、最后 40 帧设标签为 1。代码没有力学方程，且不生成主训练的 `demo_training_data.csv`。

该脚本可用于接口演示，不能作为新的力学模拟生成器，也无法据此认定主 CSV 的标签来源。

## 六 Agent 的真实运行机制

`agent/agent 代码/app/agent/workflow.py:16` 建立感知→知识→决策→资源→管控→反思条件链。`app/services/perception_warning_service.py:122` 是确定性服务，模式为 `rule_based`。`app/agent/subagents/perception_warning_agent.py:25` 预留 backend 协议，构造时默认规则实现。MOA 接入是设计接口，不等于代码已经加载该模型。

`app/services/knowledge_retrieval_service.py:13` 使用本地知识目录，决策/资源/反思使用策略服务。`workflow_nodes.py:171` 以 dry_run 方式生成管控，`:214` 关闭自动循环和自动更新。`workflow_runner.py:122` 支持满足人工确认等条件后的定向恢复。“六 Agent”描述职责和执行单元，不应解释为六个已经训练完成的神经网络。

现有 fusion Schema 在 `app/schemas/workflow.py:164` 要求七连续变量和质量/时间元信息，`:17` 禁止额外字段。四维梁力学输出不能直接塞入旧 schema；位移、离层、工作阻力、弹簧力和应力有各自物理含义、单位与聚合方式。

## 本次采用的安全复用范围

复用 RF/XGBoost 算法类别、四类指标和显式状态机思想。另写梁—弹簧方程、数据契约、极限状态标签、工况分组和独立训练器。保留原 CSV 与线上模型，合成数据不与旧 CSV 混合评估。

新模型先以离线实验运行。若后续接入 Agent，需独立 mechanics_simulation schema、实际模型版本、来源标记与标签映射，再用感知-only或旁路对比核验后续决策影响。

本核验与方案使用 scientific-writing 的证据来源/适用范围约束；研究成果对外表述仍需指导教师审核。力学设计及官方参考见 `../superpowers/specs/2026-10-12-roof-mechanics-design.md`。
