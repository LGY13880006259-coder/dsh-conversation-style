# dsh-conversation-style

**A left-sidebar switch that changes how the assistant talks: entertainment or professional.**
**左侧栏一键切换助手的对话风格：娱乐 / 专业。**

[English](#english) | [中文](#中文)

---

## English

### What it does

- Adds one control to the Harness Web UI **left sidebar footer**, beside Settings and the usage gauge.
- Two built-in modes: **Professional** (rigorous, serious register) and **Fun** (relaxed, humorous register).
- Clicking the control toggles the mode; the label shows the current mode (`Professional` / `Fun`), and the tooltip states what a click will do.
- The mode is **global for the profile** and **persists across restarts**; it applies from the next assembled model request.
- While a save is in flight the control dims and is disabled; if the save fails the mode is reverted and the control shows a temporary retry hint. A failed initial read leaves the control usable with the default Professional mode.

### How it works

- **Host half** (`index.js`): registers a system-prompt section named `conversation-style:style` at order `10300` (after every first-party section) whose text is resolved on each assembly, so a mode change reaches the next request. The section is registered with `interpolate: false` and carries a short bilingual (EN + ZH) directive.
- **Host half** also serves a tiny loopback API on the Host's existing `webServer`: `GET /api/conversation-style` returns `{ mode, promptText }`, `POST /api/conversation-style` accepts `{ "mode": "professional" | "fun" }`. Other methods get `405`; invalid bodies get `400`.
- **Browser half** (`client.js`): registers into the live `sidebar.footer.action` slot and calls that relative route with `fetch`. It is a plain module loaded through the Harness Client module loader; only `react` is required from the browser module table.
- **State**: written atomically to `$DSH_HOME/.conversation-style.json` (`{"version":1,"mode":"..."}`). Missing or corrupt state falls back to Professional. The profile's `cordis.patch.yml` and other plugins' files are never touched.

The two modes are instruction layers only. "Fun" explicitly keeps factual accuracy, task quality, tool discipline, and security rules as hard constraints; serious or dangerous topics get the accurate answer first.

### Requirements

- DeepSeek Harness `>= 0.2.2-rc.1` with the Web GUI profile (developed and verified against `0.2.2-rc.1`; no other version is verified).
- Node.js `^22.19.0 || >=24.0.0` (the version shipped with the Harness desktop app is fine).
- No npm dependencies; the bundle uses Node builtins only.

### Install

```powershell
# from this GitHub repository (build artifacts are the source files; no build step)
dsh plugin add --profile desktop "github:LGY13880006259-coder/dsh-conversation-style"
```

Or, after the package is published to npm:

```powershell
dsh plugin add --profile desktop dsh-conversation-style
```

From the desktop app you can also use **Plugins → Add plugin** and paste the GitHub address,
then fully restart DeepSeek Harness.

### Use

1. Open any session in the Web GUI.
2. Click the switch in the left sidebar footer. The label shows the active mode.
3. The next reply follows the selected mode. Toggle again to switch back.

### Uninstall

```powershell
dsh plugin remove --profile desktop dsh-conversation-style
```

Optionally delete `$DSH_HOME/.conversation-style.json` to forget the last selected mode.

### Data and permissions

- Writes exactly one file outside the plugin itself: `$DSH_HOME/.conversation-style.json`.
- Reads no credentials, opens no port of its own, makes no outbound network requests; the HTTP route is inbound on the Host's existing loopback `webServer` and relies on that server being bound to `127.0.0.1`.
- Does not register tools, commands, agent presets, or skills; does not change models, tool permissions, or the session's plugin composition.

### Limitations

- The mode is profile-global, not per-session.
- Two fixed modes; there is no style library, custom prompt editor, or `/style` command.
- The collapsed-rail icon layout is covered by the browser-side state machine and was mock-verified; it has not been visually audited across every sidebar theme.
- Prompt changes invalidate the cached prompt prefix once per toggle; toggling is expected to be infrequent.

### License

MIT

---

## 中文

### 功能

- 在 Harness Web GUI **左侧栏底部**（设置、用量表旁）增加一个切换控件。
- 内置两种模式：**专业**（严谨、认真）与**娱乐**（轻松、幽默）。
- 点击即切换；标签显示当前模式（`专业` / `娱乐`），悬停提示下一次点击的效果。
- 模式对**整个 profile 全局生效**并**跨重启保留**；从下一次模型请求的提示词开始生效。
- 保存期间控件变暗且禁用；保存失败自动回退并短暂显示重试提示；首次读取失败时保持默认「专业」且控件仍可用。

### 实现

- **Host 半**（`index.js`）：注册名为 `conversation-style:style`、order `10300`（位于所有内置段落之后）的系统提示段落，文本在每次装配时求值，因此切换后下一条请求即生效；段落设置 `interpolate: false`，内容为中英双语短指令。
- **Host 半**同时在宿主已有的 `webServer` 上挂一个本机接口：`GET /api/conversation-style` 返回 `{ mode, promptText }`，`POST /api/conversation-style` 接受 `{ "mode": "professional" | "fun" }`；其他方法返回 `405`，非法请求体返回 `400`。
- **浏览器半**（`client.js`）：注册到 `sidebar.footer.action` 槽位，用相对地址 `fetch` 调用上述接口；通过 Harness 客户端模块加载器加载，仅从浏览器模块表取 `react`。
- **状态**：原子写入 `$DSH_HOME/.conversation-style.json`（`{"version":1,"mode":"..."}`）；文件缺失或损坏时回退为「专业」。不会改动 profile 的 `cordis.patch.yml` 或其他插件文件。

两种模式只是指令层。娱乐模式明确保留事实准确性、任务质量、工具规范与安全规则作为硬约束；严肃或危险话题先给准确回答。

### 要求

- DeepSeek Harness `>= 0.2.2-rc.1`，且使用 Web GUI profile（开发与验证版本为 `0.2.2-rc.1`，其他版本未验证）。
- Node.js `^22.19.0 || >=24.0.0`（桌面端自带运行时即可）。
- 无 npm 依赖，仅使用 Node 内置模块。

### 安装

```powershell
dsh plugin add --profile desktop "github:LGY13880006259-coder/dsh-conversation-style"
```

发布到 npm 后也可以：

```powershell
dsh plugin add --profile desktop dsh-conversation-style
```

桌面端也可在「插件 → 添加插件」中粘贴 GitHub 地址，安装完成后完整重启 DeepSeek Harness。

### 使用

1. 在 Web GUI 打开任意会话；
2. 点击左侧栏底部的切换控件，标签显示当前模式；
3. 下一条回复按所选模式生成，再次点击可切回。

### 卸载

```powershell
dsh plugin remove --profile desktop dsh-conversation-style
```

如需忘记上次选择，可删除 `$DSH_HOME/.conversation-style.json`。

### 数据与权限

- 插件自身之外只写一个文件：`$DSH_HOME/.conversation-style.json`。
- 不读取凭据、不自开端口、无出站网络请求；HTTP 接口是宿主既有 loopback `webServer` 上的入站路由，依赖该服务绑定在 `127.0.0.1`。
- 不注册工具、命令、agent preset 或技能；不改模型、工具权限或会话插件组合。

### 限制

- 模式为 profile 全局，不按会话隔离。
- 两种固定模式，没有风格库、自定义提示词编辑器或 `/style` 命令。
- 折叠成图标栏时的外观经过浏览器侧状态机与 mock 验证，尚未在所有侧栏主题下人工核对。
- 每次切换会使提示词前缀缓存失效一次，正常使用频率下影响可忽略。

### 许可证

MIT
