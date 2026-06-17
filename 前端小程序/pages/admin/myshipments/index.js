Page({
  data: {
    shipments: [],
    shipmentGroups: [],
    loading: false,
    isAdmin: false
  },

  onLoad() {
    this.syncRole();
  },

  onShow() {
    this.syncRole();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ activeIndex: 2 });
      if (this.getTabBar().loadBadge) {
        this.getTabBar().loadBadge();
      }
    }
    this.loadShipments();
  },

  syncRole() {
    const role = wx.getStorageSync('userRole') || '';
    this.setData({ isAdmin: role === 'admin' });
  },

  onPullDownRefresh() {
    this.loadShipments().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadShipments() {
    const role = wx.getStorageSync('userRole') || '';
    const isAdmin = role === 'admin';
    if (isAdmin !== this.data.isAdmin) {
      this.setData({ isAdmin });
    }
    this.setData({ loading: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: {
          action: isAdmin ? 'adminList' : 'myShipments',
          role: isAdmin ? 'admin' : 'salesman'
        }
      });

      if (res.result.code === 0) {
        const shipments = this.normalizeShipments(res.result.data.list || []);
        this.setData({
          shipments,
          shipmentGroups: this.groupShipmentsByMonth(shipments)
        });
        this.refreshTabBadge();
      } else {
        wx.showToast({ title: res.result.message || '加载失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
    }

    this.setData({ loading: false });
  },

  normalizeShipments(list) {
    return list.map(item => {
      const createdTime = this.parseDate(item.createdAt || item._createTime || item.updatedAt);
      const appointment = this.getAppointmentTag(item);
      return {
        ...item,
        creatorRoleLabel: item.creatorRole === 'admin' ? '建单管理员' : '建单业务员',
        _createdTimeValue: createdTime ? createdTime.getTime() : 0,
        _createdTimeText: createdTime ? this.formatDateTime(createdTime) : (item.createdAt || '时间未知'),
        _monthKey: createdTime ? this.formatMonthKey(createdTime) : 'unknown',
        _monthLabel: createdTime ? this.formatMonthLabel(createdTime) : '时间未知',
        _routeLabel: item.routeName || item.routeSnapshot?.name || item.routing?.warehouseName || '义乌专线',
        appointmentTagText: appointment.text,
        appointmentTagClass: appointment.className
      };
    }).sort((a, b) => b._createdTimeValue - a._createdTimeValue);
  },

  getAppointmentTag(item) {
    const scheduledAt = item.warehouseAppointment?.scheduledAt || '';
    if (item.warehouseAppointment?.isCompleted && scheduledAt) {
      return {
        text: `已预约：${String(scheduledAt).replace('T', ' ').slice(0, 16)}`,
        className: 'done'
      };
    }
    return { text: '未预约进仓', className: 'pending' };
  },

  groupShipmentsByMonth(list) {
    const groupMap = {};
    const groups = [];

    list.forEach(item => {
      const monthKey = item._monthKey || 'unknown';
      if (!groupMap[monthKey]) {
        const group = {
          monthKey,
          monthLabel: item._monthLabel || '时间未知',
          list: []
        };
        groupMap[monthKey] = group;
        groups.push(group);
      }
      groupMap[monthKey].list.push(item);
    });

    return groups.map(group => ({
      ...group,
      count: group.list.length
    }));
  },

  parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === 'string') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (value.$date) return this.parseDate(value.$date);
    if (value.seconds || value._seconds) {
      const seconds = value.seconds || value._seconds;
      const nanos = value.nanoseconds || value._nanoseconds || 0;
      return new Date(seconds * 1000 + Math.floor(nanos / 1000000));
    }
    return null;
  },

  formatMonthKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  },

  formatMonthLabel(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}年${month}月`;
  },

  formatDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
  },

  refreshTabBadge() {
    if (typeof this.getTabBar === 'function' && this.getTabBar() && this.getTabBar().loadBadge) {
      this.getTabBar().loadBadge();
    }
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/index?id=${id}` });
  },

  goToCreate() {
    wx.switchTab({ url: '/pages/admin/create/index' });
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
        this.loadShipments();
        this.refreshTabBadge();
      } else {
        wx.showToast({ title: res.result.message || '删除失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  }
});
