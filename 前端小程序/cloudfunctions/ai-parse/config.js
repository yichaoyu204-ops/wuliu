/**
 * 全局配置 - 所有可配置项集中在此
 * 修改此文件不会影响历史数据，只会影响新创建的货物
 */

module.exports = {
  // ============================================
  // AI 识别配置 - 可修改
  // ============================================
  kimi: {
    // API Key从环境变量读取，安全不泄露
    apiKey: process.env.KIMI_API_KEY || '',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-32k-vision-preview',
    fallbackModels: [
      'moonshot-v1-8k-vision-preview',
      'moonshot-v1-128k-vision-preview'
    ],
    timeout: 20000,

    // AI识别提示词
    prompt: `你是物流单证识别专家。请从进仓通知单图片中提取信息，输出JSON。

字段识别规则（严格按字段名对应，不要混淆）：

【shipmentInfo - 货物信息】
- warehouseEntryNo: 进仓编号/入仓号/仓库进仓编号，每张进仓单都会写出。通常在"进仓编号/入仓号/编号/仓库编号/NO./进仓单号/入仓单号/收货编号"附近，可能是纯数字、字母数字组合或带横杠/斜杠。典型样例：CPSNGOA26040464、MSF260156150、SH26MH273084。注意：SH26MH273084 这种前面带字母前缀的编号仍然是进仓编号，不是业务参与编号
- waybillNo: 单据最顶部一行/顶部红色数字里的业务参与编号，格式必须完整匹配"两位年份 + MH + 数字/字母"，如26MH642064、25MH123456。只识别以两位年份开头、紧跟连续大写"MH"的编号。不要把CPSNGOA26040464、MSF260156150、SH26MH273084、DSCGL260484137、货号、客户编码、箱唛、条码号、进仓编号识别为业务参与编号。如果顶部看不清或找不到YYMH开头编号，val填null并标记manualReview为true
- pieces: 件数，如146。看表格中"件数/数量/PCS"列
- weight: 毛重/重量，带KG/KGS/LBS单位，如2551KG。看表格中"重量/毛重"列，数字通常较大
- volume: 体积/立方数，带CBM单位，如6CBM。看表格中"体积/立方"列，数字通常较小（一般<100）
- marks: 唛头，跨多行要合并为一行。没有则填null

【routing - 路线信息】
- warehouseName: 仓库名称，如"海通安达/乐祎仓库/顺航仓库/其他仓库"
- warehouseAddress: 仓库地址，有则填，没有则null
- destinationPort: 目的港，如"SANTOS, BRAZIL"
- departureTime: 预计开航日/ETD，格式YYYY-MM-DD。注意：开航时间一定在截仓时间之后！如果单据上有多个日期，带"开航/ETD/预计开航"字样的才是开航时间
- latestDeliveryTime: 最晚进仓时间/截仓时间，格式YYYY-MM-DD HH:mm。注意：截仓时间一定在开航时间之前！通常带"截仓/截止/最晚进仓"字样

【contacts - 联系人】
- factoryName: 工厂名称/发货人
- contactPerson: 联系人姓名
- contactPhone: 联系电话

重要规则：
1. 重量和体积不要混淆：重量带KG/KGS单位（数值通常上千），体积带CBM单位（数值通常是个位数或几十）
2. 开航时间(ETD)和截仓时间不要混淆：开航时间一定晚于截仓时间。如果识别结果不满足这个逻辑，说明搞混了，请重新判断
3. 唛头跨多行要合并为一行
4. 同一信息在单据上多处出现（如目的港和目的国相同），只识别一次
5. 日期格式：YYYY-MM-DD，时间格式：YYYY-MM-DD HH:mm
6. 数字和单位连在一起（如2551KG、6CBM、146CTNS）时，要分离数字和单位
7. 业务参与编号必须完整匹配正则：^\\d{2}MH[A-Z0-9]+$。看到类似CPSNGOA26040464、MSF260156150、SH26MH273084、DSCGL260484137，绝对不要填入waybillNo；其中SH26MH273084虽然包含26MH，但前面有SH字母前缀，属于进仓编号
8. 进仓编号是独立字段 warehouseEntryNo，不能因为没有MH就丢弃；如果看到"进仓编号/入仓号/进仓单号/入仓单号/收货编号/NO."旁边的编号，要填入warehouseEntryNo
9. 如果看不清字段标签，也要从图片顶部、表头、右上角、条码/二维码附近找一个最像进仓编号的编号；不能填日期、手机号、件数、重量、体积、目的港、业务参与编号
10. 同时输出 waybillNoCandidates，把单据上所有完整匹配"两位年份 + MH + 数字/字母"的业务参与编号候选都列出来；同时输出 allVisibleCodes，把单据上所有看得见的编号/代码都列出来，方便系统兜底选择进仓编号和业务参与编号
11. 只输出JSON，不要任何其他文字

输出格式：
{
  "shipmentInfo": {
    "warehouseEntryNo": { "val": "...", "manualReview": false },
    "waybillNo": { "val": "...", "manualReview": false },
    "pieces": { "val": "...", "unit": "...", "manualReview": false },
    "weight": { "val": "...", "unit": "...", "manualReview": false },
    "volume": { "val": "...", "unit": "...", "manualReview": false },
    "marks": { "val": "...", "manualReview": false }
  },
  "waybillNoCandidates": ["..."],
  "allVisibleCodes": ["..."],
  "routing": {
    "warehouseName": { "val": "...", "manualReview": false },
    "warehouseAddress": { "val": "...", "manualReview": false },
    "destinationPort": { "val": "...", "manualReview": false },
    "departureTime": { "val": "YYYY-MM-DD", "manualReview": false },
    "latestDeliveryTime": { "val": "YYYY-MM-DD HH:mm", "manualReview": false }
  },
  "contacts": {
    "factoryName": { "val": "...", "manualReview": false },
    "contactPerson": { "val": "...", "manualReview": false },
    "contactPhone": { "val": "...", "manualReview": false }
  },
  "handwritingDetected": false,
  "pushSummary": "工厂简称/件数/重量/体积",
  "handwrittenFields": []
}`
  },

  // ============================================
  // 通义千问配置（Kimi 备选）
  // ============================================
  dashscope: {
    apiKey: process.env.DASHSCOPE_API_KEY || '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-vl-max',
    timeout: 20000
  },

  // ============================================
  // 微信配置 - 需要替换为实际值
  // ============================================
  wxTemplates: {
    // 在微信公众平台申请订阅消息模板后替换此处
    shipmentUpdate: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    // 报价确认通知模板（需单独申请，消息前缀 [待确认报价]）
    quoteConfirmation: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  },

  // 云函数超时配置
  functionConfig: {
    timeout: 60,      // 秒
    memorySize: 512   // MB
  },

  // ============================================
  // 路线模板配置 - 可随时增删改，不影响历史货物
  // ============================================
  // 注意：修改此处只会影响新创建的货物，历史货物保持原路线不变
  defaultRoutes: [
    {
      id: 'route_yw_haitong_anda',
      name: '义乌→海通安达',
      description: '标准路线：工厂→义乌中转仓→海通安达',
      nodes: [
        { code: 'pickup', name: '工厂提货', minDuration: 1, maxDuration: 3, template: '已提货，运输至义乌中转仓，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
        { code: 'yiwu_entry', name: '义乌中转仓收货', minDuration: 0.5, maxDuration: 1, template: '义乌中转仓已收货，准备发运', icon: 'warehouse', editable: true },
        { code: 'mainline', name: '干线运输', minDuration: 3, maxDuration: 5, template: '运输中，海通安达方向，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck', editable: true },
        { code: 'nb_entry', name: '已进入目标仓库', minDuration: 0, maxDuration: 0, template: '已进入目标仓库，等待报关', icon: 'check-circle', editable: false }
      ]
    },
    {
      id: 'route_yw_leyi_warehouse',
      name: '义乌→乐祎仓库',
      description: '标准路线：工厂→义乌中转仓→乐祎仓库',
      nodes: [
        { code: 'pickup', name: '工厂提货', minDuration: 1, maxDuration: 3, template: '已提货，运输至义乌中转仓，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
        { code: 'yiwu_entry', name: '义乌中转仓收货', minDuration: 0.5, maxDuration: 1, template: '义乌中转仓已收货，准备发运', icon: 'warehouse', editable: true },
        { code: 'mainline', name: '干线运输', minDuration: 3, maxDuration: 5, template: '运输中，乐祎仓库方向，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck', editable: true },
        { code: 'nb_entry', name: '已进入目标仓库', minDuration: 0, maxDuration: 0, template: '已进入目标仓库，等待报关', icon: 'check-circle', editable: false }
      ]
    },
    {
      id: 'route_yw_shunhang_warehouse',
      name: '义乌→顺航仓库',
      description: '标准路线：工厂→义乌中转仓→顺航仓库',
      nodes: [
        { code: 'pickup', name: '工厂提货', minDuration: 1, maxDuration: 3, template: '已提货，运输至义乌中转仓，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
        { code: 'yiwu_entry', name: '义乌中转仓收货', minDuration: 0.5, maxDuration: 1, template: '义乌中转仓已收货，准备发运', icon: 'warehouse', editable: true },
        { code: 'mainline', name: '干线运输', minDuration: 3, maxDuration: 5, template: '运输中，顺航仓库方向，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck', editable: true },
        { code: 'nb_entry', name: '已进入目标仓库', minDuration: 0, maxDuration: 0, template: '已进入目标仓库，等待报关', icon: 'check-circle', editable: false }
      ]
    },
    {
      id: 'route_yw_other_warehouse',
      name: '义乌→其他仓库',
      description: '标准路线：工厂→义乌中转仓→其他仓库',
      nodes: [
        { code: 'pickup', name: '工厂提货', minDuration: 1, maxDuration: 3, template: '已提货，运输至义乌中转仓，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
        { code: 'yiwu_entry', name: '义乌中转仓收货', minDuration: 0.5, maxDuration: 1, template: '义乌中转仓已收货，准备发运', icon: 'warehouse', editable: true },
        { code: 'mainline', name: '干线运输', minDuration: 3, maxDuration: 5, template: '运输中，其他仓库方向，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck', editable: true },
        { code: 'nb_entry', name: '已进入目标仓库', minDuration: 0, maxDuration: 0, template: '已进入目标仓库，等待报关', icon: 'check-circle', editable: false }
      ]
    }
  ],

  // ============================================
  // 费用标准配置 - 可随时修改，不影响历史货物
  // ============================================
  // 注意：修改此处只会影响新创建的货物
  defaultFees: {
    baseTransport: {
      name: '进仓运费',
      unit: '元',
      calculationType: 'manual'
    },
    collection: {
      name: '代收款',
      unit: '元',
      calculationType: 'manual'
    },
    pickup: {
      name: '上门提货费',
      basePrice: 50,
      unit: '元/次',
      calculationType: 'fixed'
    },
    storage: {
      name: '集货点堆存费',
      unitPrice: 50,
      unit: '元/票/天',
      calculationType: 'manual',
      freeDays: 5
    },
    relabel: {
      name: '贴唛改唛费',
      unitPrice: 2,
      unit: '元/件',
      calculationType: 'per_piece'
    },
    beilunDistribution: {
      name: '北仑分拨费',
      basePrice: 120,
      unit: '元/票',
      calculationType: 'fixed'
    },
    transfer: {
      name: '转运费',
      unit: '元',
      calculationType: 'manual'
    }
  },

  // ============================================
  // 响应码配置 - 一般无需修改
  // ============================================
  codes: {
    SUCCESS: 0,
    ERROR: 1,
    NOT_FOUND: 404,
    UNAUTHORIZED: 401,
    PARAM_ERROR: 400
  }
};
