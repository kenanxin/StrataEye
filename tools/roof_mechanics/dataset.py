"""Seeded simulated scenarios and causally constructed future-limit labels."""

import json
import math

import numpy as np

from .solver import BeamConfig, _integer, _number, solve_beam, verify_solver


FEATURE_NAMES = ('max_deflection_mm', 'deflection_increment_mm_per_step',
                 'max_support_force_kn', 'max_bending_stress_mpa')
CLASS_NAMES = ('低利用率', '中等利用率', '接近假设极限', '达到假设极限')
SIMULATOR_VERSION = 'eb-spring-v1'
DATASET_VERSION = 'roof-mechanics-v1'
SOURCE_KIND = 'mechanics_simulation'
FAMILIES = ('load_ramp', 'support_softening', 'roof_softening')


def classify_ratio(ratio):
    ratio = _number(ratio, 'ratio')
    return 0 if ratio < .5 else 1 if ratio < .8 else 2 if ratio < 1 else 3


def supervised_rows(trajectory, scenario_id, domain, family):
    """Use only current features and the next three observed states as labels.

    A shorter window is allowed only when the first limit crossing provides
    positive target evidence. The crossing itself is never a feature row.
    Incomplete negative tails are omitted; post-crossing evidence is rejected.
    """
    for index, state in enumerate(trajectory):
        if state['step'] != index:
            raise ValueError('trajectory steps must be contiguous from zero')
        ratio = _number(state['current_ratio'], 'current_ratio')
        if ratio >= 1 and index != len(trajectory) - 1:
            raise ValueError('trajectory contains states after its first limit crossing')
    rows = []
    for index, state in enumerate(trajectory):
        if state['current_ratio'] >= 1:
            break
        future = trajectory[index+1:index+4]
        if len(future) < 3 and not (future and future[-1]['current_ratio'] >= 1):
            continue
        future_ratio = max(item['current_ratio'] for item in future)
        row = {name: state[name] for name in FEATURE_NAMES if name != 'deflection_increment_mm_per_step'}
        row['deflection_increment_mm_per_step'] = state['max_deflection_mm'] - trajectory[index-1]['max_deflection_mm'] if index else 0.
        row.update(scenario_id=scenario_id, domain=domain, family=family, step=state['step'],
                   current_ratio=state['current_ratio'], current_class=classify_ratio(state['current_ratio']),
                   target_future_ratio=future_ratio, target_class=classify_ratio(future_ratio),
                   source_kind=SOURCE_KIND, dataset_version=DATASET_VERSION)
        rows.append(row)
    return rows


def _utilization(response, length, strength, capacity):
    components = dict(deflection=response['max_deflection_mm'] / (length / 250 * 1000),
                      bending=response['max_bending_stress_mpa'] / strength,
                      support=response['max_support_force_kn'] / (capacity / 1000))
    ratio = max(components.values())
    _number(ratio, 'derived utilization')
    return ratio, components


def _scenario(rng, index, domain, steps):
    length = float(rng.uniform(6, 12) if domain == 'in_domain' else rng.uniform(np.nextafter(12., math.inf), 14))
    thickness = float(rng.uniform(.30, .60))
    young = float(rng.uniform(4e9, 20e9))
    spring_stiffnesses = rng.uniform(2e6, 20e6, 3).tolist()
    capacity = float(rng.uniform(.4e6, 1.2e6))
    strength = float(rng.uniform(1, 6))
    start_fraction = float(rng.uniform(.10, .35))
    end_fraction = float(rng.uniform(.90, 1.30))
    support_loss = float(rng.uniform(.20, .80))
    young_loss = float(rng.uniform(.10, .45))
    family = FAMILIES[index % len(FAMILIES)]
    scenario_id = f'{domain}-{index:05d}'
    nodes = [6, 12, 18]
    reference_config = BeamConfig(length, 1., thickness, young)
    reference_load = 100000.
    initial_springs = dict(zip(nodes, spring_stiffnesses))
    reference = solve_beam(reference_config, reference_load, initial_springs)
    reference_ratio, _ = _utilization(reference, length, strength, capacity)
    if reference_ratio <= 0:
        raise ValueError('reference load must produce positive utilization')
    critical_load = reference_load / reference_ratio
    parameters = dict(length_m=length, width_m=1., thickness_m=thickness, young_modulus_pa=young,
                      elements=24, boundary='simply_supported', spring_nodes=nodes,
                      spring_positions_m=[length * fraction for fraction in (.25, .5, .75)],
                      spring_stiffnesses_n_per_m=spring_stiffnesses, capacity_n=capacity,
                      spring_capacities_n=[capacity] * 3, bending_strength_mpa=strength,
                      deflection_limit_mm=length / 250 * 1000, q_reference_n_per_m=reference_load,
                      reference_ratio=reference_ratio, q_crit_n_per_m=critical_load,
                      start_load_fraction=start_fraction, end_load_fraction=end_fraction,
                      support_loss_fraction=support_loss if family == 'support_softening' else 0.,
                      young_modulus_loss_fraction=young_loss if family == 'roof_softening' else 0.,
                      requested_steps=steps)
    trajectory = []
    stop_reason = 'completed_load_schedule'
    for step in range(steps):
        progress = step / (steps - 1)
        load_fraction = start_fraction + (end_fraction - start_fraction) * progress
        effective_young = young * (1 - parameters['young_modulus_loss_fraction'] * progress**2)
        effective_springs = {node: stiffness * (1 - parameters['support_loss_fraction'] * progress**2)
                             for node, stiffness in initial_springs.items()}
        response = solve_beam(BeamConfig(length, 1., thickness, effective_young), critical_load * load_fraction, effective_springs)
        ratio, components = _utilization(response, length, strength, capacity)
        state = dict(response, step=step, progress=progress, load_n_per_m=critical_load * load_fraction,
                     young_modulus_pa=effective_young, spring_stiffnesses_n_per_m=effective_springs,
                     current_ratio=ratio, current_class=classify_ratio(ratio), utilization_components=components)
        trajectory.append(state)
        if ratio >= 1:
            stop_reason = 'first_limit_crossing'
            break
    return dict(scenario_id=scenario_id, domain=domain, family=family, parameters=parameters,
                trajectory=trajectory, stop_reason=stop_reason, source_kind=SOURCE_KIND,
                simulator_version=SIMULATOR_VERSION, dataset_version=DATASET_VERSION)


def generate_dataset(in_domain_scenarios=500, ood_scenarios=100, steps=32, *,
                     in_domain_seed=1729, ood_seed=3141):
    in_count = _integer(in_domain_scenarios, 'in_domain_scenarios', 0)
    out_count = _integer(ood_scenarios, 'ood_scenarios', 0)
    steps = _integer(steps, 'steps', 2)
    in_domain_seed = _integer(in_domain_seed, 'in_domain_seed', 0)
    ood_seed = _integer(ood_seed, 'ood_seed', 0)
    verification = verify_solver()
    if verification.get('passed') is not True:
        raise ValueError('solver verification did not pass')
    scenarios = []
    rows = []
    for domain, count, seed in [('in_domain', in_count, in_domain_seed), ('ood', out_count, ood_seed)]:
        rng = np.random.default_rng(seed)
        for index in range(count):
            scenario = _scenario(rng, index, domain, steps)
            scenarios.append(scenario)
            rows.extend(supervised_rows(scenario['trajectory'], scenario['scenario_id'], domain, scenario['family']))
    metadata = dict(simulator_version=SIMULATOR_VERSION, dataset_version=DATASET_VERSION,
                    source_kind=SOURCE_KIND, feature_names=list(FEATURE_NAMES), class_names=list(CLASS_NAMES),
                    thresholds=[.5, .8, 1.], future_window_steps=3, noise=False,
                    seeds=dict(in_domain=in_domain_seed, ood=ood_seed), uniform_support_capacity=True,
                    in_domain_scenarios=in_count, ood_scenarios=out_count, steps=steps,
                    row_count=len(rows), scenario_count=len(scenarios),
                    ood_scope='span in (12, 14] m; all other ranges shared with in-domain',
                    step_semantics='quasi-static loading step; no physical time unit',
                    limit_semantics='hypothetical screening limits; no field calibration or accident probability',
                    assumptions=['homogeneous slender linear-elastic Euler-Bernoulli strip',
                                 'bilateral grounded linear springs', 'prescribed stiffness degradation',
                                 'no post-limit collapse dynamics', 'no sensor noise'])
    result = dict(rows=rows, scenarios=scenarios, verification=verification, metadata=metadata)
    # Finite output is an explicit data contract; never serialize NaN/Infinity.
    json.dumps(result, allow_nan=False)
    return result
