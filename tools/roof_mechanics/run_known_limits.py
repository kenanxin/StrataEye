"""Run the fixed known-limit mechanics ablation in a fresh local directory."""

import argparse
from pathlib import Path

from .known_limits_study import run_study


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--in-domain-scenarios', type=int, default=500)
    parser.add_argument('--ood-scenarios', type=int, default=100)
    parser.add_argument('--steps', type=int, default=32)
    args = parser.parse_args()
    run_study(args.output_dir, args.in_domain_scenarios, args.ood_scenarios, args.steps)


if __name__ == '__main__':
    main()
