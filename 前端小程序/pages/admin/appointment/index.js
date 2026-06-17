Page({
  data: {
    loading: false,
    activeTab: 'pending',
    pendingShipments: [],
    completedShipments: [],
    showModal: false,
    currentShipment: null,
    appointmentForm: {
      date: '',
      time: ''
    }
  },

  onLoad() {
    const role = wx.getStorageSync('userRole') || '';
    if (role !== 'warehouse') {
      wx.showToast({ title: '请切换接单员操作预约', icon: 'none' });
      setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 1200);
      return;
    }
    this.initDefaultForm();
  },

  onShow() {
    const role = wx.getStorageSync('userRole') || '';
    if (role !== 'warehouse') return;

    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ activeIndex: 3 });
      if (this.getTabBar().loadBadge) this.getTabBar().loadBadge();
    }
    this.loadAppointments();
  },

  onPullDownRefresh() {
    this.loadAppointments().then(() => wx.stopPullDownRefresh());
  },

  initDefaultForm() {
    this.setData({
      appointmentForm: {
        date: this.getTodayDate(),
        time: this.getNowTime()
      }
    });
  },

  async loadAppointments() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: { action: 'appointmentList', role: 'warehouse' }
      });

      if (res.result.code === 0) {
        const data = res.result.data || {};
        this.setData({
          pendingShipments: this.normalizeList(data.pending || []),
          completedShipments: this.normalizeList(data.completed || [])
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

  normalizeList(list) {
    return list.map(item => {
      const scheduledAt = item.warehouseAppointment?.scheduledAt || '';
      const completed = !!(item.warehouseAppointment?.isCompleted && scheduledAt);
      return {
        ...item,
        creatorRoleLabel: item.creatorRole === 'admin' ? '建单管理员' : '建单业务员',
        appointmentTimeText: completed ? this.formatAppointmentTime(scheduledAt) : '',
        appointmentTagText: completed ? `已预约：${this.formatAppointmentTime(scheduledAt)}` : '暂未完成进仓预约',
        appointmentTagClass: completed ? 'done' : 'pending'
      };
    });
  },

  getTodayDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  getNowTime() {
    const now = new Date();
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    return `${hour}:${minute}`;
  },

  splitAppointmentTime(value) {
    if (!value) return { date: this.getTodayDate(), time: this.getNowTime() };
    const text = String(value).replace('T', ' ').slice(0, 16);
    const parts = text.split(' ');
    return {
      date: parts[0] || this.getTodayDate(),
      time: (parts[1] || this.getNowTime()).slice(0, 5)
    };
  },

  formatAppointmentTime(value) {
    return String(value || '').replace('T', ' ').slice(0, 16);
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  openAppointment(e) {
    const id = e.currentTarget.dataset.id;
    const list = this.data.activeTab === 'completed'
      ? this.data.completedShipments
      : this.data.pendingShipments;
    const shipment = list.find(item => item._id === id);
    if (!shipment) return;

    const appointmentTime = this.splitAppointmentTime(shipment.warehouseAppointment?.scheduledAt);
    this.setData({
      currentShipment: shipment,
      showModal: true,
      appointmentForm: appointmentTime
    });
  },

  closeModal() {
    this.setData({ showModal: false, currentShipment: null });
    this.initDefaultForm();
  },

  noop() {},

  onAppointmentDateChange(e) {
    this.setData({ 'appointmentForm.date': e.detail.value });
  },

  onAppointmentTimeChange(e) {
    this.setData({ 'appointmentForm.time': e.detail.value });
  },

  async saveAppointment() {
    const { currentShipment, appointmentForm } = this.data;
    if (!currentShipment) return;
    if (!appointmentForm.date || !appointmentForm.time) {
      wx.showToast({ title: '请选择预约日期和时间', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-update',
        data: {
          action: 'updateInfo',
          shipmentId: currentShipment._id,
          data: {
            warehouseAppointment: {
              scheduledAt: `${appointmentForm.date} ${appointmentForm.time}`
            }
          }
        }
      });

      wx.hideLoading();
      if (res.result.code === 0) {
        wx.showToast({ title: '预约已保存', icon: 'success' });
        this.closeModal();
        this.loadAppointments();
      } else {
        wx.showToast({ title: res.result.message || '保存失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/index?id=${id}` });
  },

  refreshTabBadge() {
    if (typeof this.getTabBar === 'function' && this.getTabBar() && this.getTabBar().loadBadge) {
      this.getTabBar().loadBadge();
    }
  }
});
