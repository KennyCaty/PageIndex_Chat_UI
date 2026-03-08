🤖 PageIndex Chat UI

> **基于树状结构推理的 Agentic RAG 文档问答系统**
> 无向量、无 Embedding —— 让 LLM 像人类一样阅读文档

<p align="center">
  <a href="#-项目简介">简介</a> •
  <a href="#-核心特性">特性</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-技术架构">架构</a> •
  <a href="#-api--模型说明">API/模型</a> •
  <a href="#-成本估算">成本</a> •
  <a href="#-致谢">致谢</a>
</p>

---

## 📖 项目简介

**PageIndex Chat UI** 是一个面向 PDF 文档的智能问答系统。它基于开源项目 PageIndex 的核心索引算法，并在其上搭建了完整的 **Agentic RAG**交互界面。

![WebUI示意图](image/WebUI.png)

### 💡 核心理念：相似度 ≠ 相关性

传统 RAG 系统依赖向量 Embedding 进行检索 —— 语义相似的片段未必是回答问题所需的上下文。PageIndex 采用完全不同的路线：
* **建索引时**：将 PDF 解析为层级化的树状结构（类似书的目录），并为每个节点生成摘要。
* **问答时**：让 LLM 基于树结构进行推理式导航，逐层定位答案所在的章节/段落。

*没有任何 Embedding、没有向量数据库，完全依靠 LLM 的推理能力完成检索。*


---

## ✨ 核心特性

### 🧠 Agent 系统（五大能力）
本项目的问答引擎不是简单的「检索 → 生成」管线，而是一个具备完整推理链路的 Agent：

| 能力 | 说明 |
| :--: | :--: |
| **ReAct 循环** | Think → Act → Observe 迭代推理，最多 5 轮 |
| **多工具调度** | 5 种内置工具，Agent 自主选择每一步使用哪个 |
| **问题分解** | 复杂问题自动拆解为子问题，分别检索后综合 |
| **自我反思** | 生成答案后自动评估质量，不达标则补充检索并重新作答 |
| **主动分析** | 文档索引完成后自动生成摘要、关键发现和推荐问题 |

### 🛠️ 内置工具
Agent 在每轮 ReAct 循环中可以调用以下工具：

| 工具名称 | 功能描述 |
| :--: | :--: |
| `tree_search` | 在文档树结构上进行推理搜索，定位相关章节 |
| `read_node` | 读取指定节点的完整文本内容 |
| `keyword_search`| 在全文中进行精确关键词/短语匹配 |
| `view_pages` | 查看页面图像（视觉模式下通过 VLM 分析图表/公式/表格） |
| `summarize_nodes`| 对节点内容生成 LLM 摘要，用于信息压缩 |

### 🌗 双模式 RAG

| 模式 | 说明 | 适用场景 |
| :--: | :--: | :--: |
| **文本模式** | 以节点文本为上下文，调用文本模型 | 文字为主的文档 |
| **视觉模式** | 以页面图像为上下文，调用多模态模型 | 图表、公式、表格丰富的文档 |

### 🧩 自定义技能（Skills）
通过 Markdown 文件定义 Agent 的专项技能，无需修改代码即可扩展 Agent 行为。内置 4 个示例技能：
* **公式解读**：解释数学公式的符号含义和推导逻辑
* **关键信息提取**：从论文中提取核心贡献、方法、实验结果
* **论文对比分析**：系统对比文档中不同方法/模型的异同
* **表格数据提取**：定位并提取表格数据，以 Markdown 表格输出

### 🌟 其他亮点
* **流式输出**：回答和推理过程实时流式展示
* **多轮对话记忆**：保留最近 5 轮对话历史作为上下文
* **答案溯源**：每个回答标注引用的节点 ID 和页码，可直接跳转查看
* **页面高亮**：在 PDF 页面图像上高亮显示对应文本块的来源节点
* **Web 界面在线配置**：模型、API Key、Base URL 均可在界面中动态修改

---

## 🚀 快速开始

### 环境要求
* Python >= 3.11
* OpenAI API Key（或任何兼容 OpenAI API 格式的服务）

### 安装

```bash
# 使用 pip
pip install -r requirements.txt

# 或使用 uv（推荐，速度更快）
uv sync
```

### 启动

```bash
# 方式一：直接运行
python app.py

# 方式二：使用 uv
uv run python app.py

# 方式三：使用启动脚本（Linux/macOS）
./start.sh
```

服务默认运行在 **http://localhost:5001**

### ⚙️首次配置

启动后打开浏览器访问 `http://localhost:5001`，点击界面左上角的设置图标，配置：

1. **文本模型**：填入模型名称、API Key 和 Base URL
2. **视觉模型**（可选）：如需使用视觉模式，填入多模态模型的配置

配置会保存到 `config.json`



## 🏗️技术架构

### 🗺️系统架构图

![架构图](image/architecture.png)

### 🔄Agent 工作流程

![工作流](image/workflow.png)

### 📁项目目录结构

```
PageIndex_Agent_UI/
├── app.py                  # Flask 应用初始化、路由注册
├── main.py                 # 主入口（读取 config 启动）
├── config.py               # 配置管理（单例 ConfigManager）
├── config.json             # 运行时配置（gitignored，含 API Key）
├── requirements.txt        # Python 依赖
├── pyproject.toml          # 项目元数据 & 依赖（uv 兼容）
├── start.sh                # 启动脚本
│
├── pageindex/              # PageIndex 核心索引引擎
│   ├── page_index.py       #   树结构构建：目录检测→页码对齐→递归分裂
│   ├── utils.py            #   PDF 解析、Token 计算、LLM 调用封装
│   └── config.yaml         #   索引参数默认值
│
├── services/               # 业务逻辑层
│   ├── agent.py            #   DocumentAgent：ReAct / 分解 / 反思 / 分析
│   ├── rag_service.py      #   RAG 服务 + PageIndex 封装（LLM/VLM 调用）
│   ├── indexing_service.py #   PDF 索引调度
│   ├── skill_manager.py    #   技能文件加载与管理
│   └── tools/              #   Agent 可调用的 5 个工具
│       ├── base.py         #     BaseTool + ToolRegistry
│       ├── tree_search.py  #     树搜索工具
│       ├── node_reader.py  #     节点阅读工具
│       ├── keyword_search.py#    关键词搜索工具
│       ├── page_viewer.py  #     页面查看工具（VLM）
│       └── summarizer.py   #     摘要工具
│
├── skills/                 # 自定义技能（Markdown 格式）
│   ├── formula_explainer.md
│   ├── key_info_extraction.md
│   ├── paper_comparison.md
│   └── table_extraction.md
│
├── models/                 # 数据模型
│   └── document.py         #   Document / Message / DocumentStore
│
├── routes/                 # 路由 & 通信
│   ├── api.py              #   REST API（文件上传、配置、技能管理）
│   └── socket_handlers.py  #   WebSocket 处理（聊天、索引进度）
│
├── templates/
│   └── index.html          # 前端页面（单文件 SPA）
├── static/
│   └── js/app.js           # 前端逻辑
│
├── uploads/                # PDF 上传存储（gitignored）
└── results/                # 索引结果存储（gitignored）
```


## 🔌API / 模型说明

### 调用方式

本项目通过 **OpenAI Python SDK**（`openai` >= 1.0）调用 LLM，同时支持同步和异步两种方式：

| 场景 | 调用方式 | 说明 |
|------|----------|------|
| 索引构建（PageIndex Core） | `openai.OpenAI` 同步调用 | `pageindex/utils.py` 中的 `ChatGPT_API` 系列函数 |
| 问答推理（Agent / RAG） | `openai.AsyncOpenAI` 异步调用 | `services/rag_service.py` 中的 `call_llm` / `call_vlm` |

所有调用均通过 `base_url` 参数配置 API 端点，因此**任何兼容 OpenAI Chat Completions API 格式的服务均可使用**（如第三方代理、本地部署的模型等）。

### 涉及的模型

本项目**不使用 Embedding 模型，不使用向量数据库**。所有能力仅依赖 Chat Completion API。

| 用途 | 配置位置 | 默认模型 | 说明 |
|------|----------|----------|------|
| **索引构建** | `pageindex/config.yaml` 或 Web UI 文本模型 | `gpt-4o-2024-11-20` | 用于目录检测、结构解析、页码对齐、摘要生成。索引质量对此模型的推理能力要求较高 |
| **问答 - 文本模式** | Web UI → 文本模型 | `gpt-4o-mini` | Agent 推理、树搜索、回答生成、自我反思。推荐使用性价比高的模型 |
| **问答 - 视觉模式** | Web UI → 视觉模型 | `gpt-4.1` | 需要多模态能力（接受图片输入），用于图表/公式/表格的视觉分析 |

> 以上默认模型仅为推荐配置，可在 Web UI 设置面板中自由更换为任何 OpenAI 兼容模型。
> 在测试阶段，文本模型和视觉模型均为'gpt-5-mini'

### ⚙️配置参数

#### 模型配置（`config.json` / Web UI）

| 参数 | 说明 |
|------|------|
| `models.text.name` | 文本模型名称（如 `gpt-4o-mini`） |
| `models.text.api_key` | 文本模型 API Key |
| `models.text.base_url` | 文本模型 API 端点（如 `https://api.openai.com/v1`） |
| `models.vision.name` | 视觉模型名称（如 `gpt-4.1`） |
| `models.vision.api_key` | 视觉模型 API Key |
| `models.vision.base_url` | 视觉模型 API 端点 |

#### 索引参数（`pageindex/config.yaml`）

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `model` | `gpt-4o-2024-11-20` | 索引构建使用的模型 |
| `toc_check_page_num` | `20` | 扫描前 N 页检测目录 |
| `max_page_num_each_node` | `10` | 单节点最大页数，超过则递归分裂 |
| `max_token_num_each_node` | `20000` | 单节点最大 Token 数，超过则递归分裂 |
| `if_add_node_id` | `yes` | 是否为节点分配 ID |
| `if_add_node_summary` | `yes` | 是否生成节点摘要 |
| `if_add_doc_description` | `no` | 是否生成全文档描述 |
| `if_add_node_text` | `no` | 是否在结构中保留节点原文 |

#### Agent 参数（`services/agent.py` 中的常量）

| 参数 | 值 | 说明 |
|------|-----|------|
| `MAX_REACT_STEPS` | `5` | 每个子问题的 ReAct 最大轮数 |
| `MAX_RETRY` | `1` | 反思不通过后的最大重试次数 |
| `REFLECT_ACCEPT_THRESHOLD` | `6` | 反思评分低于此值触发重试（满分 10） |


## 💰成本估算

由于本项目完全通过 LLM API 驱动，使用成本取决于所选模型的定价。以下基于 OpenAI 官方价格估算（2025 年），仅供参考。

> 实际上只要不使用类似`GPT5.2 Pro`这种高消费模型，本项目的api花销是完全可以接受的。

### 索引阶段（一次性，每篇文档）

索引过程涉及大量 LLM 调用：目录检测、结构解析、页码对齐与验证、节点摘要生成等。

| 文档规模 | 预计 LLM 调用次数 | 使用 gpt-4o-mini | 使用 gpt-4o | 使用gpt-5-mini |
|----------|-------------------|-----------------|-------------|-------------|
| 短文档（~10 页） | 30–60 次 | $0.01–0.04 | $0.20–0.60 | $0.03–0.10 |
| 论文（~20 页） | 50–100 次 | $0.02–0.08 | $0.40–1.20 | $0.05–0.20 |
| 长文档（~100 页） | 150–400 次 | $0.08–0.30 | $1.50–5.00 | $0.20–0.80 |

> **说明**：索引过程的调用次数与文档结构复杂度强相关。有清晰目录的文档调用次数较少；无目录文档需要从头构建结构，调用次数更多。

### 问答阶段（每次提问）

每次提问经历：问题分解（1 次）→ ReAct 循环（3–10 次）→ 回答生成（1 次）→ 反思（1 次），可能还有重试。

| 场景 | 预计 LLM 调用次数 | 使用 gpt-4o-mini | 使用 gpt-4o / gpt-4.1 | 使用gpt-5-mini |
|------|-------------------|-----------------|----------------------|-------------|
| 简单问题（单步检索） | 4–6 次 | $0.003–0.008 | $0.05–0.10 | $0.008–0.02 |
| 常规问题（多步推理） | 6–12 次 | $0.005–0.015 | $0.08–0.20 | $0.015–0.04 |
| 复杂问题（分解 + 重试） | 12–20 次 | $0.01–0.03 | $0.15–0.40 | $0.03–0.09 |
| 视觉模式（含图像输入） | 6–15 次 | — | $0.10–0.50 | $0.01–0.05 |

> **说明**：视觉模式因需传输页面图像（base64），Token 消耗显著高于纯文本模式。

### 典型使用成本示例

| 场景 | 模型配置 | 预计费用 |
|------|----------|---------|
| 索引一篇 20 页论文 + 问 10 个问题 | 索引用 gpt-4o-mini，问答用 gpt-4o-mini | ~$0.10–0.20 |
| 索引一篇 20 页论文 + 问 10 个问题 | 索引用 gpt-4o，问答用 gpt-4o-mini | ~$0.50–1.50 |
| 索引一篇 20 页论文 + 问 10 个问题	| 索引用 gpt-5-mini，问答用 gpt-5-mini | ~$0.20–0.60 |


## 📦项目依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| Flask | >= 3.0 | Web 框架 |
| Flask-SocketIO | >= 5.3 | WebSocket 实时通信 |
| Flask-CORS | >= 4.0 | 跨域支持 |
| openai | >= 1.0 | LLM / VLM API 调用 |
| tiktoken | >= 0.5 | Token 计数 |
| PyMuPDF (fitz) | >= 1.23 | PDF 页面渲染为图像、文本提取 |
| PyPDF2 | >= 3.0 | PDF 文本提取 |
| python-dotenv | >= 1.0 | 环境变量加载 |
| PyYAML | >= 6.0 | 配置文件解析 |


## 🙏致谢

本项目的核心 PageIndex 索引算法参考自 [VectifyAI/PageIndex](https://github.com/VectifyAI/PageIndex) 开源项目。


## 📄License

MIT License

---

<p align="center">
  Made with care for better document understanding
</p>
