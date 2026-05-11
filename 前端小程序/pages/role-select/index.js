const app = getApp();

Page({
  data: {
    showLoginForm: false,
    selectedRole: '',
    selectedRoleName: '',
    isAdmin: false,
    phone: '',
    password: '',
    name: '',
    loggingIn: false,
    useManualInput: false
  },

  onLoad() {
    // 如果已有角色和手机号，直接跳转
    const role = wx.getStorageSync('userRole');
    const phone = wx.getStorageSync('userPhone');
    if (role && phone) {
      this.navigateByRole(role);
    }
  },

  selectRole(e) {
    const { role } = e.currentTarget.dataset;

    // ===== 测试模式：直接登录，固定姓名 =====
    this.completeLogin(role, '13800000000', '系统用户');
    // ===== 测试模式结束 =====

    /* ===== 正常登录方式（恢复时请取消注释） =====
    const roleNameMap = {
      salesman: '业务员',
      warehouse: '仓管员',
      admin: '管理员'
    };

    this.setData({
      showLoginForm: true,
      selectedRole: role,
      selectedRoleName: roleNameMap[role] || role,
      isAdmin: role === 'admin',
      phone: '',
      password: '',
      name: '',
      useManualInput: false
    });
    ===== 正常登录方式结束 ===== */
  },

  goBack() {
    this.setData({
      showLoginForm: false,
      selectedRole: '',
      selectedRoleName: '',
      isAdmin: false,
      phone: '',
      password: '',
      name: '',
      useManualInput: false
    });
  },

  switchToManual() {
    this.setData({ useManualInput: true, phone: '' });
  },

  switchToWechat() {
    this.setData({ useManualInput: false, phone: '' });
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value });
  },

  // 微信一键登录：获取手机号
  async onGetPhoneNumber(e) {
    const { selectedRole, name } = this.data;

    if (e.detail.errMsg && e.detail.errMsg.includes('deny')) {
      wx.showToast({ title: '需要授权手机号才能登录', icon: 'none' });
      return;
    }

    if (!e.detail.cloudID) {
      // 开发工具中无法获取 cloudID，提示使用手动输入
      wx.showModal({
        title: '提示',
        content: '微信一键登录需在真机上使用。\n开发调试请切换为「手机号登录」',
        showCancel: false,
        confirmText: '我知道了'
      });
      return;
    }

    this.setData({ loggingIn: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'user-login',
        data: {
          action: 'getPhone',
          role: selectedRole,
          cloudID: e.detail.cloudID,
          name
        }
      });

      if (res.result.code === 0) {
        const { phone } = res.result.data;
        await this.completeLogin(selectedRole, phone);
      } else {
        wx.showToast({ title: res.result.message || '登录失败', icon: 'none' });
        this.setData({ loggingIn: false });
      }
    } catch (err) {
      wx.showToast({ title: '登录失败，请重试', icon: 'none' });
      this.setData({ loggingIn: false });
    }
  },

  // 管理员手动登录（手机号+密码）
  async doLogin() {
    const { selectedRole, phone, password, name, isAdmin, loggingIn } = this.data;
    if (loggingIn) return;

    if (!phone || phone.length < 11) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }

    if (isAdmin && !password) {
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }

    this.setData({ loggingIn: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'user-login',
        data: {
          action: 'login',
          role: selectedRole,
          phone,
          password: password || undefined,
          name
        }
      });

      if (res.result.code === 0) {
        await this.completeLogin(selectedRole, phone, res.result.data?.name || name);
      } else {
        wx.showToast({ title: res.result.message || '登录失败', icon: 'none' });
        this.setData({ loggingIn: false });
      }
    } catch (e) {
      console.error('登录异常:', e);
      wx.showToast({ title: e.message || '网络错误，请重试', icon: 'none' });
      this.setData({ loggingIn: false });
    }
  },

  // 非管理员手动登录（仅手机号）
  async doLoginManual() {
    const { selectedRole, phone, name, loggingIn } = this.data;
    if (loggingIn) return;

    if (!phone || phone.length < 11) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }

    this.setData({ loggingIn: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'user-login',
        data: {
          action: 'login',
          role: selectedRole,
          phone,
          name
        }
      });

      if (res.result.code === 0) {
        await this.completeLogin(selectedRole, phone, res.result.data?.name || name);
      } else {
        wx.showToast({ title: res.result.message || '登录失败', icon: 'none' });
        this.setData({ loggingIn: false });
      }
    } catch (e) {
      console.error('登录异常:', e);
      wx.showToast({ title: e.message || '网络错误，请重试', icon: 'none' });
      this.setData({ loggingIn: false });
    }
  },

  // 登录成功后的统一处理
  async completeLogin(role, phone, name) {
    wx.setStorageSync('userRole', role);
    wx.setStorageSync('userPhone', phone);
    if (name) wx.setStorageSync('userName', name);
    app.globalData.role = role;
    app.globalData.phone = phone;
    app.globalData.name = name || '';
    if (app.setUserInfo) {
      app.setUserInfo({ role, phone, name });
    }

    wx.showToast({ title: '登录成功', icon: 'success' });
    setTimeout(() => {
      this.navigateByRole(role);
    }, 800);
  },

  navigateByRole(role) {
    // 所有角色统一进入主页（查单页），通过主页功能入口访问各自模块
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
