# 灵瞳勘顶智能体服务（CAMEL）

用 CAMEL 搭建六智能体研判管线（A1 感知预警 → A2 知识检索 → A3 调度决策 → A5 资源评估 → A4 协同管控 → A6 反思迭代），ReAct 范式：LLM 负责推理与编排，数值计算全部由确定性工具完成，可审计、可复现。

三层架构：

- **L1 机理层**：`mechanics_check` —— Winkler 弹性地基上 Euler–Bernoulli 梁有限元（复用 `tools/roof_mechanics/solver.py`），输出挠度/弯曲应力/支承反力。
- **L2 数据层**：`query_roof_record`（XGBoost 四级预警 + 七项特征 p95 越限）、`microseismic_indices`（能量指数 EI、事件率、b 值）。
- **L3 决策层**：CAMEL `ChatAgent` + `FunctionTool`，DeepSeek 驱动，结构化输出（Pydantic），每次运行落盘 trace 到 `runs/`。

## 运行

```powershell
# 首次：创建虚拟环境（已存在则跳过）
python -m venv agents/.venv
agents/.venv/Scripts/pip install -r agents/requirements.txt

# 工具层冒烟测试（无需 LLM）
agents/.venv/Scripts/python agents/smoke_test.py

# 启动服务（默认 8093）
agents/.venv/Scripts/python -m uvicorn agent_service.api:app --app-dir agents --port 8093
```

## 接口

- `GET /health` —— camel 可用性、DeepSeek 配置、数据集规模
- `POST /agent/runs` —— `{"record_id": "REC-...", "resource_snapshot": {...}}` 运行六智能体管线（同步，约 1–2 分钟），返回完整 trace
- `GET /agent/runs/{workflow_run_id}` —— 查询历史 trace

密钥复用 StrataEye 根目录 `.env` 的 `DEEPSEEK_API_KEY / DEEPSEEK_API_ENDPOINT / DEEPSEEK_MODEL`。

安全边界：智能体只输出预警与候选方案，不控制设备；A6 闭环决策 `operator_confirmation_required` 恒为 true，执行需人工审批。
