# Pi Study Helper开发文档草稿

### 大致格式:

参考pi-loop-graph-extension文件夹下的文档管理方式建立如下文档
docs/
    - 设计
        -该项目主要目标.md
        -README.md 设计文件夹下的内容,管理方式其余内容依次类推
    - 形态
        -README.md
    - 计划
        -README.md
    - 审查
        -README.md
    - 归档
        -README.md
    - 参考(new)
        -README.md
    - README.md

### 该项目目标基本内容:

在Pi review agent的基础上利用开发完成的pi-loop-graph-sdk
重构pi-review-agent所拥有功能,
并以loop engine的思维将功能串联组织为产品;
验证pi-loop-graph-sdk的实现,为sdk后续迭代以及正式版内容提出建议;

#### 具体实施建议:

1. 收集pi-review-agent以及pi-loop-graph-extension下的信息,利用基本实现目标,建立参考信息文档.
2. 反复讨论撮合设计文档体系与开发路线图
3. 仿照pi-loop-graph-extension文件夹下的内容建立Agent.md,docs文件
