"""Two simply supported EB strips, compression-only contact, tension-only ties.

Downward displacement is positive. gap = lower - upper; positive gap is opening.
Contact uses a finite penalty stiffness (elastic overlap is reported separately).
Ties are incremental, zero-preload axial connectors, not a full bolt/bond model.
All inputs are SI. The layers have independent rotations: no composite shear bond.
"""
import numpy as np

from .solver import BeamConfig, _integer, _number, solve_beam


def solve_layered(upper, lower, loads_n_per_m, anchors, contact_n_per_m2=1e9,
                  lower_supports=None, max_iterations=80):
    """Minimize the convex, piecewise quadratic total potential by damped Newton."""
    if not isinstance(upper, BeamConfig) or not isinstance(lower, BeamConfig):
        raise TypeError('Two BeamConfig instances are required')
    for layer in (upper, lower):
        solve_beam(layer, 0., {})  # shared physical input validation
    if (upper.length_m, upper.width_m, upper.elements, upper.boundary) != (
            lower.length_m, lower.width_m, lower.elements, lower.boundary):
        raise ValueError('Layers must share length, strip width, mesh and boundary')
    if upper.boundary != 'simply_supported' or not 2 <= upper.elements <= 96:
        raise ValueError('Use simply supported layers and 2..96 elements')
    if not isinstance(loads_n_per_m, (list, tuple)) or len(loads_n_per_m) != 2:
        raise ValueError('Two layer loads are required')
    loads = [_number(q, 'layer load') for q in loads_n_per_m]
    contact = _number(contact_n_per_m2, 'contact stiffness')
    iterations = _integer(max_iterations, 'max_iterations')
    n, length = upper.elements, upper.length_m
    size, le = 2 * (n + 1), length / n

    def connectors(values):
        if not isinstance(values, dict):
            raise TypeError('Connectors must be a node-to-stiffness dictionary')
        checked = {}
        for node, stiffness in values.items():
            node = _integer(node, 'connector node')
            if node >= n:
                raise ValueError('Connectors must use internal nodes')
            checked[node] = _number(stiffness, 'connector stiffness')
        return checked

    anchors = connectors(anchors)
    supports = connectors({} if lower_supports is None else lower_supports)
    K, F = np.zeros((2 * size, 2 * size)), np.zeros(2 * size)
    rigidities = []
    for layer_id, (layer, q) in enumerate(zip((upper, lower), loads)):
        ei = layer.young_modulus_pa * layer.width_m * layer.thickness_m**3 / 12
        rigidities.append(ei)
        ke = ei / le**3 * np.array([
            [12, 6*le, -12, 6*le], [6*le, 4*le**2, -6*le, 2*le**2],
            [-12, -6*le, 12, -6*le], [6*le, 2*le**2, -6*le, 4*le**2]])
        fe = q * le / 2 * np.array([1, le/6, 1, -le/6])
        for element in range(n):
            ix = layer_id * size + np.arange(2*element, 2*element+4)
            K[np.ix_(ix, ix)] += ke
            F[ix] += fe
    for node, k in supports.items():
        K[size+2*node, size+2*node] += k
    # B maps displacement to lower-minus-upper interface gap at internal nodes.
    B = np.zeros((n-1, 2*size))
    for row, node in enumerate(range(1, n)):
        B[row, 2*node], B[row, size+2*node] = -1., 1.
    kt = np.array([anchors.get(node, 0.) for node in range(1, n)])
    kc = np.full(n-1, contact * le)  # tributary length makes mesh refinement consistent
    free = np.setdiff1d(np.arange(2*size), [0, 2*n, size, size+2*n])
    if not np.isfinite(K).all() or not np.isfinite(F).all() or not np.isfinite(kc).all():
        raise ValueError('Nonfinite assembled system')

    def state(u):
        gap = B @ u
        ks = np.where(gap >= 0, kt, kc)
        force = ks * gap
        gradient = K @ u + B.T @ force - F
        hessian = K + B.T @ (ks[:, None] * B)
        energy = .5 * u @ K @ u + .5 * np.dot(force, gap) - F @ u
        return gap, force, gradient, hessian, energy

    u = np.zeros(2*size)
    scale = max(float(np.linalg.norm(F[free])), 1.)
    for iteration in range(iterations):
        gap, force, gradient, hessian, energy = state(u)
        if np.linalg.norm(gradient[free]) / scale < 1e-9:
            break
        direction = np.zeros_like(u)
        direction[free] = np.linalg.solve(hessian[np.ix_(free, free)], -gradient[free])
        alpha = 1.
        for _ in range(45):
            trial = u + alpha * direction
            if state(trial)[4] <= energy + 1e-4 * alpha * np.dot(gradient, direction):
                u = trial
                break
            alpha *= .5
        else:
            raise ValueError('Contact line search failed')
    else:
        raise ValueError('Contact iteration did not converge')
    gap, interface_force, gradient, _, _ = state(u)
    residual = float(np.linalg.norm(gradient[free]) / scale)
    reactions = [-float(gradient[i]) for i in (0, 2*n, size, size+2*n)]
    support_forces = {node: float(k*u[size+2*node]) for node, k in supports.items()}
    applied = sum(loads) * length
    balance = abs(sum(reactions) + sum(support_forces.values()) - applied) / max(applied, 1.)
    signed_gap = np.concatenate(([0.], gap, [0.]))
    opening = np.maximum(signed_gap, 0.) * 1000
    overlap = np.maximum(-signed_gap, 0.) * 1000
    t = np.linspace(0, 1, 9)
    shape = np.array([1-3*t*t+2*t**3, le*(t-2*t*t+t**3),
                      3*t*t-2*t**3, le*(-t*t+t**3)]).T
    curvature = np.array([(-6+12*t)/le**2, (-4+6*t)/le,
                          (6-12*t)/le**2, (-2+6*t)/le]).T
    layer_results = []
    for layer_id, layer in enumerate((upper, lower)):
        local_u = u[layer_id*size:(layer_id+1)*size]
        max_w = max(float(np.max(np.abs(shape @ local_u[2*e:2*e+4]))) for e in range(n))
        max_m = max(float(np.max(np.abs(rigidities[layer_id] * curvature @ local_u[2*e:2*e+4]))) for e in range(n))
        layer_results.append(dict(displacement_mm=(local_u[::2]*1000).tolist(),
                                  max_deflection_mm=max_w*1000,
                                  max_bending_stress_mpa=max_m*6/(layer.width_m*layer.thickness_m**2)/1e6))
    tie_forces = np.maximum(gap, 0.) * kt
    contact_forces = np.maximum(-gap, 0.) * kc
    work = float(F @ u)
    strain_energy = .5*float(u @ K @ u + np.dot(interface_force, gap))
    energy_error = abs(2*strain_energy-work) / max(abs(work), 1.)
    if not np.isfinite(u).all() or max(residual, balance, energy_error) > 1e-7:
        raise ValueError('Layered solution failed conservation checks')
    return dict(layers=layer_results, node_positions_m=np.linspace(0, length, n+1).tolist(),
                signed_gap_mm=(signed_gap*1000).tolist(), opening_mm=opening.tolist(),
                contact_overlap_mm=overlap.tolist(), max_opening_mm=float(max(opening)),
                max_contact_overlap_mm=float(max(overlap)),
                anchor_forces_kn={node: float(tie_forces[node-1]/1000) for node in anchors},
                total_anchor_force_kn=float(sum(tie_forces)/1000),
                contact_forces_kn=(contact_forces/1000).tolist(),
                lower_support_forces_kn={node: force/1000 for node, force in support_forces.items()},
                boundary_reactions_kn=[r/1000 for r in reactions], applied_load_kn=applied/1000,
                equilibrium_relative_error=balance, residual_relative_error=residual,
                strain_energy_j=strain_energy, energy_relative_error=energy_error,
                iterations=iteration, opening_sampling='mesh_nodes')
