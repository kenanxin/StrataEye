"""CAMEL 六智能体编排管线：A1→A2→A3→A5→A4→A6，全程留痕（工具调用 + 结构化输出）。"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any

from .config import DEEPSEEK_API_KEY, DEEPSEEK_MODEL, RUNS_DIR, deepseek_base_url
from .roles import OUTPUT_SCHEMAS, PIPELINE_ORDER, ROLES
from .tools import (mechanics_check, microseismic_indices, query_roof_record,
                    search_knowledge, tool_call_log)

DEFAULT_RESOURCE_SNAPSHOT = {
    "personnel_available": 6, "support_material_sets": 12, "inspection_devices": 3,
}

STEP_TASKS = {
    "A1": "请对记录 {record_id} 执行感知预警。先调用 query_roof_record 与 microseismic_indices，再输出结构化结论。",
    "A2": "根据 A1 结论检索相关知识并说明关联。",
    "A3": "生成不少于 2 套候选处置方案；必须调用 mechanics_check 至少一次，并把解算数值写进 mechanics_basis。",
    "A5": "基于资源快照 {resource_snapshot} 评估各方案可行性。",
    "A4": "为推荐方案起草三端协同通知。",
    "A6": "执行反思迭代与闭环决策。",
}

STEP_TOOLS = {
    "A1": [query_roof_record, microseismic_indices],
    "A2": [search_knowledge],
    "A3": [mechanics_check],
    "A5": [], "A4": [], "A6": [],
}


def _build_model():
    from camel.models import DeepSeekModel
    return DeepSeekModel(model_type=DEEPSEEK_MODEL, api_key=DEEPSEEK_API_KEY,
                         url=deepseek_base_url())


def _build_agent(agent_id: str):
    from camel.agents import ChatAgent
    from camel.messages import BaseMessage
    from camel.toolkits import FunctionTool

    role = ROLES[agent_id]
    system_message = BaseMessage.make_assistant_message(
        role_name=role["name"], content=role["system"])
    tools = [FunctionTool(fn) for fn in STEP_TOOLS[agent_id]]
    return ChatAgent(system_message=system_message, model=_build_model(), tools=tools)


def _field_spec(schema) -> str:
    spec = []
    for name, info in schema.model_json_schema()["properties"].items():
        kind = info.get("type", "str")
        if kind == "array":
            kind = "字符串数组"
        item = f"{name}({kind})"
        description = info.get("description")
        if description:
            item += f"：{description}"
        spec.append(item)
    return "；".join(spec)


def _step(agent, agent_id: str, user_text: str) -> tuple[dict, str]:
    """执行一步：提示词约束输出 JSON，本地解析并用 Pydantic 校验；不合法则纠错重试一次。

    不使用 camel 的 response_format——0.2.90 配 DeepSeek 在该路径存在
    "too many values to unpack" 的内部错误，原始调用则完全正常。
    """
    from camel.messages import BaseMessage

    schema = OUTPUT_SCHEMAS[agent_id]
    spec = _field_spec(schema)
    content = (user_text + "\n\n输出要求：只输出一个 JSON 对象，不要 markdown 代码块、"
               "不要解释性文字。字段：" + spec)
    raw, best_parsed, error = "", None, "未执行"
    for attempt in range(2):
        message = BaseMessage.make_user_message(role_name="调度中心", content=content)
        raw = str(agent.step(message).msgs[0].content)
        try:
            parsed = _parse_json(raw)
            schema.model_validate(parsed)
            best_parsed, error = parsed, None
            break
        except Exception as failure:  # noqa: BLE001 - 解析/校验失败进入纠错重试
            if best_parsed is None:
                best_parsed = parsed if isinstance(parsed, dict) else None
            error = str(failure)[:200]
            content = (f"你上次输出的 JSON 不合法或字段缺失（{error}）。"
                       "请严格只输出一个完整 JSON 对象，字段：" + spec)
    if best_parsed is None:
        raise ValueError(f"智能体输出无法解析为 JSON：{raw[:200]}")
    if error:
        best_parsed["_validation_warning"] = error
    return best_parsed, raw


def _parse_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1].lstrip("json").strip()
    decoder = json.JSONDecoder()
    for pos, char in enumerate(text):
        if char != "{":
            continue
        try:
            obj, _ = decoder.raw_decode(text, pos)
            return obj
        except json.JSONDecodeError:
            continue
    raise ValueError(f"智能体输出无法解析为 JSON：{text[:200]}")


def run_workflow(record_id: str, resource_snapshot: dict | None = None) -> dict:
    """运行六智能体研判管线并落盘 trace。"""
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    workflow_run_id = f"WF-{uuid.uuid4()}"
    resource = {**DEFAULT_RESOURCE_SNAPSHOT, **(resource_snapshot or {})}
    run: dict[str, Any] = {
        "workflow_run_id": workflow_run_id, "record_id": record_id,
        "resource_snapshot": resource, "model": DEEPSEEK_MODEL,
        "framework": "camel-ai", "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "nodes": [],
    }
    context: dict[str, Any] = {"record_id": record_id, "resource_snapshot": resource}
    started_all = time.perf_counter()

    for agent_id in PIPELINE_ORDER:
        node_started = time.perf_counter()
        tool_call_log.clear()
        task = STEP_TASKS[agent_id].format(record_id=record_id,
                                           resource_snapshot=json.dumps(resource, ensure_ascii=False))
        user_text = ("上游上下文（JSON）：\n" + json.dumps(context, ensure_ascii=False, default=str)
                     + "\n\n任务：" + task)
        try:
            agent = _build_agent(agent_id)
            output, raw = _step(agent, agent_id, user_text)
            status = "success"
            summary = raw[:300]
        except Exception as error:  # noqa: BLE001 - 单节点失败记录后继续
            output, summary, status = None, f"failed: {error}", "failed"
        node = {
            "agent_id": agent_id, "name": ROLES[agent_id]["name"], "status": status,
            "input_evidence": [f"{c['tool']}({json.dumps(c.get('args', ()), ensure_ascii=False, default=str)[:120]})"
                               for c in tool_call_log],
            "tool_calls": list(tool_call_log), "output_summary": summary,
            "output": output,
            "elapsed_ms": round((time.perf_counter() - node_started) * 1000, 1),
        }
        run["nodes"].append(node)
        context[agent_id] = output if output is not None else summary

    run["elapsed_ms"] = round((time.perf_counter() - started_all) * 1000, 1)
    run["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    trace_path = RUNS_DIR / f"{workflow_run_id}.json"
    with open(trace_path, "w", encoding="utf-8") as f:
        json.dump(run, f, ensure_ascii=False, indent=2, default=str)
    run["trace_path"] = str(trace_path)
    return run
