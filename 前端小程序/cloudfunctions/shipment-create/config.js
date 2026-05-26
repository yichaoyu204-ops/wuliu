/**
 * 全局配置 - 所有可配置项集中在此
 * 修改此文件不会影响历史数据，只会影响新创建的货物
 */

module.exports = {
  // ============================================
  // 响应码配置 - 一般无需修改
  // ============================================
  codes: {
    SUCCESS: 0,
    ERROR: 1,
    NOT_FOUND: 404,
    UNAUTHORIZED: 401,
    PARAM_ERROR: 400
  },

  // 路线模板配置 - 修改此处只会影响新创建的货物，历史货物保持原路线不变
  defaultRoutes: [
    {
      id: 'route_yw_haitong_anda',
      name: '义乌→海通安达',
      description: '标准路线：工厂→义乌中转仓→海通安达',
      nodes: [
        { code: 'pickup', name: '工厂送货/上门提货', minDuration: 1, maxDuration: 3, template: '已提货，运输至义乌中转仓，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
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
        { code: 'pickup', name: '工厂送货/上门提货', minDuration: 1, maxDuration: 3, template: '已提货，运输至义乌中转仓，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
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
        { code: 'pickup', name: '工厂送货/上门提货', minDuration: 1, maxDuration: 3, template: '已提货，运输至义乌中转仓，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
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
        { code: 'pickup', name: '工厂送货/上门提货', minDuration: 1, maxDuration: 3, template: '已提货，运输至义乌中转仓，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
        { code: 'yiwu_entry', name: '义乌中转仓收货', minDuration: 0.5, maxDuration: 1, template: '义乌中转仓已收货，准备发运', icon: 'warehouse', editable: true },
        { code: 'mainline', name: '干线运输', minDuration: 3, maxDuration: 5, template: '运输中，其他仓库方向，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck', editable: true },
        { code: 'nb_entry', name: '已进入目标仓库', minDuration: 0, maxDuration: 0, template: '已进入目标仓库，等待报关', icon: 'check-circle', editable: false }
      ]
    }
  ]
};
