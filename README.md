# hamboo工作台

个人新媒体运营效率中心 — 待办、账号矩阵、选题灵感、饮食记录、账本、体重日历、照片记录，iPad/iPhone/PC 三端云同步。

## 功能模块

| 模块 | 说明 |
|------|------|
| 首页 | 概览面板：待办数、本月支出、饮食热量、体重变化、热点 TOP5 |
| 待办事项 | 按优先级管理任务，支持截止日期 |
| 账号矩阵 | 管理多平台账号，记录粉丝/阅读数据，趋势图表 |
| 选题灵感 | 热点速报自动推送选题建议，一键收藏到选题库 |
| 饮食记录 | 三餐打卡 + 热量统计 + 饮食日历 |
| 账本记录 | 收支记账，月度预算，分类统计 |
| 体重日历 | 每日体重录入 + BMI 计算 + 趋势图 |
| 照片记录 | 朋友圈式时间线，图片云存储，支持文字+标签+位置 |

## 使用方式

### Web 访问

打开 `http://hamboo.space` → 注册账号 → 开始使用。

### 安装到桌面（推荐 iPad/iPhone）

1. Safari 打开 `http://hamboo.space`
2. 点击分享按钮 → "添加到主屏幕"
3. 桌面出现 hamboo 图标，点击即可像 App 一样使用

安装后支持离线使用——断网也能查看和编辑数据，联网后自动同步。

## 技术架构

```
hamboo.space (GitHub Pages)
    │
    ├── 静态 PWA（HTML + vanilla JS）
    │   ├── Service Worker 离线缓存
    │   ├── IndexedDB 本地缓存 + 同步队列
    │   └── Chart.js 图表
    │
    └── Supabase 后端
        ├── Auth（邮箱登录）
        ├── Database（workspace_data 表）
        ├── Storage（照片图片）
        └── Realtime（多端实时同步）
```

## 账号管理

- **注册**：打开页面 → 点击"注册" → 填写邮箱密码 → 自动登录
- **切换账号**：侧栏底部"退出登录"→ 重新登录
- **管理用户**：登录 [Supabase 后台](https://supabase.com/dashboard/project/qcrgrgiyqxaqzzqrauzl/auth/users) 可查看/添加/删除用户

## 数据安全

- 数据通过 Supabase RLS（行级安全）隔离，每人只能读写自己的数据
- 照片存储在 Supabase Storage，仅登录用户可上传
- 离线数据存储在浏览器 IndexedDB，不会上传到第三方

## 部署

```
cloud/
├── index.html        # 主页面
├── auth.js           # 登录/注册
├── db.js             # 数据层 + 离线同步
├── supabase.js       # Supabase 客户端配置
├── supabase.min.js   # Supabase SDK（本地化）
├── chart.umd.min.js  # Chart.js（本地化）
├── sw.js             # Service Worker
├── manifest.json     # PWA 配置
├── schema.sql        # 数据库建表参考
├── CNAME             # 自定义域名
├── data/hotspots.js  # 热点数据
└── icons/            # PWA 图标
```
