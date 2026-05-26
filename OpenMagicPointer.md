# OpenMagicPointer

MagicPointer: https://deepmind\.google/blog/ai\-pointer/

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=MGU0YTZhODI2MTMxYzQ3NTA2MzVmYmNmZDgyNDg2MzhfYmEyOWMzM2QwN2M2NzA3NzM3ZjcxM2YxMGViYjA1OWZfSUQ6NzY0NDIxMTM0OTE5MDYyNjI3MF8xNzc5ODA3NDE4OjE3Nzk4OTM4MThfVjM)

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=MjdmZjZlOGMxZjFlMGVkZTljMjIyNWZkZDI5N2VkYWJfZjZmMjYyMzYyOWNjZTQ4OWE1M2M4ZDM3NTY1Y2NjMTNfSUQ6NzY0NDIxMTM2MDAzMzAxNzAxM18xNzc5ODA3NDE4OjE3Nzk4OTM4MThfVjM)

[https://storage.googleapis.com/gdm-deepmind-com-prod-public/media/QeTwZ9wWGXR2MbQh/maintaining_flow_v9.webm#t=0.1]()

[https://storage.googleapis.com/gdm-deepmind-com-prod-public/media/xBmnpEDq0QWHrb-V/show_dont_tell_v6.webm#t=0.1]()

[https://storage.googleapis.com/gdm-deepmind-com-prod-public/media/xBmnpEDq0QWHrb-V/This_and_That_v4.webm#t=0.1]()

[https://storage.googleapis.com/gdm-deepmind-com-prod-public/media/xBmnpEDq0QWHrb-V/pixels_to_actions_v5.webm#t=0.1]()

Clicky: https://github\.com/farzaa/clicky

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=NjNiNDk1YmU2MzRlYWRlZDgxZjgyODUxOGJlZDE5YjZfZGRlOTJkODM0NWI3ODQxMThkYjk0YTgyYTFlNTA0NDRfSUQ6NzY0NDIxMTEzMDc4NDY2NDUwOF8xNzc5ODA3NDE4OjE3Nzk4OTM4MThfVjM)

AIPointer: https://github\.com/gonemedia/aipointer

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=MmYwMGFhZmE3NTg4ODcyYzhiY2IwN2VjZGE1NTNiOWRfMjZiYjY0MDU1MjE1NDhmYjNlZmZkYWVkNDNhZmJmYjhfSUQ6NzY0NDIxMTIxMzQ2Mjc4NTIxNV8xNzc5ODA3NDE4OjE3Nzk4OTM4MThfVjM)

CUA: https://github\.com/trycua/cua

Everywhere: https://github\.com/sylinko/everywhere

明白，重新定位后应该是：

> **OpenPointer 不是 OpenClaw 插件，而是一个独立 AI Pointer 产品。**
> OpenClaw / Hermes / Codex / Claude Code / OpenCode 是可接入的“大脑后端”；
> Cua / Playwright / Windows UIA / macOS AX 是可接入的“交互执行层”；
> OpenPointer 自己要提供完整的日常功能、UI、上下文管理、安全确认和轻量 agent 能力。
> 
> 

---

# 项目定位

## 项目名暂定

**OpenPointer**

## 一句话

> **OpenPointer 是一个开源 AI 光标助手：用户指向屏幕上的对象，说“这个/那个/放这里”，它能理解、解释、改写、提取、比较，并在确认后安全执行操作。**
> 
> 

它的核心不是“插件”，而是一个完整产品：

```Plain Text
OpenPointer = AI Pointer App
             + Pointer Grounding Engine
             + Local Context Memory
             + Action Preview UI
             + Agent Backend Router
             + Computer-use Executor
```

Google DeepMind 的 AI Pointer 灵感核心是让鼠标指针理解“它指向什么，以及为什么对用户重要”，并减少用户把上下文搬进 AI 工具的摩擦。这个方向和 OpenPointer 的产品定位完全一致。\(Google DeepMind\)

---

# 和 AIPointer / Cua / OpenClaw 的关系

## AIPointer

AIPointer 已经证明了“按住快捷键、光标旁弹窗、截图给 VLM、回答当前屏幕问题”的产品形态成立；它也有多 provider、工具审批、截图裁剪、跨平台桌面 app 等设计。\(GitHub\)

但 OpenPointer 不应该只是 AIPointer clone。差异应该是：

---

## Cua

Cua 是 computer\-use agent 基础设施，提供 sandboxes、SDKs、benchmarks，可训练和评估控制 macOS、Linux、Windows 桌面的 agent。\(GitHub\) Cua 也提供云/本地桌面环境，支持 macOS、Windows、Linux、Android sandboxes。\(Cua\)

OpenPointer 和 Cua 的关系应该是：

```Plain Text
OpenPointer 负责：用户指向了什么、想做什么、是否确认执行
Cua 负责：在真实/虚拟桌面里点击、输入、滚动、执行
```

Cua 是 executor，不是产品主体。

---

## OpenClaw / Hermes / Codex / Claude Code / OpenCode

OpenClaw 是 agent gateway/runtime，支持 tools、skills、plugins、canvas、sessions、cron、nodes 等能力。\(GitHub\) OpenClaw plugin 可以扩展 channels、model providers、agent harnesses、tools、skills、speech、media understanding 等运行时能力。\(OpenClaw\)

OpenPointer 和这些框架的关系是：

```Plain Text
OpenPointer 自己可以回答和执行轻量任务；
复杂任务才转交给 OpenClaw / Hermes / Codex / Claude Code / OpenCode。
```

所以它们是 **optional backend**，不是 OpenPointer 的本体。

---

# 产品形态

OpenPointer 应该像一个真正可日用的工具。

## 核心交互

```Plain Text
用户指向屏幕对象
    ↓
按快捷键 / 语音 / 鼠标手势
    ↓
OpenPointer 识别对象
    ↓
弹出光标旁 AI 面板
    ↓
用户说：解释这个 / 总结这个 / 改写这里 / 比较这两个 / 放到这里
    ↓
OpenPointer 回答或展示 action preview
    ↓
用户确认后执行
```

## 独立功能

这才是独立产品，而不是中间层。

---

# 总体架构

```Plain Text
┌──────────────────────────────────────────────┐
│ OpenPointer App                              │
│ 光标浮窗 / 快捷键 / 语音 / 历史记录 / 设置面板       │
└──────────────────────┬───────────────────────┘
                       ↓
┌──────────────────────────────────────────────┐
│ Pointer Grounding Engine                     │
│ DOM / AX / UIA / screenshot / OCR / VLM       │
│ 识别用户指向的对象                              │
└──────────────────────┬───────────────────────┘
                       ↓
┌──────────────────────────────────────────────┐
│ Pointer Context Runtime                      │
│ this / that / these / here / session memory   │
└──────────────────────┬───────────────────────┘
                       ↓
┌──────────────────────────────────────────────┐
│ OpenPointer Native Skills                    │
│ explain / summarize / rewrite / extract       │
│ compare / fill / copy / annotate              │
└──────────────────────┬───────────────────────┘
                       ↓
┌──────────────────────────────────────────────┐
│ Backend Router                               │
│ local LLM / API model / OpenClaw / Hermes     │
│ Codex / Claude Code / OpenCode / custom MCP   │
└──────────────────────┬───────────────────────┘
                       ↓
┌──────────────────────────────────────────────┐
│ Safe Executor                                │
│ DOM / Playwright / Cua / UIA / AX / shell     │
│ preview / permission / audit log              │
└──────────────────────────────────────────────┘
```

---

# 技术栈建议

## Phase 1：Web\-first 独立工具

先做 Chrome / Edge extension。原因是网页里可以拿到 DOM、selection、ARIA、table、input 等结构化信息，比纯桌面截图稳定。

---

## Phase 2：Desktop App

桌面版建议做成独立 companion，不要一开始塞进扩展。

推荐路线：

```Plain Text
Browser Extension 负责网页高精度体验
Desktop App 负责全局屏幕 / App / IDE / PDF / 图片场景
```

---

# 核心模块结构

```Plain Text
openpointer/
  apps/
    browser-extension/
    desktop-app/
    landing-demo/

  packages/
    core/
      pointer-context
      pointer-entity
      pointer-action
      pointer-memory

    grounding/
      dom-grounding
      aria-grounding
      screenshot-grounding
      windows-uia-grounding
      macos-ax-grounding
      visual-grounding

    ui/
      floating-panel
      entity-card
      action-preview
      history-panel
      settings-panel

    skills/
      explain
      summarize
      rewrite
      translate
      extract-table
      compare
      fill-input
      annotate

    executors/
      dom-executor
      playwright-executor
      cua-executor
      windows-uia-executor
      macos-ax-executor

    backends/
      local-llm
      openai-compatible
      gemini
      anthropic
      ollama
      openclaw
      hermes
      codex
      claude-code
      opencode

    mcp/
      openpointer-mcp-server

  examples/
    github-helper/
    paper-reader/
    shopping-compare/
    form-writer/
    code-explainer/

  docs/
    architecture.md
    safety.md
    integrations.md
    protocol.md
```

---

# 核心数据模型

保持简单，三类对象即可。

## 7\.1 PointerContext

表示用户当前指向的环境。

```Plain Text
PointerContext:
- source: web / desktop / pdf / ide
- cursor: x, y, screen, viewport
- target: role, text, bbox, selector, accessibility path
- selection: selected text
- nearby: nearby elements/text
- visual: local crop
- app/page: url, title, process, window title
```

## 7\.2 PointerEntity

表示识别出的对象。

```Plain Text
PointerEntity:
- text
- button
- input
- link
- table
- code
- chart
- image
- product
- date
- place
- file
- issue
- diff
- error-log
```

## 7\.3 PointerAction

表示可执行动作。

```Plain Text
PointerAction:
- explain
- summarize
- translate
- rewrite
- extract
- compare
- fill
- copy
- click
- open
- send_to_agent
```

每个 action 都带风险等级：

```Plain Text
low: explain / summarize / translate
medium: fill / copy / open
high: submit / send / delete / purchase / shell
```

---

# OpenPointer 自己必须有的核心能力

这些能力不能依赖 OpenClaw/Cua，否则它就真的变成中间插件了。

## 8\.1 Local Pointer Assistant

默认本地就能用：

- 指哪问哪；

- 指哪总结；

- 指哪翻译；

- 指哪提取；

- 指哪改写；

- 指哪填入。

这是日用核心。

## 8\.2 Pointer Workspace

用户问过的对象可以被保存：

```Plain Text
- 当前对象截图
- 识别出的 entity
- 用户问题
- AI 回答
- 执行动作
- 来源 URL / app / 时间
```

这可以做成一个轻量知识库。

## 8\.3 Multi\-target Pointer Memory

支持：

```Plain Text
this   = 当前对象
that   = 上一个对象
these  = 多选对象
here   = 当前插入位置
```

这个是最接近 Google Magic Pointer 灵魂的地方。

## 8\.4 Native Skills

OpenPointer 自带技能，不必每次走复杂 agent：

## 8\.5 Action Preview

执行前必须可见：

```Plain Text
OpenPointer will:
1. Fill this input with: ...
2. Click this button: ...
Confirm / Cancel
```

这个比“自动 agent”更容易获得用户信任。尤其 OpenClaw 这类深权限 agent 生态曾被报道过插件/skill 安全风险，因此 OpenPointer 从第一天就应该把 preview、权限和审计日志做成核心能力，而不是后补。\(The Verge\)

---

# 后端接入方式

## 9\.1 默认模式：OpenPointer Native

```Plain Text
用户指向对象
→ OpenPointer 自己调用模型
→ 自己回答/提取/改写/填入
```

适合 80% 高频任务。

## 9\.2 Agent Mode：交给 OpenClaw / Hermes

```Plain Text
用户：让 agent 处理这个
→ OpenPointer 生成 PointerContext
→ 发送给 OpenClaw/Hermes
→ 后端做长任务、记忆、跨应用协作
```

适合：

- 创建任务；

- 跨渠道通知；

- 查资料；

- 长工作流；

- 保存到个人记忆。

## 9\.3 Coding Mode：交给 Codex / Claude Code / OpenCode

```Plain Text
用户指向错误日志 / GitHub issue / PR diff
→ OpenPointer 抽取上下文
→ 发给 coding agent
→ coding agent 读代码库、修改、跑测试
```

适合开发者场景。

## 9\.4 Computer\-use Mode：交给 Cua

```Plain Text
用户确认操作
→ OpenPointer 发 action plan
→ Cua 在 sandbox / desktop 中执行
→ OpenPointer 展示结果和日志
```

适合需要真实 GUI 操作的任务。

---

# MVP 范围

第一版只做一个能打的独立产品。

## MVP 功能

```Plain Text
1. Chrome/Edge extension
2. 光标旁浮窗
3. DOM + selection + crop grounding
4. Ask / Explain / Summarize / Translate
5. Rewrite selected text
6. Fill input with confirmation
7. Extract table to Markdown/CSV
8. Pointer history
9. OpenAI-compatible + Gemini + Claude adapter
10. MCP server prototype
```

## MVP 不做

```Plain Text
- 全桌面控制
- 长任务自动化
- 复杂 OpenClaw 集成
- Cua sandbox 执行
- 多平台 installer
- 语音/TTS
- 自训练
```

先把网页上的 **“指哪问哪 \+ 指哪改哪 \+ 指哪填哪”** 做顺。

---

# 第二阶段功能

```Plain Text
1. Desktop companion
2. Windows UIA / macOS AX grounding
3. Cua executor bridge
4. OpenClaw plugin
5. Hermes skill bridge
6. Codex / Claude Code / OpenCode bridge
7. this / that / these / here memory
8. action audit log
9. local workspace search
```

这一阶段才把它从“AI 光标工具”升级成“agent 前端”。

---

# 项目壁垒

真正壁垒不是模型调用，而是这四件事：

## 12\.1 高质量 Grounding

```Plain Text
DOM / AX / UIA 优先
Vision fallback
LLM reasoning 最后
```

不要一上来就纯截图问 VLM。

## 12\.2 Pointer Memory

让 AI 真正理解：

```Plain Text
这个、那个、这些、放这里
```

## 12\.3 Safe Action UX

用户必须知道 agent 要做什么。

这会明显区别于很多“黑箱自动操作电脑”的 CUA 项目。

## 12\.4 独立产品体验

即使不接 OpenClaw、不接 Cua、不接 Codex，OpenPointer 也应该是一个好用的 AI 光标助手。

---

# 最终路线图

## Phase 0：设计

```Plain Text
- 产品 demo flow
- PointerContext schema
- Action risk policy
- README / landing concept
```

## Phase 1：Web MVP

```Plain Text
- Browser extension
- Floating panel
- Ask / explain / summarize / rewrite / fill
- Provider adapter
- Local history
```

## Phase 2：独立工具化

```Plain Text
- Pointer Workspace
- Entity card
- Multi-target selection
- Table/code/image specialized skills
- Local settings / BYOK
```

## Phase 3：Agent 后端

```Plain Text
- MCP server
- OpenClaw bridge
- Hermes bridge
- Codex / Claude Code / OpenCode bridge
```

## Phase 4：Desktop \+ Cua

```Plain Text
- Tauri desktop app
- Windows UIA / macOS AX
- Cua executor
- sandbox execution
- audit log
```

## Phase 5：生态化

```Plain Text
- Plugin SDK
- PointerBench
- Examples
- Docs
- Community recipes
```

---

# 最终定义

新版项目不应该叫：

> OpenClaw pointer plugin
> 
> 

也不应该叫：

> AIPointer clone
> 
> 

而应该是：

> **OpenPointer：一个独立的开源 AI 光标助手，同时也是 computer\-use agents 的人机交互前端。**
> 
> 

最核心的一句话：

```Plain Text
OpenPointer lets users point at anything, ask naturally, and act safely.
```

中文：

> **指向任何东西，自然提问，安全行动。**
> 
> 

这版定位更稳：

它有自己的产品闭环，也能接 OpenClaw/Hermes/Codex/Cua 做增强。这样既不会沦为插件，也不会试图从零重造整个 agent runtime。

