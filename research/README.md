# 离线力学研究

## 下载和核验原始结果

完整结果附件：[research-2026-10-17](https://github.com/kenanxin/StrataEye/releases/tag/research-2026-10-17)。下载 `StrataEye-offline-research-20261017.zip` 和SHA-256文本，先核对压缩包哈希，再解压到仓库根目录。解压后得到 `research-evidence/outputs`，不要改写原有协议、模型和结果。

```powershell
Get-FileHash .\StrataEye-offline-research-20261017.zip -Algorithm SHA256
Expand-Archive -LiteralPath .\StrataEye-offline-research-20261017.zip -DestinationPath .
python tools/verify-research-archive.py research-evidence
```

校验器仅用Python标准库，检查全部文件的哈希和字节数，并核验六份原始manifest。它不会执行模型、加载joblib、修改原结果，也不评价科学有效性。历史协议保留原机器路径；校验器按包内相对路径核验，不要求存在原D盘目录。

## 文件对应的研究阶段

| 目录 | 研究内容 |
|---|---|
| `roof-mechanics-v1` | 简化梁—弹簧模拟、四观测、未来三加载步标签及RF/XGBoost训练 |
| `roof-mechanics-known-limits` | 两组工况下raw4与精确限值known_limits4的对照 |
| `roof-mechanics-limits-sensitivity` | 保存模型的限值估计误差压力分析，包含补充来源核验轮 |
| `roof-mechanics-uncertainty` | 27点有限采样、低估、误报和人工复核负担 |
| `roof-mechanics-fresh-cohort` | 冻结模型在新种子模拟工况上的复核 |

每阶段保留原数据、协议、模型、预测和指标，结果说明在 `docs/qa/*roof-mechanics*results.md`。可直接阅读，无须重新训练。未经信任核验的joblib/pickle不得加载。

## 环境与小规模验证

原实验记录环境和直接依赖见 `requirements-research.txt`，依赖文件不包含Python本体。建议建立独立Python环境，先安装依赖并执行单元测试；新环境与原实验的差异须单独记录。

```powershell
python -m venv .venv-research
.\.venv-research\Scripts\python.exe -m pip install -r requirements-research.txt
.\.venv-research\Scripts\python.exe -B -m unittest discover -s tests/roof_mechanics -p 'test_*.py' -v
```

另开新目录运行实验，避免覆盖历史结果：

```powershell
.\.venv-research\Scripts\python.exe -B -m tools.roof_mechanics.run_experiment --output-dir .\reruns\v1-new
.\.venv-research\Scripts\python.exe -B -m tools.roof_mechanics.run_known_limits --output-dir .\reruns\known-limits-new
```

冻结历史协议的完整语义回读含原路径检查，移动机器后应先运行上面的包内哈希校验。进一步重复敏感性和新工况实验时，建议使用当前机器新生成的known-limits源，显式传 `--source-dir` 及该源manifest的SHA-256；具体参数见 `tools/roof_mechanics/README.md`。只做哈希校验没有重算全部历史预测。

三维展示工件也可以重新导出到新的文件：

```powershell
.\.venv-research\Scripts\python.exe tools/export-support-simulation.py --solver tools/roof_mechanics/solver.py --output .\reruns\support-core.json
.\.venv-research\Scripts\python.exe tools/export-support-deformation.py --solver tools/roof_mechanics/solver.py --core data/support-simulation-v1.json --output .\reruns\support-shape.json
```

## 研究边界

模拟四观测与教师七数值输入属于不同研究任务。模型采用线弹性、小变形、准静态梁与接地弹簧，加载步没有现场时间单位。精确限值来自模拟参数；误差采样宽度是假设值；域外变化范围有限。保留低估、误报及较高人工复核负担。现场标定、真实噪声、动态垮落和矿山实证尚待验证，人类科学审核仍待完成。

源码复制自研究提交 `e78421dd90322ec0f2561824156679d5a436eb51`，求解器哈希应与三维工件血缘一致。本次只补齐交付，不重新训练或修改原实验文件。
