-- 种子数据：20 岗位 + 2 prompt + 1 默认管理员
USE resume_app;

-- 默认管理员（先随便填一个 openid，等阶段 4 你自己登录后拿真实 openid 替换）
INSERT INTO `admins` (`openid`, `note`) VALUES
('REPLACE_WITH_YOUR_OPENID', '默认管理员，请在管理后台替换')
ON DUPLICATE KEY UPDATE `note` = VALUES(`note`);

-- Prompt 模板：简历生成
INSERT INTO `prompts` (`code`, `name`, `content`, `version`, `is_active`) VALUES
('resume_generate', '简历生成 Prompt（默认）',
'# 角色
你是一位资深 HR，专长把零散经历改写成有冲击力的简历段落。

# 任务
根据用户提供的资料，生成一份结构化中文简历，输出 Markdown。

# 用户资料
{user_form}

# 输出格式（严格遵守）
```markdown
# {{姓名}}

## 个人概况
- 期望城市：...
- 期望岗位：...
- 期望薪资：...K/月

## 教育背景
...

## 工作经历
...

## 技能清单
...

## 项目亮点
...
```

# 约束
- 篇幅 ≤ 600 字
- 用动词开头，避免空洞形容
- 技能点必须从用户资料里出现，不要编造', 1, 1),

('match_rerank', '岗位匹配精排 Prompt（默认）',
'# 角色
你是一位严格的求职顾问，评估候选人与岗位的匹配度。

# 候选人简历
{resume}

# 候选岗位列表（JSON）
{jobs}

# 输出格式（严格 JSON，无多余文字）
```json
{
  "results": [
    {"job_id": 1, "score": 85, "reason": "技能 5/5 命中，3 年经验匹配本科要求"}
  ]
}
```

# 规则
- 只评 list 里的岗位，不要新增
- score 范围 0-100，60 以下说明不推荐
- reason 一句话，≤ 30 字
- 严格 JSON 输出，不要 markdown 代码块包裹', 1, 1)
ON DUPLICATE KEY UPDATE `content` = VALUES(`content`);

-- 20 条岗位种子
INSERT INTO `jobs` (`title`, `company`, `city`, `salary_min`, `salary_max`, `degree_required`, `experience_required`, `skills_required`, `description_md`, `is_online`, `is_deleted`, `sort_weight`) VALUES
('前端工程师', '示例科技 A', '北京', 15, 25, '本科', '1-3年', JSON_ARRAY('JavaScript', 'Vue', 'React'), '负责公司核心产品前端开发，参与需求评审。', 1, 0, 0),
('后端工程师', '示例科技 A', '北京', 18, 30, '本科', '1-3年', JSON_ARRAY('Node.js', 'MySQL', 'Redis'), '负责 API 设计与实现，保证服务稳定性。', 1, 0, 0),
('全栈工程师', '示例科技 B', '上海', 20, 35, '本科', '3-5年', JSON_ARRAY('Node.js', 'React', 'PostgreSQL'), '独立负责中小项目全栈开发。', 1, 0, 10),
('数据分析师', '示例科技 C', '深圳', 12, 20, '本科', '应届', JSON_ARRAY('SQL', 'Python', 'Tableau'), '业务数据分析，输出周报。', 1, 0, 0),
('产品经理', '示例科技 C', '深圳', 15, 25, '本科', '3-5年', JSON_ARRAY('Axure', '用户调研', '数据分析'), '负责 B 端产品规划。', 1, 0, 0),
('UI 设计师', '示例设计 D', '杭州', 10, 18, '大专', '1-3年', JSON_ARRAY('Figma', 'Sketch', '动效'), '负责移动端 UI 设计。', 1, 0, 0),
('运营专员', '示例科技 E', '广州', 8, 12, '大专', '应届', JSON_ARRAY('文案', '社群运营', 'Excel'), '用户社群维护，活动策划。', 1, 0, 0),
('测试工程师', '示例科技 F', '北京', 12, 20, '本科', '1-3年', JSON_ARRAY('Selenium', 'Python', 'Postman'), '自动化测试脚本编写。', 1, 0, 0),
('DevOps 工程师', '示例科技 G', '上海', 20, 35, '本科', '3-5年', JSON_ARRAY('Docker', 'K8s', 'AWS'), 'CI/CD 流水线维护。', 1, 0, 5),
('算法工程师', '示例科技 H', '北京', 25, 40, '硕士', '1-3年', JSON_ARRAY('Python', 'PyTorch', 'NLP'), '推荐算法研发。', 1, 0, 0),
('iOS 开发', '示例科技 I', '深圳', 18, 30, '本科', '1-3年', JSON_ARRAY('Swift', 'Objective-C', 'iOS'), 'iOS App 开发与维护。', 1, 0, 0),
('Android 开发', '示例科技 I', '深圳', 18, 30, '本科', '1-3年', JSON_ARRAY('Kotlin', 'Java', 'Android'), 'Android App 开发与维护。', 1, 0, 0),
('市场营销', '示例科技 J', '上海', 10, 18, '本科', '1-3年', JSON_ARRAY('品牌推广', '文案', 'PPT'), '品牌营销方案策划。', 1, 0, 0),
('财务专员', '示例科技 K', '北京', 8, 15, '本科', '应届', JSON_ARRAY('Excel', '用友', '税务'), '日常账务处理。', 1, 0, 0),
('人力资源', '示例科技 K', '北京', 10, 18, '本科', '1-3年', JSON_ARRAY('招聘', '员工关系', '培训'), '负责招聘与员工关系。', 1, 0, 0),
('销售经理', '示例科技 L', '广州', 12, 25, '大专', '3-5年', JSON_ARRAY('客户开发', '谈判', 'CRM'), 'B 端客户开发与维护。', 1, 0, 0),
('内容编辑', '示例科技 M', '杭州', 8, 15, '本科', '应届', JSON_ARRAY('文案', '排版', '短视频'), '公众号内容生产。', 1, 0, 0),
('客服主管', '示例科技 N', '深圳', 10, 18, '大专', '3-5年', JSON_ARRAY('客服管理', '沟通', '培训'), '客服团队管理。', 1, 0, 0),
('Java 工程师', '示例科技 O', '上海', 18, 30, '本科', '3-5年', JSON_ARRAY('Java', 'Spring', 'MySQL'), '后端服务开发。', 1, 0, 0),
('架构师', '示例科技 P', '北京', 35, 60, '硕士', '5+年', JSON_ARRAY('架构设计', '分布式', '高并发'), '系统架构演进。', 1, 0, 0);
