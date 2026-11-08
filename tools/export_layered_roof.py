"""Reproducible, uncalibrated roadway strip scenarios; no teacher data access."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.roof_mechanics.solver import BeamConfig
from tools.roof_mechanics.layered_solver import solve_layered


def source_hash(path):
    return hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()


def build():
    upper = BeamConfig(8., 1., .6, 12e9, elements=24)
    lower = BeamConfig(8., 1., .3, 6e9, elements=24)
    presets = [('reference', '参考锚固', 1., 1., False),
               ('load-increase', '载荷增加', 1.5, 1., False),
               ('anchor-weakening', '锚固连接刚度降低', 1., .25, False),
               ('upper-loading', '上层受载与层间接触', 1., 1., True)]
    cases = []
    for case_id, label, load_factor, tie_factor, upper_loading in presets:
        frames = []
        for step in range(21):
            q = (2000. + step*400.) * load_factor
            loads = [8*q, .1*q] if upper_loading else [.2*q, q]
            result = solve_layered(upper, lower, loads, {6: 8e6*tie_factor, 12: 8e6*tie_factor, 18: 8e6*tie_factor},
                                   contact_n_per_m2=1e9, lower_supports={12: 2e6})
            frames.append(dict(step=step, upper_load_kn_per_m=loads[0]/1000,
                               lower_load_kn_per_m=loads[1]/1000, **result))
        cases.append(dict(id=case_id, label=label, anchor_stiffness_mn_per_m=8*tie_factor,
                          load_factor=load_factor, frames=frames))
    sources = ['tools/roof_mechanics/solver.py', 'tools/roof_mechanics/layered_solver.py', 'tools/export_layered_roof.py']
    return dict(schema_version=1, version='layered-roof-v1-20261019', source_kind='mechanics_simulation',
                computation_mode='precomputed_solver_frames', object_id='SIM-ROADWAY-LAYERS-01',
                model='双层Euler–Bernoulli梁 / 受压接触 / 受拉锚固连接',
                parameters=dict(length_m=8., width_m=1., elements=24, upper_thickness_m=.6,
                    lower_thickness_m=.3, upper_young_modulus_gpa=12., lower_young_modulus_gpa=6.,
                    anchor_nodes=[6, 12, 18], lower_support_nodes=[12], lower_support_stiffness_mn_per_m=2.,
                    contact_stiffness_n_per_m2=1e9, boundary='两层分别简支', anchor_preload_kn=0.),
                provenance=dict(source_hash_convention='sha256_utf8_lf', sources={s: source_hash(ROOT/s) for s in sources}),
                scope='巷道顶板单位宽度双层条带；参数为演示设定，待现场校准。',
                limitations=['小变形、线弹性、准静态；加载步无现场时间单位',
                    '层间法向受压罚接触，单独报告弹性重叠；张开时接触不承受拉力',
                    '锚固连接为零预紧受拉轴向弹簧；未建模粘结滑移、屈服与断裂',
                    '两层转角独立，无层间剪切粘结；离层峰值为网格节点采样',
                    '预设工况对照用于机理研究；参数反演、异常根因识别与现场有效性待验证'], cases=cases)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    artifact = build()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8', newline='\n') as out:
        json.dump(artifact, out, ensure_ascii=False, allow_nan=False, indent=2)
        out.write('\n')
    print('Exported 4 scenarios / 84 frames:', args.output)
