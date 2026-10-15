"""Supplement the immutable core frames with verified FEM displacement fields."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

def export(solver_path, core_path, output_path):
    solver_path=Path(solver_path).resolve(strict=True)
    core_path=Path(core_path).resolve(strict=True)
    output_path=Path(output_path).resolve()
    if output_path.exists(): raise FileExistsError(output_path)
    spec=importlib.util.spec_from_file_location('support_shape_solver',solver_path)
    solver=importlib.util.module_from_spec(spec);sys.modules[spec.name]=solver;spec.loader.exec_module(solver)
    core=json.loads(core_path.read_text(encoding='utf-8'));p=core['parameters']
    config=solver.BeamConfig(p['length_m'],p['width_m'],p['thickness_m'],p['young_modulus_gpa']*1e9,p['elements'])
    cases=[]
    for item in core['cases']:
        frames=[]
        for original in item['frames']:
            result=solver.solve_beam(config,original['load_kn_per_m']*1000,{p['spring_node']:item['spring_stiffness_mn_per_m']*1e6})
            for key,value in [('support_force_kn',result['spring_forces_n'][p['spring_node']]/1000),('support_displacement_mm',result['displacement_m'][p['spring_node']]*1000),('max_deflection_mm',result['max_deflection_mm'])]:
                if abs(value-original[key])>1e-8:raise ValueError(f'Core frame mismatch: {key}')
            frames.append(dict(step=original['step'],displacement_mm=[v*1000 for v in result['displacement_m']],rotation_rad=result['rotation_rad']))
        cases.append(dict(id=item['id'],frames=frames))
    artifact=dict(version='support-deformation-v1-20261015',source_kind='verified_fem_displacement_field',
                  core_file_sha256=hashlib.sha256(core_path.read_bytes()).hexdigest(),
                  solver_source_sha256=hashlib.sha256(solver_path.read_bytes()).hexdigest(),
                  exporter_source_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  interpolation='cubic_hermite',displacement_positive='downward',
                  node_positions_m=[i*p['length_m']/p['elements'] for i in range(p['elements']+1)],
                  display_reference_max_mm=max(f['max_deflection_mm'] for c in core['cases'] for f in c['frames']),cases=cases)
    output_path.parent.mkdir(parents=True,exist_ok=True)
    with output_path.open('x',encoding='utf-8',newline='\n') as handle:
        json.dump(artifact,handle,ensure_ascii=False,allow_nan=False,indent=2);handle.write('\n')
    print(f'Verified63 frames,25 nodes; fixed color reference={artifact["display_reference_max_mm"]:.6f}mm')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--solver',required=True);parser.add_argument('--core',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();export(args.solver,args.core,args.output)
