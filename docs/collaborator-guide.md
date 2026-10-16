# 队友从这里开始

仓库：[kenanxin/StrataEye](https://github.com/kenanxin/StrataEye)。本次沿用原仓库ID，保留历史和协作权限。

## 获取最新代码

```powershell
git remote set-url origin https://github.com/kenanxin/StrataEye.git
git fetch origin
git switch main
git pull --ff-only origin main
```

若本地存在未提交改动，先自行保存；不要强制覆盖。首次获取可用 `git clone https://github.com/kenanxin/StrataEye.git`。`main` 为团队获取入口，`deploy/mine-v2-balanced` 为原部署分支。

部分历史三维素材使用Git LFS，完整本地演示前需确认Git LFS已安装，并在仓库内执行 `git lfs pull`。图形素材下载、npm依赖安装和源码拉取都依赖本机网络；页面上的DeepSeek生成另需后端配置。

## 已实现的重点与代码

| 内容 | 查看位置 | 范围 |
|---|---|---|
| 教师CSV与XGBoost预警 | `data/teacher_roof_monitoring.csv`、`tools/data_integration`、`server` | 原数据来源和标签形成仍待核实；不将模型置信度解释为灾害概率 |
| 六智能体研判及三端闭环 | `server/multi-agent-workflow-service.js`、`server/agent-collaboration-service.js`、`docs/api/multi-agent-workflow-api.md` | 模型、规则、检索和人员审批共同组成流程；保留驳回、资源不足、重新研判、方案版本及审核记忆 |
| 跨域RAG与DeepSeek | `server/knowledge-retrieval-service.js`、`data/knowledge/cross-domain-v1.json`、`tests/cross-domain-advice.test.mjs` | 小型资料集的字符二元组TF-IDF检索；保留真实引用与回退来源，尚未建立完整知识图谱 |
| 单支护点力学融入三维 | `js/scene/support-deformation.mjs`、`js/support-simulation-ui.mjs`、`data/support-deformation-v1.json` | 预计算梁—弹簧位移场、加载步和同荷载刚度对照；位移放大有标注，原数值不变 |
| 独立力学模拟与模型训练 | `tools/roof_mechanics`、`tests/roof_mechanics`、`research/README.md` | 四观测预测未来加载步假定极限状态，包含RF/XGBoost、限值消融、敏感性、有限采样、新工况复核 |

上表列的是当前工程成果。原报告中的大规模图谱、真实事故案例评测等内容，需要对应工件才能确认，不能据此表推断已经复现。模拟研究结果用于方法探索，现场标定和独立实证仍需开展。

## 在线查看与本地运行

在线登录：[演示系统](https://smart-mine-v2-balanced.vercel.app/login)。三端账号及密码由负责人私下提供，GitHub协作权限和网站账号权限分别管理。

```powershell
npm ci
$env:PORT='8092'
npm start
```

访问 `http://localhost:8092/login`。不复制生产密钥到仓库；DeepSeek现场生成需要在后端独立配置，本仓库不包含生产密钥或云端业务数据库。照片原件保存在上传浏览器，其他电脑通常只能读取元数据。

离线研究结果需额外下载Release附件；单独克隆源码不包含约394MB的历史实验工件。下载及校验方式见[研究导读](../research/README.md)。

## 本次核验口径

GitHub API确认 `Richard110206` 为write协作者，仓库为公开仓库。另通过新建临时克隆检查远端文件和研究工件；这些是仓库侧访问证据。协作者本人电脑的网络、Python环境、网站登录及实际操作仍由其本机确认。

本次完整核验范围和网络限制见[2026-10-17交付核验](qa/2026-10-17-collaborator-research-delivery.md)。
