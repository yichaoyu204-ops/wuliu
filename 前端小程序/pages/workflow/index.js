const app = getApp();

Page({
  data: {
    role: '',
    roleName: '',
    shipments: [],
    storedShipments: [],
    billShipments: [],
    completedShipments: [],
    loading: false,
    activeTab: 'pending',
    isSalesman: false,
    isAdmin: false,
    statusNameMap: {
      created: '已建单，待仓管员实测定价',
      measured_priced: '已实测定价，管理员同步确认中',
      admin_confirmed: '管理员已确认，待送达',
      billed: '账单已发送，待支付',
      completed: '流程已结'
    }
  },

  onLoad() {
    const role = wx.getStorageSync('userRole') || '';
    const roleNameMap = {
      salesman: '业务员',
      warehouse: '仓管员',
      admin: '管理员'
    };
    this.setData({
      role,
      roleName: roleNameMap[role] || role,
      isSalesman: role === 'salesman',
      isAdmin: role === 'admin'
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const role = wx.getStorageSync('userRole') || '';
      const isAdmin = role === 'admin';
      this.getTabBar().setData({ activeIndex: isAdmin ? 3 : 2 });
    }
    this.loadData();
  },

  async loadData() {
    const { role, isSalesman } = this.data;
    if (!role) {
      wx.showModal({
        title: '提示',
        content: '请先选择角色',
        showCancel: false,
        success: () => wx.reLaunch({ url: '/pages/role-select/index' })
      });
      return;
    }

    if (isSalesman) {
      this.loadMyShipments();
    } else {
      this.loadWorkflows();
    }
  },

  // 业务员：加载我的运单
  async loadMyShipments() {
    this.setData({ loading: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: { action: 'myShipments' }
      });

      if (res.result.code === 0) {
        const list = res.result.data?.list || [];
        const grouped = this.groupShipmentsByDate(list);
        this.setData({ groupedShipments: grouped });
      } else {
        wx.showToast({ title: res.result.message || '加载失败', icon: 'none' });
      }
    } catch (e) {
      console.error('加载我的运单失败:', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }

    // 同步更新 tabBar badge（业务员模式）
    this.updateBadge();

    this.setData({ loading: false });
  },

  // 按时间分组：按月（当年显示"X月"，跨年显示"YYYY年X月"）
  groupShipmentsByDate(list) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const monthMap = {};

    list.forEach(item => {
      const ts = item._createTime || item.createdAt || item.createTime;
      if (!ts) return;
      const date = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
      const itemStr = this.formatDate(date);
      const enriched = { ...item, _createTimeStr: itemStr };

      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const label = `${year}年${month}月`;
      const sortKey = `${year}-${month.toString().padStart(2, '0')}`;

      if (!monthMap[sortKey]) {
        monthMap[sortKey] = { label, items: [], sortKey };
      }
      monthMap[sortKey].items.push(enriched);
    });

    // 按月份倒序排列
    return Object.values(monthMap).sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  },

  formatDate(date) {
    const d = new Date(date);
    const MM = (d.getMonth() + 1).toString().padStart(2, '0');
    const DD = d.getDate().toString().padStart(2, '0');
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${MM}-${DD} ${hh}:${mm}`;
  },

  // 统一更新 tabBar badge（所有角色共用）
  async updateBadge() {
    const role = wx.getStorageSync('userRole') || '';
    if (!role) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: { action: 'pendingCount', role }
      });
      if (res.result.code === 0) {
        const count = res.result.data.count;
        if (typeof this.getTabBar === 'function' && this.getTabBar()) {
          this.getTabBar().setData({ badgeValue: count });
        }
      }
    } catch (e) {
      console.error('更新badge失败:', e);
    }
  },

  // 仓管/管理员：加载流程待办
  async loadWorkflows() {
    this.setData({ loading: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: {
          action: 'workflowList',
          role: this.data.role,
          includeCompleted: true
        }
      });

      if (res.result.code === 0) {
        const { pending = [], stored = [], billing = [], completed = [] } = res.result.data || {};

        const processList = (list) => list.map(item => {
          const timeline = item.timeline || [];
          const activeNode = timeline.find(n => n.status === 'active');
          const nodeCode = activeNode ? activeNode.nodeCode : '';
          const btnMap = { pickup: '确认入库', yiwu_entry: '确认出库', mainline: '确认到达' };
          return { ...item, currentNodeCode: nodeCode, advanceButtonText: btnMap[nodeCode] || '推进节点' };
        });

        const pendingList = processList(pending);
        const storedList = processList(stored);
        const billList = processList(billing);
        const completedList = processList(completed);

        this.setData({
          shipments: pendingList,
          storedShipments: storedList,
          billShipments: billList,
          completedShipments: completedList
        });

        // 同步更新 tabBar badge（统一用 pendingCount）
        this.updateBadge();
      } else {
        wx.showToast({ title: res.result.message || '加载失败', icon: 'none' });
      }
    } catch (e) {
      console.error('加载流程失败:', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }

    this.setData({ loading: false });
  },

  switchTab(e) {
    const { tab } = e.currentTarget.dataset;
    this.setData({ activeTab: tab });
  },

  // 查看详情
  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/index?id=${id}` });
  },

  // 推进OA流程
  async advanceOA(e) {
    const { id, action } = e.currentTarget.dataset;
    const { role } = this.data;

    if (action === 'measure_price') {
      wx.navigateTo({ url: `/pages/admin/measure/index?shipmentId=${id}` });
    } else if (action === 'admin_confirm') {
      wx.showModal({
        title: '管理员确认',
        content: '确认货物信息和价格无误？',
        success: (res) => {
          if (res.confirm) this.doAdvanceOA(id, 'adminConfirm');
        }
      });
    } else if (action === 'mark_delivered') {
      wx.showModal({
        title: '确认送达',
        content: '确认货物已送达目标仓库？',
        success: (res) => {
          if (res.confirm) this.doAdvanceOA(id, 'markDelivered');
        }
      });
    } else if (action === 'mark_spot_paid') {
      wx.showModal({
        title: '标记现结收款',
        content: '确认已现场收到款项？',
        success: (res) => {
          if (res.confirm) this.doAdvanceOA(id, 'markSpotPaid');
        }
      });
    }
  },

  async doAdvanceOA(shipmentId, oaAction) {
    wx.showLoading({ title: '处理中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-update',
        data: {
          action: 'advanceOa',
          shipmentId,
          data: { oaAction }
        }
      });

      wx.hideLoading();

      if (res.result.code === 0) {
        wx.showToast({ title: '操作成功', icon: 'success' });
        this.loadWorkflows();
      } else {
        wx.showToast({ title: res.result.message || '操作失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 管理员删除运单
  async deleteShipment(e) {
    const id = e.currentTarget.dataset.id;
    const { isAdmin } = this.data;
    if (!isAdmin) {
      wx.showToast({ title: '仅限管理员', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认删除',
      content: '删除后不可恢复，是否确认？',
      confirmColor: '#E53935',
      success: (res) => {
        if (res.confirm) this.doDelete(id);
      }
    });
  },

  async doDelete(shipmentId) {
    wx.showLoading({ title: '删除中...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-update',
        data: { action: 'delete', shipmentId }
      });
      wx.hideLoading();
      if (res.result.code === 0) {
        wx.showToast({ title: '已删除', icon: 'success' });
        this.loadData();
      } else {
        wx.showToast({ title: res.result.message || '删除失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  // 节点文案映射
  nodeButtonMap: {
    pickup: '确认入库',
    yiwu_entry: '确认出库',
    mainline: '确认到达'
  },

  // 推进物流节点
  async advanceNode(e) {
    const id = e.currentTarget.dataset.id;
    wx.showLoading({ title: '推进中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-update',
        data: {
          action: 'advanceNode',
          shipmentId: id
        }
      });

      wx.hideLoading();

      if (res.result.code === 0) {
        wx.showToast({ title: '节点已推进', icon: 'success' });
        this.loadData();
      } else {
        wx.showToast({ title: res.result.message || '推进失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '推进失败', icon: 'none' });
    }
  },

  // 管理员发送账单
  async sendBill(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '发送账单',
      content: '确认发送账单给客户？',
      success: (res) => {
        if (res.confirm) this.doSendBill(id);
      }
    });
  },

  async doSendBill(shipmentId) {
    wx.showLoading({ title: '发送中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-update',
        data: {
          action: 'advanceOa',
          shipmentId,
          data: { oaAction: 'sendBill' }
        }
      });

      wx.hideLoading();

      if (res.result.code === 0) {
        wx.showToast({ title: '账单已发送', icon: 'success' });
        this.loadWorkflows();
      } else {
        wx.showToast({ title: res.result.message || '发送失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '发送失败', icon: 'none' });
    }
  },

  onPullDownRefresh() {
    this.loadData().then(() => {
      wx.stopPullDownRefresh();
    });
  }
});
