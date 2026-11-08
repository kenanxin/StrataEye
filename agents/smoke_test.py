"""工具层冒烟测试（不依赖 CAMEL/LLM）：验证四个专业工具与代表性记录。"""
from __future__ import annotations

import sys

from agent_service.config import load_dataset
from agent_service.tools import (mechanics_check, microseismic_indices,
                                 query_roof_record, search_knowledge)


def main() -> int:
    dataset = load_dataset()
    print(f"数据集记录数：{len(dataset['records'])}")
    print("代表记录：", json.dumps(dataset["representatives"], ensure_ascii=False)[:300])

    by_class = dataset["representatives"]
    target = by_class.get("重大风险") or dataset["records"][0]["id"]
    print(f"\n=== query_roof_record（{target}）===")
    record = query_roof_record(target)
    print(record["predicted_class"], record["confidence"],
          [(f["label"], f["value"], f["exceeds_p95"]) for f in record["features"]])

    print(f"\n=== microseismic_indices（{target}）===")
    print(microseismic_indices(target))

    print("\n=== mechanics_check（支架阻力 0.9 MPa、跨度 8 m 折算荷载）===")
    print(mechanics_check(load_kn_per_m=90.0, spring_stiffness_mn_per_m=4.0))

    print("\n=== search_knowledge('离层 微震 预警') ===")
    hits = search_knowledge("离层 微震 预警")
    print([card["id"] for card in hits["cards"]])
    return 0


if __name__ == "__main__":
    import json
    sys.exit(main())
