# 鲸之心 / Heart of Deepseek

为减少「鱼八股」而设计的极简本地聊天 bot。鲸之心把通用回复规则与角色设定分开，让简单告别就停在一句「晚安」，分享时接住对方提到的细节，有明确请求时直接给结果。角色特有的口吻、动作和反应仍由角色卡决定。规则用于减少套话和多余追问，实际表现受模型和对话内容影响。

能用于日常文字和图片聊天，也可以把人设和记忆模块作为参考，加装到自己的应用中。

## 能做什么

- **聊文字和图片**。接入官方 DeepSeek API，提供 Windows 桌面窗口和本机网页入口。
- **自定义角色**。支持 YAML、手写问卷和 TXT 模板，角色卡包含人设、回复格式和补充表达要求。
- **管理记忆**。按角色隔离聊天，检索相关旧对话，保存约定与事实，保留更正版本和原话出处。
- **确认共同经历**。模型提出带原话的候选经历，确认后才用于后续回忆。

## 本机运行

需要 Node.js 24 或更高版本。

```sh
npm ci
npm start
```

打开 [本机聊天页](http://127.0.0.1:3561)，在右上角「设置」填入自己的 DeepSeek API Key。也可通过进程环境变量 `HEART_API_KEY` 提供。默认模型为 `deepseek-flash`。正式版首次启动载入示例角色「小鱼」和随附头像，聊天和记忆为空。

### Windows 桌面版

在 Windows x64、Node.js 24+ 和 WebView2 Runtime 环境中，从项目目录运行：

```powershell
npm.cmd ci
./scripts/package-windows.ps1
```

打包后，在脚本输出的发布文件夹里双击「打开鲸之心.exe」。同目录的「预览鲸之心.exe」使用独立的虚构演示数据，无需 API Key 即可查看现有对话、记忆和角色管理。移动桌面版时请复制完整发布文件夹。

### 数据存放

网页开发模式默认把数据保存在 `data/`。桌面正式版使用 `%LOCALAPPDATA%/HeartOfDeepseek/App/Data`，预览版使用独立的 `Preview/Data`。通过设置界面保存的 API Key 位于该数据目录的 `key.local`，内容是明文。可用 `HEART_DATA_DIR` 指定网页模式数据目录，用 `HEART_PORT` 指定端口。

应用仅监听本机回环地址。生成回复时，当前输入、发送的图片、角色卡和相关对话上下文会发给官方 DeepSeek API。自动整理共同经历时也会发送候选对话的原话。设置 `HEART_AUTO_EXPERIENCES=0` 可关闭自动整理。

## 加装到自己的应用

可以从任意一层接入，继续使用自己的 UI 和模型。

| 想复用的部分 | 入口 | 接入方式 |
| --- | --- | --- |
| 角色卡格式 | [roles/blank.yaml](roles/blank.yaml) 和 [手写 TXT 模板](roles/手写角色卡.txt) | 用 `roleFromYaml()` 校验 YAML，用 `handwrittenToYaml()` 或 `questionnaireToYaml()` 转换手写资料。 |
| 减少套话的提示词 | [core.mjs](core.mjs) | 用 `prompt(role)` 生成系统提示词。角色卡与应用通用规则分段拼装，也可只参考其中的回复规则。 |
| 记忆和约定 | [core.mjs](core.mjs)、[memory.mjs](memory.mjs) | 通过 `Store` 初始化 SQLite，按稳定角色 ID 写入消息、保存事实版本、执行约定命令，再用 `store.context()` 取得本轮需要的记忆。 |
| 共同经历审核 | [memory.mjs](memory.mjs)、[server.mjs](server.mjs) | 参照现有的候选生成与审核流程。保留原话和来源，用户确认后才纳入召回。 |

下面的示例演示角色校验、提示词拼装和本地记忆。只需安装项目依赖，运行它不会请求模型服务。

```js
import { readFileSync } from 'node:fs';
import { Store, prompt, roleFromYaml } from './core.mjs';

const role = roleFromYaml(readFileSync('./roles/xiaoyu.yaml', 'utf8'));
const store = new Store(':memory:');
try {
  store.saveRole(role);
  store.remember(role.id, { topic: '阅读偏好', fact: '周末喜欢看短篇小说' });
  const userText = '周末想找点东西读，你还记得我喜欢什么吗？';
  const messages = [
    { role: 'system', content: prompt(role) },
    {
      role: 'user',
      content: '本轮相关的本地上下文\n' + JSON.stringify(store.context(role.id, userText)),
    },
    { role: 'user', content: userText },
  ];
  console.log(messages);
} finally {
  store.close();
}
```

接入持久数据库时，用数据库路径替代 `:memory:`。应用有多位用户时，由宿主为每位用户分配独立数据库或实现额外的租户隔离。公开仓库提供模块源码与接入示例。

## 测试

```sh
npm test
node scripts/smoke.mjs
```

测试使用虚构样例和临时数据目录。覆盖角色卡校验、空历史启动、记忆隔离、约定改期、原话回看和重启恢复。默认测试无需 API Key。

## 许可证

[MIT](LICENSE)。鲸之心是独立项目，使用 DeepSeek 的官方接口。
