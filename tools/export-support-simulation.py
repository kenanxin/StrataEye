"""Export immutable single-support presets from the existing verified solver.

No model fitting, teacher-data access or field calibration. Deployment needs
only the generated JSON, not a Python service. Refuse overwriting an artifact.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys


def export(solver_path, output):
    solver_path = Path(solver_path).resolve(strict=True)
    output = Path(output).resolve()
    if output.exists():
        raise FileExistsError(f'Refuse to overwrite {output}')
    spec = importlib.util.spec_from_file_location('support_demo_beam_solver', solver_path)
    solver = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = solver
    spec.loader.exec_module(solver)
    verification = solver.verify_solver()
    config = solver.BeamConfig(length_m=8., width_m=1., thickness_m=.5,
                               young_modulus_pa=8e9, elements=24)
    cases = []
    for case_id, label, stiffness in [('reference-support', '参考支护', 80e6),
                                      ('soft-support', '较低支护刚度', 20e6),
                                      ('stiff-support', '较高支护刚度', 160e6)]:
        frames = []
        for step in range(21):
            load = 20000. + 4000. * step
            result = solver.solve_beam(config, load, {12: stiffness})
            if max(result['equilibrium_relative_error'], result['residual_relative_error']) > 1e-8:
                raise ValueError('Physical verification failed')
            frames.append(dict(step=step, load_kn_per_m=load/1000,
                               support_force_kn=result['spring_forces_n'][12]/1000,
                               support_displacement_mm=result['displacement_m'][12]*1000,
                               max_deflection_mm=result['max_deflection_mm'],
                               max_bending_stress_mpa=result['max_bending_stress_mpa'],
                               boundary_reactions_kn=[v/1000 for v in result['boundary_reactions_n'].values()],
                               applied_load_kn=load*config.length_m/1000,
                               equilibrium_relative_error=result['equilibrium_relative_error'],
                               residual_relative_error=result['residual_relative_error']))
        cases.append(dict(id=case_id, label=label, spring_stiffness_mn_per_m=stiffness/1e6, frames=frames))
    artifact = dict(schema_version=1, version='support-point-v1-20261014',
                    source_kind='mechanics_simulation', computation_mode='precomputed_solver_frames',
                    model='Euler–Bernoulli梁—单接地线性弹簧', object_id='SIM-SUPPORT-01',
                    scene_role='simulationSupport01', mapping_kind='illustrative_object_link',
                    parameters=dict(length_m=8., width_m=1., thickness_m=.5, young_modulus_gpa=8.,
                                    elements=24, spring_node=12, spring_position_m=4., boundary='simply_supported'),
                    step_unit='准静态加载步，无现场时间单位',
                    disclaimer='简化力学预计算演示，未经现场校准。模拟支护反力不等于液压支架实测工作阻力；三维对象仅作示意关联，不改变教师数据、风险等级或工单状态。',
                    limitations=['线弹性、小变形与双向弹簧假设', '无裂隙、离层或垮落动力学', '无材料噪声或液压支架机构建模', '刚度工况不代表已执行的现场补强措施'],
                    provenance=dict(solver_source_sha256=hashlib.sha256(solver_path.read_bytes()).hexdigest(),
                                    exporter_source_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                                    solver_verification=verification), cases=cases)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8', newline='\n') as handle:
        json.dump(artifact, handle, ensure_ascii=False, allow_nan=False, indent=2)
        handle.write('\n')
    print(f'Exported {len(cases)} cases / {sum(len(c["frames"]) for c in cases)} frames: {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--solver', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    export(args.solver, args.output)
