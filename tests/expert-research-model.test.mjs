import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExpertResearchModel } from '../js/expert-research-model.mjs';

const schema = [
  { key: 'roof', label: '顶板离层速率', unit: 'mm/d' },
  { key: 'support', label: '支架阻力', unit: 'MPa' },
];

test('deviation ranking uses full numeric metric evidence and omits unavailable values', () => {
  const model = buildExpertResearchModel({
    current: {
      feature_schema: schema,
      metrics: { roof: { value: 3, standardized_value: -2.8 }, support: { value: .9 } },
      risk: { contribution: { roof: .1, support: .9 } },
    },
  });
  assert.deepEqual(model.contributions.map(item => [item.key, item.contribution]), [['roof', 2.8]]);
});

test('builds deterministic real-data research datasets', () => {
  const model = buildExpertResearchModel({
    current: {
      feature_schema: schema,
      risk: { level: 'red', score: 95, explanation: '离层与阻力共同异常', contribution: { roof: 0.7, support: 0.3 } },
      metrics: { roof: { value: 3 }, support: { value: 0.9 } },
      feature_evidence: [
        { key: 'roof', standardized_value: 2.8 },
        { key: 'support', standardized_value: 2.1 },
      ],
    },
    history: {
      feature_schema: schema,
      analytics: { sampleCount: 20000, classDistribution: { '低风险': 7000, '一般风险': 10000, '较大风险': 2000, '重大风险': 1000 } },
      points: [
        { timestamp: '2025/11/01 10:00', score: 45, metrics: { roof: { value: 1, standardized_value: 1 }, support: { value: 0.6, standardized_value: -1 } } },
        { timestamp: '2025/11/01 10:03', score: 95, metrics: { roof: { value: 3, standardized_value: 2.8 }, support: { value: 0.9, standardized_value: 2.1 } } },
      ],
    },
  });
  assert.equal(model.sampleCount, 20000);
  assert.equal(model.distribution[3].count, 1000);
  assert.equal(model.contributions[0].label, '顶板离层速率');
  assert.equal(model.contributions[0].contribution, 2.8);
  assert.equal(model.contributions[1].contribution, 2.1);
  assert.equal(model.heatmap.length, 2);
  assert.equal(model.violins[0].median, 1.9);
  assert.equal(model.trend.length, 2);
  assert.equal(model.riskLevel, 'red');
});

test('returns empty chart datasets when history is unavailable', () => {
  const model = buildExpertResearchModel({ current: {}, history: {} });
  assert.deepEqual(model.trend, []);
  assert.deepEqual(model.clusters, []);
  assert.equal(model.sampleCount, 0);
});
