# Agent 逆向工程与架构洞察方法 Spec

Status: Draft
Owner: Ziye
Created: 2026-07-27
Source context: 陈天老师《AI 编程实战训练营》第六周 Agent 课程、本地课程仓库、课堂截图、OpenCode introspection 工程

## 1. 目标

把陈天老师在课程里分析 Claude Code、OpenAI Codex、OpenCode 的做法整理成一套可复用方法：

- 从哪里找到目标仓库和源码。
- 用什么提示词驱动 coding agent 做源码探索。
- 怎样找出 system prompt、tool prompt、agent prompt、用户/项目指令注入、上下文压缩、工具注册与调用链路。
- 怎样把分析结果沉淀到 `agent-architecture-atlas`，并用图示解释架构。
- 对闭源工具和开源工具分别采用什么证据标准。

本 spec 面向后续复刻同类研究：看一个复杂 Agent 产品时，不只看功能表面，而是还原它的 prompt assembly、agent loop、tool runtime、provider abstraction、permission/sandbox/hooks/logging 等底层机制。

## 2. 已确认来源

| 对象 | 来源 | 说明 |
| --- | --- | --- |
| 课程仓库 | `https://github.com/tyrchen/geektime-bootcamp-ai` | 本地位于 `vendors/geektime-bootcamp-ai`，是训练营课程源码与材料仓库。 |
| Codex 源码 | `https://github.com/openai/codex` | 课堂截图中路径为 `~/projects/opensource/rust/codex`，分析目标是开源 Codex CLI。 |
| OpenCode 源码 | `https://github.com/opencode-ai/opencode` | 课堂截图中路径为 `~/projects/opensource/typescript/opencode:dev`，右侧显示 OpenCode 1.1.1。 |
| OpenCode runtime introspection | `vendors/geektime-bootcamp-ai/w6/opencode-introspection` | 本地课程仓库内的日志插件与可视化器，用于捕获真实 LLM 输入输出。 |
| Claude Code 材料 | `vendors/geektime-bootcamp-ai/site/src/pages/materials/claude-code-architecture.mdx` | 课程站点里记录 Claude Code 2.0.36 的 AST 逆向分析。 |
| Claude Code prompts | `vendors/geektime-bootcamp-ai/site/src/pages/materials/claude-code-system-prompts.mdx` | 课程站点里记录 Claude Code system prompts 的提取和分类。 |
| Codex 课程材料 | `vendors/geektime-bootcamp-ai/specs/w4/codex-arch-by-claude.md` 等 | 早期对 Codex 架构、event loop、tool call、apply_patch 的分析文档。 |

注意：用户口述里的 "OpenEcho Labs" 与截图、本地工程均指向 OpenCode。后续文档中统一写作 "OpenCode / OpenEcho Labs 线索"，但源码定位以 `opencode-ai/opencode` 和本地 `opencode-introspection` 为准。

## 3. 证据分级

逆向分析需要区分证据来源，避免把推测写成事实。

| 等级 | 证据 | 可写成 |
| --- | --- | --- |
| A | 开源仓库源码、配置、测试、提交历史 | "源码中定义/调用/装配..." |
| B | 运行时捕获的 LLM input/output 日志 | "在该版本运行时观测到..." |
| C | 课程材料、截图、讲解文本 | "课程中展示/老师采用..." |
| D | 根据架构模式推断 | "推测/可能/需要验证..." |

闭源 Claude Code 的内部实现应主要使用 B/C/D 表述。开源 Codex 与 OpenCode 可以使用 A/B 表述。

## 4. 陈天老师的核心流程

整体流程不是先写结论，而是让 agent 先读源码、抓运行时证据，再逼它输出结构化文档。

```text
Target product/repo
        |
        v
Repository discovery
        |
        v
Static source archaeology -----> Runtime introspection
        |                         |
        v                         v
Prompt catalog              Actual LLM input/output logs
        |                         |
        +-----------+-------------+
                    v
Architecture reconstruction
                    |
                    v
agent-architecture-atlas/*.md + ascii diagrams + source references
```

## 5. 仓库与源码从哪儿找

### 5.1 课程主线

先从课程仓库定位第六周材料：

```bash
gh repo view tyrchen/geektime-bootcamp-ai
git clone https://github.com/tyrchen/geektime-bootcamp-ai
find w6 -maxdepth 3 -type f
find specs/w4 specs/w6 -maxdepth 2 -type f
```

本地可直接看：

- `vendors/geektime-bootcamp-ai/w6/opencode-introspection`
- `vendors/geektime-bootcamp-ai/w6/simple-agent`
- `vendors/geektime-bootcamp-ai/w6/codereview-agent`
- `vendors/geektime-bootcamp-ai/specs/w4/codex-*.md`
- `vendors/geektime-bootcamp-ai/specs/w6/0001-simple-agent-design.md`
- `vendors/geektime-bootcamp-ai/specs/w6/0003-codereview-agent-design.md`

### 5.2 Codex

Codex 的公开源码来自：

```bash
gh repo view openai/codex
git clone https://github.com/openai/codex ~/projects/opensource/rust/codex
```

课堂截图里 agent 重点读取过这些文件：

- `codex-rs/core/prompt.md`
- `codex-rs/core/review_prompt.md`
- `codex-rs/core/templates/compact/prompt.md`
- `codex-rs/core/src/tools/spec.rs`
- `codex-rs/apply-patch/apply_patch_tool_instructions.md`
- `codex-rs/core/src/user_instructions.rs`
- `codex-rs/core/src/client_common.rs`

还搜索过：

```text
PLAN_TOOL|update_plan
```

搜索范围在 `codex-rs/core/src/tools`。

### 5.3 OpenCode / OpenEcho Labs 线索

OpenCode 的公开源码来自：

```bash
gh repo view opencode-ai/opencode
git clone https://github.com/opencode-ai/opencode ~/projects/opensource/typescript/opencode
```

课程截图显示右侧任务为：

```text
Analyzing opencode prompt architecture
```

本地课程提供了配套 runtime introspection 工程：

```text
vendors/geektime-bootcamp-ai/w6/opencode-introspection/
  opencode.json
  plugins/log-conversation.ts
  logs/*.jsonl
  specs/visualizer-design.md
  visualizer/
```

其中 `opencode.json` 注册了日志插件：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "./plugins/log-conversation.ts"
  ]
}
```

`plugins/log-conversation.ts` 使用 OpenCode hook 捕获每轮 LLM 输入输出：

- `chat.message`: 用户新消息开始时创建 conversation id。
- `experimental.chat.system.transform`: 捕获 system prompt 数组。
- `experimental.chat.messages.transform`: 捕获完整 messages 数组。
- `event` / `message.updated`: 捕获 assistant 完成后的输出 parts、tokens、cost、finish reason。

日志写入：

```text
logs/{sessionID}_{conversationID}.jsonl
```

每行主要有两类：

- `turn_start`: system prompts + complete message history。
- `turn_complete`: assistant message + output parts + token/cost/timing metadata。

## 6. 课堂中出现的关键提示词

### 6.1 Codex 源码分析提示词

截图中能看到的原始中文提示词是：

```text
查看 codex 的实现，找出其所有 system prompt 和工具调用相关的 prompt，撰写文档介绍它，放在 agent-architecture-atlas 下。必要时画 ascii 图表帮助理解
```

这条 prompt 的目标非常明确：

- 目标 repo: `codex`
- 分析对象: system prompt + 工具调用相关 prompt
- 产物位置: `agent-architecture-atlas`
- 表达方式: Markdown 文档 + 必要的 ASCII 图

### 6.2 OpenCode prompt architecture 提示词

截图右侧任务标题是：

```text
Analyzing opencode prompt architecture
```

根据屏幕中生成的文档结构，实际产物至少覆盖：

```text
1. Overview
2. System Prompt Architecture
3. Provider-Specific Prompts
4. Tool Prompt Architecture
5. Agent System
6. Special Prompt Files
7. Prompt Assembly Flow
```

### 6.3 可复用中文模板

后续分析任意 Agent repo 时，可以直接用下面这个模板：

```text
请探索 <repo-name> 代码库，找出所有 system prompt、developer prompt、tool prompt、agent prompt、用户/项目指令注入、上下文压缩、工具注册与工具调用相关的实现。

请把结论写到 agent-architecture-atlas/<repo-name>-prompt-architecture.md，要求：
1. 列出关键源码路径和它们的职责。
2. 解释 prompt assembly flow：哪些信息按什么顺序进入模型上下文。
3. 解释 tool registry 和 tool call flow：工具如何注册、如何展示给模型、如何执行、结果如何回填。
4. 说明 agent modes / subagents / provider-specific prompts 的差异。
5. 必要时画 ASCII 架构图帮助理解。
6. 对无法从源码确认的部分明确标注为推测。
```

### 6.4 OpenCode runtime logging 模板

如果要复刻老师对 OpenCode 的运行时抓取方式，可以让 agent 做：

```text
请为 OpenCode 写一个 introspection plugin，捕获每轮 LLM 调用的 system prompt、messages、assistant output、tool invocations、tokens、cost、timing metadata，按 session/conversation 写入 logs/*.jsonl。

再写一个 visualizer，支持打开 JSONL 文件，并按 turn 展示 input、system prompts、messages、assistant output、tool calls 和 metadata。
```

## 7. 一二三步怎么做

### Step 1: 定位代码入口和架构边界

目标是先知道项目由哪些层组成，不急着总结 prompt。

对每个 repo 先看：

- `package.json` / `Cargo.toml` / workspace manifests。
- CLI entrypoint。
- core runtime / agent loop。
- model provider abstraction。
- tool registry / tool executor。
- config loader。
- instruction loader，例如 `AGENTS.md`、`CLAUDE.md`、用户配置。

建议搜索词：

```text
system
prompt
instructions
tool
agent
compact
review
plan
update_plan
apply_patch
AGENTS.md
CLAUDE.md
provider
sandbox
permission
hook
```

### Step 2: 静态源码考古

目标是找到 prompt 的定义位置、拼装顺序和工具描述来源。

对 Codex 这类开源项目，重点追踪：

- base instructions 在哪里定义。
- developer instructions / user input / tool results 如何进入 conversation。
- `AGENTS.md` 或 skill instructions 如何加载。
- tool descriptions 和 JSON schema 如何注入模型。
- special modes 的 prompt，例如 review、compact、plan。
- apply patch、shell、update_plan 等工具的提示词和执行规则。

Codex 课堂截图中的重建结果可以概括为：

```text
System Prompt + User Input + Tool Results
        |
        v
Conversation Manager
        |
        v
Prompt Builder
        |
        +-- base_instructions
        +-- developer_instructions
        +-- user_input
        +-- AGENTS.md
        +-- Skill Instructions
        |
        v
Tool Registry
        |
        +-- shell
        +-- apply_patch
        +-- update_plan
        +-- MCP tools
```

### Step 3: 运行时抓取真实上下文

静态源码只能告诉你 "可能怎么拼"，运行时日志才能告诉你 "实际发给模型的是什么"。

OpenCode 课程工程采用 hook 插件抓取：

```text
User message
    |
    v
chat.message
    |
    v
new conversation id
    |
    v
experimental.chat.system.transform
    |
    v
capture system[]
    |
    v
experimental.chat.messages.transform
    |
    v
capture messages[]
    |
    v
LLM call + tool loop
    |
    v
message.updated
    |
    v
capture assistant output parts
    |
    v
logs/*.jsonl
```

这一步特别适合分析：

- 实际 system prompt 是否与源码一致。
- 工具调用前后 messages 如何增长。
- tool invocation part 的结构。
- tokens、cost、finish reason 是否能解释 agent 行为。
- subagent / background task 是否生成新的 message stream。

### Step 4: 重建架构模型

把源码证据和运行时证据合并成架构图。课堂中展示的 Agent SDK 图可以抽象成：

```text
User Application
        |
        v
SDK Interface Layer
        |
        v
Agent Loop
        |
        +-------------------+
        | Session Layer     |
        | - context         |
        | - conversation    |
        +-------------------+
        |
        +-------------------+
        | Tool Layer        |
        | - built-in tools  |
        | - tool execution  |
        | - external tools  |
        +-------------------+
        |
        +-------------------+
        | LLM Abstraction   |
        +-------------------+
        |
        +-- OpenAI
        +-- Claude
        +-- Qwen
        +-- Kimi
        +-- ...

Cross-cutting:
permission control / hooks / logs / sandbox
```

### Step 5: 写入 `agent-architecture-atlas`

老师的产物通常不是一个长文档，而是拆成多个学习文件。OpenCode 截图中出现的文件结构包括：

```text
agent-architecture-atlas/
  00-overview.md
  01-directory-structure.md
  02-core-architecture.md
  03-core-modules.md
  04-data-flow-patterns.md
  opencode-prompt-architecture.md
  opencode-prompt-architecture-zh.md
```

Codex 截图中出现：

```text
agent-architecture-atlas/
  codex-prompts-and-tools.md
```

推荐每个 repo 至少产出：

```text
agent-architecture-atlas/
  00-overview.md
  01-key-files.md
  02-prompt-assembly-flow.md
  03-tool-call-flow.md
  04-agent-loop.md
  05-open-questions.md
```

## 8. 输出文档结构

`*-prompt-architecture.md` 建议固定为：

```text
# <Repo> Prompt Architecture

## Overview
## Repository and Version
## Key Files
## System Prompt Architecture
## Provider-Specific Prompts
## Tool Prompt Architecture
## Agent Modes and Subagents
## Prompt Assembly Flow
## Tool Call Flow
## Runtime Observations
## ASCII Architecture Diagram
## Open Questions
```

每个关键结论必须附带：

- 文件路径。
- 代码符号或搜索词。
- 证据等级 A/B/C/D。
- 如果是运行时日志，写出 JSONL 文件名和 turn index。

## 9. 验收标准

对任意目标 Agent，完成分析后应能回答：

- base system prompt 在哪里定义？
- developer/user/project instructions 如何合并？
- `AGENTS.md` / `CLAUDE.md` / skills 如何进入上下文？
- tool registry 在哪里维护？
- tool description/schema 如何展示给模型？
- tool result 如何追加回 conversation？
- review/compact/plan 等特殊模式如何切换？
- provider-specific prompt 有哪些差异？
- sandbox、permission、hooks、logs 分别在哪里介入？
- 哪些结论来自源码，哪些来自运行时，哪些只是推断？

## 10. 风险与边界

- 不把闭源产品的推断写成源码事实。
- 不发布包含 token、账号、私有路径、商业秘密的原始日志。
- 不绕过授权、DRM、许可证或访问控制。
- 引用 prompt 时只摘录必要片段，避免整段复制闭源或版权材料。
- 对于 Claude Code 这类闭源产品，优先写架构洞察和分类，不把运行时 prompt 当作可公开复刻资产。

## 11. 后续可执行任务

1. 在 `vendors/geektime-bootcamp-ai` 中补一个 `agent-architecture-atlas` 索引，链接 Codex/OpenCode/Claude Code 三条分析线。
2. 为 `w6/opencode-introspection` 的 JSONL logs 写一个 extractor，把 system prompt、tool calls、tokens 汇总成表。
3. 复刻 Codex 分析：clone `openai/codex`，运行本 spec 的提示词，产出 `codex-prompts-and-tools.md`。
4. 复刻 OpenCode 分析：clone `opencode-ai/opencode`，运行 introspection plugin，产出 `opencode-prompt-architecture.md`。
5. 把上述分析反哺到 `w6/simple-agent` 和 `w6/codereview-agent` 的设计中，形成自己的通用 Agent 内核。
