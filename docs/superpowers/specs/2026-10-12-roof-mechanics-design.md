# 梁—弹簧顶板模拟与独立四维预警实验设计

日期：2026-10-12。阶段：离线研究原型，参数和矿业适用范围待指导教师审阅。

## 范围与依据

按用户要求，第一项云端发布在 Supabase 管理授权及迁移处暂停。已上线系统保持现状。本实验在已有隔离工作树中开发，不更换教师 CSV、生产 XGBoost、六智能体规则或部署配置。

用户已要求自行拟定方案、自我审查并继续执行；本次采用下述保守的离线范围。涉及现场参数确认、云数据库和生产模型替换时另设人工批准。

已读交付根 README、算法训练/预处理/生成代码和 Agent 设计/服务。原算法对同一八维输入（七数值加质量）训练 RF 与 XGBoost。另一个 generate data.py 生成 432 条五数值、二分类随机模拟样本，无法作为 20,000 条教师 CSV 的生成依据。交付 Agent 正式感知链采用 rule_based，预留 backend 协议。新实验不复用其七维数据 Schema。

## 选择

1. **采用一维 Euler–Bernoulli 梁与离散线性弹簧。** 有可核查的有限元方程和解析算例，适合先实现、测试和训练可复现闭环。
2. 二维连续介质弹塑性/FEniCS 等模型可拓展围岩破坏，需要材料本构、边界和网格验证，当前先不实施。
3. 直接随机扰动指标实现更快，但缺少力学响应来源，不用于本次改进。

选择 1。模拟对象为简化、均质、细长、线弹性顶板条带及理想弹簧支护。加载步对应一系列准静力平衡，不代表真实分钟/天。支护或刚度退化是预设场景参数，不是求解器自动发现的裂纹演化。首版不计算水文、微震、层间离层、塑性、动力垮落、采空区三维结构。

## 力学求解器

SI 单位：E（Pa）、长度/宽度/厚度（m）、q（N/m）、弹簧 k（N/m）。矩形截面 I=b*h^3/12。每节点包含向下位移 w 与转角，使用两节点三次 Hermite 梁单元。总体方程为 (K_beam+K_spring)u=f，其中弹簧接固定基座、加入位移自由度对角项。

默认两端简支 w=0、转角自由，同时支持左端固支的悬臂校验。弹簧位置必须落在内部网格节点。本实验的线性弹簧允许正负反力；它是理想弹性约束，不包装为只能受压的液压支柱模型。

输出节点位移、转角、弹簧反力、边界反力、弯曲应力估计、总应变能、自由自由度残差及整体竖向平衡误差。弯曲应力由 Hermite 曲率恢复 M=EI*w''、sigma=|M|h/(2I)，网格误差通过加密检查。最大位移在各单元采样恢复，不能仅用稀疏节点替代连续场。

输入拒绝 NaN/Inf、非正材料/尺寸、负载荷/弹簧刚度、错误边界、非整数网格、端部或越界弹簧。默认 24 个单元；评估同时用 12/24/48 单元检查收敛。

独立校验包括：无弹簧简支均布荷载 w_max=5qL^4/(384EI)，悬臂端位移 qL^4/(8EI)，对称性、零载荷、载荷线性、加强支护降低位移、弱化刚度增大位移、整体平衡、2U=f^T*u。任何校验失败，停止生成正式实验数据。

## 数据与预测任务

标识：simulator_version=eb-spring-v1；dataset_version=roof-mechanics-v1；source_kind=mechanics_simulation。

四维特征严格按以下顺序提取：

| 字段 | 单位 | 含义 |
|---|---|---|
| max_deflection_mm | mm | 当前模拟条带最大挠度 |
| deflection_increment_mm_per_step | mm/加载步 | 当前挠度减上一加载步，因果计算 |
| max_support_force_kn | kN | 当前离散弹簧反力绝对值最大值 |
| max_bending_stress_mpa | MPa | 当前梁单元恢复弯曲应力绝对值最大值 |

这些是仿真观测量。梁挠度与老师 CSV 中层间离层不是同一物理量。增量也不使用 mm/d 标记。四维实验不进行七维数据降维，不填造涌水、微震等缺失指标。

每个 scenario 包含不同的几何、材料、支护与加载轨迹。范围均为工程程序验证假设，未由矿井测量校准：域内 L=6–12 m、b=1 m、h=0.30–0.60 m、E=4–20 GPa、3 个弹簧位于 L/4、L/2、3L/4，k=2–20 MN/m、承载上限=0.4–1.2 MN、抗弯拉强度=1–6 MPa。挠度筛查限值 L/250 是本实验假设，不称为煤矿法定阈值。跨度/厚度至少为 10。

基于初始单位荷载响应计算参考极限荷载 q_crit，再从 0.10–0.35*q_crit 逐步增加至 0.90–1.30*q_crit。32 个准静力步、三种场景族：仅增加荷载；弹簧刚度逐步降低（最终损失 20%–80%）；梁 E 逐步降低（最终损失 10%–45%）。退化使用加载进度平方，承载限值本身不随退化任意变化。随机数只采样假设参数，响应由方程计算。

极限利用率 r=max(w_max/w_limit, sigma_max/strength, max(|spring_force|)/capacity)。类别为 0（r<0.5）、1（0.5<=r<0.8）、2（0.8<=r<1）、3（r>=1，达到假设极限）。0.5/0.8 为实验分级阈值，不等同原教师标签和事故概率。

主要任务为根据当前四维观测预测**未来 3 个加载步内最高极限状态类别**。未来响应只进入标签，禁止进入特征。轨迹第一次 r>=1 时停止；当前 r>=1 的帧不进入预警训练。当前帧若随后 3 步可观测则保留；若较早达到极限，保留已确认的类别 3；未达到极限且不足完整未来窗口的尾帧丢弃。不计算阈值后的垮落过程。

默认生成 500 个域内场景（seed=1729）、100 个域外场景（seed=3141）。域外仅跨度为 12–14 m（不包含 12），用于独立跨度外推压力测试，不能泛称为所有域外情况。每场景保存原始参数、求解轨迹、数据来源和停止原因，CSV一行一个可监督观测。实际条数由终止条件产生，不凑满 20,000 条。

首版无传感器噪声，噪声鲁棒性验证未完成。后续须在协议预先锁定后添加噪声/缺失和独立实验验证。

## 训练、评估和存档

仅域内场景按 seed=2718 随机排列成组，60%训练、20%验证、20%最终测试，同一轨迹完全属于一组。域外场景不参加训练、早停或模型选择。归一化不需要树模型，因此不拟合全量 scaler，也不使用 Kalman 回顾平滑。

RF 与 XGBoost重新训练。RF: 200 trees/min_samples_leaf=3/class_weight=balanced/n_jobs=2/random_state=42。XGBoost: 350 rounds/depth=4/learning_rate=.05/subsample=.9/colsample_bytree=1/hist/n_jobs=2/random_state=42/early_stopping_rounds=25，仅验证集用于早停，训练集确定类别权重。

基线：训练集多数类；四维可解释浅决策树(max_depth=3)；当前极限类别延续（使用额外已知材料上限的物理参照，明确其信息条件更强）。按验证 Macro-F1 从 RF/XGB 选研究候选，再冻结模型评估测试和域外数据。各类 precision/recall、固定四类混淆矩阵、Macro-F1、重大类漏报及低类误报均输出；类别无样本则对应 recall=null，不制造完美召回。报告同时记录类别分布、场景数、行数、拆分零交集、训练版本、耗时、输出SHA256和限制。

数据/model/metrics.json 写入用户目录 D:/矿业/outputs/roof-mechanics-v1/2026-10-12，路径须新建，已有输出不覆盖。大文件不纳入 Git，仅保留源码、方案与小体量QA摘要。XGBoost保存 JSON，RF仅保存本地训练产生的joblib；不加载交付目录未知pickle。

单次合成实验验证的是假设模拟器的极限状态预测。训练指标不作为现场准确率，不宣称超过原七维模型。基线接近或超过复杂模型时照实报告。当前无需向 DeepSeek 发送 CSV 或源代码。

## 交付与未来边界

交付离线CLI、单测、数据/模型/划分清单、力学校验和结果说明。当前不加新UI、不更新云部署。以后专用backend必须明确 mechanics_simulation 来源、四维schema和标签映射，先做旁路/感知-only核验，再经人工审核决定是否接入智能体。

现场校准未完成，需教师帮助审核条带近似、边界、参数、强度和阈值。当前开发可以在这些量明确标记为假设的条件下继续。

## 已打开的参考资料

- Delft University of Technology, *Euler-Bernoulli beam elements*, Equations 4.29–4.43 and assumptions: https://teachbooks.tudelft.nl/computational-modelling/structural_linear/euler_bernouilli.html
- scikit-learn, *Cross-validation* / group-aware splitting: https://scikit-learn.org/stable/modules/cross_validation.html
- XGBoost official Python API / early stopping: https://xgboost.readthedocs.io/en/stable/python/python_api.html
- Kassis T, Agarwal V, He Y, Patel D, Brueckner AM (2026), *Scientific Agent Skills: A Library of Procedural Knowledge for Research Agents*, arXiv:2609.00065. https://doi.org/10.48550/arXiv.2609.00065 （使用其来源、方法/结果分离和不夸大证据的研究流程，未用其证明本力学模型有效）。

以上页面由 Codex 于 2026-10-12 打开核对；科学适用范围仍待人类指导教师审核。

## 自我审查结论

已分离原 CSV 与合成实验、七维与四维输入、准静力阈值与动态灾害、实验假设与现场参数、验证与最终测试、预测输入与未来标签。第一项部署暂停不阻塞本地研究。仅按此离线范围实施，不把源码完成和测试通过写成现场工程验收。
