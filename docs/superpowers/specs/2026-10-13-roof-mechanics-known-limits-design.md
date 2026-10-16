# 已知物理限值下的顶板预警消融实验

日期：2026-10-13。用途：继续老师第二项建议的离线研究原型；科学适用性待指导教师审阅。

## 问题与选择

已有梁—弹簧模拟器和 RF/XGBoost 训练闭环已完成。V1 的四项观测未输入材料抗弯强度、支护容量和跨度位移限值，标签却依赖这些量。已查看的 V1 测试集保留作历史结果，不再用于选模。本次按用户此前自主设计、审查并实施的授权继续。

采用一个小范围独立实验：保持力学方程、假设参数范围和未来三加载步的四类标签不变，比较原始四观测与使用时点已知工程限值的四维无量纲表征。另补跨中单弹簧的独立解析校验。直接换更复杂模型不能补足缺失的信息；二维破坏仿真所需本构和现场校准尚不足，留待后续。

归一化组的信息条件更强。它需要明确提供位移限值、抗弯强度和支护容量，这些量在本次均是模拟场景假设，现场可获得性待确认。结论限定为“在已知这些限值的模拟工况中”。不将旧七维 CSV 变成四维，也不把仿真四维映射到涌水、微震或层间离层。

## 力学与数据边界

复用 eb-spring-v1 的线弹性、准静力、双向接地弹簧求解器。新解析例取简支梁均布荷载 q 和跨中弹簧 k：I=bh^3/12，w0=5qL^4/(384EI)，跨中点力柔度 C=L^3/(48EI)，w=w0/(1+kC)，弹簧反力=k*w。对照跨中节点位移而非全梁最大挠度；相对误差须小于 1e-4。此为程序核验，不证明矿井灾害有效性。

生成器仅增加可选的独立域内/域外 seed，默认值与原接口保持相同。V1 标签阈值 .5/.8/1、未来窗口3、首次极限越界停止、尾窗处理和 q_crit 比例加载均保留。新实验对所有比较组统一排除 step=0，避免无上一帧时把缺省增量0当成已观测零增量。所生成行数自然决定，不凑数。

预先冻结两个重复批次，每批500个域内、100个跨度域外工况、最多32加载步：replicate-a seeds=(41101,42101,43101)，replicate-b seeds=(41102,42102,43102)，分别为域内、域外和工况划分 seed。每批完整工况60/20/20；域外从不参与训练、早停和模型选择。工况ID添加批次前缀，批次之间不合并训练，不能把批次数当成不同矿井。

## 表征与模型

raw4 顺序保持 max_deflection_mm、deflection_increment_mm_per_step、max_support_force_kn、max_bending_stress_mpa。

known_limits4 顺序固定为 deflection_utilization、deflection_increment_utilization_per_step、support_utilization、bending_utilization。对应分母为 deflection_limit_mm、同一位移限值、capacity_n/1000、bending_strength_mpa。只有当前四观测和这三个静态工程限值参与计算；不读 current_ratio、target_class、target_future_ratio、q_crit、未来荷载、退化比例、场景族或未来轨迹。缺失、非数、非有限或非正限值直接报错，不静默填造。

两个表征分别训练 RF 与 XGBoost。超参数与 V1 相同：RF200树/min_samples_leaf3/训练类别balanced；XGB350轮/depth4/learning_rate.05/subsample.9/hist/验证早停25，n_jobs2、random_state42；权重仅由训练标签计算。无全量scaler或平滑，无网格搜索，不自动更改标签。

每个表征在验证集独立选研究候选：先筛选 Macro-F1>=.50 且真实类0预测>0比例<=.20 的模型，候选中优先等级3召回，再按Macro-F1、XGBoost依次破同分。没有合格候选时按验证Macro-F1选报告对象并明确 eligible=false。阈值是本次研究选择约束，不是生产安全验收标准。选择记录在计算测试和域外分数之前冻结，查看结果后不改模型、参数、划分或规则。

保存两类基线：训练多数类；已知限值的当前类别延续。后者由当前三个利用率的最大值分类，不预报未来越界，注明其信息条件与归一化组一致、强于raw4。不凭测试成绩更换模型。

## 评价与证据

保留四类混淆矩阵、precision/recall、Macro-F1、准确率、等级3逐行低估率、类0误报率，分子分母明确。新增工况事件指标，分别对固定告警等级>=2和>=3报告：真实首次极限事件数、未来3步阳性窗口中至少一次告警的事件数/比例、最早及时告警距越界的加载步数；未达到极限的工况中发生告警的比例单列为告警负担，不能把所有接近极限告警都叫错误。

事件真值来自完整轨迹的首次r>=1；模型输入不接触该轨迹。提前量只在已确认越界事件的阳性窗口中计算，单位为加载步，范围1–3。没有相关事件时分母0、比例null。首帧与告警早于窗口的情况不得计入及时发现。

两批重复结果分别报告，再给出描述性范围；不把两点范围写成置信区间。存储原始场景轨迹、raw和normalized观测、模型原生JSON、本地训练RF joblib、划分、预测、metrics、协议、源码版本/哈希及SHA256文件清单。回读独立核对输入转换、未来标签、工况隔离、模型JSON重载预测、指标分母与文件覆盖。未经审核的pickle不加载。

输出使用新目录 D:/矿业/outputs/roof-mechanics-known-limits/2026-10-13，存在即拒绝，不覆盖V1。保留所有失败/成功研究结果。教师CSV前后哈希应一致；Git只提交源码、测试和小体量结果说明。网站、Agent、生产模型和部署配置不改动、不推送云端。

## 未验证内容

现场参数与阈值、真实时间尺度、层间离层、水文/微震、单向支护接触、塑性、裂纹演化、动态垮落和噪声/缺失鲁棒性仍未验证。q_crit比例轨迹是人为构造，不代表现场事故发生率；新测试仍来自相同模拟器。本实验完成可交付可复現研究链路，生产接入需另行审核。

## 已打开的依据与自审

- Delft, Euler–Bernoulli beam elements §4.1，式4.29–4.43：https://teachbooks.tudelft.nl/computational-modelling/structural_linear/euler_bernouilli.html
- scikit-learn 1.7.2 分组评估：https://scikit-learn.org/1.7/modules/cross_validation.html
- XGBoost 3.2系列官方早停API：https://xgboost.readthedocs.io/en/release_3.2.0/python/python_api.html
- Kassis T, Agarwal V, He Y, Patel D, Brueckner AM (2026), Scientific Agent Skills: A Library of Procedural Knowledge for Research Agents：https://doi.org/10.48550/arXiv.2609.00065。用于证据与报告流程，不作为矿井力学验证依据。

以上由Codex于2026-10-13打开核对，人工科学复核待完成。自审已分离已知工程参数与未来标签、两个表征的信息条件、V1历史与新测试、逐行低估与事件告警、离线研究与生产发布；无待填内容。
