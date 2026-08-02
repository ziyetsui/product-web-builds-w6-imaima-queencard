#  Deployment Spec


##  新建分支

我新建分支的目的应该是“克隆到”：

首先让 GitHub 去找我所有的分支，它是能找到的。然后我让它克隆下来，Git 到我的本地，帮我新建一个分支。

接着我要进行修改，它就会帮我新建一个分支，其实还挺快的。  然后用 LazyGit 打开 LazyGit 的面板，切到这个分支，我就可以看到所有的命令。  


## 修改feature 

### 修改输入框内的提示词

这里我其实要和 ChatGPT 进行聊天。

一种是锁定所有的风格，然后只变文案，这是其中一种；但我更希望它能够生成的是一种完全复刻这个爆款的方式：我给出一个相近的主题，它完全按照这个爆款风格再生成一组组图，我觉得这样可能会更好。 但我试了一下，我并不知道该怎么去修改提示词。所以我第一个要做的，就是需要和 ChatGPT 去进行沟通，看看它能给我的提示词效果是什么样子的。


描述我的问题：
你好，我想跟你描述一下我的问题。

我现在在做一个小红书复刻爆款的网站。假设我目前已经从网站上爬取了很多小红书爆款的图文，我希望用户通过我这个网站能实现这样一个目的：

用户点击某一个帖子（包含爬取出来的图片、标题、文案等），这些内容就会回弹到上方的输入框中。接着，利用我目前内嵌的 ChatGPT Image 2.0 模型，用户只需要输入一些变量——比如提示词、主标题、副标题等，点击生成，就能实现类似的复刻爆款效果。

我希望它呈现出一种“填空题”的形式。也就是说，用户只需要做一点填空，比如改变一个主题或输入一个相近的主题，然后利用模型自身的能力，就能生成一张风格差不多、但符合用户自身需求的图片，从而实现模仿和复刻爆款的效果。

我不知道我这么说你能不能理解，反正我现在卡在了这一步。我不知道该给用户提供什么样的提示词，或者说应该设计什么样的提示词让模型去理解，进而改成我想要的效果，让用户实现这样的操作。

不知道我是否描述清楚了？



---  


chatgpt给的回答：
我完全理解，而且我觉得你真正想做的不是「图片生成」产品，而是「爆款 Pattern（模式）复用」产品。

实际上，你现在卡住的地方不是 Prompt，而是抽象层级。

⸻

现在大多数 AI 生图产品都是这样

用户：

帮我生成一个小红书封面

↓

Prompt

↓

Image Model

↓

图片

⸻

而你真正想做的是

爆款帖子
      │
      ▼
Pattern Extraction（自动提炼）
      │
      ▼
Variable Filling（用户填空）
      │
      ▼
Image Prompt
      │
      ▼
ChatGPT Image 2
      │
      ▼
新的爆款

所以Prompt不是给用户写的。

Prompt 是给 Image Model 的。

用户只是在填写变量。

这是两个完全不同的东西。

⸻

我建议你把整个 Prompt 分成两层。

第一层（用户能看到）

永远只有几个变量。

例如你的鸡这个例子。

原图：

鸡伤心的时候会变成什么？

答案：

emo ji

那么用户真正应该填什么？

其实只有：

主题
鸡
↓
熊猫

或者

主题
动物
↓
程序员

或者

双关词
emoji
↓
404

甚至

想表达
冷笑话
职场
互联网
程序员
情侣

他根本不用写Prompt。

⸻

所以前端看到的是：

主题
__________
副标题
__________
风格
冷笑话

结束。

⸻

第二层（隐藏 Prompt）

这个才是送给 GPT Image 的。

例如：

这是一个参考作品。
请不要复制原图。
请学习：
- 节奏
- 画面构图
- 留白
- 反差包袱
- 文案节奏
- 手绘风格
- 漫画形式
- 标题语气
不要学习：
- 原始主题
- 原始文案
- 原始角色
请保持：
两格漫画
第一格：
提出一个问题。
第二格：
出现一个具有双关语的答案。
新的主题：
{{topic}}
新的关键词：
{{keyword}}
新的笑点：
{{joke}}
输出新的漫画。

注意。

这里用户一句Prompt都没写。

⸻

其实还可以继续往上一层。

这一层才是真正牛逼的。

不是 Prompt。

而是 Pattern。

例如：

你的鸡案例。

真正的 Pattern 是：

Question
↓
Expectation
↓
Unexpected Meaning Shift
↓
Emoji

也就是

Setup
↓
Wordplay
↓
Visual Punchline

所以数据库里保存的应该不是 Prompt。

而是：

Pattern Name
Emoji Pun
Pattern
Question
↓
Word Transformation
↓
Emoji
Variables
topic
keyword
pun

以后换任何内容都能生成。

⸻

所以数据库应该长这样。

例如：

Template
ID
0001
Name
Emoji Pun
Reference
鸡伤心的时候
Variables
topic
emotion
emoji
System Prompt
....

以后用户点一下。

看到的是：

主题
______
情绪
______
最终梗
______

点生成。

结束。

⸻

再举一个更复杂的小红书例子。

例如这个封面。

普通人千万别学AI
因为会......

真正Pattern不是：

普通人千万别学AI

而是：

禁止
↓
制造焦虑
↓
反转
↓
给收益

所以变量应该是：

主题
AI
↓
减肥
↓
英语
↓
副业
↓
健身

Prompt永远不用变。

⸻

所以我建议你的数据库不要存 Prompt。

而要存：

Reference
↓
Pattern
↓
Variables
↓
Prompt Template

例如：

{
 id
 reference
 dna
 variables
 image_prompt
}

其中：

dna
{
layout
two panel
style
hand drawing
hook
question
twist
pun
visual
simple
}

真正生成Prompt的时候：

Prompt
=
Prompt Template
+
Variables
+
Reference DNA

而不是：

Prompt = 用户输入

⸻

我甚至建议你做一个「DNA 抽取器」。

这是整个产品最值钱的部分。

用户点一个爆款以后，不是直接把图片塞进 Prompt。

而是后台先自动分析：

Visual DNA
版式
颜色
字体
留白
主体位置
人物比例
画风
--------
Content DNA
Hook
情绪
反差
CTA
价值
--------
Generation Variables
主标题
副标题
主体
行业
人物
颜色
数字
品牌

最后生成一个 JSON：

{
  "style": {
    "layout": "two_panel",
    "illustration": "simple_hand_drawn",
    "background": "#8ec9f5",
    "stroke": "thick_black",
    "font": "bold"
  },
  "content": {
    "pattern": "Question → Pun → Reveal",
    "hook": "提出问题",
    "ending": "双关词",
    "emotion": "轻松搞笑"
  },
  "variables": [
    "topic",
    "title",
    "subtitle",
    "keyword",
    "pun",
    "emoji"
  ]
}

以后所有 Prompt 都是根据这个 JSON 自动拼出来。

⸻

我觉得你的产品真正的竞争壁垒，不会是「Prompt 库」。

而会是一个四层架构：

爆款帖子
      │
      ▼
① 爆款 DNA（自动解析）
      │
      ▼
② 变量（用户填空）
      │
      ▼
③ Prompt Composer（自动组装 Prompt）
      │
      ▼
④ GPT Image 2（生成）

用户永远不应该面对 Prompt。

用户面对的是「填空题」；Prompt 是系统内部的中间语言。

⸻

我甚至建议把整个网站升级成一个”Pattern Engine（模式引擎）”：

* Pattern Layer：每个爆款先抽取视觉 DNA + 内容 DNA + 可编辑变量。
* Variable Layer：用户只填写 3～8 个变量（主题、标题、副标题、人物、品牌、数字等）。
* Prompt Layer：系统根据 DNA 自动组装完整 Prompt，并将参考图一起发送给 ChatGPT Image 2。
* Generation Layer：模型负责补全所有细节，输出复刻度高但主题已替换的新作品。

这样，你卖给用户的就不是「提示词」，而是一个可以无限复用的爆款模板系统。这也是比单纯的 Prompt 市场更有长期价值的产品方向。


### 测试不同模型生成效果





### 修改支付链路 



### 修改admin  




