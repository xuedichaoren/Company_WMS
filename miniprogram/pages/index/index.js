// pages/index/index.js
// ============================================================
// 首页：仓库概览、扫码入口、快捷操作、最近操作记录
// 数据来源：utils/store.js（纯前端演示数据，本地持久化）
// ============================================================

const app = getApp()
const store = require('../../utils/store.js')

/**
 * 快捷操作配置
 * - key：动作标识，与下方 PAGE_ROUTES 对应
 * - icon：使用汉字作为轻量图标，避免引入额外图片资源
 * - color / bg：图标前景色与背景色
 */
const ACTIONS = [
  { key: 'inbound', label: '入库', icon: '入', color: '#16a34a', bg: '#e8f8ee' },
  { key: 'outbound', label: '出库', icon: '出', color: '#f97316', bg: '#fff2e8' },
  { key: 'stock', label: '库存查询', icon: '库', color: '#2f6bff', bg: '#e9f0ff' },
  { key: 'goods', label: '商品管理', icon: '商', color: '#7c3aed', bg: '#f1eafe' },
  { key: 'log', label: '操作日志', icon: '志', color: '#0891b2', bg: '#e6f7fa' }
]

/**
 * 快捷操作对应的页面路径
 * 页面开发完成后，把路径加入 READY_PAGES 即可自动启用跳转，
 * 不需要再改动 handleActionTap 里的逻辑。
 */
const PAGE_ROUTES = {
  inbound: '/pages/inbound/index',
  outbound: '/pages/outbound/index',
  stock: '/pages/stock/index',
  goods: '/pages/goods/index',
  log: '/pages/log/index'
}

/** 已完成开发的页面路径列表（后续开发一个页面就加一条） */
const READY_PAGES = [
  '/pages/login/index',
  '/pages/inbound/index',
  '/pages/outbound/index',
  '/pages/stock/index',
  '/pages/goods/index',
  '/pages/log/index'
]

/** 星期名称，用于日期格式化 */
const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * 根据当前小时返回问候语
 * @param {number} hour 0 - 23
 * @returns {string}
 */
function getGreeting(hour) {
  if (hour < 6) return '凌晨好'
  if (hour < 9) return '早上好'
  if (hour < 12) return '上午好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/**
 * 格式化日期，例如：2026年10月27日 周二
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${year}年${month}月${day}日 ${WEEK_DAYS[date.getDay()]}`
}

Page({
  data: {
    // 当前登录用户（来源：utils/store.js 登录态，未登录时显示游客）
    userName: '',
    userRole: '',
    logged: false,
    // 动态问候语与日期
    greeting: '',
    dateText: '',
    // 仓库概览与最近操作记录
    overview: {
      warehouseName: '',
      stats: []
    },
    records: [],
    // 当前生产任务（来源：utils/store.js，含齐套摘要）
    taskOverview: { task: null },
    // 快捷操作配置（静态，无需每次 setData）
    actions: ACTIONS
  },

  onLoad() {
    this.loadData()
  },

  onShow() {
    // 从其他页面返回时刷新数据、问候语与日期，保证与最新操作同步
    this.loadData()
  },

  /**
   * 下拉刷新：静态数据直接重新加载
   * 接入接口后，可在这里改为重新请求数据
   */
  onPullDownRefresh() {
    this.loadData()
    setTimeout(() => {
      wx.stopPullDownRefresh()
    }, 300)
  },

  /** 加载首页数据 */
  loadData() {
    const now = new Date()
    const user = store.getUser()
    const overview = store.getOverview()

    this.setData({
      logged: !!user,
      userName: user ? user.name : '游客',
      userRole: user ? user.role : '点击登录',
      greeting: getGreeting(now.getHours()),
      dateText: formatDate(now),
      overview: {
        warehouseName: app.globalData.warehouse.name,
        stats: overview.stats
      },
      records: store.listRecords({ limit: 5 }),
      taskOverview: store.getTaskOverview()
    })
  },

  /**
   * 点击顶部用户区域
   * 未登录 → 去登录页；已登录 → 提供切换账号 / 重置演示数据入口
   */
  handleUserTap() {
    if (!this.data.logged) {
      wx.navigateTo({ url: '/pages/login/index' })
      return
    }

    wx.showActionSheet({
      itemList: ['切换账号', '重置演示数据'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: '/pages/login/index' })
          return
        }
        wx.showModal({
          title: '重置演示数据',
          content: '将清空本地物料、BOM、生产任务与出入库记录，恢复初始演示数据，是否继续？',
          confirmText: '重置',
          confirmColor: '#ef4444',
          success: (modalRes) => {
            if (!modalRes.confirm) return
            store.resetDemoData()
            this.loadData()
            wx.showToast({ title: '已恢复初始数据', icon: 'success' })
          }
        })
      },
      fail: () => {}
    })
  },

  /**
   * 点击「扫一扫」：调起微信扫码
   * 支持条形码与二维码，扫码成功后选择后续操作
   */
  handleScan() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['barCode', 'qrCode'],
      success: (res) => {
        const code = (res.result || '').trim()
        if (!code) {
          wx.showToast({ title: '未识别到条码内容', icon: 'none' })
          return
        }
        this.showScanActions(code)
      },
      fail: (err) => {
        // 用户主动取消扫码时不提示
        const message = (err && err.errMsg) || ''
        if (message.indexOf('cancel') === -1) {
          wx.showToast({ title: '扫码失败，请重试', icon: 'none' })
        }
      }
    })
  },

  /**
   * 扫码成功后弹出操作菜单：扫码入库 / 扫码出库 / 查询库存
   * @param {string} code 扫码结果
   */
  showScanActions(code) {
    const scanActions = [
      { key: 'inbound', label: '扫码入库' },
      { key: 'outbound', label: '扫码出库' },
      { key: 'stock', label: '查询库存' }
    ]

    wx.showActionSheet({
      itemList: scanActions.map((item) => item.label),
      success: (res) => {
        const action = scanActions[res.tapIndex]
        if (!action) return

        const route = PAGE_ROUTES[action.key]

        // 目标页面已完成开发时，携带条码跳转
        if (route && READY_PAGES.indexOf(route) !== -1) {
          wx.navigateTo({
            url: `${route}?code=${encodeURIComponent(code)}`
          })
          return
        }

        // 页面尚未开发，先用弹窗展示扫码结果
        wx.showModal({
          title: '已识别条码',
          content: `条码：${code}\n操作：${action.label}（页面开发中）`,
          showCancel: false,
          confirmText: '知道了'
        })
      },
      fail: () => {
        // 用户取消操作菜单，无需处理
      }
    })
  },

  /**
   * 快捷操作点击
   * 未开发的页面统一提示「XX页面开发中」，避免跳转报错
   */
  handleActionTap(e) {
    const { key } = e.currentTarget.dataset
    const action = ACTIONS.find((item) => item.key === key) || { label: '该' }
    const route = PAGE_ROUTES[key]

    if (route && READY_PAGES.indexOf(route) !== -1) {
      wx.navigateTo({ url: route })
      return
    }

    wx.showToast({
      title: `${action.label}页面开发中`,
      icon: 'none'
    })
  },

  /**
   * 点击「当前任务」卡片：进入生产任务与齐套分析页
   */
  handleTaskTap() {
    wx.navigateTo({ url: '/pages/task/index' })
  },

  /**
   * 点击最近操作记录，弹窗查看详情
   */
  handleRecordTap(e) {
    const { index } = e.currentTarget.dataset
    const record = this.data.records[index]
    if (!record) return

    const lines = [
      `单号：${record.id}`,
      `商品：${record.title}`,
      `SKU：${record.sku}`,
      `规格：${record.spec}`,
      `数量：${record.quantity}${record.unit}`,
      `库位：${record.location || '未设置'}`,
      `操作人：${record.operator}`,
      `时间：${record.time}`
    ]
    // 生产领料记录会带上具体领用明细
    if (record.detailText) lines.push('', '领用物料：', record.detailText)
    if (record.remark) lines.push(`备注：${record.remark}`)

    wx.showModal({
      title: `${record.typeText}详情`,
      content: lines.join('\n'),
      showCancel: false,
      confirmText: '知道了'
    })
  }
})
