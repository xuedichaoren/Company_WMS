// pages/login/index.js
// ============================================================
// 登录页：演示版账号登录，登录态写入 utils/store.js
// ============================================================

const app = getApp()
const store = require('../../utils/store.js')

/** 演示账号：工号 → 姓名 / 角色 */
const DEMO_ACCOUNTS = {
  admin: { name: '张伟', role: '仓管员' },
  lina: { name: '李娜', role: '仓管员' },
  wangqiang: { name: '王强', role: '主管' }
}

/** 演示密码 */
const DEMO_PASSWORD = '123456'

Page({
  data: {
    account: '',
    password: '',
    showPwd: false,
    // 快捷账号，点了直接填入工号
    demoAccounts: [
      { account: 'admin', name: '张伟', role: '仓管员' },
      { account: 'lina', name: '李娜', role: '仓管员' },
      { account: 'wangqiang', name: '王强', role: '主管' }
    ],
    // 已登录用户（用于展示「退出登录」）
    currentUser: null,
    submitting: false
  },

  onShow() {
    this.setData({ currentUser: store.getUser() })
  },

  handleAccountInput(e) {
    this.setData({ account: e.detail.value })
  },

  handlePasswordInput(e) {
    this.setData({ password: e.detail.value })
  },

  togglePwd() {
    this.setData({ showPwd: !this.data.showPwd })
  },

  /** 点击演示账号，自动填入工号 */
  handleDemoTap(e) {
    const { account } = e.currentTarget.dataset
    this.setData({ account })
  },

  /** 一键填充演示账号与密码 */
  handleQuickFill() {
    this.setData({ account: 'admin', password: DEMO_PASSWORD })
    wx.showToast({ title: '已填入演示账号', icon: 'none' })
  },

  /** 登录 */
  handleLogin() {
    if (this.data.submitting) return

    const account = this.data.account.trim()
    const password = this.data.password

    if (!account) {
      wx.showToast({ title: '请输入工号', icon: 'none' })
      return
    }
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' })
      return
    }
    if (password !== DEMO_PASSWORD) {
      wx.showToast({ title: '密码错误，演示密码 123456', icon: 'none' })
      return
    }

    const preset = DEMO_ACCOUNTS[account.toLowerCase()]
    const user = {
      account,
      name: preset ? preset.name : account,
      role: preset ? preset.role : '仓管员',
      loginAt: Date.now()
    }

    this.setData({ submitting: true })
    store.setUser(user)
    app.syncUser()

    wx.showToast({ title: '登录成功', icon: 'success' })

    setTimeout(() => {
      this.setData({ submitting: false })
      // 从首页跳进来时直接返回，避免页面栈里堆积重复首页
      if (getCurrentPages().length > 1) {
        wx.navigateBack()
      } else {
        wx.reLaunch({ url: '/pages/index/index' })
      }
    }, 600)
  },

  /** 退出登录 */
  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后可继续以游客身份浏览首页，是否退出？',
      confirmText: '退出',
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return
        store.clearUser()
        app.syncUser()
        this.setData({ currentUser: null, account: '', password: '' })
        wx.showToast({ title: '已退出登录', icon: 'success' })
      }
    })
  },

  /** 游客身份进入首页 */
  handleSkip() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
      return
    }
    wx.reLaunch({ url: '/pages/index/index' })
  }
})
