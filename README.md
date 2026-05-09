# PageIndex Chat UI

> ⚠️ **项目重构中 / Under Reconstruction**
>
> 本项目正处于重构阶段，架构、数据模型、交互方式都可能发生变化，
> 新的文档将在重构完成后补齐。
>
> 旧版 README 已保留为 [`README_old.md`](./README_old.md)，
> 仅作历史参考，其中描述的使用方式与当前代码可能不一致。

---

<p align="center">
  <a href="#-项目简介">简介</a> •
  <a href="#-核心特性">特性</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-api--模型说明">API/模型</a> •
  <a href="#-致谢">致谢</a>
</p>

---

## 📖 项目简介

**PageIndex Chat UI** 是一个基于[PageIndex](https://github.com/VectifyAI/PageIndex)的 **Agentic RAG** 文档问答系统。它无需向量数据库、无需 Embedding，完全依靠 LLM 在文档目录树上进行推理式导航。

重构后的版本采用支持两种对话模式：

* **单文档对话（Single）**：针对单篇 PDF 的深度问答，系统提示词内联完整目录树，Agent 规划更充分
* **知识库问答（KB）**：用户自由选择多份文档参与对话，Agent 通过渐进式披露（元数据 → 目录 → 章节内容）自动跨文档检索与综合



### 💡 核心理念：相似度 ≠ 相关性

传统 RAG 依赖向量 Embedding——语义相似的片段未必是回答问题所需的上下文。PageIndex 采用不同的路线：

* **建索引时**：将 PDF 解析为层级化的树状结构（类似书的目录），并为每个节点生成摘要
* **问答时**：让 Agent 基于树结构逐层定位答案所在的章节/段落

*没有任何 Embedding、没有向量数据库。*

---

## UI 界面
![ui](image/readme/UI.png)
![kb_chat](image/readme/kb_chat.png)

---

## ✨ 核心特性

### 多工具 Agent

问答引擎是一个具备完整推理链路的 Agent。面对用户提问，它自主规划搜索、阅读、总结路径，在 8 种工具中选择调用：

| 工具 | 说明 |
| :--: | :--: |
| `tree_search` | 在文档树结构上推理搜索，定位相关章节 |
| `read_node` | 读取指定节点的完整文本 |
| `keyword_search` | 全文精确关键词/短语匹配 |
| `view_pages` | 将页面图像送入 VLM 分析图表/公式/表格 |
| `summarize_nodes` | 对节点内容生成 LLM 摘要，压缩信息 |
| `list_documents` | 列出可访问文档的元数据（KB 模式） |
| `read_document_toc` | 读取文档的目录结构（KB 模式） |
| `cross_search` | 跨多篇文档并行搜索（KB 模式） |

Agent 在每轮对话中执行 **分解 → 推理搜索 → 回答生成 → 自我评估** 的完整回路：

* 复杂问题自动拆解为子问题，分别检索后综合
* 答案生成后自动评估质量，不达标则补充检索并重写
* 索引完成后自动分析文档，产出摘要、关键发现和推荐问题

### 文本 / 视觉双模式

| 模式 | 说明 |
| :--: | :--: |
| **文本模式** | 以节点文本为上下文，调用文本模型 |
| **视觉模式** | 以页面图像为上下文，调用多模态模型分析图表/公式/表格 |

### 自定义技能（Skills）

通过 Markdown 文件定义 Agent 的专项技能，无需改代码即可扩展 Agent 行为。每个 skill 声明激活条件、工具调用流程、输出格式和防幻觉守则：

| 技能 | 默认 | 作用 |
| :--: | :--: | :-- |
| **文档速读** `key_info_extraction` | ✅ | 论文/报告/手册/合同/财报的通用速读卡，按文档类型自适应输出 |
| **结构化对比** `structured_comparison` | ✅ | 章节/方法/条款/版本/产品多维度对比 |
| **表格抽取** `table_extraction` | ✅ | 文本/视觉双模，精确还原为 Markdown 表格 |

### 界面

* 三页布局：知识库管理 / 单文档对话 / 知识库问答
* 节点溯源：回答附带引用的节点 ID 和页码，点击跳转 PDF 对应位置
* 单文档对话与知识库问答均包含对话记忆

---

## 🚀 快速开始

### 环境要求

* Python >= 3.11
* OpenAI API Key（或任何兼容 OpenAI API 格式的服务）

### 安装

```bash
# 使用 uv（推荐）
uv sync

# 或 pip
pip install -r requirements.txt
```

### 启动

```bash
python app.py          # 或 uv run python app.py / ./start.sh
```

服务默认运行在 **http://localhost:5001**。

### ⚙️ 首次配置

打开设置面板，填入文本模型和视觉模型的名称、API Key、Base URL。配置保存到 `config.json`。

---

## 🏗️ 技术架构

### 📁 项目目录

```
PageIndex_Chat_UI/
├── app.py                  # Flask 应用入口
├── config.py               # 配置管理
├── config.json             # 运行时配置（含 API Key）
├── pyproject.toml          # 项目元数据 & 依赖
├── start.sh                # 启动脚本
│
├── pageindex/              # PageIndex 索引引擎
│   ├── page_index.py       #   树结构构建：目录检测→页码对齐→递归分裂
│   ├── utils.py            #   PDF 解析、LLM 调用封装
│   └── config.yaml         #   索引参数
│
├── services/               # 业务逻辑层
│   ├── agent.py            #   Agent：分解 / ReAct / 反思 / 分析
│   ├── rag_service.py      #   RAG 服务 + LLM/VLM 调用
│   ├── indexing_service.py #   索引调度
│   ├── skill_manager.py    #   技能管理
│   └── tools/              #   8 个 Agent 工具
│       ├── base.py
│       ├── tree_search.py  ├── node_reader.py  ├── keyword_search.py
│       ├── page_viewer.py  ├── summarizer.py
│       ├── list_documents.py  ├── read_toc.py  ├── cross_search.py
│
├── skills/                 # 自定义技能（Markdown）
│   ├── key_info_extraction.md
│   ├── structured_comparison.md
│   └── table_extraction.md
│
├── models/                 # 数据模型
│   ├── document.py         #   Document / DocumentStore
│   └── session.py          #   ChatSession / Message / SessionStore
│
├── routes/
│   ├── api.py              #   REST API
│   └── socket_handlers.py  #   Socket.IO 流式聊天
│
├── templates/index.html    # 前端 SPA
├── static/
│   ├── css/app.css
│   └── js/app.js
│
├── uploads/                # PDF 上传（gitignored）
├── results/                # 索引结果与会话数据（gitignored）
│   ├── _index/             #   会话索引（per-mode）
│   ├── _sessions/          #   会话数据（per-mode 隔离）
│   └── documents/          #   文档索引结果
└── image/                  # README 插图
```

### 🔑 架构要点

**Session 与 Document 解耦**

重构的核心变化：Session 不再绑定 Document 的生命周期。每个 Session 独立存储，可绑定一个或多个文档：

* `single` 模式会话按文档分组，删除文档时自动清理关联会话
* `kb` 模式会话扁平存储，独立于单一文档

两种模式的会话互不干扰，存储和索引均按模式隔离。

**KB 模式的渐进式披露**

KB 模式下系统提示词不内联完整目录树（token 成本过高），而是让 Agent 自行决策探索深度：`list_documents`（元数据）→ `read_document_toc`（目录）→ `tree_search`（具体内容）。

---

## 🔌 API / 模型说明

本项目通过 **OpenAI Python SDK**（`openai` >= 1.0）调用 LLM，兼容任何 Chat Completions API 端点。

| 用途 | 默认模型 | 说明 |
|------|----------|------|
| 索引构建 | `gpt-5-mini` | 目录检测、结构解析、摘要生成 |
| 文本问答 | `gpt-5-mini` | Agent 推理、工具调用、回答生成 |
| 视觉问答 | `gpt-5-mini` | 图表/公式/表格的视觉分析 |

本项目**不使用 Embedding 模型，不使用向量数据库**。

### ⚙️ 关键参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `MAX_REACT_STEPS` | 5 | ReAct 最大步数 |
| `MAX_RETRY` | 1 | 反思未通过的最大重试次数 |
| `REFLECT_ACCEPT_THRESHOLD` | 6 | 反思评分低于此触发重试（满分 10） |
| `max_page_num_each_node` | 10 | 单节点最大页数 |
| `max_token_num_each_node` | 20000 | 单节点最大 Token 数 |

---

## 📦 依赖

| 依赖 | 用途 |
|------|------|
| Flask + Flask-SocketIO | Web 框架 + 实时通信 |
| openai | LLM / VLM API |
| PyMuPDF | PDF 渲染、文本提取 |
| PyPDF2 | PDF 文本提取 |
| tiktoken | Token 计数 |
| PyYAML | 配置解析 |

---

## 🙏 致谢

核心 PageIndex 索引算法参考自 [VectifyAI/PageIndex](https://github.com/VectifyAI/PageIndex)。

---

## 📄 License

MIT License
