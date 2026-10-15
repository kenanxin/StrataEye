export function buildSupportSimulationOption(item, selectedStep) {
  return {
    animation: false,
    color: ['#32c7d9', '#f2b84b'],
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true },
    legend: { top: 12, data: ['模拟支护反力', '支护点顶板位移'] },
    grid: { left: 55, right: 58, top: 55, bottom: 42, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    xAxis: { type: 'category', name: '加载步', nameLocation: 'middle', nameGap: 28, data: item.frames.map(f => f.step), boundaryGap: false },
    yAxis: [{ type: 'value', name: '反力 kN', min: 0 }, { type: 'value', name: '位移 mm', min: 0, splitLine: { show: false } }],
    series: [
      { id: 'support-force', name: '模拟支护反力', type: 'line', yAxisIndex: 0, data: item.frames.map(f => f.support_force_kn), showSymbol: false,
        lineStyle: { width: 2 }, markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: '#d8e8ee', type: 'dashed' }, data: [{ xAxis: selectedStep }] } },
      { id: 'support-displacement', name: '支护点顶板位移', type: 'line', yAxisIndex: 1, data: item.frames.map(f => f.support_displacement_mm), showSymbol: false, lineStyle: { width: 2 } },
    ],
  };
}
