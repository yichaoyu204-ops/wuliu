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
    "waybillNo": { "val": "运单号如26MH642064，一般在进仓单顶部，格式为年份缩写+MH+数字", "manualReview": false },
    "pieces": { "val": "件数数字", "unit": "单位如CTNS/CARTONS/PLTS/件（CTNS和CARTONS等价）", "manualReview": false },
    "weight": { "val": "毛重数字", "unit": "KGS/LBS", "manualReview": false },
    "volume": { "val": "体积数字", "unit": "CBM", "manualReview": false },
    "marks": { "val": "唛头", "manualReview": false }
  },
  "routing": {
    "warehouseName": { "val": "仓库名称", "manualReview": false },
    "warehouseAddress": { "val": "仓库地址", "manualReview": false },
    "entryTime": { "val": "进仓时间ISO格式", "manualReview": false },
    "departureTime": { "val": "预计开航日期如2026-04-22", "manualReview": false },
    "destinationPort": { "val": "目的港如宁波港", "manualReview": false },
    "latestDeliveryTime": { "val": "最晚进仓时间如2026-04-25 14:30，同义词：进仓时间截止、最晚送达", "manualReview": false }
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
2. 日期时间格式：YYYY-MM-DD HH:mm，无法识别则val为null
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
      id: 'route_yw_mh_hub',
      name: '义乌→萌恒仓库（经义乌中转仓）',
      description: '标准路线：工厂→义乌中转仓→萌恒仓库',
      nodes: [
        { code: 'pickup', name: '工厂提货', minDuration: 1, maxDuration: 3, template: '已提货，运输至义乌中转仓，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
        { code: 'yiwu_entry', name: '义乌中转仓入库', minDuration: 0.5, maxDuration: 1, template: '已入库义乌中转仓，准备发运', icon: 'warehouse', editable: true },
        { code: 'mainline', name: '干线运输', minDuration: 3, maxDuration: 5, template: '运输中，萌恒仓库方向，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck', editable: true },
        { code: 'queue', name: '仓库排队', minDuration: 0.25, maxDuration: 2, template: '已到达萌恒仓库，绿色通道排队中', icon: 'clock', editable: true },
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
        { code: 'queue', name: '仓库排队', minDuration: 0.25, maxDuration: 2, template: '已到达北仑仓库，绿色通道排队中', icon: 'clock', editable: true },
        { code: 'nb_entry', name: '入库完成', minDuration: 0, maxDuration: 0, template: '已完成入库北仑仓库，等待报关', icon: 'check-circle', editable: false }
      ]
    },
    {
      id: 'route_yw_mh_direct',
      name: '义乌→萌恒仓库（工厂直发）',
      description: '直达路线：工厂不经义乌中转仓，直发萌恒仓库',
      nodes: [
        { code: 'pickup', name: '工厂提货', minDuration: 4, maxDuration: 6, template: '已提货，直接发往萌恒仓库，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
        { code: 'queue', name: '仓库排队', minDuration: 0.25, maxDuration: 2, template: '已到达萌恒仓库，绿色通道排队中', icon: 'clock', editable: true },
        { code: 'nb_entry', name: '入库完成', minDuration: 0, maxDuration: 0, template: '已完成入库萌恒仓库，等待报关', icon: 'check-circle', editable: false }
      ]
    },
    {
      id: 'route_yw_bl_direct',
      name: '义乌→北仑方向其他仓库（工厂直发）',
      description: '直达路线：工厂不经义乌中转仓，直发北仑方向其他仓库',
      nodes: [
        { code: 'pickup', name: '工厂提货', minDuration: 4, maxDuration: 6, template: '已提货，直接发往北仑仓库，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
        { code: 'queue', name: '仓库排队', minDuration: 0.25, maxDuration: 2, template: '已到达北仑仓库，绿色通道排队中', icon: 'clock', editable: true },
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
