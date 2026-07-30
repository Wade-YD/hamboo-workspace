// 热点速报数据（每日更新）
var HOTSPOT_DATA = {
  updatedAt: "2026-07-30",
  briefing: "今日新媒体热点聚焦：科技圈动态、内容创作趋势、平台政策变化。选题建议基于当前热点自动生成，点击「收藏」加入选题库。",
  platforms: [
    {
      platform: "小红书",
      items: [
        { rank: 1, title: "今日选题建议持续更新中", tag: "内容创作", heat: "9.8" },
        { rank: 2, title: "关注热点趋势，保持内容新鲜度", tag: "运营技巧", heat: "9.5" },
        { rank: 3, title: "平台算法新变化解读", tag: "平台政策", heat: "9.2" },
        { rank: 4, title: "爆款内容拆解与分析", tag: "案例分析", heat: "8.9" },
        { rank: 5, title: "创作者成长路径分享", tag: "成长", heat: "8.7" }
      ]
    }
  ],
  topics: [
    { title: "热点一：内容选题思路", platform: "小红书", angle: "从用户痛点出发，结合自身经验分享", format: "图文", priority: "高", ref: "#热点1" },
    { title: "热点二：运营技巧分享", platform: "小红书", angle: "数据支撑+实操案例", format: "图文", priority: "高", ref: "#热点2" },
    { title: "热点三：趋势解读", platform: "抖音", angle: "短视频快速反应热点", format: "短视频", priority: "中", ref: "#热点3" }
  ]
};
