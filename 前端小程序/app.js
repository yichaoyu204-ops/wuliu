// app.js - 小程序入口
// 修改env为你的云环境ID

App({
  globalData: {
    userInfo: null,
    role: null,
    phone: null,
    name: null
  },

  onLaunch() {
    wx.cloud.init({
      env: 'cloud1-d3gv8423598374873',
      traceUser: true
    });

    this.checkLogin();
    this.checkRole();
  },

  checkLogin() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = userInfo;
      this.globalData.role = userInfo.role;
      this.globalData.phone = userInfo.phone;
      this.globalData.name = userInfo.name;
    }
  },

  checkRole() {
    // 角色保存在独立的 storage key 中
    const role = wx.getStorageSync('userRole');
    if (role) {
      this.globalData.role = role;
    }
  },

  setUserInfo(userInfo) {
    this.globalData.userInfo = userInfo;
    this.globalData.role = userInfo.role;
    this.globalData.phone = userInfo.phone;
    this.globalData.name = userInfo.name;
    wx.setStorageSync('userInfo', userInfo);
  }
});
