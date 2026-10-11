from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Sequence

import joblib
import numpy as np
import pandas as pd
from xgboost import XGBClassifier


CLASS_NAMES = ["低风险", "一般风险", "较大风险", "重大风险"]
CLASS_KEYS = ["low", "general", "major", "severe"]
NUMERIC_COLUMNS = [
    "顶板离层速率",
    "锚杆轴力增量",
    "锚索轴力增量",
    "支架阻力",
    "涌水量",
    "微震能量",
    "距水体/岩溶体距离",
]
FEATURE_KEYS = [
    "roof_separation_rate",
    "bolt_axial_force_increment",
    "cable_axial_force_increment",
    "support_resistance",
    "water_inflow",
    "microseismic_energy",
    "distance_to_water",
]
FEATURE_UNITS = ["mm/d", "kN", "kN", "MPa", "m3/h", "J", "m"]
REQUIRED_COLUMNS = ["时间", "设备编号", *NUMERIC_COLUMNS, "数据质量", "风险等级"]
EXPECTED_SHA256 = "86D4C2FB192721B2745F00076AEB00CF351C654ED936DDB098BFA6217E30AC6A"
EXPECTED_ROWS = 20_000
GAP_THRESHOLD_SECONDS = 600
RISK_SCORE_WEIGHTS = np.array([20.0, 45.0, 70.0, 95.0], dtype=np.float64)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def compute_risk_score(probabilities: Sequence[float]) -> int:
    values = np.asarray(probabilities, dtype=np.float64)
    if values.shape != (4,) or not np.isfinite(values).all():
        raise ValueError("probabilities must contain four finite values")
    return int(round(float(np.dot(values, RISK_SCORE_WEIGHTS))))


def make_record_id(timestamp: str, device_id: str, index: int) -> str:
    del device_id
    parsed = pd.to_datetime(timestamp, errors="raise")
    return f"REC-{parsed.strftime('%Y%m%d%H%M')}-{index:05d}"


def validate_source_frame(frame: pd.DataFrame, expected_rows: int | None = None) -> None:
    missing = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError(f"missing columns: {', '.join(missing)}")
    if expected_rows is not None and len(frame) != expected_rows:
        raise ValueError(f"expected {expected_rows} rows, received {len(frame)}")

    numeric = frame[NUMERIC_COLUMNS].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=np.float64)
    if not np.isfinite(numeric).all():
        raise ValueError("numeric features contain non-finite values")

    labels = set(frame["风险等级"].astype(str))
    unknown_labels = sorted(labels.difference(CLASS_NAMES))
    missing_labels = sorted(set(CLASS_NAMES).difference(labels)) if expected_rows else []
    if unknown_labels:
        raise ValueError(f"unknown risk labels: {', '.join(unknown_labels)}")
    if missing_labels:
        raise ValueError(f"missing risk labels: {', '.join(missing_labels)}")

    if frame["时间"].isna().any() or pd.to_datetime(frame["时间"], errors="coerce").isna().any():
        raise ValueError("time column contains invalid values")
    if frame["设备编号"].astype(str).str.strip().eq("").any():
        raise ValueError("device id contains empty values")
    if frame["数据质量"].astype(str).str.strip().eq("").any():
        raise ValueError("data quality contains empty values")


def select_representatives(records: list[dict]) -> dict[str, str]:
    representatives: dict[str, str] = {}
    for label in CLASS_NAMES:
        candidates = [
            record
            for record in records
            if record["true_class"] == label and record["predicted_class"] == label
        ]
        if not candidates:
            raise ValueError(f"no correctly classified representative for {label}")
        best = max(candidates, key=lambda record: (record["confidence"], record["id"]))
        representatives[label] = best["id"]
    return representatives


def write_artifact(artifact: dict, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(
        artifact,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    output_path.write_text(payload + "\n", encoding="utf-8")


def _feature_schema(frame: pd.DataFrame) -> list[dict]:
    schema = []
    for column, key, unit in zip(NUMERIC_COLUMNS, FEATURE_KEYS, FEATURE_UNITS):
        values = frame[column].to_numpy(dtype=np.float64)
        schema.append(
            {
                "key": key,
                "label": column,
                "unit": unit,
                "min": round(float(values.min()), 6),
                "max": round(float(values.max()), 6),
                "p05": round(float(np.quantile(values, 0.05)), 6),
                "p95": round(float(np.quantile(values, 0.95)), 6),
            }
        )
    schema.append(
        {
            "key": "data_quality",
            "label": "数据质量",
            "unit": None,
            "categories": sorted(frame["数据质量"].astype(str).unique().tolist()),
        }
    )
    return schema


def _history_windows(records: list[dict], representatives: dict[str, str]) -> dict[str, list[str]]:
    index_by_id = {record["id"]: index for index, record in enumerate(records)}
    windows: dict[str, list[str]] = {}
    for record_id in representatives.values():
        center = index_by_id[record_id]
        start = max(0, center - 12)
        end = min(len(records), center + 12)
        window = records[start:end]
        window = sorted(window, key=lambda record: pd.to_datetime(record["time"]))
        windows[record_id] = [record["id"] for record in window]
    return windows


def prepare_model_numeric(frame: pd.DataFrame, kalman_filter) -> np.ndarray:
    times = pd.to_datetime(frame["时间"])
    gaps = times.groupby(frame["设备编号"]).diff().dt.total_seconds()
    segment_ids = (gaps.isna() | (gaps > GAP_THRESHOLD_SECONDS)).cumsum()
    raw = frame[NUMERIC_COLUMNS].to_numpy(dtype=np.float64)
    smoothed = np.zeros_like(raw)
    for segment_id in segment_ids.unique():
        positions = np.flatnonzero(segment_ids.to_numpy() == segment_id)
        if len(positions) == 1:
            smoothed[positions] = raw[positions]
        else:
            segment_smoothed, _ = kalman_filter.smooth(raw[positions])
            smoothed[positions] = segment_smoothed
    if not np.isfinite(smoothed).all():
        raise ValueError("Kalman preprocessing produced non-finite values")
    return smoothed


def build_dataset(csv_path: Path, model_dir: Path, built_at: str) -> dict:
    source_hash = file_sha256(csv_path)
    if source_hash != EXPECTED_SHA256:
        raise ValueError(f"source SHA-256 mismatch: expected {EXPECTED_SHA256}, received {source_hash}")

    frame = pd.read_csv(csv_path, encoding="utf-8-sig")
    source_column_count = len(frame.columns)
    validate_source_frame(frame, expected_rows=EXPECTED_ROWS)
    frame = frame.copy()
    frame[NUMERIC_COLUMNS] = frame[NUMERIC_COLUMNS].apply(pd.to_numeric)

    required_artifacts = [
        "scaler.pkl",
        "quality_encoder.pkl",
        "label_encoder.pkl",
        "kalman_filter.pkl",
        "metrics.json",
        "xgb_model.json",
    ]
    missing_artifacts = [name for name in required_artifacts if not (model_dir / name).is_file()]
    if missing_artifacts:
        raise ValueError(f"missing model artifacts: {', '.join(missing_artifacts)}")

    metrics = json.loads((model_dir / "metrics.json").read_text(encoding="utf-8"))
    if metrics.get("best_model") != "xgboost":
        raise ValueError(f"unsupported best model: {metrics.get('best_model')}")

    scaler = joblib.load(model_dir / "scaler.pkl")
    quality_encoder = joblib.load(model_dir / "quality_encoder.pkl")
    label_encoder = joblib.load(model_dir / "label_encoder.pkl")
    kalman_filter = joblib.load(model_dir / "kalman_filter.pkl")
    label_classes = [str(value) for value in label_encoder.classes_.tolist()]
    if label_classes != CLASS_NAMES:
        raise ValueError(f"label encoder order mismatch: {label_classes}")

    known_quality = {str(value) for value in quality_encoder.categories_[0].tolist()}
    unknown_quality = sorted(set(frame["数据质量"].astype(str)).difference(known_quality))
    if unknown_quality:
        raise ValueError(f"unknown data quality values: {', '.join(unknown_quality)}")

    frame["_source_index"] = np.arange(len(frame))
    frame["_parsed_time"] = pd.to_datetime(frame["时间"])
    frame = frame.sort_values(["设备编号", "_parsed_time", "_source_index"]).reset_index(drop=True)
    numeric = frame[NUMERIC_COLUMNS].to_numpy(dtype=np.float64)
    model_numeric = prepare_model_numeric(frame, kalman_filter)
    standardized = scaler.transform(model_numeric)
    quality = quality_encoder.transform(frame[["数据质量"]].to_numpy())
    features = np.hstack([standardized, quality.astype(np.float64)])

    model = XGBClassifier()
    model.load_model(model_dir / "xgb_model.json")
    probabilities = model.predict_proba(features)
    if probabilities.shape != (len(frame), len(CLASS_NAMES)):
        raise ValueError(f"unexpected probability shape: {probabilities.shape}")

    predicted_indices = np.argmax(probabilities, axis=1)
    predicted_labels = label_encoder.inverse_transform(predicted_indices)
    records = []
    for index, row in frame.iterrows():
        probability_values = probabilities[index]
        predicted_class = str(predicted_labels[index])
        true_class = str(row["风险等级"])
        record = {
            "id": make_record_id(str(row["时间"]), str(row["设备编号"]), int(index)),
            "time": str(row["时间"]),
            "device_id": str(row["设备编号"]),
            "values": [round(float(value), 6) for value in numeric[index]],
            "model_values": [round(float(value), 6) for value in model_numeric[index]],
            "standardized_values": [round(float(value), 6) for value in standardized[index]],
            "quality": str(row["数据质量"]),
            "true_class": true_class,
            "predicted_class": predicted_class,
            "probabilities": [round(float(value), 8) for value in probability_values],
            "confidence": round(float(probability_values[predicted_indices[index]]), 8),
            "risk_score": compute_risk_score(probability_values),
            "matches_label": predicted_class == true_class,
        }
        records.append(record)

    representatives = select_representatives(records)
    parsed_time = pd.to_datetime(frame["时间"])
    class_distribution = {
        label: int((frame["风险等级"] == label).sum()) for label in CLASS_NAMES
    }
    model_metrics = metrics["xgboost"]
    return {
        "schema_version": 1,
        "inference_built_at": built_at,
        "source": {
            "name": csv_path.name,
            "sha256": source_hash,
            "row_count": len(frame),
            "column_count": source_column_count,
            "time_min": parsed_time.min().isoformat(),
            "time_max": parsed_time.max().isoformat(),
            "devices": sorted(frame["设备编号"].astype(str).unique().tolist()),
            "class_distribution": class_distribution,
        },
        "model": {
            "name": "xgboost",
            "classes": CLASS_NAMES,
            "class_keys": CLASS_KEYS,
            "accuracy": round(float(model_metrics["accuracy"]), 8),
            "macro_f1": round(float(model_metrics["macro_f1"]), 8),
        },
        "feature_schema": _feature_schema(frame),
        "records": records,
        "representatives": representatives,
        "history_windows": _history_windows(records, representatives),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build RoofRisk data from the teacher CSV and XGBoost model")
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--built-at", default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    built_at = args.built_at or datetime.now().astimezone().isoformat(timespec="seconds")
    artifact = build_dataset(args.csv.resolve(), args.model_dir.resolve(), built_at)
    write_artifact(artifact, args.output.resolve())
    print(
        json.dumps(
            {
                "output": str(args.output.resolve()),
                "rows": artifact["source"]["row_count"],
                "model": artifact["model"]["name"],
                "representatives": artifact["representatives"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
