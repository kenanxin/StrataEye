"""配置：读取 StrataEye 根目录 .env 与数据路径。"""
from __future__ import annotations

import json
from pathlib import Path

from dotenv import load_dotenv
import os

AGENTS_DIR = Path(__file__).resolve().parent.parent
ROOT = AGENTS_DIR.parent

load_dotenv(ROOT / ".env")

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_API_ENDPOINT = os.getenv("DEEPSEEK_API_ENDPOINT", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")


def deepseek_base_url() -> str:
    """.env 存的是完整路径（…/chat/completions）；OpenAI 客户端需要 base URL。"""
    url = DEEPSEEK_API_ENDPOINT.rstrip("/")
    for suffix in ("/chat/completions", "/completions"):
        if url.endswith(suffix):
            url = url[: -len(suffix)]
    return url
DEEPSEEK_TIMEOUT_MS = int(os.getenv("DEEPSEEK_TIMEOUT_MS", "120000"))

DATASET_PATH = ROOT / "data" / "roof-risk-dataset.json"
RUNS_DIR = AGENTS_DIR / "runs"

RISK_CLASSES = ["低风险", "一般风险", "较大风险", "重大风险"]


def load_dataset() -> dict:
    with open(DATASET_PATH, encoding="utf-8") as f:
        return json.load(f)


def feature_labels() -> list[dict]:
    return load_dataset()["feature_schema"]
