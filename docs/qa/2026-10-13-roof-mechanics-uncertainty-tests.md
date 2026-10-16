# 限值误差有限采样测试与正式运行记录

工作目录 `D:/矿业/worktrees/teacher-feedback-v1`；现有解释器 `D:/矿业/smart-mine-v2-balanced/.venv-data/Scripts/python.exe`，均使用 `-B`。正式基于已审阅的 `9d8f89f`，评分期间代码、测试和环境冻结。

## TDD 与实现核验

Task 1 聚焦测试最终 10/10 通过（独立审查记录报告的 GREEN；本次未重跑）。Task 2 聚焦命令如下：

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p test_uncertainty_study.py -v
```

最初 RED 为缺少模块，`Ran 1 test in 0.000s`、`FAILED (errors=1)`。实现首跑在临时篡改夹具重写 JSON 时触发 exclusive-write 的 `FileExistsError`，19.489 秒；修复夹具后 1 项测试 26.053 秒通过。补充手算测试期间的一次代码编辑触发 `analysis code hash mismatch`，2 项测试 42.630 秒、1 error；预评分哈希正确拒绝了变化，随后冻结代码重跑。

最终聚焦实际输出：

```text
test_frozen_integration_and_independent_tamper_audit ... ok
test_independent_denominators_and_summary_denominators ... ok
Ran 2 tests in 36.042s
OK
```

完整 Python suite 在实现结束时只执行一次：

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_*.py' -v
```

实际 `Ran 54 tests in 68.216s`、`OK`、退出码 0。正式评分后未重复训练夹具、全套测试或另一轮正式分析。未改 Node/web/server，因此未运行 Node suite。

测试核对 27 个不同中心偏差、324 评分单元、108 摘要、固定宽度和范围；no-fit guard 前仅建立 `run_study(source,10,2,12)` 临时夹具。新 runner 期间 XGBoost/RF `.fit` 均被禁止。另验证错误/大写哈希、路径重叠、覆盖拒绝、评分前全部 11 个分析代码/测试哈希、exact 原始中心和参照、独立分母手算、上下界与实际类别集合差异、空分母 null、CSV 篡改和重新哈希预测篡改拒绝，以及源档案/教师 CSV 字节保持。

## 正式单次调用与实际输出

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.uncertainty_study --output-dir 'D:\矿业\outputs\roof-mechanics-uncertainty\2026-10-13'
```

退出码 0。实际 stdout 为 Python summary dict，包含 `passed: True`、`cells_checked: 324`、`summaries_checked: 108`、`predictions_checked: 108`、`csv_rows_checked: 324`、`independent_denominator_reconstruction: True`、`analysis_code_provenance: pre_scoring_code_hashes_verified`、`checked_files: 6`；清单 SHA-256 为 `f377f7c385ef2e26926818f76b797baf9b31c494a0b9ccf9c6b3f0744a7fef46`。工具终端对中文路径显示编码乱码，源 JSON 路径和字节哈希正常，未据显示重写产物。完整 selections 输出显示两组 known_limits4 原验证选择均为 XGBoost，`eligible: True`，原选择被保留。

原始协议起始时间 `2026-10-13T12:19:47.243483+00:00`。PowerShell JSON 日期对象转换曾显示本地 +08:00，经原始文本核实为显示转换，未修改文件。准确总运行时长未单独记录，记为未采集。

Runner 内完整独立回读已通过，无需第二次完整预测。随后仅只读加载 JSON/CSV、提取报告所需数值、重新计算文件 SHA-256；这些不生成物理数据、不拟合、不做新模型选择。source-check 的源清单前后同为 `031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537`，教师 CSV 前后同为 `86d4c2fb192721b2745f00076aeb00cf351c654ed936ddb098bfa6217e30ac6a`。

独立任务审阅通过后才开始正式调用；最终 whole-delta 审阅和人类科学审核仍待完成。报告文档修改后只做文本/数值与档案一致性检查，代码哈希继续保持冻结。现存来源、正式七个档案文件及不属于本任务的 QA 均保留。

最后使用同一 Python `-B -c` 执行内存中的文档一致性检查，仅解析现有 JSON/CSV/Markdown 与计算哈希，未保存一次性脚本。退出码 0，实际输出为 `Document crosscheck passed: 7 output hashes, 11 frozen code hashes, 24 report table rows, all joint extrema/ties, 324 CSV rows, 6 absolute file links; no prediction rerun.` 检查覆盖三张表各 8 行的分子/分母及 Macro-F1 格式、事件表、四组联合最坏计数/并列 ID、全部 7 产物哈希及字节数、协议与证据的代码哈希、UTC 字段、source-check/readback，以及 6 个本地档案链接存在性。
