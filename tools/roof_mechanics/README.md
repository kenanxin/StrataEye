# 梁—弹簧四维预警离线实验

## 新种子模拟工况的冻结模型复核（2026-10-13）

`fresh_cohort_study` 使用原 `replicate-a/b` 的 `known_limits4` 原生 XGBoost 分别评估两组新工况。每组默认生成 100 域内和 100 域外工况、请求 32 加载步，共 400 工况；新种子固定为 51101/52101 与 51102/52102。全部排除 step 0 后的有监督观测仅用于 `fresh_in_domain`、`fresh_ood` 评估。原验证选择作为来源元数据保留，新复核模型预先指定，不拟合、不重新选择模型。27 个中心偏差条件、±20% 假设采样宽度、27 点网格和三种候选沿用既有评估器，输出全部 324 个评分、108 个预测记录及复核摘要，没有性能通过阈值。

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.fresh_cohort_study --output-dir 'D:\矿业\outputs\roof-mechanics-fresh-cohort\2026-10-13'
```

该命令供独立任务审查通过后正式运行。默认源为 `D:/矿业/outputs/roof-mechanics-known-limits/2026-10-13`，清单 SHA-256 固定为 `031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537`；替代源须显式提供 `--source-dir` 和 `--expected-manifest-sha256`。可记录显式的 `--in-domain-scenarios`、`--ood-scenarios` 正整数及 `--steps`≥4 整数配置，主要用于小规模测试。输出目录必须全新且与源不重叠。失败目录保留供检查，下一次运行使用新的目的地。

首次生成前写入 `protocol.json`，固定模拟器、求解器、评估器和测试代码哈希、软件版本、完整源文件哈希、原生模型哈希、教师 CSV 哈希、网格、分组和可复现命令。十文件存档包含协议、结果、预测、CSV、源前后核验、回读、清单、工况不重复核验，以及 `cohorts/fresh-replicate-a/dataset.json` 和 `cohorts/fresh-replicate-b/dataset.json` 的完整参数、原始行、轨迹、求解核验与元数据。清单覆盖除自身之外的九文件。工况指纹采用 `{domain,family,parameters}` 的排序紧凑 JSON SHA-256，检查原/新及新/新参数重复和全局工况 ID 唯一性。

`readback_fresh_cohort(output_dir)` 独立重建原始行和归一化分母、逐项复核全部预测、评分、摘要和 CSV，并按协议重新生成两组数据，比较完整存档。重放验证确定性，仍来自同一模拟器。评分后执行一次完整审计并冻结清单，最后只复核文件哈希和元数据，避免再次生成和预测。源模型、源存档和教师 CSV 保存前后核验记录；回读只加载原生模型，不加载外来 pickle。

研究范围固定为 `fresh_seed_same_simulator_recheck`。新种子提高了同模拟器内的工况独立性；模型形式、限值、加载机制及无传感器噪声假设仍共享。有限采样上下类别仅描述所采样网格，±20% 没有现场误差分布依据，连续参数域保证、置信界限、现场校准和生产连接均未建立。人类科学审核待完成，`submission_ready=false`。

## 冻结存档的限值误差有限采样评估器（2026-10-13）

`uncertainty_study` 读取已知限值实验的原存档，预先指定两组保存的 `known_limits4` 原生 XGBoost，在原 test/ood 行索引上评估。保留原 19 个中心偏差条件，另加三项限值共同取 ±20% 的 8 个角点，共 27 个条件。每个中心固定采样 `{-20%, 0, +20%}³` 的 27 个组合；位移及位移增量共享位移因子。中心矩阵为精确归一化观测除以各项 `1+中心偏差`，采样矩阵再乘以 `1+候选误差`。输出中心预测、采样最高类别和估计当前限值参照的 324 个行级/告警 2、3 级事件评分，以及 108 个复核摘要。

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.uncertainty_study --output-dir 'D:\矿业\outputs\roof-mechanics-uncertainty\2026-10-13'
```

上例供任务独立审查通过后正式运行。默认源路径和源清单哈希与限值估计误差压力评估相同；替代源须同时显式提供 `--source-dir`、`--expected-manifest-sha256`。输出目录必须全新且与来源路径不重叠，失败产物保留。运行前回读源存档并检查原生模型四特征、四类契约；评分前 `protocol.json` 固定代码/测试和源文件 SHA-256、模型路径与哈希、软件版本、网格、参数名及可复现命令。该流程不拟合或重新选择模型。

`predictions.json` 按原 split 行索引和条件 ID 保存中心、采样上下类别、实际采样类别集合、复核标志及类 3 可能标志。摘要同时报告复核行/工况比例、标记与未标记的中心类 3 低估、采样最高类别为 3 的中心低估，以及真实未来类别的区间覆盖和实际类别集合覆盖。标记/未标记的类 3 低估以真实未来类 3 总行数为分母；最高采样类 3 的捕获比例以中心类 3 低估行数为分母。所有比例保留分子、分母，零分母记 JSON null、CSV 空值。`comparison.csv` 保留全部 324 行，包含误报、严重低估及复核负担，避免只展示有利条件。

`readback_uncertainty(output_dir)` 校验完整文件集合、清单和代码/来源哈希，从原始四项观测和原参数独立重建中心分母，再除以 `1+候选误差` 后预测；该审计不复用生产采样函数或中心矩阵转换。原 exact 条件的中心及物理参照逐项对照原存档。教师 CSV 和完整源存档在评分后再次回读。

这是同一模拟来源上的事后探索性有限采样，±20% 为假设宽度；采样上下类别不构成连续参数域保证或置信界限。现场校准、生产连接及人类科学审核仍待完成。

正式单次运行的完整指标、严重低估、误报与复核负担见[有限采样结果](../../docs/qa/2026-10-13-roof-mechanics-uncertainty-results.md)，其证据记录链接全部 324 行 CSV 和冻结档案。

## 已保存模型的限值估计误差压力评估（2026-10-13）

独立的事后分析只读取上述已知限值实验的原始存档，加载两组 `raw4` 和 `known_limits4` 原生 XGBoost 模型。固定网格包含精确限值，以及对位移限值、支护容量、抗弯强度分别施加 ±5%、±10%、±20% 相对误差，共 19 个条件。每次只改变一个用于特征归一化和当前限值参照的估计分母；真实物理参数、轨迹、目标、首次越界事件及 test/ood 划分保持原样。`raw4` 仅在精确条件下作四组参照，因此输出 156 行评分网格。误差幅度是假设值，没有现场测量分布依据。

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.limits_sensitivity --output-dir 'D:\矿业\outputs\roof-mechanics-limits-sensitivity\2026-10-13'
```

默认输入为 `D:/矿业/outputs/roof-mechanics-known-limits/2026-10-13`，要求源清单 SHA-256 为 `031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537`；也可显式传 `--source-dir` 和必需的 `--expected-manifest-sha256`。输出目录必须全新且不得与输入重叠。先执行原存档回读，正式流程不拟合或重新选择模型。输出的 `comparison.csv` 保留所有评分及分母，缺失分母的比例在 JSON 中为 null、CSV 中为空；`readback_sensitivity` 独立重建归一化分母、预测、行级和事件指标，并校验源与教师 CSV 哈希。

实际数值、方法边界及审计记录见[限值误差分析](../../docs/qa/2026-10-13-roof-mechanics-limits-sensitivity-results.md)。首轮已冻结的正式协议缺少评分前评估器代码哈希；单独的同数据技术复核保存在 `D:/矿业/outputs/roof-mechanics-limits-sensitivity/2026-10-13-provenance-verification`，其协议在评分前记录七个代码哈希，`reproducible_command` 表示可复现命令。两轮完整结果、预测和 CSV 一致；首轮缺项仍保留。本分析是 `mechanics_simulation` 的固定模型压力评估，不能当作现场误差分布、独立模型性能试验或生产预警准确率。

## 已知工程限值消融（2026-10-13）

另设冻结实验比较 `raw4` 与 `known_limits4`。两者使用相同的新工况、按工况隔离的 60/20/20 分组和四个当前观测，并统一排除 step 0。后者依次以工况的假设位移限值、位移限值、支护容量（kN）和抗弯强度除四项原始观测。这些精确限值直接来自模拟器参数，信息条件强于 `raw4`；现场能否可靠获得这些值仍待验证。类别阈值、未来三个加载步最高类别、首次越界停步和尾窗规则沿用 V1。加载步没有物理时间单位。

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.run_known_limits --output-dir 'D:\矿业\outputs\roof-mechanics-known-limits\2026-10-13'
```

命令只接受全新输出目录；默认各生成两组独立的 500 域内、100 域外工况，每工况请求 32 步。RF/XGBoost 参数、种子、验证集早停和选择准则固定在 `protocol.json`。每个协议分别在验证集筛选 Macro-F1≥0.50、低类误报比例≤0.20 且存在真实类 3 的候选，再按类 3 召回、Macro-F1、XGBoost 平手优先排序；若均不合格，则选验证 Macro-F1 最高者并标记 `eligible=false`。测试与域外仅在选择冻结后评估。所有模型及训练多数类、已知限值当前类别参照均留存行级和告警 2/3 级事件指标；无分母处记为 null。

每组保存原始/归一化观测、轨迹、分组、预测、指标、RF 本地 joblib 和 XGBoost 原生 JSON。`manifest.json` 覆盖除自身外全部文件；回读重建未来目标及归一化特征，复核事件指标和验证选择，原生重载 XGBoost。外来 pickle 不参与回读。证据和结果记录见[本次消融结果](../../docs/qa/2026-10-13-roof-mechanics-known-limits-results.md)。该模拟器是未校准的 Euler–Bernoulli 梁及接地弹簧筛查模型；其结果不能外推为现场准确率、噪声鲁棒性或实时垮落预报。力学形式、工况分组和验证早停参见 [Delft 梁单元教材](https://teachbooks.tudelft.nl/computational-modelling/structural_linear/euler_bernouilli.html)、[scikit-learn 分组评估说明](https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-iterators-for-grouped-data)及 [XGBoost 官方 Python API](https://xgboost.readthedocs.io/en/stable/python/python_api.html)。

本目录实现简化 Euler–Bernoulli 顶板条带、接地线性弹簧、因果标签和独立 RF/XGBoost 训练。使用已审阅的[实验设计](../../docs/superpowers/specs/2026-10-12-roof-mechanics-design.md)，输出来源固定为 `mechanics_simulation`。现场材料参数、筛查极限和矿业适用性仍待教师审核。

输入按固定顺序提取四项当前观测：`max_deflection_mm`（mm）、`deflection_increment_mm_per_step`（mm/加载步）、`max_support_force_kn`（kN）、`max_bending_stress_mpa`（MPa）。目标为未来三个已观测加载步中的最高极限状态类别。加载步表示准静力平衡序列，没有真实分钟或天的映射。当前已达到极限的帧不作为预测输入；不足完整窗口的尾帧仅在确认首次极限越界时保留。

利用率采用位移/假设位移限值、弯曲应力/假设强度、弹簧力/假设容量三者最大值，阈值为 0.5、0.8、1.0。四类为低利用率、中等利用率、接近假设极限、达到假设极限。它们与教师 CSV 风险等级的语义不同。

## 运行

在仓库根目录使用已有科学环境，无需安装包。输出目录须不存在；下例是本次默认实验位置，再运行时需换成新的明确目录。

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.run_experiment --output-dir 'D:\矿业\outputs\roof-mechanics-v1\2026-10-12'
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_*.py' -v
node --test
```

可显式设置 `--in-domain-scenarios`、`--ood-scenarios`、`--steps`；训练至少需要十个有监督观测的域内工况，并要求训练标签覆盖固定四类。输出数量受首次越界和未来窗口限制决定。失败输出应保留供检查，已有目录一律拒绝覆盖。

## 评估协议

域内工况先按 seed=2718 打乱，再完整分配到 60%/20%/20% 训练、验证、最终测试组，训练数 `int(.6*n)`、验证数 `int(.2*n)`、测试为剩余。跨度 `(12,14] m` 的域外工况仅用于最后的压力测试。没有全量标准化、回顾平滑或滑窗随机拆分。[scikit-learn 的分组评估说明](https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-iterators-for-grouped-data)解释了相关观测应按组隔离的原因。

RF 固定 200 棵树、叶最小样本 3、训练类别平衡；XGBoost 固定最多 350 轮、深度 4、学习率 0.05、样本采样 0.9、列采样 1、hist、验证集 mlogloss 早停 25 轮。二者 n_jobs=2、random_state=42。XGBoost 样本权重仅由训练标签决定。[官方 API](https://xgboost.readthedocs.io/en/stable/python/python_api.html#xgboost.XGBClassifier)说明早停采用 eval_set 的验证指标。本实现先比较验证 Macro-F1，平分选 XGBoost，冻结选择后才计算测试与域外指标。

基线包含训练多数类、同四维观测的 max_depth=3 浅树，以及 `current_class` 延续参照。后者需要已知工况材料强度、容量和跨度位移限值，信息条件强于四维模型。它沿用当前类别，所有当前帧类别小于 3，故无法报出未来类别 3。`high_class_false_negative` 统计真实未来类别 3 而预测小于 3 的分级漏识别/低估，分母为真实类别 3 行数；预测 2 仍可能构成较低等级预警。本次未定义事件级告警策略，不能将这个比例直接解释为所有现场预警的漏报率。四类混淆矩阵和类支持数始终保留，零支持的 recall 为 null，极限类分级漏识别和低类误报同时报告计数与分母。

## 文件与核验

输出包含 `observations.csv`、完整 `scenarios.json` 参数及求解轨迹、`metadata.json` 标签与来源定义、`verification.json` 力学校验、`splits.json` 完整工况 ID/行索引、`metrics.json` 全模型与基线指标/参数/版本/早停历史、`source-manifest.json` 源码哈希与教师 CSV 前后哈希、`readback.json` 回读结果、`manifest.json` 完整文件 SHA-256。大文件置于 outputs，不纳入 Git。

XGBoost 保存原生 JSON，并回读核对四特征、四类和测试预测一致性。RF/浅树只保存本地刚训练的 joblib，不反序列化外来 pickle。存档 JSON 使用 `allow_nan=False`；XGBoost 参数中的原生缺失哨兵 NaN 用明确文字记录，特征本身拒绝任何非有限值。

## 解释边界与原交付来源

各工况的抗弯强度和支护容量会变化，四维观测不包含这些潜在参数；同一应力或弹簧力可对应不同利用率。加载轨迹刻意采样参考 `q_crit` 的比例，类别分布由实验设计构造，不表示矿井事件发生率。现阶段无传感器噪声验证、现场参数校准、动态垮落验证或生产系统连接。数值结果仅描述这个模拟器和固定评估协议，不能推导现场准确率。梁位移也不能直接替代层间离层。

原始 20,000 行教师/算法组 CSV 同时用于 RF 与 XGBoost；原输入为七数值加数据质量，任务为单点风险分类。`D:/矿业/算法Agent总代码交付/algorithm/揭榜挂帅/preprocess_data.py:163,167,177,200,206` 显示全量 Kalman/回顾平滑、全量 scaler 和后续随机拆分；`train_model.py:204,316,341` 显示测试早停、同数据横评与按测试指标选模。`generate data.py:7` 的随机演示生成器另产 432 条五数值二分类样本，无法证明主 CSV 的生成来源。原 `metrics.json` 的 99.325% 与本实验目标、观测、数据来源和评估协议均不同，不作为本实验的性能对照。完整来源定位见[交付只读核验](../../docs/qa/2026-10-12-delivered-algorithm-agent-audit.md)。

梁单元依据 [Delft Euler–Bernoulli 教材 §4.1，式4.29–4.43](https://teachbooks.tudelft.nl/computational-modelling/structural_linear/euler_bernouilli.html)；解析位移、网格应力收敛、平衡与能量校验支持程序验证，矿井适用性需另行证据。研究记录遵循 scientific-writing 的来源绑定和适用范围约束；该流程参考 Kassis 等（2026），[Scientific Agent Skills](https://doi.org/10.48550/arXiv.2609.00065)，用于写作与证据管理。人类科学审核尚待完成。
