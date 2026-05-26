/**
 * 全局配置 - 所有可配置项集中在此
 * 修改此文件不会影响历史数据，只会影响新创建的货物
 */

module.exports = {
  // ============================================
  // Kimi AI配置 - 可修改
  // ============================================
  kimi: {
    // API Key从环境变量读取，安全不泄露
    apiKey: process.env.KIMI_API_KEY || '',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k-vision-preview',
    timeout: 20000, // 20秒超时

    // AI识别提示词 - 可修改以优化识别效果
    prompt: `你是一个物流单证识别专家。请从进仓通知单图片中提取信息，并特别检测手写/涂改痕迹。

任务要求：
1. 提取以下字段，每个字段标注是否为手写/涂改（manualReview: true）
2. 如果发现手写修改，以手写的新数字为准
3. 如果某个字段有涂改痕迹或你有>30%不确定性，必须标记manualReview: true

输出JSON格式：
{
  "shipmentInfo": {
    "warehouseEntryNo": { "val": "进仓编号", "manualReview": false },
    "waybillNo": { "val": "业务参与编号", "manualReview": false },
    "pieces": { "val": "件数数字", "unit": "单位如CTNS/PLTS/件", "manualReview": false },
    "weight": { "val": "重量数字", "unit": "KGS/LBS", "manualReview": false },
    "volume": { "val": "体积数字", "unit": "CBM", "manualReview": false },
    "marks": { "val": "唛头", "manualReview": false }
  },
  "routing": {
    "warehouseName": { "val": "仓库名称", "manualReview": false },
    "warehouseAddress": { "val": "仓库地址", "manualReview": false },
    "entryTime": { "val": "进仓时间ISO格式", "manualReview": false },
    "departureTime": { "val": "预计开航ISO格式", "manualReview": false }
  },
  "contacts": {
    "factoryName": { "val": "工厂名称", "manualReview": false },
    "contactPerson": { "val": "联系人", "manualReview": false },
    "contactPhone": { "val": "联系电话", "manualReview": false }
  },
  "handwritingDetected": true,
  "pushSummary": "推送摘要（格式：工厂简称/件数单位/重量/体积）",
  "handwrittenFields": ["可能有手写的字段名列表"]
}

注意：
1. 只输出JSON，不要任何其他文字
2. 日期格式：2026-04-14T00:00:00Z，无法识别则val为null
3. 数字字段必须带unit，不要只返回数字
4. 全图只要有任何手写/涂改，handwritingDetected必须为true`
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
    timeout: 20,      // 秒
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
