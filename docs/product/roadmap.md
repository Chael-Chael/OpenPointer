# OpenMagicPointer 完整技术实现计划

## Summary

- 做一个跨平台桌面 AI 光标助手：用户指向、悬停、划过、圈选屏幕内容后，可用文字、语音或自动推荐动作完成问答、改写、提取、填入和安全执行。
- 第一版采用桌面优先、跨平台桌面、完整接入 Cua 执行闭环。
- 核心交互：`鼠标晃动/快捷键激活 -> 采集指针上下文 -> 自动识别意图 -> 展示可选动作 -> 语音/文字补充 -> 预览 -> 确认 -> Cua 执行`。
- `D:\aipointer` 只作为交互模式参考，尤其是鼠标晃动激活、光标拖尾、overlay 工程形态；不复用其源码、资源、UI、命名、IPC channel、文案或样式。

## Key Changes

- 建立 monorepo：
  - `apps/desktop`：Electron + React + TypeScript + Vite，负责 overlay、全局触发、语音入口、意图选项、设置页、打包。
  - `packages/core`：`PointerContext`、`PointerEntity`、`PointerIntent`、`PointerGesture`、`PointerActionPlan`、risk policy、session memory。
  - `packages/grounding`：截图、OCR、Windows UIA、macOS AX、Linux AT-SPI、VLM fallback。
  - `packages/intent`：自动意图识别、动作排序、候选选项生成。
  - `packages/voice`：STT/TTS adapter、语音状态机、语音命令解析。
  - `packages/gestures`：快捷键、鼠标晃动、悬停、划过、套索/圈选、拖尾动画数据。
  - `packages/executors`：Cua executor、本地 clipboard/open-url executor、mock executor。
  - `packages/backends`：OpenAI-compatible、Gemini、Anthropic、Ollama/local adapter。
- 输入方式：
  - `Text`：自然语言输入。
  - `Voice`：用户说“总结这个”“改写得正式一点”“填到这里”。
  - `Intent Picker`：用户不说话不打字时，系统根据指针上下文给 3-6 个动作。
  - `Gesture Context`：悬停、划过、圈选的对象都能加入上下文，而不只依赖点击或矩形截图。

## Core Interfaces

- `PointerContext`：
  - `source`: `desktop | browser | sandbox`
  - `cursor`: screen/display/local coordinates + DPR
  - `window`: title/process/app/window id
  - `target`: role/name/text/bbox/accessibility path/confidence
  - `selection`: selected text or insertion target
  - `visual`: screenshot crop id + crop bbox
  - `gesture`: hover/sweep/lasso/circle path metadata
  - `nearby`: surrounding text/elements
- `PointerGesture`：
  - `kind`: `hover | sweep | lasso | circle | rectangle | click`
  - `path`: sampled points with timestamps
  - `region`: polygon/bbox/closed-shape mask
  - `entities`: UIA/AX/OCR/VLM elements intersecting the gesture
  - `confidence`: gesture recognition confidence
- `PointerIntent`：
  - `id`: explain/summarize/translate/rewrite/extract/fill/click/open/compare/send-to-agent
  - `label`, `reason`, `confidence`, `requiresInput`, `defaultPrompt`
- `PointerActionPlan`：
  - `intent`, `risk`, `steps`, `preview`, `requiresConfirmation`
  - 所有有副作用的动作必须先生成 preview，模型文本不能直接执行。
- `ExecutorAdapter`：
  - `capabilities()`, `dryRun(plan)`, `execute(plan, approvalToken)`, `captureBeforeAfter()`, `audit(plan, result)`

## Implementation Plan

- Phase 0：架构与 clean-room 边界
  - 初始化 workspace、lint、typecheck、unit test。
  - 写 `docs/architecture.md`、`docs/safety.md`、`docs/reference-policy.md`。
  - 明确 AIPointer BSL 代码不进入本项目；只记录可借鉴交互模式。

- Phase 1：桌面 shell 与激活方式
  - Electron 主进程创建每个 display 的透明 click-through overlay。
  - 支持快捷键激活和鼠标晃动激活。
  - 鼠标晃动检测使用本项目自写算法：采样短时间窗口内的水平/二维方向反转、幅度、速度和冷却时间，避免正常移动误触。
  - 设置页允许关闭鼠标晃动、调整灵敏度、改快捷键。

- Phase 2：光标动效与上下文提示
  - 实现原创光标拖尾系统：overlay 接收 cursor stream，渲染短生命周期 trail、halo、当前捕获状态。
  - 拖尾只用于视觉反馈和 gesture path preview，不影响真实鼠标。
  - 当系统识别到 hover/sweep/lasso/context capture 时，在光标附近显示 context chips，例如 `Text selected`、`3 elements`、`Table region`。

- Phase 3：非矩形上下文采集
  - `Hover Context`：用户在对象上停留超过阈值时，自动加入当前 UI 元素、附近文本和小范围截图。
  - `Sweep Context`：用户按住触发键划过一段区域，系统采样路径附近的 UIA/AX/OCR 元素，按相交比例加入上下文。
  - `Lasso/Circle Context`：用户圈选闭合区域，系统生成 polygon mask，提取区域内元素、OCR 文本、图像 crop，不局限于矩形截图。
  - `Rectangle Context` 保留为精确截图方式，但不再是唯一选区方式。
  - 多个 context card 可累积为 `these`，当前插入点保存为 `here`。

- Phase 4：自动意图识别
  - 基于 `PointerContext + PointerGesture + PointerEntity` 先用本地规则生成候选：
    - 输入框：填入、改写后填入、粘贴摘要。
    - 大段文本：总结、翻译、解释、提取要点。
    - 表格：转 Markdown、转 CSV、总结数据。
    - 代码/错误日志：解释错误、生成修复建议、发送给 coding agent。
    - 圈选多个对象：比较、合并总结、批量提取。
  - LLM classifier 只用于排序和补充候选，不允许直接执行。
  - 低置信度时展示通用动作；高置信度时突出推荐主动作。

- Phase 5：语音交互
  - 默认不常驻录音；只有用户触发后进入 listening。
  - STT 默认系统能力，云端 STT 和本地 Whisper 作为可选配置。
  - TTS 默认按需朗读，可在设置中启用自动朗读。
  - 语音状态机：`idle -> listening -> transcribing -> resolving -> preview/responding`。
  - 支持“执行”“取消”“换一个”“详细一点”“加入这个区域”等短命令。

- Phase 6：Grounding 与 memory
  - Grounding 优先级：OS accessibility -> OCR/Som-style visual parsing -> VLM fallback。
  - 维护 `this / that / these / here`：
    - `this` 当前指向对象
    - `that` 上一个对象
    - `these` 多个已捕获对象/区域
    - `here` 当前输入位置
  - Hover、sweep、lasso、circle、rectangle 都能写入 memory，并带来源和置信度。

- Phase 7：Native assistant 与 provider router
  - 实现 Ask / Explain / Summarize / Translate / Rewrite / Extract / Fill。
  - provider router 支持 BYOK、多 provider fallback、流式响应、超时取消。
  - 模型输出必须转成结构化 `PointerActionPlan`，由本地 validator 和 risk policy 检查。

- Phase 8：完整 Cua execution
  - `cua-executor` 支持 Cua `computer-server` MCP/HTTP 原语：
    - screenshot、click、double-click、move、drag、scroll、type、hotkey、clipboard、open、launch app、active window、accessibility tree。
  - 执行流程固定为：`dryRun -> preview -> confirmation -> execute -> before/after screenshot -> audit log`。
  - 高风险动作二次确认：submit/send/delete/purchase/shell/file write。
  - Cua 只执行已确认 action plan，不负责判断用户意图。

## Test Plan

- Unit tests：schema、gesture recognition、intent ranking、risk policy、coordinate transforms。
- Gesture tests：晃动激活误触率、hover dwell、sweep path、lasso/circle polygon extraction、rectangle fallback。
- Voice tests：STT mock、语音命令解析、低置信度候选展示、执行/取消命令。
- Grounding tests：固定 UIA/AX/OCR fixture 下验证 entity extraction 和 gesture intersection。
- Executor tests：mock executor 和 Cua executor 都必须验证 preview、approval、audit。
- Cross-platform smoke：Windows、macOS、Linux 验证启动、触发、拖尾、语音、意图选项、圈选上下文、Cua 执行。
- Legal hygiene check：CI 扫描禁止出现 AIPointer 标识、复制资源、相同 IPC channel 列表或明显复用文案。

## Assumptions

- 第一版使用 Electron；Tauri 作为后续候选。
- 默认开启 intent picker 和光标拖尾；默认不自动开启麦克风。
- 鼠标晃动激活默认开启但必须可关闭，避免干扰高频鼠标用户。
- 自动意图识别只推荐和生成 plan，不直接执行有副作用动作。
- Cua 是执行层；OpenMagicPointer 自己负责 grounding、gesture context、memory、preview、安全策略、语音和意图识别。
