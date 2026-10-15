# RAG与单支护点 Implementation Plan

> 按2026-10-14用户批准的精简范围，当前会话逐项实施与自审，不派发子智能体。

**Goal:** 在已有发布修复版加入来源可查的RAG与单支护点预计算仿真，不覆盖教师数据。

**Architecture:** 本地版本化资料用字符二元组TF-IDF检索，A2保存检索快照，A3只引用已知证据。Python原求解器导出三组预设工况，Node校验并提供只读工况和人工触发建议接口，页面下方研究区与原三维中的独立标记联动。

**Tech Stack:** Node内置模块、原Python/numpy求解器、现有Three.js/ECharts，不增运行依赖。

## 约束

- 基线0e3c9d5，复用干净工作树；保留旧研究存档和已交接包。
- 模拟反力以kN显示，节点位移以mm显示；加载步无现场时间意义。
- 预计算、模拟来源、无现场校准始终可见；不替换教师模型或实测阻力，不渲染物理未支持的垮落。
- 六智能体现有三端权限和持久化保持不变；模拟解释暂为研究建议，不能伪装成已保存的教师事件审批。
- 材料为公开来源的简短转述和明确标记的项目说明；无真实历史案例时如实说明。
- 保持来源ID白名单、旧数值内容校验、规则回退、人工审批；API测试不调用真实付费接口。
- 不发布云端、不变更数据库、不录制最终演示。

## Task 1：检索与引用

Files: 新建`data/knowledge/cross-domain-v1.json`、`server/knowledge-retrieval-service.js`、`tests/knowledge-retrieval-service.test.mjs`；修改`server/agent-collaboration-service.js`、`server/expert-advice-service.js`与`js/multi-agent-workflow-ui.mjs`。

接口`createKnowledgeRetrievalService({catalog}).retrieve({query,limit=4})`返回`{method,catalog_version,status,query,chunks}`，每条含id/title/domain/text/source_url/locator/content_sha256/score。方法为字符二元组TF-IDF余弦，不称语义向量。

- [ ] 先写空检索、确定性、资料域、来源哈希与未知引用拒绝测试，执行确认缺少模块时失败。
- [ ] 实现版本化本地检索与A2快照，A3仅发送选中的安全片段；候选建议另外返回实际引用ID。
- [ ] 执行`node --test tests/knowledge-retrieval-service.test.mjs tests/expert-advice-service.test.mjs tests/agent-collaboration-service.test.mjs tests/multi-agent-ui.test.mjs`并检查旧流程无回归。

## Task 2：单支护点工况

Files: 新建`tools/export-support-simulation.py`、`data/support-simulation-v1.json`、`server/support-simulation-service.js`、`tests/support-simulation.test.mjs`。

接口`getCase(id,step)`仅接受目录内case ID和整数加载步，返回服务端保存帧。`explain({caseId,step})`用这些帧构造模拟证据并检索，不接受客户端数值、风险或任意提示词。使用原求解器路径显式参数，保存源码SHA-256与参数。

- [ ] 测试固定工况、非法ID/步数、力平衡、F=k*w、量纲、原数据不变及无配置回退。
- [ ] 用原求解器验证后导出载荷相同、刚度不同的三组工况；部署读取工件，无在线Python依赖。
- [ ] 在已有认证保护下增加GET工况、POST研究解释；POST限定企业/专家/管理员，返回人工待审和不写业务事件标记。

## Task 3：页面与三维联动

Files: 新建`js/support-simulation-ui.mjs`、`css/support-simulation.css`；修改`index.html`、`js/main.js`、`js/charts.js`、`js/scene.js`。

保持现有工业色彩：底色#10191e，面板#152229，文字#e8f1f5，模拟强调#32c7d9，对照#f2b84b。沿用当前中文字体和等宽数值。新增区域位于页面下方，宽屏控制/曲线/引用分栏，窄屏单列；特征为“一个支护点+一条有出处的解释链”，不改首屏布局。

- [ ] 建立工况、加载步、模拟反力/位移、双轴曲线和RAG证据卡；实际引用与仅检索到分开。
- [ ] Three.js只加单独包围标记和模拟标签，不变形原设备、不改变教师标签。仅点击定位时调整镜头，退出模拟时移除标记。
- [ ] ECharts复用初始化、主题和ResizeObserver，沿加载步绘图，更新数据不重复init，卸载dispose；使用richText提示。
- [ ] 测试过期请求、工况切换清空旧建议、错误/无资料显示、HTML逃逸及销毁清理。
- [ ] 启动本地Chrome检查数值、控件、图表、引用和三维标记。保存可追溯QA，不宣称云端已更新。

## 自审与后续

检查来源、引用、物理单位、风险分支隔离和旧流程回归。模拟建议接入三端持久化需另设明确来源契约，本轮不借用教师记录ID制造已完成闭环。完成后告知实际可用入口与仍缺材料。
