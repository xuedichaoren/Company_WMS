// pages/index/index.js
// ============================================================
// 首页：仓库概览、扫码入口、快捷操作、最近操作记录
// 数据来源：本文件内的静态模拟数据
// ============================================================

const app = getApp()

// ============================================================
// 静态模拟数据（纯前端演示）
// 说明：不请求任何后端接口，后续接入真实接口时，
// 保持下方字段结构不变，把常量替换为接口返回值即可。
// ============================================================

/** 仓库概览 */
const overview = {
  warehouseName: '华东一号仓',
  /** 顶部数据卡片，按展示顺序排列 */
  stats: [
    { key: 'inbound', label: '今日入库', value: 12, unit: '单' },
    { key: 'outbound', label: '今日出库', value: 9, unit: '单' },
    { key: 'stock', label: '在库商品', value: 1286, unit: '件' },
    { key: 'warning', label: '库存预警', value: 5, unit: '项' }
  ]
}

/** 最近操作记录：type 为 in(入库) / out(出库)，按时间从新到旧排列 */
const recentRecords = [
  {
    id: 'IN-20261027-001',
    type: 'in',
    typeText: '入库',
    title: '无线蓝牙耳机',
    sku: 'SKU-10086',
    spec: '白色 / 标准版',
    quantity: 100,
    unit: '件',
    operator: '张伟',
    location: 'A-01-03',
    time: '10:32'
  },
  {
    id: 'OUT-20261027-004',
    type: 'out',
    typeText: '出库',
    title: '机械键盘 K8',
    sku: 'SKU-10021',
    spec: '87 键 / 黑色',
    quantity: 20,
    unit: '件',
    operator: '李娜',
    location: 'B-02-01',
    time: '09:58'
  },
  {
    id: 'IN-20261027-002',
    type: 'in',
    typeText: '入库',
    title: '智能手环 5',
    sku: 'SKU-10056',
    spec: '深空灰',
    quantity: 60,
    unit: '件',
    operator: '张伟',
    location: 'A-02-01',
    time: '09:15'
  },
  {
    id: 'OUT-20261027-003',
    type: 'out',
    typeText: '出库',
    title: '快充数据线',
    sku: 'SKU-10008',
    spec: 'Type-C / 1.5m',
    quantity: 150,
    unit: '件',
    operator: '王强',
    location: 'C-01-02',
    time: '08:47'
  },
  {
    id: 'IN-20261026-018',
    type: 'in',
    typeText: '入库',
    title: '无线鼠标 M3',
    sku: 'SKU-10033',
    spec: '2.4G / 黑色',
    quantity: 80,
    unit: '件',
    operator: '李娜',
    location: 'B-01-02',
    time: '昨天 17:20'
  }
]

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
const READY_PAGES = []

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
    // 当前登录用户（来自全局数据，后续接入登录页后替换）
    userName: '',
    userRole: '',
    // 动态问候语与日期
    greeting: '',
    dateText: '',
    // 仓库概览与最近操作记录
    overview: {
      warehouseName: '',
      stats: []
    },
    records: [],
    // 快捷操作配置（静态，无需每次 setData）
    actions: ACTIONS
  },

  onLoad() {
    this.loadData()
  },

  onShow() {
    // 从其他页面返回时刷新问候语和日期，避免跨天显示错误
    this.setData({
      greeting: getGreeting(new Date().getHours()),
      dateText: formatDate(new Date())
    })
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
    this.setData({
      userName: app.globalData.userInfo.name,
      userRole: app.globalData.userInfo.role,
      greeting: getGreeting(now.getHours()),
      dateText: formatDate(now),
      overview,
      records: recentRecords
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
   * 点击最近操作记录，弹窗查看详情
   */
  handleRecordTap(e) {
    const { index } = e.currentTarget.dataset
    const record = this.data.records[index]
    if (!record) return

    wx.showModal({
      title: `${record.typeText}详情`,
      content: [
        `商品：${record.title}`,
        `SKU：${record.sku}`,
        `规格：${record.spec}`,
        `数量：${record.quantity}${record.unit}`,
        `库位：${record.location}`,
        `操作人：${record.operator}`,
        `时间：${record.time}`
      ].join('\n'),
      showCancel: false,
      confirmText: '知道了'
    })
  }
})
