"""Reproduce supplied evaluation and a separate chronological raw-feature benchmark.

No production model/artifact is overwritten. The chronological benchmark deliberately
omits retrospective Kalman smoothing and does not inherit the supplied full-data scaler.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, recall_score
from sklearn.preprocessing import OrdinalEncoder, StandardScaler
from sklearn.utils.class_weight import compute_sample_weight
from xgboost import XGBClassifier

from tools.data_integration.build_roof_risk_dataset import CLASS_NAMES, EXPECTED_SHA256, NUMERIC_COLUMNS


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest().upper()


def metrics(y, predicted):
    support = np.bincount(y, minlength=4)
    recalls = recall_score(y, predicted, labels=range(4), average=None, zero_division=0)
    return {
        "accuracy": float(accuracy_score(y, predicted)),
        "macro_f1": float(f1_score(y, predicted, labels=range(4), average="macro", zero_division=0)),
        "recall_by_class": [float(value) if count else None for value, count in zip(recalls, support)],
        "confusion_matrix": confusion_matrix(y, predicted, labels=range(4)).tolist(),
        "support": support.tolist(),
        "unevaluable_classes": [label for label, count in zip(CLASS_NAMES, support) if count == 0],
        "macro_f1_definition": "Unweighted mean over all four fixed labels; missing-label F1 is zero, recall is null",
    }


def audit(csv, model_dir):
    frame = pd.read_csv(csv, encoding="utf-8-sig")
    if sha(csv) != EXPECTED_SHA256:
        raise ValueError("Teacher CSV does not match the integrated source hash")
    labels = {label: index for index, label in enumerate(CLASS_NAMES)}
    frame["parsed_time"] = pd.to_datetime(frame["时间"], errors="raise")
    frame = frame.sort_values(["parsed_time", "设备编号"], kind="stable").reset_index(drop=True)
    y = frame["风险等级"].map(labels).to_numpy(dtype=np.int64)
    if len(frame) != 20000 or len(np.unique(y)) != 4:
        raise ValueError("Expected 20,000 rows and four labels")

    supplied = np.load(model_dir / "processed_data.npz", allow_pickle=False)
    model = XGBClassifier()
    model.load_model(model_dir / "xgb_model.json")
    supplied_metrics = metrics(supplied["y_pw_test"], model.predict(supplied["X_pw_test"]).astype(int))
    declared = json.loads((model_dir / "metrics.json").read_text(encoding="utf-8"))["xgboost"]
    supplied_metrics["matches_declared_confusion_matrix"] = supplied_metrics["confusion_matrix"] == declared["confusion_matrix"]
    supplied_metrics["matches_declared_accuracy"] = abs(supplied_metrics["accuracy"] - declared["accuracy"]) < 1e-10

    # Timestamp ties remain together; no record from a held-out time appears in training.
    cut_train = frame.parsed_time.iloc[int(len(frame) * .6)]
    cut_test = frame.parsed_time.iloc[int(len(frame) * .8)]
    masks = [frame.parsed_time < cut_train, (frame.parsed_time >= cut_train) & (frame.parsed_time < cut_test), frame.parsed_time >= cut_test]
    train, validation, test = [frame.loc[mask] for mask in masks]
    yt, yv, ye = [y[mask.to_numpy()] for mask in masks]
    scaler = StandardScaler().fit(train[NUMERIC_COLUMNS])
    encoder = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1).fit(train[["数据质量"]])
    X = [np.hstack([scaler.transform(part[NUMERIC_COLUMNS]), encoder.transform(part[["数据质量"]])]) for part in [train, validation, test]]
    results = {}
    models = {
        "majority_baseline": DummyClassifier(strategy="most_frequent"),
        "random_forest": RandomForestClassifier(n_estimators=400, min_samples_leaf=2, class_weight="balanced", n_jobs=4, random_state=42),
        "xgboost": XGBClassifier(n_estimators=600, max_depth=6, learning_rate=.05, subsample=.9, colsample_bytree=.9, objective="multi:softprob", num_class=4, eval_metric="mlogloss", tree_method="hist", n_jobs=4, random_state=42, early_stopping_rounds=30),
    }
    for name, estimator in models.items():
        start = time.perf_counter()
        fit_options = {"sample_weight": compute_sample_weight("balanced", yt), "eval_set": [(X[1], yv)], "verbose": False} if name == "xgboost" else {}
        estimator.fit(X[0], yt, **fit_options)
        results[name] = metrics(ye, estimator.predict(X[2]).astype(int))
        results[name]["training_seconds"] = round(time.perf_counter() - start, 3)
        if name == "xgboost":
            results[name]["best_iteration"] = int(estimator.best_iteration)
        print(json.dumps({name: results[name]}, ensure_ascii=True), flush=True)

    feature_cols = [*NUMERIC_COLUMNS, "数据质量"]
    train_keys = set(pd.util.hash_pandas_object(train[feature_cols], index=False).tolist())
    overlap = pd.util.hash_pandas_object(test[feature_cols], index=False).isin(train_keys)
    artifacts = ["xgb_model.json", "rf_model.pkl", "scaler.pkl", "quality_encoder.pkl", "kalman_filter.pkl", "processed_data.npz", "metrics.json", "preprocess_data.py", "train_model.py"]
    source_candidate = model_dir / "demo_training_data.csv"
    return {
        "schema_version": 1,
        "source": {"sha256": sha(csv), "rows": len(frame), "columns": len(frame.columns) - 1, "class_order": CLASS_NAMES, "supplied_training_csv_same_hash": sha(source_candidate) == sha(csv) if source_candidate.exists() else None},
        "artifact_sha256": {name: sha(model_dir / name) for name in artifacts},
        "supplied_random_split": {"train_rows": len(supplied["y_pw_train"]), "test_rows": len(supplied["y_pw_test"]), "reproduced_xgboost": supplied_metrics, "limitations": ["Kalman EM and StandardScaler fitted before random split", "Retrospective smoothing uses future samples within segments", "Test partition used for XGBoost early stopping", "Random pointwise split does not demonstrate temporal/site generalization"]},
        "chronological_raw_feature_benchmark": {
            "seed": 42, "production_model_replaced": False,
            "protocol": "Global timestamp 60/20/20; ties together; training-only scaling/encoding; raw seven numeric plus quality; validation-only XGBoost early stopping; untouched test evaluation",
            "split": {name: {"rows": len(part), "time_min": str(part.parsed_time.min()), "time_max": str(part.parsed_time.max()), "labels": np.bincount(target, minlength=4).tolist()} for name, part, target in zip(["train", "validation", "test"], [train, validation, test], [yt, yv, ye])},
            "test_feature_rows_also_in_training": int(overlap.sum()),
            "models": results,
            "limitations": ["Same teacher-provided dataset, not independent mine/site validation", "Label creation and field acquisition provenance require supplier confirmation", "Raw-feature benchmark is a different pipeline from production smoothed XGBoost", "Model probability is not calibrated accident probability; weighted 20/45/70/95 score is not a continuous physical risk measurement"]},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=Path("data/teacher_roof_monitoring.csv"))
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("docs/qa/2026-10-11-model-evidence.json"))
    args = parser.parse_args()
    result = audit(args.csv, args.model_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(str(args.output))
