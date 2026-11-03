// app.js
// ============================================================
// WMS 仓储管理小程序入口
// 说明：当前为纯前端演示版本，不依赖后端接口与云开发
// ============================================================

const store = require('./utils/store.js')

App({
  /**
   * 全局数据
   * userInfo 在 onLaunch 与登录成功后与 utils/store.js 中的登录态保持同步
   */
  globalData: {
    userInfo: {
      name: '张伟',
      role: '仓管员'
    },
    warehouse: {
      id: 'WH-001',
      name: '华东一号仓'
    },
    /** 是否已登录（演示版允许游客浏览首页） */
    logged: false
  },

  onLaunch() {
    // 纯前端演示：暂不需要发起网络请求或初始化云开发
    this.syncUser()
    console.log('[WMS] 小程序启动')
  },

  /** 把本地登录态同步到 globalData */
  syncUser() {
    const user = store.getUser()
    if (!user) {
      this.globalData.logged = false
      return null
    }
    this.globalData.logged = true
    this.globalData.userInfo = {
      name: user.name || '仓管员',
      role: user.role || '仓管员',
      account: user.account || ''
    }
    return this.globalData.userInfo
  }
})
