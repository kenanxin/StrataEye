import { escapeKnowledgeHtml as escape, renderKnowledgeEvidence } from './knowledge-evidence.mjs';
import { requestAdvice, adviceSourceLabel, adviceNotice } from './advice-presentation.mjs';

export function renderLayeredProfile(frame) {
  const peak = Math.max(...frame.layers.flatMap(l => l.displacement_mm.map(Math.abs)), 1);
  const scale = 48 / peak, n = frame.node_positions_m.length;
  const x = i => 40 + 640*i/(n-1);
  const y = (layer, i) => 55 + layer*100 + frame.layers[layer].displacement_mm[i]*scale;
  const curves = frame.layers.map((layer, k) => `<polyline fill="none" stroke="${k ? '#f2b84b' : '#54cfdf'}" stroke-width="3" points="${layer.displacement_mm.map((_, i) => `${x(i)},${y(k, i)}`).join(' ')}"/>`).join('');
  const ties = Object.keys(frame.anchor_forces_kn).map(Number).map(i => `<line x1="${x(i)}" x2="${x(i)}" y1="${y(0, i)}" y2="${y(1, i)}" stroke="#b8c7d1" stroke-width="2" stroke-dasharray="5 4"/>`).join('');
  return `<svg viewBox="0 0 720 250" role="img" aria-label="上层和下层顶板挠曲及锚固连接示意"><text x="40" y="24" fill="#54cfdf">上层顶板</text><text x="40" y="143" fill="#f2b84b">下层顶板</text>${ties}${curves}<text x="40" y="239" fill="#a7b7c0" font-size="12">挠度显示倍率 ×${scale.toFixed(1)}；层间距为示意，离层量见计算值</text></svg>`;
}

export function setupLayeredRoof({ authFetch, role }) {
  const el = id => document.getElementById(id);
  if (!el('layeredRoofLab')) return { destroy() {} };
  let data, destroyed = false, revision = 0, pending = false;
  const canExplain = ['enterprise', 'expert', 'super_admin'].includes(role);
  const listeners = [];
  const listen = (id, type, fn) => { el(id).addEventListener(type, fn); listeners.push(() => el(id)?.removeEventListener(type, fn)); };
  const selected = () => {
    const item = data?.cases.find(c => c.id === el('layeredCase').value);
    return item && { item, frame: item.frames[Number(el('layeredStep').value)] };
  };
  function render() {
    const s = selected(); if (!s?.frame) return;
    revision++;
    const f = s.frame, reference = data.cases.find(c => c.id === 'reference').frames[f.step];
    el('layeredStepLabel').textContent = `${f.step} / 20`;
    el('layeredOpening').textContent = f.max_opening_mm.toFixed(3);
    el('layeredForce').textContent = f.total_anchor_force_kn.toFixed(2);
    el('layeredParameters').textContent = `上层载荷 ${f.upper_load_kn_per_m.toFixed(2)} kN/m，下层 ${f.lower_load_kn_per_m.toFixed(2)} kN/m；连接刚度 ${s.item.anchor_stiffness_mn_per_m} MN/m。`;
    el('layeredProfile').innerHTML = renderLayeredProfile(f);
    el('layeredComparison').textContent = `同加载步参考：层间张开 ${reference.max_opening_mm.toFixed(3)} mm，锚固总拉力 ${reference.total_anchor_force_kn.toFixed(2)} kN。当前下层挠度 ${f.layers[1].max_deflection_mm.toFixed(3)} mm，罚接触弹性重叠 ${f.max_contact_overlap_mm.toFixed(4)} mm。载荷增加及上层受载工况的载荷与参考不同。`;
    el('layeredTable').innerHTML = `<table><caption>同加载步的已知工况对照</caption><thead><tr><th scope="col">工况</th><th scope="col">总载荷 kN</th><th scope="col">张开 mm</th><th scope="col">锚固拉力 kN</th></tr></thead><tbody>${data.cases.map(c => { const v = c.frames[f.step]; return `<tr${c.id === s.item.id ? ' aria-current="true"' : ''}><th scope="row">${escape(c.label)}</th><td>${v.applied_load_kn.toFixed(1)}</td><td>${v.max_opening_mm.toFixed(3)}</td><td>${v.total_anchor_force_kn.toFixed(2)}</td></tr>`; }).join('')}</tbody></table>`;
    el('layeredAdvice').innerHTML = ''; el('layeredKnowledge').innerHTML = '';
    el('layeredStatus').textContent = canExplain ? '可检索资料并解释当前预设工况。' : '可查看工况及计算结果。';
  }
  listen('layeredCase', 'change', render); listen('layeredStep', 'input', render);
  listen('layeredExplain', 'click', async () => {
    const s = selected(); if (!s || pending || !canExplain) return;
    pending = true; el('layeredExplain').disabled = true;
    const requestRevision = revision;
    el('layeredStatus').textContent = '正在检索资料并生成分层顶板解释…';
    try {
      const result = await requestAdvice(authFetch, '/api/roof-risk/layered-roof/explain', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ case_id: s.item.id, step: s.frame.step }),
      });
      if (destroyed || revision !== requestRevision) return;
      el('layeredStatus').textContent = `${adviceSourceLabel(result.advice)} · ${adviceNotice(result.advice)} · 预设工况解释，待人工复核`;
      el('layeredAdvice').innerHTML = `<div class="support-lab-proposal"><p>${escape(result.advice.summary)}</p><ul>${result.advice.recommendations.map(r => `<li>${escape(r)}</li>`).join('')}</ul></div>`;
      el('layeredKnowledge').innerHTML = renderKnowledgeEvidence(result.retrieval, result.advice.evidence_ids);
    } catch (error) {
      if (!destroyed && revision === requestRevision) el('layeredStatus').textContent = `解释暂不可用：${error.message}`;
    } finally { pending = false; if (!destroyed) el('layeredExplain').disabled = !canExplain || !data; }
  });
  const ready = (async () => {
    try {
      const response = await authFetch('/api/roof-risk/layered-roof', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.version !== 'layered-roof-v1-20261019' || payload.cases?.length !== 4) throw new Error('工况版本不匹配');
      if (destroyed) return;
      data = payload;
      el('layeredCase').innerHTML = data.cases.map(c => `<option value="${escape(c.id)}">${escape(c.label)}</option>`).join('');
      el('layeredCase').value = 'reference';
      el('layeredCase').disabled = false; el('layeredStep').disabled = false;
      el('layeredExplain').disabled = !canExplain;
      el('layeredSource').textContent = `${data.version} · ${data.scope}`;
      render();
    } catch (error) { if (!destroyed) el('layeredStatus').textContent = `分层顶板工况加载失败：${error.message}`; }
  })();
  return { ready, destroy() { destroyed = true; revision++; listeners.forEach(fn => fn()); } };
}
