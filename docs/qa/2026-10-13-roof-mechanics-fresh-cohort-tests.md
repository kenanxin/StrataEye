# 新种子冻结模型复核：测试与执行证据

Task 1 代码与测试固定在 085dfa9de1b6f126396289dd76c55be937f1c547，独立规格及质量审查分别为 Spec compliant / Quality Approved，均无 findings。本记录复用已完成的测试证据，Task 2 未重复测试套件。 [claim:C094] [evidence:E09,E12]

## 已完成测试（来自 Task 1 执行报告）

```powershell
& 'D:/矿业/smart-mine-v2-balanced/.venv-data/Scripts/python.exe' -B -m unittest discover -s tests/roof_mechanics -p test_fresh_cohort_study.py -v
```

初始 RED 为 ModuleNotFoundError，1 test / 0.000s / exit 1。第一次实现迭代缺 sample_limit_error_predictions 导入，2 tests / 6.117s / exit 1；第二次迭代 Python 3.10 无 TestCase.enterContext，2 tests / 4.590s / exit 1。修复后最终 focused GREEN 为 2 tests / 24.380s / exit 0 / OK。 [claim:C095] [evidence:E09]

```powershell
& 'D:/矿业/smart-mine-v2-balanced/.venv-data/Scripts/python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_*.py' -v
```

冻结代码唯一 full Python suite 为 56 tests / 81.353s / exit 0 / OK。没有 web/server 变更，因此未运行 Node 套件。Task 1 的临时原始训练 fixture 仅用于测试，正式本次全程加载既有模型。 [claim:C096] [evidence:E09]

Task 1 覆盖规范指纹、old/new 和 new/new 参数及 ID 重复、无效数量/种子/哈希/路径、实际临时源数据及保存模型推理、模型/教师字节保持、fit 禁止、生成前协议/代码哈希、独立 raw denominator 回读、CSV/dataset/prediction 篡改检测。测试数据集尺寸为每队列 2+2 个工况及 12 步；其结果不替代正式样本性能。 [claim:C097] [evidence:E09]

## 唯一正式 CLI 和存档审核

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.fresh_cohort_study --output-dir 'D:\矿业\outputs\roof-mechanics-fresh-cohort\2026-10-13'
```

调用前输出不存在，实际 invocation_count=1，退出码 0。外层 UTC 开始 `2026-10-13T15:54:00.9725838Z`，结束 `2026-10-13T15:59:31.3286592Z`；protocol.created_utc 原字符串为 `2026-10-13T15:54:21.750344+00:00`。固定 source/hash/100+100/32 参数通过默认值使用，协议同时保存显式完整重现参数。 [claim:C098] [evidence:E01,E12]

实际输出依次为 Generating fresh-replicate-a: 100+100 scenarios；Generating fresh-replicate-b: 100+100 scenarios；四组 Scoring 的 eligible rows 为 2527、2518、2505、2565，各 27 conditions；Auditing fresh datasets and all frozen-model predictions。终端 JSON 的中文路径因控制台编码显示乱码，原始文件路径与 UTF-8 JSON 正确；轻量证据读取采用 ASCII JSON escaping 解决传输问题。 [claim:C099] [evidence:E01,E03,E12]

内置唯一完整 audit passed=true：cells=324、summaries=108、predictions=108、CSV rows=324、datasets=2、regenerated scenarios=400、reconstructed raw rows=10515、eligible rows=10115。该 audit 包括原来源回读、确定性重生成、独立原始分母重建、模型/教师/代码保持；deterministic replay is independent source=false。没有额外调用 readback_fresh_cohort 进行重复预测。 [claim:C100] [evidence:E04,E12]

后续轻量核查以 SHA-256/bytes 核对正式 9 个清单成员、10 个文件完整集合、原来源 26 个清单成员及教师字节，读取 JSON/CSV 验证计数，并重新计算 14 个预生成代码/测试/helper 哈希；全部通过。正式清单 SHA-256 为 `4af915e447446e5d1fd0a52cd1effa14631820c9f1b0cdec8483d97accc325e8`。轻量核查只读取和计算哈希，无生成、预测、拟合或选模。 [claim:C101] [evidence:E01,E05,E08,E12]

软件版本：Python 3.10.10、NumPy 1.26.4、scikit-learn 1.7.2、XGBoost 3.2.0、joblib 1.6.0，平台 Windows-10-10.0.26200-SP0；源与本次分析版本一致。模型仅为已保存原生 JSON，未加载外部 pickle。 [claim:C102] [evidence:E01,E12]

QA 自核对将主表每个值与 CSV 按 replicate/split/case_id/candidate 定位逐项比较，四组顺序、全部分母、四位 F1、事件表、复核表与 joint 最大值/并列条件一致；保留全部八个 joint 条件和 324 行 CSV 链接。该核对是程序与 AI 审核，人类科学确认待完成。 [claim:C103] [evidence:E03,E12]

Task 2 未修改 code/test/README、教师数据、旧存档或旧 QA 文件；保留十一条既有 untracked 路径。未训练、调参、改变种子、重跑正式分析或进行 cloud/web/live/push/deploy 操作。Task 2 执行记录形成时，Task 2 reviewer 和最终 whole-delta 技术审查待完成。 [claim:C104] [evidence:E12]

完整命令、轻量核查代码及输出摘要由控制器保存 Task 2 执行报告；对应本地记录为 `D:/矿业/worktrees/teacher-feedback-v1/docs/qa/2026-10-13-roof-mechanics-fresh-cohort-task2-execution.md`。 [claim:C105] [evidence:E12]
