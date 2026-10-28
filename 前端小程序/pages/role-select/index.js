const app = getApp();

const PRESET_LOGIN_NAMES = {
  'admin:18268685702': '管理员1',
  'warehouse:18268685702': '虞一超',
  'admin:18005745533': '虞宏伟',
  'admin:15557041311': '姚慧',
};

Page({
  data: {
    showLoginForm: false,
    selectedRole: '',
    selectedRoleName: '',
    isAdmin: false,
    needsPassword: false,
    phone: '',
    password: '',
    name: '',
    loggingIn: false,
    agreementChecked: false
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

    const roleNameMap = {
      salesman: '业务员',
      warehouse: '接单员',
      admin: '管理员'
    };

    this.setData({
      showLoginForm: true,
      selectedRole: role,
      selectedRoleName: roleNameMap[role] || role,
      isAdmin: role === 'admin',
      needsPassword: role === 'admin' || role === 'warehouse',
      phone: '',
      password: '',
      name: '',
      agreementChecked: false
    });
  },

  goBack() {
    this.setData({
      showLoginForm: false,
      selectedRole: '',
      selectedRoleName: '',
      isAdmin: false,
      needsPassword: false,
      phone: '',
      password: '',
      name: '',
      agreementChecked: false
    });
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

  onAgreementChange(e) {
    const values = e.detail.value || [];
    this.setData({ agreementChecked: values.includes('agreed') });
  },

  openServiceAgreement() {
    wx.navigateTo({ url: '/pages/agreement/index' });
  },

  openPrivacyPolicy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },

  ensureAgreement() {
    if (this.data.agreementChecked) return true;
    wx.showToast({ title: '请先阅读并同意协议', icon: 'none' });
    return false;
  },

  validatePresetAccountName(role, phone, name) {
    const expectedName = PRESET_LOGIN_NAMES[`${role}:${phone}`];
    if (!expectedName) return true;
    if (String(name || '').trim() === expectedName) return true;
    wx.showToast({ title: '姓名、手机号或密码不匹配', icon: 'none' });
    return false;
  },

  // 管理员/接单员手动登录（手机号+密码）
  async doLogin() {
    const { selectedRole, phone, password, name, needsPassword, loggingIn } = this.data;
    if (loggingIn) return;
    if (!this.ensureAgreement()) return;

    if (!phone || phone.length < 11) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }

    if (needsPassword && !password) {
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }
    if (!name.trim()) {
      wx.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }
    if (!this.validatePresetAccountName(selectedRole, phone, name)) {
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
    if (!this.ensureAgreement()) return;

    if (!phone || phone.length < 11) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }
    if (!name.trim()) {
      wx.showToast({ title: '请输入姓名', icon: 'none' });
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
