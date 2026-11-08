import dataclasses
import unittest
import numpy as np
from tools.roof_mechanics.solver import BeamConfig, solve_beam
from tools.roof_mechanics.layered_solver import solve_layered


class LayeredSolverTests(unittest.TestCase):
    def setUp(self):
        self.cfg = BeamConfig(8., 1., .4, 10e9, elements=24)

    def test_uncoupled_layers_match_existing_analytic_solver(self):
        r = solve_layered(self.cfg, self.cfg, [2e4, 5e4], {}, 0.)
        for i, q in enumerate([2e4, 5e4]):
            expected = solve_beam(self.cfg, q, {})
            np.testing.assert_allclose(r['layers'][i]['displacement_mm'], np.array(expected['displacement_m'])*1000, atol=1e-7)
        self.assertGreater(r['max_opening_mm'], 0)

    def test_center_tie_matches_independent_closed_form(self):
        q, k = 5e4, 8e6
        r = solve_layered(self.cfg, self.cfg, [0., q], {12: k}, 1e9)
        EI = self.cfg.young_modulus_pa*self.cfg.width_m*self.cfg.thickness_m**3/12
        compliance = self.cfg.length_m**3/(48*EI)
        bare = 5*q*self.cfg.length_m**4/(384*EI)
        gap = bare/(1+2*k*compliance)
        self.assertAlmostEqual(r['signed_gap_mm'][12]/1000, gap, places=9)
        self.assertAlmostEqual(r['anchor_forces_kn'][12], k*gap/1000, places=6)
        self.assertEqual(max(r['contact_forces_kn']), 0.)

    def test_contact_cannot_carry_tension_and_ties_cannot_carry_compression(self):
        opened = solve_layered(self.cfg, self.cfg, [0., 5e4], {12: 8e6})
        self.assertEqual(max(opened['contact_forces_kn']), 0.)
        closed = solve_layered(self.cfg, self.cfg, [5e4, 0.], {12: 8e6})
        self.assertEqual(closed['total_anchor_force_kn'], 0.)
        self.assertEqual(closed['max_opening_mm'], 0.)
        self.assertGreater(max(closed['contact_forces_kn']), 0.)
        self.assertGreater(closed['max_contact_overlap_mm'], 0.)

    def test_contact_mesh_converges_with_distributed_stiffness(self):
        values = [solve_layered(dataclasses.replace(self.cfg, elements=n), dataclasses.replace(self.cfg, elements=n), [5e4, 0.], {}, 1e8)['layers'][1]['max_deflection_mm'] for n in (12, 24, 48)]
        self.assertLess(abs(values[2]-values[1]), abs(values[1]-values[0]))
        self.assertLess(abs(values[2]/values[1]-1), .01)

    def test_center_contact_matches_independent_closed_form(self):
        cfg = dataclasses.replace(self.cfg, elements=2)
        q, contact = 5e4, 1e8
        result = solve_layered(cfg, cfg, [q, 0.], {}, contact)
        EI = cfg.young_modulus_pa*cfg.width_m*cfg.thickness_m**3/12
        compliance = cfg.length_m**3/(48*EI)
        bare = 5*q*cfg.length_m**4/(384*EI)
        kc = contact*cfg.length_m/2
        expected_overlap = bare/(1+2*kc*compliance)
        self.assertAlmostEqual(result['max_contact_overlap_mm']/1000, expected_overlap, places=9)
        self.assertAlmostEqual(result['contact_forces_kn'][0], kc*expected_overlap/1000, places=6)

    def test_conservation_symmetry_and_zero_load(self):
        for loads in ([0., 0.], [0., 5e4], [5e4, 0.]):
            r = solve_layered(self.cfg, self.cfg, loads, {6: 4e6, 18: 4e6}, lower_supports={12: 2e6})
            for key in ('equilibrium_relative_error', 'residual_relative_error', 'energy_relative_error'):
                self.assertLess(r[key], 1e-7)
            np.testing.assert_allclose(r['opening_mm'], r['opening_mm'][::-1], atol=1e-8)
        self.assertEqual(solve_layered(self.cfg, self.cfg, [0., 0.], {})['max_opening_mm'], 0.)

    def test_weaker_tie_increases_opening_and_reduces_tie_force(self):
        strong = solve_layered(self.cfg, self.cfg, [0., 5e4], {12: 8e6})
        weak = solve_layered(self.cfg, self.cfg, [0., 5e4], {12: 2e6})
        self.assertGreater(weak['max_opening_mm'], strong['max_opening_mm'])
        self.assertLess(weak['total_anchor_force_kn'], strong['total_anchor_force_kn'])

    def test_invalid_inputs_and_iteration_failure(self):
        for kw in ({'anchors': {-1: 1.}}, {'anchors': {24: 1.}}, {'anchors': {12: float('nan')}}, {'anchors': {}, 'contact_n_per_m2': -1.}, {'anchors': {}, 'loads_n_per_m': [True, 1.]}, {'anchors': {}, 'max_iterations': 0}):
            args = dict(upper=self.cfg, lower=self.cfg, loads_n_per_m=[0., 5e4], anchors={})
            args.update(kw)
            with self.assertRaises((ValueError, TypeError)):
                solve_layered(**args)
        with self.assertRaises(ValueError):
            solve_layered(self.cfg, dataclasses.replace(self.cfg, length_m=9.), [0., 5e4], {})
        with self.assertRaises(ValueError):
            solve_layered(self.cfg, self.cfg, [0., 5e4], {}, max_iterations=1)


if __name__ == '__main__':
    unittest.main()
