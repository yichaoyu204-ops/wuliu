const app = getApp();

Page({
  data: {
    categories: [],
    loading: true,
    showAddModal: false,
    submitting: false,
    // 新增表单
    form: {
      name: '',
      type: '',
      calculationType: 'manual',
      basePrice: '',
      unitPrice: '',
      unit: '元',
      freeDays: '',
      isRequired: false,
      allowManualAmount: true,
      sortOrder: '50',
      description: ''
    },
    calcTypeOptions: [
      { label: '固定金额', value: 'fixed' },
      { label: '按件计费', value: 'per_piece' },
      { label: '按体积计费', value: 'per_volume' },
      { label: '按重量计费', value: 'per_weight' },
      { label: '按体积×天数', value: 'per_volume_per_day' },
      { label: '手动输入', value: 'manual' }
    ],
    calcTypeLabel: '手动输入'
  },

  onLoad() {
    this.loadCategories();
  },


  async loadCategories() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'fee-config',
        data: { action: 'list' }
      });
      if (res.result.code === 0) {
        this.setData({ categories: res.result.data || [], loading: false });
      } else {
        this.showError(res.result.message || '加载失败');
        this.setData({ loading: false });
      }
    } catch (e) {
      this.showError('网络错误，请重试');
      this.setData({ loading: false });
    }
  },

  // 切换启用/禁用
  async toggleEnabled(e) {
    const { id, enabled } = e.currentTarget.dataset;
    const action = enabled ? '禁用' : '启用';

    wx.showModal({
      title: `确认${action}`,
      content: `${action}后，新建报价单将不再显示此类目`,
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const result = await wx.cloud.callFunction({
            name: 'fee-config',
            data: { action: 'update', id, data: { isEnabled: !enabled } }
          });
          if (result.result.code === 0) {
            wx.showToast({ title: `已${action}`, icon: 'success' });
            this.loadCategories();
          } else {
            this.showError(result.result.message);
          }
        } catch (e) {
          this.showError('操作失败，请重试');
        }
      }
    });
  },

  // 修改排序权重
  async updateSort(e) {
    const { id } = e.currentTarget.dataset;
    const sortOrder = parseInt(e.detail.value);
    if (isNaN(sortOrder) || sortOrder < 0) return;

    try {
      await wx.cloud.callFunction({
        name: 'fee-config',
        data: { action: 'update', id, data: { sortOrder } }
      });
      this.loadCategories();
    } catch (e) {
      this.showError('保存失败');
    }
  },

  openAddModal() {
    this.setData({
      showAddModal: true,
      form: {
        name: '', type: '', calculationType: 'manual',
        basePrice: '', unitPrice: '', unit: '元',
        freeDays: '', isRequired: false, allowManualAmount: true,
        sortOrder: '50', description: ''
      },
      calcTypeLabel: '手动输入'
    });
  },

  closeModal() {
    this.setData({ showAddModal: false });
  },

  onFormInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  getCalcTypeLabel(calcType) {
    const opt = this.data.calcTypeOptions.find(o => o.value === calcType);
    return opt ? opt.label : '手动输入';
  },

  onCalcTypeChange(e) {
    const calcType = this.data.calcTypeOptions[e.detail.value].value;
    this.setData({
      'form.calculationType': calcType,
      'form.allowManualAmount': calcType === 'manual',
      calcTypeLabel: this.getCalcTypeLabel(calcType)
    });
  },

  onRequiredChange(e) {
    this.setData({ 'form.isRequired': e.detail.value });
  },

  async submitAdd() {
    const { form } = this.data;
    if (!form.name.trim()) {
      wx.showToast({ title: '请填写类目名称', icon: 'none' }); return;
    }
    if (!form.type.trim()) {
      wx.showToast({ title: '请填写类型标识', icon: 'none' }); return;
    }

    this.setData({ submitting: true });
    try {
      const data = {
        ...form,
        basePrice: form.basePrice ? parseFloat(form.basePrice) : null,
        unitPrice: form.unitPrice ? parseFloat(form.unitPrice) : null,
        freeDays: form.freeDays ? parseInt(form.freeDays) : null,
        sortOrder: parseInt(form.sortOrder) || 50
      };

      const res = await wx.cloud.callFunction({
        name: 'fee-config',
        data: { action: 'create', data }
      });

      if (res.result.code === 0) {
        wx.showToast({ title: '创建成功', icon: 'success' });
        this.setData({ showAddModal: false, submitting: false });
        this.loadCategories();
      } else {
        this.showError(res.result.message || '创建失败');
        this.setData({ submitting: false });
      }
    } catch (e) {
      this.showError('网络错误，请重试');
      this.setData({ submitting: false });
    }
  },

  showError(msg) {
    wx.showToast({ title: msg, icon: 'none', duration: 2500 });
  }
});
