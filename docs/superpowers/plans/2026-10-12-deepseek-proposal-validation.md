# DeepSeek Proposal Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复正常定性建议被数量正则误拒，并提供不含原文的校验原因，以完成真实云建议验收。

**Architecture:** 原建议适配器内部提取小型数量检查和结构化校验，API 保持兼容。精确屏蔽已复现非数量词后沿用原严格正则；无新依赖、无外部自动重试。

**Tech Stack:** CommonJS Node 服务、node:test。

## Global Constraints

- 工作目录 `D:/矿业/worktrees/teacher-release-deepseek`，基线 `caa77e547cdda0425d839158dfaf01e67c2147c3`，不合并离线力学提交。
- 仅修改 `server/expert-advice-service.js`、`tests/expert-advice-service.test.mjs`；工作流建议路径之外保持原行为。
- 仅允许屏蔽 `进一步|一致|统一|一旦|一般风险`，返回原文本；其他数量检测沿用现有 `NUMERIC_PROPOSAL`。
- 无论建议内容，权威 `risk` 使用原 `safe.risk`；已知引用、人工审批、安全边界保持。
- `validation_errors` 每项仅固定 code/field 与可选非负整数 index，最多12项，无任何提供方内容或密钥。
- 无新增数据库、依赖、云项目或自动外部重试；本地 tests 使用注入 provider。
- Git 写入禁用自动维护，不重置/强推/修复历史对象；仅暂存自己的两个源码文件。

## Task 1: Qualitative Words, Diagnostics, and Contract Tests

**Files:** Modify `server/expert-advice-service.js`; Test `tests/expert-advice-service.test.mjs`。

**Interfaces:** 消费原 `generateWorkflowAdvice(input)`；成功对象兼容，失败对象在既有 fallback 字段基础上增加可选 `validation_errors`。

- [ ] 先加入服务级注入测试：分别在 summary 与 recommendation 使用五个词例，断言 source=deepseek、原文本保持、risk保持、已知引用保持；改动前应因 local-rule 失败。最小测试结构如下，复用现有 workflowInput 和注入模式：

```js
const parsed = {summary:'进一步复核证据的一致性', recommendations:['统一安排复测'], evidence_ids:[workflowInput.feature_evidence[0].id]};
const service = createExpertAdviceService({apiKey:'test-key', fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(parsed)}}]})})});
const advice = await service.generateWorkflowAdvice(workflowInput);
assert.equal(advice.source,'deepseek');
assert.equal(advice.summary,parsed.summary);
assert.deepEqual(advice.recommendations,parsed.recommendations);
```

- [ ] 测试明确保留拒绝：`进一步补强三百MPa`、`统一在三十分钟内处置`、`一旦超过５MPa`、`一般风险每天一次`、`一致率达到99%`、`复核至少十处`、`复核 one support`。全部返回规则回退。覆盖七条建议、空/超长/错误类型、未知证据、失效JSON以及隐私；不改变既有测试含义。
- [ ] 提取 `hasNumericProposal(text)`，实现检测副本精确屏蔽后原正则检测；不得截断、删改返回提案。提取校验结果数组，code 使用 summary_invalid/summary_numeric_content/recommendations_invalid/recommendation_invalid/recommendation_numeric_content/evidence_ids_invalid/unknown_evidence。field 对应 summary/recommendations/evidence_ids；建议级错误可含 index。
- [ ] 在 invalid_provider_advice 分支仅附固定诊断枚举，最多12项；其他 fallback_reason 不变。成功生成没有 fallback_reason。提示写明长度、1–6条建议、定性数值禁令与有效JSON例子，例子引用本次已知 ID，不编造 ID。
- [ ] 执行 focused tests 记录 RED/GREEN，再执行完整 Node suite 一次。Node 路径 `C:/Users/欣/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`，完整命令为 `node --test tests/*.test.mjs`（通过 PowerShell 显式文件数组，避免 Windows glob 差异）。不得联网、安装依赖或写生产。
- [ ] 自审并仅提交上述两个源码文件；报告记录实际命令、数量、输出、失败原因和未证明的云行为。独立任务复审通过前不得发布。
