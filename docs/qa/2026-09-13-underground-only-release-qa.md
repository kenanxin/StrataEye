# 井下单场景版本验收记录

日期：2026-09-13

## 发布范围

- 删除主界面的“地表 / 井下”切换入口，仅保留井下数字孪生。
- Mine V2 不再构建地表园区、地表地形或地表运行根节点。
- 删除地表场景实现文件和对应配置、拓扑、相机预设。
- 兼容历史链接：`view=surface` 不报错，统一回落到 `underground`。
- 保留井下巷道、1206 工作面、设备、顶板风险场、真实数据、三端闭环和六智能体流程。

## 自动化结果

- Node 全量测试：156 / 156 通过。
- 离线提交预检：通过。
- 老师 CSV：20,000 行、11 列。
- 数据 SHA-256：`86D4C2FB192721B2745F00076AEB00CF351C654ED936DDB098BFA6217E30AC6A`。

## Chrome 界面验收

验收地址：`/?scene=v2&view=surface&field=risk&portal=enterprise`

- 最终相机模式：`underground`。
- 地表切换按钮数量：0。
- 地表场景根节点数量：0。
- 页面脚本异常：0。
- 井下场景完成装载并可见。

自动化脚本：`tools/capture-underground-only-qa.cjs`

截图（本地生成，不纳入版本库）：`tools/.generated/underground-only/underground-only-chrome.png`

## 边界说明

- HDR、岩壁、金属、输送机、监控等井下共用资源继续保留。
- 历史设计与验收文档保留，作为项目迭代记录，不参与页面运行。
