import dataclasses
import unittest
from unittest.mock import patch

import numpy as np

from tools.roof_mechanics.solver import BeamConfig, solve_beam, verify_solver


class SolverTests(unittest.TestCase):
    def test_simply_supported_analytic_units_and_checks(self):
        cfg = BeamConfig(8., 1., .4, 10e9, elements=48)
        result = solve_beam(cfg, 1e5, {})
        inertia = cfg.width_m * cfg.thickness_m**3 / 12
        expected_mm = 5 * 1e5 * 8**4 / (384 * 10e9 * inertia) * 1000
        expected_stress = (1e5 * 8**2 / 8) * .4 / (2 * inertia) / 1e6
        self.assertAlmostEqual(result['max_deflection_mm'] / expected_mm, 1., places=4)
        self.assertLess(abs(result['max_bending_stress_mpa'] / expected_stress - 1), .005)
        self.assertLess(result['equilibrium_relative_error'], 1e-8)
        self.assertLess(result['residual_relative_error'], 1e-8)
        self.assertAlmostEqual(2 * result['strain_energy_j'] / result['work_n_m'], 1., places=7)
        self.assertAlmostEqual(sum(result['boundary_reactions_n'].values()), 8e5, places=3)
        self.assertEqual(result['max_support_force_kn'], 0.)

    def test_cantilever_analytic(self):
        cfg = BeamConfig(8., 1., .4, 10e9, elements=48, boundary='cantilever')
        result = solve_beam(cfg, 1e5, {})
        inertia = .4**3 / 12
        self.assertAlmostEqual(result['max_deflection_mm'] / (1e5 * 8**4 / (8 * 10e9 * inertia) * 1000), 1., places=4)
        self.assertLess(abs(result['max_bending_stress_mpa'] / (1e5 * 8**2 / 2 * .4 / (2 * inertia) / 1e6) - 1), .005)

    def test_stress_refines_on_both_boundaries(self):
        for boundary, moment in [('simply_supported', 1e5 * 8**2 / 8), ('cantilever', 1e5 * 8**2 / 2)]:
            expected = moment * .4 / (2 * (.4**3 / 12)) / 1e6
            errors = [abs(solve_beam(BeamConfig(8., 1., .4, 10e9, elements=n, boundary=boundary), 1e5, {})['max_bending_stress_mpa'] / expected - 1) for n in (12, 24, 48)]
            self.assertGreater(errors[0], errors[1])
            self.assertGreater(errors[1], errors[2])
            self.assertLess(errors[2], .005)

    def test_symmetry_linear_response_and_springs(self):
        cfg = BeamConfig(8., 1., .4, 10e9)
        springs = {6: 4e6, 12: 4e6, 18: 4e6}
        first = solve_beam(cfg, 1e5, springs)
        second = solve_beam(cfg, 2e5, springs)
        np.testing.assert_allclose(first['displacement_m'], first['displacement_m'][::-1], rtol=1e-8, atol=1e-12)
        np.testing.assert_allclose(first['rotation_rad'], -np.array(first['rotation_rad'][::-1]), rtol=1e-8, atol=1e-12)
        for field in ('max_deflection_mm', 'max_support_force_kn', 'max_bending_stress_mpa'):
            self.assertAlmostEqual(second[field] / first[field], 2., places=8)
        self.assertLess(first['max_deflection_mm'], solve_beam(cfg, 1e5, {})['max_deflection_mm'])
        self.assertGreater(solve_beam(dataclasses.replace(cfg, young_modulus_pa=5e9), 1e5, springs)['max_deflection_mm'], first['max_deflection_mm'])
        self.assertAlmostEqual(first['max_support_force_kn'], max(abs(v) for v in first['spring_forces_n'].values()) / 1000)
        self.assertLess(first['equilibrium_relative_error'], 1e-8)
        self.assertLess(first['residual_relative_error'], 1e-8)

    def test_zero_load(self):
        result = solve_beam(BeamConfig(8., 1., .4, 10e9), 0., {12: 4e6})
        for field in ('max_deflection_mm', 'max_support_force_kn', 'max_bending_stress_mpa', 'strain_energy_j', 'equilibrium_relative_error', 'residual_relative_error', 'work_n_m'):
            self.assertEqual(result[field], 0.)

    def test_invalid_inputs_and_immutable_config(self):
        valid = BeamConfig(8., 1., .4, 10e9)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            valid.length_m = 3
        for field in ('length_m', 'width_m', 'thickness_m', 'young_modulus_pa'):
            for value in (0, -1, float('nan'), float('inf'), True, '8'):
                with self.subTest(field=field, value=value), self.assertRaises((ValueError, TypeError)):
                    solve_beam(dataclasses.replace(valid, **{field: value}), 1e5, {})
        for value in (0, -1, 2.5, True, '24'):
            with self.subTest(elements=value), self.assertRaises((ValueError, TypeError)):
                solve_beam(dataclasses.replace(valid, elements=value), 1e5, {})
        for boundary in ('fixed', None, 2):
            with self.assertRaises((ValueError, TypeError)):
                solve_beam(dataclasses.replace(valid, boundary=boundary), 1e5, {})
        for load in (-1, float('nan'), float('inf'), True, '1'):
            with self.assertRaises((ValueError, TypeError)):
                solve_beam(valid, load, {})
        for springs in ({0: 1}, {24: 1}, {-1: 1}, {25: 1}, {1.5: 1}, {True: 1}, {1: -1}, {1: float('nan')}, {1: True}, [], None):
            with self.subTest(springs=springs), self.assertRaises((ValueError, TypeError)):
                solve_beam(valid, 1e5, springs)

    def test_overflow_fails_closed(self):
        with self.assertRaises(ValueError):
            solve_beam(BeamConfig(1e150, 1., 1e150, 1e300), 1e300, {})

    def test_verification(self):
        result = verify_solver()
        self.assertTrue(result['passed'])
        self.assertEqual(result['grids'], [12, 24, 48])
        self.assertLess(result['spring_checks']['center_deflection_relative_error'], 1e-4)
        self.assertLess(result['spring_checks']['center_spring_force_relative_error'], 1e-4)

    def test_single_center_spring_against_analytic_solution(self):
        cfg = BeamConfig(8., 1., .4, 10e9, 24)
        inertia = cfg.width_m * cfg.thickness_m**3 / 12
        bare_center = 5 * 1e5 * 8**4 / (384 * 10e9 * inertia)
        expected = bare_center / (1 + 4e6 * 8**3 / (48 * 10e9 * inertia))
        response = solve_beam(cfg, 1e5, {12: 4e6})
        self.assertLess(abs(response['displacement_m'][12] / expected - 1), 1e-4)
        self.assertLess(abs(response['spring_forces_n'][12] / (4e6 * expected) - 1), 1e-4)

    def test_verification_rejects_nonfinite_measurements(self):
        original_solve = solve_beam
        def corrupted_solve(*args):
            result = original_solve(*args)
            result['max_deflection_mm'] = float('nan')
            return result
        with patch('tools.roof_mechanics.solver.solve_beam', side_effect=corrupted_solve):
            with self.assertRaises(ValueError):
                verify_solver()

    def test_verification_rejects_center_spring_drift(self):
        original_solve = solve_beam
        def corrupted_solve(config, load, springs):
            result = original_solve(config, load, springs)
            if springs == {12: 4e6}:
                result['displacement_m'][12] *= 1.001
            return result
        with patch('tools.roof_mechanics.solver.solve_beam', side_effect=corrupted_solve):
            with self.assertRaisesRegex(ValueError, 'center spring analytic'):
                verify_solver()


if __name__ == '__main__':
    unittest.main()
