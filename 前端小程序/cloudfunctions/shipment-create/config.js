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
      id: 'route_yw_mh_hub',
      name: '义乌→萌恒仓库（经义乌中转仓）',
      description: '标准路线：工厂→义乌中转仓→萌恒仓库',
      nodes: [
        { code: 'pickup', name: '工厂送货/上门提货', minDuration: 1, maxDuration: 3, template: '已提货，运输至义乌中转仓，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
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
        { code: 'pickup', name: '工厂送货/上门提货', minDuration: 1, maxDuration: 3, template: '已提货，运输至义乌中转仓，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
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
        { code: 'pickup', name: '工厂送货/上门提货', minDuration: 4, maxDuration: 6, template: '已提货，直接发往萌恒仓库，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
        { code: 'nb_entry', name: '入库完成', minDuration: 0, maxDuration: 0, template: '已完成入库萌恒仓库，等待报关', icon: 'check-circle', editable: false }
      ]
    },
    {
      id: 'route_yw_bl_direct',
      name: '义乌→北仑方向其他仓库（工厂直发）',
      description: '直达路线：工厂不经义乌中转仓，直发北仑方向其他仓库',
      nodes: [
        { code: 'pickup', name: '工厂送货/上门提货', minDuration: 4, maxDuration: 6, template: '已提货，直接发往北仑仓库，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
        { code: 'nb_entry', name: '入库完成', minDuration: 0, maxDuration: 0, template: '已完成入库北仑仓库，等待报关', icon: 'check-circle', editable: false }
      ]
    }
  ]
};
