/**
 * 全局配置 - 所有可配置项集中在此
 * 修改此文件不会影响历史数据，只会影响新创建的货物
 */

module.exports = {
  // ============================================
  // Kimi AI配置
  // ============================================
  kimi: {
    // API Key从环境变量读取，安全不泄露
    apiKey: process.env.KIMI_API_KEY || '',
    baseUrl: 'https://api.moonshot.cn/v1',
    // 多个视觉模型，按顺序尝试
    models: [
      'moonshot-v1-8k-vision-preview',
      'moonshot-v1-32k-vision-preview',
      'moonshot-v1-128k-vision-preview'
    ],
    timeout: 45000, // 45秒超时

    // AI识别提示词
    prompt: `你是物流单证识别专家。请从进仓通知单图片中提取信息，输出JSON。

字段识别规则（严格按字段名对应，不要混淆）：

【shipmentInfo - 货物信息】
- waybillNo: 单据最顶部一行/顶部红色数字里的业务编号，格式必须是"两位年份 + MH + 数字/字母"，如26MH642064、25MH123456。只识别包含连续大写"MH"的编号。不要把DSCGL、货号、客户编码、箱唛、条码号、进仓编号识别为业务编号。如果顶部看不清或找不到YYMH开头编号，val填null并标记manualReview为true
- pieces: 件数，如146。看表格中"件数/数量/PCS"列
- weight: 毛重/重量，带KG/KGS/LBS单位，如2551KG。看表格中"重量/毛重"列，数字通常较大
- volume: 体积/立方数，带CBM单位，如6CBM。看表格中"体积/立方"列，数字通常较小（一般<100）
- marks: 唛头，跨多行要合并为一行。没有则填null

【routing - 路线信息】
- warehouseName: 仓库名称，如"萌恒仓库"
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
7. 业务编号必须匹配正则：\\d{2}MH[A-Z0-9]+。看到类似DSCGL260484137这种没有MH的字符串，绝对不要填入waybillNo
8. 只输出JSON，不要任何其他文字

输出格式：
{
  "shipmentInfo": {
    "waybillNo": { "val": "...", "manualReview": false },
    "pieces": { "val": "...", "unit": "...", "manualReview": false },
    "weight": { "val": "...", "unit": "...", "manualReview": false },
    "volume": { "val": "...", "unit": "...", "manualReview": false },
    "marks": { "val": "...", "manualReview": false }
  },
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
    // API Key从环境变量读取
    apiKey: process.env.DASHSCOPE_API_KEY || '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-vl-max',
    timeout: 45000
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
      id: 'route_yw_mh_hub',
      name: '义乌→萌恒仓库（经义乌中转仓）',
      description: '标准路线：工厂→义乌中转仓→萌恒仓库',
      nodes: [
        { code: 'pickup', name: '工厂提货', minDuration: 1, maxDuration: 3, template: '已提货，运输至义乌中转仓，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
        { code: 'yiwu_entry', name: '义乌中转仓入库', minDuration: 0.5, maxDuration: 1, template: '已入库义乌中转仓，准备发运', icon: 'warehouse', editable: true },
        { code: 'mainline', name: '干线运输', minDuration: 3, maxDuration: 5, template: '运输中，萌恒仓库方向，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck', editable: true },
        { code: 'nb_entry', name: '入库完成', minDuration: 0, maxDuration: 0, template: '已完成入库萌恒仓库，等待报关', icon: 'check-circle', editable: false }
      ]
    },
    {
      id: 'route_yw_bl_hub',
      name: '义乌→北仑方向其他仓库（经义乌中转仓）',
      description: '标准路线：工厂→义乌中转仓→北仑方向其他仓库',
      nodes: [
        { code: 'pickup', name: '工厂提货', minDuration: 1, maxDuration: 3, template: '已提货，运输至义乌中转仓，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
        { code: 'yiwu_entry', name: '义乌中转仓入库', minDuration: 0.5, maxDuration: 1, template: '已入库义乌中转仓，准备发运', icon: 'warehouse', editable: true },
        { code: 'mainline', name: '干线运输', minDuration: 3, maxDuration: 5, template: '运输中，北仑方向，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck', editable: true },
        { code: 'nb_entry', name: '入库完成', minDuration: 0, maxDuration: 0, template: '已完成入库北仑仓库，等待报关', icon: 'check-circle', editable: false }
      ]
    },
    {
      id: 'route_yw_mh_direct',
      name: '义乌→萌恒仓库（工厂直发）',
      description: '直达路线：工厂不经义乌中转仓，直发萌恒仓库',
      nodes: [
        { code: 'pickup', name: '工厂提货', minDuration: 4, maxDuration: 6, template: '已提货，直接发往萌恒仓库，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
        { code: 'nb_entry', name: '入库完成', minDuration: 0, maxDuration: 0, template: '已完成入库萌恒仓库，等待报关', icon: 'check-circle', editable: false }
      ]
    },
    {
      id: 'route_yw_bl_direct',
      name: '义乌→北仑方向其他仓库（工厂直发）',
      description: '直达路线：工厂不经义乌中转仓，直发北仑方向其他仓库',
      nodes: [
        { code: 'pickup', name: '工厂提货', minDuration: 4, maxDuration: 6, template: '已提货，直接发往北仑仓库，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
        { code: 'nb_entry', name: '入库完成', minDuration: 0, maxDuration: 0, template: '已完成入库北仑仓库，等待报关', icon: 'check-circle', editable: false }
      ]
    }
  ],

  // ============================================
  // 费用标准配置 - 可随时修改，不影响历史货物
  // ============================================
  // 注意：修改此处只会影响新创建的货物
  defaultFees: {
    baseTransport: {
      name: '基础运费',
      basePrice: 500,        // 基础价格
      unit: '元/票',
      calculationType: 'fixed'  // fixed | per_weight | per_volume | per_piece
    },
    warehouse: {
      name: '仓储费',
      unitPrice: 5,          // 单价
      unit: '元/m³/天',
      calculationType: 'per_volume_per_day',
      freeDays: 3            // 免费天数
    },
    wrapping: {
      name: '缠货费',
      unitPrice: 2,
      unit: '元/件',
      calculationType: 'per_piece'
    },
    pickup: {
      name: '提货费',
      basePrice: 100,
      unit: '元/票',
      calculationType: 'fixed'
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
