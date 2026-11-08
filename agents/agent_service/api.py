"""FastAPI 服务：HTTP 入口，供前端/Node 网关调用 CAMEL 六智能体管线。"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .config import DEEPSEEK_API_KEY, RUNS_DIR, load_dataset
from .pipeline import run_workflow

app = FastAPI(title="灵瞳勘顶 智能体服务", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"])


class RunRequest(BaseModel):
    record_id: str = Field(description="监测记录号，如 REC-202511011657-00000")
    resource_snapshot: dict | None = None


@app.get("/health")
def health() -> dict:
    try:
        import camel  # noqa: F401
        camel_ok = True
        camel_version = getattr(camel, "__version__", "unknown")
    except Exception:  # noqa: BLE001
        camel_ok, camel_version = False, None
    return {
        "status": "ok", "camel_available": camel_ok, "camel_version": camel_version,
        "deepseek_configured": bool(DEEPSEEK_API_KEY),
        "dataset_records": len(load_dataset()["records"]),
    }


@app.post("/agent/runs")
def create_run(request: RunRequest) -> dict:
    dataset = load_dataset()
    if not any(r["id"] == request.record_id for r in dataset["records"]):
        raise HTTPException(status_code=404, detail=f"记录 {request.record_id} 不存在")
    if not DEEPSEEK_API_KEY:
        raise HTTPException(status_code=503, detail="未配置 DEEPSEEK_API_KEY")
    return run_workflow(request.record_id, request.resource_snapshot)


@app.get("/agent/runs/{run_id}")
def get_run(run_id: str) -> dict:
    path = Path(RUNS_DIR) / f"{run_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"运行 {run_id} 不存在")
    return json.loads(path.read_text(encoding="utf-8"))
