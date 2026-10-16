# 新种子队列复核：技术与科学审核状态

Task 1 技术门禁为 Spec compliant / Quality Approved（均无 findings），冻结基线 085dfa9de1b6f126396289dd76c55be937f1c547。Task 2 自审核与独立审阅完成，Spec compliant / Quality Approved（均无 findings）；本阶段整阶段初审及定向复审已完成，两处文档问题均已解决；批准范围为离线技术交付。 [claim:C106] [evidence:E09,E12,E14,E15,E16]

human_scientific_approval=pending、literature_human_verification=pending、submission_ready=false、no_live_integration=true。人类须审核科学解释、数据/模型边界、负面结果及流程引用；最终整阶段技术审查已依据独立审阅关闭。 [claim:C107] [evidence:E01,E10,E12,E16]

## 自核对结论与保留问题

唯一正式调用 exit 0；10 个正式文件、9 个清单成员、324 cells、108 summaries、108 prediction records 和 324 CSV rows 均通过内置 audit。轻量核对额外确认源 26 个文件、原生模型、教师与 14 个代码/测试/helper 哈希保持。全部参数指纹与 ID 在原 1200 + 新 400 工况之间唯一。 [claim:C108] [evidence:E04,E05,E07,E08,E12]

精确 A 新域内 U 残留 1/201 类 3 行低估，等级 3 事件检出为 67/67；强度 +20% 同组 U 残留 4/201 行低估且等级 3 及时检出 66/67。这两个条件分别记录，行级低估未直接等同为整事件漏检。 [claim:C109] [evidence:E02,E03]

强度 +20% 四组 U 残留低估 4/201、2/207、5/198、3/189，joint 最大 U 低估 8/201、3/207、7/198、7/189。A 新域内 joint PMP/PPP 各 1/201 中心低估未被 review flag 标记。精确 A 新域内采样区间/类别集合有 4/5 行覆盖缺失，其余精确组各有 1 行集合覆盖缺失。 [claim:C110] [evidence:E02,E03]

精确 U 低类误报 282/592、284/606、273/601、275/639；等级 3 非极限告警 27/33、26/31、32/34、32/37。精确/强度 +20% 全部四组 100/100 工况至少一行标记，复核行约 80%–82% / 67%–69%。这些输出仅提示潜在处理负担；未进行人工修正或测量资源成本。 [claim:C111] [evidence:E02,E03]

报告保留八个 joint 条件全部主要 adverse 计数及独立最大值的完整 ties，全部 324 行 CSV 可访问。旧 test/ood 与新 fresh_in_domain/fresh_ood 是不同总体，描述性对照分别保留计数与分母；未作显著性、因果改善、池化或现场可靠性结论。 [claim:C112] [evidence:E02,E03,E11]

## 解释边界和后续门禁

新种子与非重复参数审计增强本次模拟样本的可追踪性；同一生成器、假定误差宽度、有限 27 点、未来三步标签和无噪声假定限制外推。确定性重放验证存档可再现性，现场物理独立性、误差校准、处置成本及生产有效性仍未取得证据。 [claim:C113] [evidence:E01,E04,E06A,E06B,E07]

本次无性能接受阈值。Task 1 的历史验证模型选择原样保留，不将其阈值用于决定本次通过。独立 Task 2 reviewer 已核验四份 QA 与正式档案，全阶段技术复核已依据初审与定向复审完成关闭；科学解释、文献与提交状态保留人工审核门禁。 [claim:C114] [evidence:E01,E09,E12,E14,E15,E16]

scientific-writing 用于证据映射、负面发现完整报告和各统计分母对照；其 Kassis 等 2026 arXiv 流程引用仅说明写作方法，根控制器已打开当前记录核对元数据，人工文献核验 pending。无外部文稿/数据传输。 [claim:C115] [evidence:E10,E12]

## 归档记录

Task 2 独立审阅原始结论见 `2026-10-13-roof-mechanics-fresh-cohort-task2-review.md`。执行记录和绑定需求已按字节原样移入同一 QA 目录；证据清单保留原输入路径并更新可读归档路径。
