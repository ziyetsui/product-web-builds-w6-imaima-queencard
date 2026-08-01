# Trumpcard Instruction

## 元数据

- 工作流：`w6`
- 产品目录：`w6/trumpcard/trumpcard/`
- Instruction 来源：`.chats/w6.md`
- 关联审查结果：`specs/w6/0002-trumpcard-code-review.md`
- 规格文件：`specs/w6/0001-trumpcard-instruction.md`
- 创建日期：`2026-06-12`
- Artifact role：`instruction`

## 命名说明

根据 `.rules/spec-ledger-naming-rules.md` 的手动 spec chain 公式：

```text
specs/{scope}/000N-{project-slug}-{artifact-type}.md
```

本文件命名为：

```text
specs/w6/0001-trumpcard-instruction.md
```

命名含义：

- `w6`：所属 workstream
- `0001`：先记录驱动本轮工作的 instruction
- `trumpcard`：项目 slug
- `instruction`：用于驱动 code review 的 instruction/prompt 记录

## Instruction

```markdown
# instruction

## code review

先扫描现状，第一步：AI 考古。先利用 Agent 的强阅读能力，为你生成一份“现状地图”。

20-29 Product and Web Builds/w6/trumpcard/trumpcard 请分析这个文件夹的代码逻辑。不要修改代码，请告诉我：目前的业务流程是什么？如果我要修改 X 功能，会有哪些潜在的模块受到影响？请列出所有依赖。

##
```

## 使用边界

- 这是 code review 的驱动 instruction，不是应用代码。
- 稳定代码审查结果位于 `specs/w6/0002-trumpcard-code-review.md`。
- 本文件仅记录这次审查如何被发起，便于后续复盘、复用或对比不同 agent 的输出。







## 总体策略步骤 

第一步：AI 考古。先利用 Agent 的强阅读能力，为你生成一份“现状地图”。

Prompt 示例：
“@FileA @FileB 请分析这两个文件的代码逻辑。不要修改代码，请告诉我：目前的业务流程是什么？如果我要修改 X 功能，会有哪些潜在的模块受到影响？请列出所有依赖链。”

产出：
一份 Markdown 格式的 refactor-analysis.md。这是你的手术方案。

第二步：建立安全网：
这是最容易被忽略的一步。在修改旧逻辑之前，先让 Agent 为旧逻辑写测试。

Prompt 示例：
“针对已有的 XXX 功能，请确保当前单元/集成测试的完备性，尤其是各种边界条件。确保这些测试在当前代码下全部通过。”

目的：
锁定现状。一旦后续改造导致这些测试变红，你就知道 Agent 破坏了原有功能。

第三步：
为改造任务生成 PRD -> Design -> impl/Test plan -> Execute -> Test -> PR

5. 对于偏业务驱动、规则复杂的开发场景，可否引入 AI 工作流来辅助或自动化部分处理？AI 在此类系统中能贡献多少价值？边界如何判断？若要构建这样的 AI 工作流，整体设计应从哪些步骤入手？

[Tyr]
这绝对是 Agentic Coding 最能大展拳脚，也是最能产生“代际差”效率提升的领域。一个反直觉的结论：业务规则越复杂，AI 的价值越高。因为 AI 本质上是一个“语义翻译器”，而复杂业务开发的最大痛点，正是“业务语言”与“编程语言”之间的语义鸿沟。

步骤和之前的流程无异。注意把规则文档化。

6. 希望课程可以更多的聚焦在 AI 编程的研发全流程层面，比如：
有赞 AI 研发全流程落地实践 - 53AI-AI知识库｜企业AI知识库｜大模型知识库｜AIHub ...
工作流 devops 流程中，怎么可以以全流程视角通过这些 AI 工具去为工作赋能。




## 手术需求描述 

我现在告诉你我想要 改什么 ， 然后你可以模仿陈天老师， 如果你是陈天老师，你会怎么做？ 怎么去制定这个手术方案 ？ 

--- 

1、 我现在没有生成 页面 http://localhost:8080/prompts，  https://raphael.app/  想像 raphael   一样， 回弹提示词后， 跳转生成页面  ，  重要的参数，  选模型、 选尺寸、 语言、 张图 就行 ， 生成后支持下载，导出 
2 、 首页的hero section 组件  需要修改， 目前没有 参数选择 和 生成组件 
3、 没有接模型 ， 初步想接的几个模型 
--- 
GPT 和 Gemini的 svg图标放反了
这里是其他几个模型的svg，可以加上
seedream （没找到，AI生成一个）
grok: [https://uxwing.com/grok-ai-icon/](https://uxwing.com/grok-ai-icon/)
hunyuan： [https://lobehub.com/zh/icons/hunyuan](https://lobehub.com/zh/icons/hunyuan)

这些模型要支持 图生图 （垫图） 的功能 
补充了Gemini，效果 GPT image2 ＞  Gemini 3.1flash ＞ seedream-5-0-260128、doubao-seedream-5-0-260128 ＞ grok-imagine-image＞ wan-2.5 ＞  kling-image-o1，差距主要体现在对复杂内容的理解呈现+中文支持上   
可以在 gptproto  https://gptproto.com/model?tags=text-to-image  选择 
可以选这几个 
然后需要 进行 api 测试 

4、 不知道有没有后端  
5、 顶部tab 有点乱  
6、 解决 vpn 的问题 ，部署海外的网站 ， 国内用户是否可以用 
7、 增加更多的模版  
8 、支付需要支持国内支付 ， 需要支持 支付宝 或者 微信 stripe 是否可以 或者其他？ 
9 、 商业化定价与积分 ， 你可以从这个  这个repo 去找 应该有个定价 skill  [zifeixu85/videofly-template](https://github.com/zifeixu85/videofly-template) ， https://docs.videofly.app/docs/config/price  ， https://docs.videofly.app/docs/pricing



## 实施阶段


**本轮先改**
1. **测试安全网**
   先补测试，锁住当前正确行为，避免后面重构越改越乱。

2. **支付主路径**
   收敛 Billing Provider 到 Stripe-first，隔离 Creem；修 Stripe checkout、return URL、webhook、Customer 同步。

3. **登录可用性**
   Google 登录按配置显示；未配置就隐藏。Magic link 保持主路径，失败要有明确提示。

4. **生产安全口**
   Admin credit API 加生产保护，默认不暴露测试接口。

5. **外部生成入口**
   固化 `tryUrl` contract，明确当前只是跳外部生成页，不做本地扣积分生成。

**下轮再改**
1. **本地生成闭环**
   做真正的 image generation task、生成状态、结果页、扣费/退款闭环。

2. **积分模型升级**
   把现在偏 video 的 credit hold 改成通用 task credit hold，支持 image/video 等任务类型。

3. **数据库历史清理**
   清理 Creem 遗留表、旧 schema、历史配置，但要在 migration baseline 稳定之后做。

4. **会员中心 / Dashboard**
   做用户自己的套餐、积分、订单、生成历史、订阅管理页面。

5. **Prompt Library 深化**
   重构案例数据结构、分类、搜索、推荐、收藏、复用工作流。

一句话：本轮是 **止血和收口**，下轮是 **产品闭环和系统升级**。




## 下一步

用途：在真正改代码前，审查 0005 这个 implementation plan 有没有依赖倒置、任务过大、测试缺口、支付/登录/积分边界不清的问题。
顺序我建议这样：
0003-trumpcard-refactor-analysis.md
-> 0004-trumpcard-test-safety-net.md
-> 0005-trumpcard-implementation-plan.md
-> 0006-trumpcard-implementation-plan-review.md   # 下一步
-> 0007-trumpcard-implementation-tasks.md         # 通过 review 后再拆任务
-> 0008-trumpcard-code-review.md                  # 实现后审查代码




## 定价、支付与积分系统 

这是两个skill 或者方法论 ：  

1、 如何定价 https://docs.videofly.app/docs/pricing  

这里涉及到我要选择的生图模型 ：  GPT-Image-2-All 、 Nano Banana 2 生图/编辑 、 Seedream 5.0 等系列
生图模型的api ：   你可以参考的 api文档  https://api.apiyi.com/token
生图模型的api 测试：  https://docs.apiyi.com/api-capabilities/seedream-image/historical-versions

GPT-Image-2-All 生图
curl --request POST \
  --url https://api.apiyi.com/v1/images/edits \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: multipart/form-data' \
  --form model=gpt-image-2-all \
  --form 'prompt=把图1的人物放进图2的场景，参考图3的画风' \
  --form 'image=<string>' \
  --form image.items='@example-file'



Nano Banana 2 生图/编辑
curl --request POST \
  --url https://api.apiyi.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "contents": [
    {
      "parts": [
        {
          "text": "把这两张图里的人物合成到同一个办公室场景中，做着搞怪表情"
        },
        {
          "inlineData": {
            "mimeType": "image/png",
            "data": "<BASE64_DATA_IMG_1>"
          }
        },
        {
          "inlineData": {
            "mimeType": "image/png",
            "data": "<BASE64_DATA_IMG_2>"
          }
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": [
      "IMAGE"
    ],
    "imageConfig": {
      "aspectRatio": "16:9",
      "imageSize": "2K"
    }
  }
}
'

Seedream 5.0 等系列
curl --request POST \
  --url https://api.apiyi.com/v1/images/generations \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "seedream-5-0-260128",
  "prompt": "Replace the clothing in image 1 with the outfit from image 2."
}
'


 API KEY
请把 Key 放到 .env.local 里。


2、 想清楚付费思路 ：
 匿名用户、  已登录用户、 付费用户   （月付费和年付费）  
 匿名用户， 必须登录 ， 登录完必须买积分才能使用 

积分数和图片下载分别是多少 ？ 

https://docs.videofly.app/docs/pricing  你可以根据这个文档 帮我制定产品定价方案 

成本参考： 你可以参考的 api文档  https://api.apiyi.com/token
  https://docs.apiyi.com/api-capabilities/seedream-image/historical-versions

每一个模型每一张多少钱 ？  怎么扣积分规则？  不同订阅积分能生多少张图？ 


利润多少？ 
最终定价以及对应积分多少 ？  




3、支付配置
用 stripe mcp ， 需要支持 支付宝和微信  




