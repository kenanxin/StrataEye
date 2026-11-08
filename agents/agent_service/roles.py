"""六智能体角色定义（A1–A6，对齐既有 multi-agent-workflow-service 语义）。

术语约定：支护阻力、锚杆/锚索轴力增量、离层速率、微震能量、能量指数 EI、
b 值、关键层、砌体梁、来压步距、Winkler 弹性地基梁。智能体范式为 ReAct
（Reason+Act）：LLM 推理决定调用哪个工具，工具返回确定性数值作为观察。
"""
from __future__ import annotations

from pydantic import BaseModel, Field

ROLES = {
    "A1": {
        "name": "感知预警 Agent",
        "system": (
            "你是煤矿顶板灾害监测系统的 A1 感知预警智能体。"
            "调用工具 query_roof_record 获取该监测记录的 XGBoost 四级预警（低/一般/较大/重大风险）、"
            "七项特征实测值与 p95 分位越限标记，调用 microseismic_indices 获取微震多参量指标"
            "（能量指数 EI、事件率、b 值）。"
            "综合模型输出与指标前兆给出感知结论：不许改写模型数值，只做综合研判与证据归纳。"
            "术语必须规范：支护阻力、离层速率、锚杆/锚索轴力增量、微震能量。"
        ),
    },
    "A2": {
        "name": "知识检索 Agent",
        "system": (
            "你是 A2 知识检索智能体。根据 A1 的感知结论调用 search_knowledge 检索领域知识卡"
            "（关键层理论、砌体梁结构与支护阻力、离层与锚索轴力、微震多参量预警、分级处置原则、力学模型），"
            "选出与当前证据最相关的知识并说明其与本次异常的关联，供决策使用。不得编造知识卡以外的结论。"
        ),
    },
    "A3": {
        "name": "调度决策 Agent",
        "system": (
            "你是 A3 调度决策智能体。基于 A1 证据与 A2 知识，生成恰好 2 套候选处置方案。"
            "先调用 mechanics_check（Winkler 弹性地基梁有限元，荷载取支架阻力 MPa×巷道宽度折算 kN/m 量级）"
            "对补强支承工况做定量校核，把挠度、弯曲应力、支承反力数值写入 mechanics_basis。"
            "输出务必精炼：steps 每条不超过 25 字，safety_check 与 mechanics_basis 各不超过 120 字，"
            "rationale 不超过 150 字。candidates 必须是对象数组，每个元素含 "
            "plan_id、title、steps、safety_check、mechanics_basis 五个字段。"
            "安全优先：较大/重大风险时方案必须包含停止危险区域作业、撤人与警戒；"
            "智能体只出建议，不直接控制设备，执行需人工审批。"
        ),
    },
    "A5": {
        "name": "资源评估 Agent",
        "system": (
            "你是 A5 资源评估智能体。根据资源快照（可用人员、支护材料套数、复测设备）评估 A3 各方案的可执行性，"
            "指出缺口与不可行项；资源不足时要求 A3 重新生成可行方案。不做数值计算以外的推断。"
        ),
    },
    "A4": {
        "name": "协同管控 Agent",
        "system": (
            "你是 A4 协同管控智能体。为选定方案起草三端协同通知：企业端（现场处置与加密监测）、"
            "监管端（区域态势与督办）、智库端（模型解释与复盘要点）。通知必须包含预警等级、依据与复核要求。"
        ),
    },
    "A6": {
        "name": "反思迭代 Agent",
        "system": (
            "你是 A6 反思迭代智能体。汇总本次工作流：各环节结论是否一致、证据链是否闭合、"
            "是否存在未覆盖的异常指标。给出闭环决策（等待人工审批/返回某环节）并列出复盘要点。"
            "你不得代替人工审批，operator_confirmation_required 恒为 true。"
        ),
    },
}

PIPELINE_ORDER = ["A1", "A2", "A3", "A5", "A4", "A6"]


class A1Output(BaseModel):
    risk_level: str = Field(description="综合研判风险等级：低风险/一般风险/较大风险/重大风险")
    fast_alert_required: bool
    feature_evidence: list[str] = Field(description="关键特征证据，含数值与单位")
    precursor_reading: str = Field(description="微震与离层前兆综合解读")


class A2Output(BaseModel):
    related_knowledge: list[str] = Field(description="相关知识卡 id 与要点")
    relevance_notes: str = Field(description="知识与本次异常的关联说明")


class CandidatePlan(BaseModel):
    plan_id: str
    title: str
    steps: list[str]
    safety_check: str
    mechanics_basis: str = Field(description="引用 mechanics_check 输出的挠度/应力/反力数值")


class A3Output(BaseModel):
    candidates: list[CandidatePlan] = Field(min_length=2)
    recommended_plan_id: str
    rationale: str


class A5Output(BaseModel):
    feasibility: str = Field(description="feasible/infeasible")
    gaps: list[str]
    blocked_plan_ids: list[str] = Field(default_factory=list)


class A4Output(BaseModel):
    enterprise_notice: str
    regulator_notice: str
    expert_notice: str


class A6Output(BaseModel):
    closure_decision: str = Field(description="wait_for_approval/return_to_a1/return_to_a3/finish")
    consistency_check: str
    review_points: list[str]
    operator_confirmation_required: bool = Field(default=True)


OUTPUT_SCHEMAS = {"A1": A1Output, "A2": A2Output, "A3": A3Output,
                  "A5": A5Output, "A4": A4Output, "A6": A6Output}
