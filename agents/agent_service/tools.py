"""智能体可调用的专业工具（Tool）。

Tool 的作用：LLM 负责推理与编排，数值计算全部由这里的确定性算法完成——
有限元力学解算、XGBoost 结果查询、微震多参量指标——保证数值可复现、可审计。
"""
from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path
from typing import Any

from .config import RISK_CLASSES, load_dataset

TOOLS_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS_ROOT.parent / "tools"))

from roof_mechanics.solver import BeamConfig, solve_beam  # noqa: E402

# 运行期工具调用审计日志：pipeline 每步开始前清空、结束后收走。
tool_call_log: list[dict] = []


def _logged(fn):
    import inspect

    def wrapper(*args, **kwargs):
        entry = {"tool": fn.__name__, "args": args, "kwargs": kwargs, "ts": time.time()}
        started = time.perf_counter()
        try:
            result = fn(*args, **kwargs)
            entry["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 3)
            entry["ok"] = True
            entry["result_digest"] = _digest(result)
            return result
        except Exception as error:  # noqa: BLE001 - 审计需要记录失败
            entry["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 3)
            entry["ok"] = False
            entry["error"] = str(error)[:300]
            raise
        finally:
            tool_call_log.append(entry)

    wrapper.__name__ = fn.__name__
    wrapper.__doc__ = fn.__doc__
    wrapper.__annotations__ = fn.__annotations__
    wrapper.__signature__ = inspect.signature(fn)  # FunctionTool 需要真实签名生成参数 schema
    return wrapper


def _digest(result: Any) -> str:
    text = json.dumps(result, ensure_ascii=False, default=str)
    return text if len(text) <= 600 else text[:600] + "…"


@_logged
def query_roof_record(record_id: str) -> dict:
    """按记录号查询顶板监测记录：XGBoost 四级预警结果、七项特征实测值（含单位与 p95 分位阈值）、是否越限。

    参数 record_id 形如 REC-202511011657-00000。
    """
    data = load_dataset()
    index = {r["id"]: r for r in data["records"]}
    record = index.get(record_id)
    if record is None:
        candidates = [i for i in list(index)[:5]]
        raise ValueError(f"记录 {record_id} 不存在。示例记录号：{candidates}")
    features = []
    for meta, value in zip(data["feature_schema"], record["values"]):
        key = meta["key"]
        p95 = meta.get("p95")
        features.append({
            "key": key, "label": meta["label"], "unit": meta.get("unit", ""),
            "value": value, "p95": p95,
            "exceeds_p95": (p95 is not None and value > p95 and key != "distance_to_water_body"),
        })
    return {
        "record_id": record["id"], "device_id": record.get("device_id"), "time": record.get("time"),
        "quality": record.get("quality"),
        "predicted_class": record["predicted_class"], "risk_score": record.get("risk_score"),
        "confidence": record["confidence"],
        "probabilities": dict(zip(RISK_CLASSES, record["probabilities"])),
        "features": features,
    }


@_logged
def microseismic_indices(record_id: str) -> dict:
    """计算该记录所在设备时序窗口的微震多参量预警指标：最新能量、背景均值、能量指数 EI、事件率、b 值（Aki 最大似然估计）。

    能量指数 EI=最新能量/窗口均值，EI>2 且事件率升高常为岩层破断前兆；b 值下降指示大事件占比升高。
    """
    data = load_dataset()
    index = {r["id"]: r for r in data["records"]}
    record = index.get(record_id)
    if record is None:
        raise ValueError(f"记录 {record_id} 不存在")
    window_ids = data.get("history_windows", {}).get(record_id, [record_id])
    energies = []
    for wid in window_ids:
        row = index.get(wid)
        if row is not None:
            energies.append(float(row["values"][5]))
    energies = energies or [float(record["values"][5])]
    latest = energies[-1]
    mean = sum(energies) / len(energies)
    peak = max(energies)
    ei = latest / mean if mean > 0 else float("inf")
    magnitudes = [math.log10(max(e, 1e-9)) for e in energies]
    m_min = min(magnitudes)
    mean_m = sum(magnitudes) / len(magnitudes)
    b_value = 0.4343 / (mean_m - m_min) if mean_m > m_min else None
    span_hours = max(len(energies) * 3 / 60, 1e-6)
    return {
        "record_id": record_id, "window_size": len(energies),
        "latest_energy": latest, "background_mean": round(mean, 3), "peak_energy": peak,
        "energy_index_ei": round(ei, 3),
        "event_rate_per_hour": round(len(energies) / span_hours, 2),
        "b_value": round(b_value, 3) if b_value is not None else None,
        "interpretation_hint": "EI>2 或 b 值明显低于背景（如 <1）提示破断风险升高，需结合离层与支护阻力综合研判。",
    }


@_logged
def mechanics_check(
    load_kn_per_m: float,
    length_m: float = 8.0,
    width_m: float = 1.0,
    thickness_m: float = 0.4,
    young_modulus_gpa: float = 10.0,
    spring_stiffness_mn_per_m: float = 0.0,
) -> dict:
    """运行顶板力学解算引擎：Winkler 弹性地基上 Euler–Bernoulli 梁有限元（Hermite 单元）。

    输入巷道跨度与顶板荷载（kN/m），输出最大挠度(mm)、最大弯曲应力(MPa)、
    弹性支承最大反力(kN，模拟锚索/支架支承)、应变能与平衡校核误差。
    用于 A3 调度决策 Agent 对候选处置方案做力学校核。
    """
    springs = {}
    if spring_stiffness_mn_per_m > 0:
        for node in (6, 12, 18):
            springs[node] = spring_stiffness_mn_per_m * 1e6
    config = BeamConfig(
        length_m=length_m, width_m=width_m, thickness_m=thickness_m,
        young_modulus_pa=young_modulus_gpa * 1e9, elements=24,
        boundary="simply_supported",
    )
    result = solve_beam(config, load_kn_per_m * 1000, springs)
    keep = ("max_deflection_mm", "max_bending_stress_mpa", "max_support_force_kn",
            "strain_energy_j", "equilibrium_relative_error", "residual_relative_error")
    return {k: round(result[k], 6) for k in keep} | {
        "model": "Winkler 弹性地基 Euler–Bernoulli 梁 FEM（24 单元）",
        "inputs": {"load_kn_per_m": load_kn_per_m, "length_m": length_m,
                   "thickness_m": thickness_m, "young_modulus_gpa": young_modulus_gpa,
                   "spring_stiffness_mn_per_m": spring_stiffness_mn_per_m},
    }


KNOWLEDGE_CARDS = [
    {"id": "K1", "topic": "关键层理论",
     "content": "采场上覆岩层中多层坚硬厚岩层（关键层）控制其上覆软岩的运动：主关键层破断影响地表沉降，亚关键层破断对应采场来压。关键层破断前离层在其下方发育，离层速率是重要前兆参量（钱鸣高、许家林）。"},
    {"id": "K2", "topic": "砌体梁结构与支护阻力",
     "content": "老顶（基本顶）破断后块体铰接形成砌体梁结构，回转变形对支架构成'给定变形'载荷：支架工作阻力需适应而非阻止老顶回转。支架阻力骤升/骤降均为支架-围岩相互作用异常信号。"},
    {"id": "K3", "topic": "离层与锚索轴力",
     "content": "顶板深部离层扩展时，离层速率上升；锚索轴力增量骤增说明深部载荷转移至锚固承载层，骤减（索体松弛）可能预示离层滑移失稳。锚杆轴力主要反映浅部岩层松动。"},
    {"id": "K4", "topic": "微震多参量预警",
     "content": "微震能量、事件率、能量指数 EI、b 值组成多参量综合预警：EI=当前能量/背景均值，EI 持续>2、事件率突增、b 值下降三者并发常为岩层破断前兆（窦林名等，2018，多参量综合预警）。"},
    {"id": "K5", "topic": "分级处置原则",
     "content": "重大风险：立即停止危险区域作业并撤人、划定警戒、复核支护与顶板状态、加密监测并报监管核验。较大风险：复测异常指标、临时补强支护、加密监测。一般/低风险：提高采样频率、持续跟踪趋势。"},
    {"id": "K6", "topic": "力学解算模型",
     "content": "本系统力学解算采用 Winkler 弹性地基上 Euler–Bernoulli 梁有限元模型（Hermite 梁单元，含解析解校核），将顶板简化为弹性支承梁，输出挠度、弯曲应力与支承反力，用于处置方案定量校核。"},
]


@_logged
def search_knowledge(query: str) -> dict:
    """知识检索：按关键词返回顶板灾害领域知识卡（关键层理论、砌体梁、离层-锚索、微震预警、分级处置、力学模型）。"""
    hits = []
    for card in KNOWLEDGE_CARDS:
        text = card["topic"] + card["content"]
        overlap = sum(1 for ch in set(query) if ch in text)
        if overlap >= max(2, len(set(query)) // 3) or card["topic"] in query:
            hits.append(card)
    if not hits:
        hits = KNOWLEDGE_CARDS[:2]
    return {"query": query, "cards": hits[:4]}
