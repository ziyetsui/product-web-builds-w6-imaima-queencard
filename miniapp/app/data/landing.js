const env = require("../config/env");

function asset(path) {
  return env.API_BASE_URL.replace(/\/$/, "") + "/miniapp-assets/" + path;
}

module.exports = {
  hero: {
    eyebrow: "参考图驱动 · 平台原生感 · 副业友好",
    titleLines: ["参考图一粘，", "爆款图文，", "快人一步。"],
    titleLineOne: "参考图一粘，",
    titleLineTwo: "爆款图文，",
    titleLineThree: "快人一步。",
    highlightWords: ["涨粉", "变现", "爆款", "出圈"],
    subtitle: "上传参考图，ima ima queencard 识别爆款版式与平台语感，快速生成成套小红书图文。",
    samplePrompt: "请参考这张小红书爆款图文的版式结构、标题语气、信息节奏和封面风格，围绕我的主题生成一组成套图文脚本，包含标题、封面文案、每页画面描述和最后一页互动提问。",
    badges: [
      { value: "10万+", label: "单日涨粉", tone: "pumpkin" },
      { value: "5W+", label: "月均变现", tone: "lemon" },
      { value: "30秒", label: "批量出图", tone: "lavender" },
    ],
  },
  contrast: {
    title: "你缺的不是灵感，是把爆款做快的工具",
    pain: {
      label: "现状",
      title: "真正劝退人的，是这套重流程",
      items: ["一张张拆参考图", "一页页写标题和文案", "一次次抽卡筛图", "反复手工调版式，还不像平台内容"],
    },
    solution: {
      label: "ima ima queencard 的做法",
      title: "从参考图直接到可发图文",
      items: ["参考图驱动，不从空白 prompt 开始", "抓版式结构和信息节奏", "平台语感贴近，不像 AI 海报", "成套生成，直接发、连续发、批量发"],
    },
    note: "很多人不是输在不会做内容，而是输在做内容太慢，慢到根本坚持不下去。",
  },
  steps: [
    { num: "01", title: "粘贴参考图", desc: "把你收藏的爆款图文直接粘进来，识别版式结构。" },
    { num: "02", title: "输入主题", desc: "告诉它你要做的方向和核心内容，几句话就够。" },
    { num: "03", title: "拿到成套图文", desc: "得到贴合平台语感的内容，可以直接发或继续批量出。" },
  ],
  proofs: [
    {
      img: asset("cases/proof-iron-lady.jpg"),
      value: "一天涨粉 2W",
      desc: "「铁血老太」人设号 · 单日爆款",
      tone: "lemon",
    },
    {
      img: asset("cases/proof-plog.jpg"),
      value: "月入 5W+",
      desc: "plog 博主 · 一个月 30+ 商单",
      tone: "seafoam",
    },
    {
      img: asset("cases/proof-growth.jpg"),
      value: "9W 新增粉丝",
      desc: "不露脸女性成长号 · 一个月",
      tone: "pumpkin",
    },
  ],
  marquee: ["参考图驱动", "成套图文", "平台原生感", "副业友好", "不从空白开始", "把爆款做快"],
  comparisons: [
    {
      type: "知识拆解型",
      tags: ["版式像", "语感对", "可批量"],
      inputImg: asset("cases/comparison-knowledge-input.jpg"),
      previewImgs: [asset("cases/comparison-knowledge-input.jpg")],
      outputImgs: [
        asset("cases/comparison-knowledge-1.jpg"),
        asset("cases/comparison-knowledge-2.jpg"),
        asset("cases/comparison-knowledge-3.jpg"),
      ],
    },
    {
      type: "情绪疗愈型",
      tags: ["版式像", "语感对", "可批量"],
      inputImg: asset("cases/comparison-emotion-input.jpg"),
      previewImgs: [asset("cases/comparison-emotion-input.jpg")],
      outputImgs: [
        asset("cases/comparison-emotion-1.jpg"),
        asset("cases/comparison-emotion-2.jpg"),
        asset("cases/comparison-emotion-3.jpg"),
      ],
    },
    {
      type: "清单种草型",
      tags: ["版式像", "语感对", "可批量"],
      inputImg: asset("cases/comparison-list-input.jpg"),
      previewImgs: [asset("cases/comparison-list-input.jpg")],
      outputImgs: [
        asset("cases/comparison-list-1.jpg"),
        asset("cases/comparison-list-2.jpg"),
        asset("cases/comparison-list-3.jpg"),
      ],
    },
  ],
  useCases: [
    { title: "知识拆解号", desc: "专业知识做成图文，更易被搜索收藏", tone: "white", image: asset("usecases/semiconductor.jpg") },
    { title: "情绪疗愈号", desc: "情感文案配套版式，更有阅读感", tone: "seafoam", image: asset("usecases/energy_field.jpg") },
    { title: "种草清单号", desc: "好物清单版式统一，更像测评博主", tone: "white", image: asset("usecases/autumn_items.jpg") },
    { title: "副业教程号", desc: "拆解经验输出，图文比视频更易起步", tone: "lemon", image: asset("usecases/liver_health.jpg") },
    { title: "本地获客号", desc: "门店、服务、活动图文，直接导流", tone: "white", image: asset("usecases/local_business.jpg") },
    { title: "海外 Carousel", desc: "同样的逻辑适配海外图文格式", tone: "seafoam", image: asset("usecases/overseas_carousel.jpg") },
  ],
};
