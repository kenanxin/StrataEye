"""Small-displacement Euler--Bernoulli beam with grounded linear springs.

SI input; downward displacement/load are positive. Returned support reactions
are positive upward. Springs are bilateral ideal elastic supports. Recovered
Hermite stresses are mesh estimates, checked against analytic solutions.
"""

from dataclasses import dataclass
import math
from numbers import Integral, Real

import numpy as np


@dataclass(frozen=True)
class BeamConfig:
    length_m: float
    width_m: float
    thickness_m: float
    young_modulus_pa: float
    elements: int = 24
    boundary: str = 'simply_supported'


def _number(value, name, *, positive=False):
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Real):
        raise TypeError(f'{name} must be a real number, not a boolean')
    value = float(value)
    if not math.isfinite(value) or (value <= 0 if positive else value < 0):
        raise ValueError(f'{name} must be finite and {"positive" if positive else "nonnegative"}')
    return value


def _integer(value, name, minimum=1):
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Integral):
        raise TypeError(f'{name} must be an integer, not a boolean')
    if value < minimum:
        raise ValueError(f'{name} must be >= {minimum}')
    return int(value)


def solve_beam(config, load_n_per_m, springs):
    """Solve the beam and recover displacement, stress, forces and diagnostics.

    Boundary reaction dictionary keys are node numbers and include vertical
    forces only. The cantilever restraining moment is reported separately in
    ``boundary_moments_n_m`` (opposite the positive generalized rotation).
    """
    if not isinstance(config, BeamConfig):
        raise TypeError('config must be BeamConfig')
    length = _number(config.length_m, 'length_m', positive=True)
    width = _number(config.width_m, 'width_m', positive=True)
    thickness = _number(config.thickness_m, 'thickness_m', positive=True)
    young = _number(config.young_modulus_pa, 'young_modulus_pa', positive=True)
    count = _integer(config.elements, 'elements')
    if not isinstance(config.boundary, str) or config.boundary not in ('simply_supported', 'cantilever'):
        raise ValueError('boundary must be simply_supported or cantilever')
    load = _number(load_n_per_m, 'load_n_per_m')
    if not isinstance(springs, dict):
        raise TypeError('springs must be a node-to-stiffness dictionary')
    checked_springs = {}
    for node, stiffness in springs.items():
        node = _integer(node, 'spring node')
        if node >= count:
            raise ValueError('springs must be on internal beam nodes')
        checked_springs[node] = _number(stiffness, 'spring stiffness')

    try:
        with np.errstate(over='raise', invalid='raise', divide='raise', under='ignore'):
            inertia = width * thickness**3 / 12
            rigidity = young * inertia
            element_length = length / count
            if not all(math.isfinite(x) and x > 0 for x in (inertia, rigidity, element_length)):
                raise ValueError('derived section/rigidity/element length must be finite and positive')
            le = element_length
            stiffness = rigidity / le**3 * np.array([
                [12, 6*le, -12, 6*le], [6*le, 4*le**2, -6*le, 2*le**2],
                [-12, -6*le, 12, -6*le], [6*le, 2*le**2, -6*le, 4*le**2]])
            element_force = load * le / 2 * np.array([1, le/6, 1, -le/6])
            size = 2 * (count + 1)
            total_stiffness = np.zeros((size, size))
            force = np.zeros(size)
            for element in range(count):
                indices = np.arange(2*element, 2*element+4)
                total_stiffness[np.ix_(indices, indices)] += stiffness
                force[indices] += element_force
            for node, spring in checked_springs.items():
                total_stiffness[2*node, 2*node] += spring
            fixed = [0, 2*count] if config.boundary == 'simply_supported' else [0, 1]
            free = np.setdiff1d(np.arange(size), fixed)
            if not np.all(np.isfinite(total_stiffness)) or not np.all(np.isfinite(force)):
                raise ValueError('assembled system contains nonfinite values')
            displacement = np.zeros(size)
            displacement[free] = np.linalg.solve(total_stiffness[np.ix_(free, free)], force[free])
            if not np.all(np.isfinite(displacement)):
                raise ValueError('solution contains nonfinite values')
            residual = total_stiffness @ displacement - force
            spring_forces = {node: float(spring * displacement[2*node]) for node, spring in checked_springs.items()}
            boundary_forces = {dof//2: float(-residual[dof]) for dof in fixed if dof % 2 == 0}
            boundary_moments = {dof//2: float(-residual[dof]) for dof in fixed if dof % 2}
            t = np.linspace(0, 1, 9)
            shape = np.array([1-3*t*t+2*t**3, le*(t-2*t*t+t**3),
                              3*t*t-2*t**3, le*(-t*t+t**3)]).T
            curvature = np.array([(-6+12*t)/le**2, (-4+6*t)/le,
                                  (6-12*t)/le**2, (-2+6*t)/le]).T
            max_deflection = 0.
            max_moment = 0.
            for element in range(count):
                local = displacement[2*element:2*element+4]
                max_deflection = max(max_deflection, float(np.max(np.abs(shape @ local))))
                max_moment = max(max_moment, float(np.max(np.abs(rigidity * (curvature @ local)))))
            work = float(force @ displacement)
            energy = float(.5 * displacement @ total_stiffness @ displacement)
            applied = load * length
            # Relative errors are defined as zero for the exact zero-load solution.
            equilibrium = abs(sum(boundary_forces.values()) + sum(spring_forces.values()) - applied) / applied if applied else 0.
            residual_error = float(np.linalg.norm(residual[free]) / np.linalg.norm(force[free])) if load else 0.
            result = dict(max_deflection_mm=max_deflection * 1000,
                          max_support_force_kn=max((abs(x) for x in spring_forces.values()), default=0.) / 1000,
                          max_bending_stress_mpa=max_moment * thickness / (2 * inertia) / 1e6,
                          displacement_m=displacement[::2].tolist(), rotation_rad=displacement[1::2].tolist(),
                          spring_forces_n=spring_forces, boundary_reactions_n=boundary_forces,
                          boundary_moments_n_m=boundary_moments, strain_energy_j=energy,
                          equilibrium_relative_error=equilibrium, residual_relative_error=residual_error,
                          work_n_m=work)
            values = [result[name] for name in ('max_deflection_mm', 'max_support_force_kn', 'max_bending_stress_mpa',
                                               'strain_energy_j', 'equilibrium_relative_error', 'residual_relative_error', 'work_n_m')]
            values += list(spring_forces.values()) + list(boundary_forces.values()) + list(boundary_moments.values())
            if not all(math.isfinite(x) for x in values):
                raise ValueError('recovered results contain nonfinite values')
            return result
    except (OverflowError, FloatingPointError, ZeroDivisionError, np.linalg.LinAlgError) as error:
        raise ValueError('beam numerical system could not be solved with finite results') from error


def verify_solver():
    """Fail-closed analytic and conservation checks before generating data."""
    grids = [12, 24, 48]
    cases = {}
    for boundary in ('simply_supported', 'cantilever'):
        measured = []
        for count in grids:
            config = BeamConfig(8., 1., .4, 10e9, count, boundary)
            response = solve_beam(config, 1e5, {})
            inertia = .4**3 / 12
            expected_deflection = (5 / 384 if boundary == 'simply_supported' else 1 / 8) * 1e5 * 8**4 / (10e9 * inertia) * 1000
            expected_moment = 1e5 * 8**2 / (8 if boundary == 'simply_supported' else 2)
            expected_stress = expected_moment * .4 / (2 * inertia) / 1e6
            measured.append(dict(elements=count,
                                 deflection_relative_error=abs(response['max_deflection_mm'] / expected_deflection - 1),
                                 stress_relative_error=abs(response['max_bending_stress_mpa'] / expected_stress - 1),
                                 equilibrium_relative_error=response['equilibrium_relative_error'],
                                 residual_relative_error=response['residual_relative_error'],
                                 energy_relative_error=abs(2 * response['strain_energy_j'] / response['work_n_m'] - 1)))
        cases[boundary] = measured
    spring_response = solve_beam(BeamConfig(8., 1., .4, 10e9), 1e5, {6: 4e6, 12: 4e6, 18: 4e6})
    spring_checks = dict(equilibrium_relative_error=spring_response['equilibrium_relative_error'],
                         residual_relative_error=spring_response['residual_relative_error'],
                         energy_relative_error=abs(2 * spring_response['strain_energy_j'] / spring_response['work_n_m'] - 1))
    center_config = BeamConfig(8., 1., .4, 10e9)
    center_stiffness = 4e6
    center_response = solve_beam(center_config, 1e5, {12: center_stiffness})
    center_inertia = center_config.width_m * center_config.thickness_m**3 / 12
    bare_center = 5 * 1e5 * center_config.length_m**4 / (384 * center_config.young_modulus_pa * center_inertia)
    expected_center = bare_center / (1 + center_stiffness * center_config.length_m**3 /
                                     (48 * center_config.young_modulus_pa * center_inertia))
    spring_checks['center_deflection_relative_error'] = abs(center_response['displacement_m'][12] / expected_center - 1)
    spring_checks['center_spring_force_relative_error'] = abs(center_response['spring_forces_n'][12] /
                                                               (center_stiffness * expected_center) - 1)
    measured_values = [value for measured in cases.values() for item in measured
                       for key, value in item.items() if key != 'elements'] + list(spring_checks.values())
    if not all(math.isfinite(value) for value in measured_values):
        raise ValueError('nonfinite solver verification measurement')
    for boundary, measured in cases.items():
        if any(item['deflection_relative_error'] >= 1e-4 for item in measured) or measured[-1]['stress_relative_error'] >= .005:
            raise ValueError(f'{boundary} analytic verification failed')
        if not all(measured[i+1]['stress_relative_error'] < measured[i]['stress_relative_error'] for i in range(2)):
            raise ValueError(f'{boundary} mesh stress convergence failed')
        if any(item[key] >= 1e-7 for item in measured for key in ('equilibrium_relative_error', 'residual_relative_error', 'energy_relative_error')):
            raise ValueError(f'{boundary} conservation verification failed')
    if any(spring_checks[key] >= 1e-4 for key in ('center_deflection_relative_error',
                                                'center_spring_force_relative_error')):
        raise ValueError('center spring analytic verification failed')
    if any(spring_checks[key] >= 1e-7 for key in ('equilibrium_relative_error',
                                                'residual_relative_error', 'energy_relative_error')):
        raise ValueError('spring-supported conservation verification failed')
    return dict(passed=True, grids=grids, analytic_cases=cases, spring_checks=spring_checks,
                tolerances=dict(deflection=1e-4, refined_stress=.005, conservation=1e-7,
                                center_spring=1e-4))
