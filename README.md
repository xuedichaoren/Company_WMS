# WMS 仓库管理小程序

面向仓库操作人员的手机端仓储管理系统，使用**原生微信小程序语法**开发（WXML + WXSS + JS + JSON），不依赖 uni-app 等框架。

当前为**纯前端演示版本**：所有数据均为本地静态模拟，不请求后端接口。

## 已实现页面

| 页面 | 路径 | 状态 |
| --- | --- | --- |
| 首页 | `miniprogram/pages/index/index` | ✅ 已完成 |
| 登录页 | `miniprogram/pages/login/index` | ⏳ 待开发 |
| 入库 | `miniprogram/pages/inbound/index` | ⏳ 待开发 |
| 出库 | `miniprogram/pages/outbound/index` | ⏳ 待开发 |
| 库存查询 | `miniprogram/pages/stock/index` | ⏳ 待开发 |
| 商品管理 | `miniprogram/pages/goods/index` | ⏳ 待开发 |
| 操作日志 | `miniprogram/pages/log/index` | ⏳ 待开发 |

> 首页快捷操作已预留页面路由。每开发完一个页面，只需把路径加入
> `miniprogram/pages/index/index.js` 中的 `READY_PAGES` 数组，跳转即会自动生效；
> 未完成的页面点击后会提示「XX页面开发中」，不会报错。

## 目录结构

```
Wx_miniprogram/
├── miniprogram/                 # 小程序源码目录
│   ├── app.js                   # 小程序入口，全局数据
│   ├── app.json                 # 全局配置（页面路由、导航栏）
│   ├── app.wxss                 # 全局样式与主题变量
│   ├── sitemap.json             # 页面索引配置
│   └── pages/
│       └── index/               # 首页
│           ├── index.js         # 页面逻辑（扫码、快捷入口、下拉刷新）
│           ├── index.json       # 页面配置
│           ├── index.wxml       # 页面结构
│           └── index.wxss       # 页面样式
├── project.config.json          # 微信开发者工具项目配置（含 AppID）
├── project.private.config.json  # 本地私有配置
└── README.md
```

## 运行方式

1. 打开微信开发者工具，选择「导入项目」。
2. 项目目录选择本仓库根目录 `Wx_miniprogram`。
3. AppID 使用 `project.config.json` 中的 `wx00025c1841c755b4`，或替换为你自己的 AppID。
4. 编译后即可在模拟器 / 真机预览首页。

## 常见问题

- **提示 `module 'xxx.js' is not defined`**：通常是新增文件后，开发者工具仍在使用旧的编译文件列表。执行「工具 → 清除缓存 → 全部清除」，然后重新编译。
- **提示找不到旧页面（如 `pages/example/index`）**：说明工具仍在用旧项目的编译缓存。清除缓存，或关闭项目后重新导入 `E:\Wx_miniprogram`。
- **JSON 报错 `Unexpected token` 且开头是一个看不见的字符**：文件被保存成了带 BOM 的 UTF-8。请将 `app.json` 等 JSON 文件另存为 **UTF-8（无 BOM）**；本项目的 JSON 文件都不要带 BOM。

## 首页功能

- **仓库概览**：今日入库、今日出库、在库商品、库存预警。
- **扫一扫**：调用 `wx.scanCode` 识别条形码 / 二维码，识别后可选择扫码入库、扫码出库、查询库存（对应页面开发中）。
- **快捷操作**：入库、出库、库存查询、商品管理、操作日志五个入口。
- **最近操作**：展示最新出入库记录，点击可查看详情。
- **下拉刷新**：重新加载本地模拟数据。
- **手机适配**：全部使用 `rpx` 布局，并适配底部安全区。

## 后续开发约定

- 每个页面放在 `miniprogram/pages/<页面名>/` 下，文件统一命名为 `index.js / index.json / index.wxml / index.wxss`。
- 首页的模拟数据直接写在 `pages/index/index.js` 顶部；后续页面可以沿用这种方式，也可以拆到页面同目录下的独立文件中。
- 颜色、圆角等主题变量统一定义在 `miniprogram/app.wxss` 的 `page` 选择器中，页面内通过 `var(--xxx)` 引用。
- 接入真实接口时，只需替换页面内模拟数据的来源，页面字段结构尽量保持不变。
