// pages/log/index.js
// ============================================================
// 操作日志页：按类型筛选、按日期分组展示出入库记录
// 数据来源：utils/store.js
// ============================================================

const store = require('../../utils/store.js')

/** 类型筛选项 */
const TYPE_TABS = [
  { key: 'all', label: '全部' },
  { key: 'in', label: '入库' },
  { key: 'out', label: '出库' },
  { key: 'pick', label: '领料' }
]

/** 生产任务领料：type 记为出库，靠 taskId 区分 */
function isPick(record) {
  return record.type === 'out' && !!record.taskId
}

/**
 * 按日期把记录分组
 * @param {Array} records 已按时间倒序排列的记录
 * @returns {Array<{label: string, list: Array}>}
 */
function groupByDay(records) {
  const groups = []
  let currentLabel = ''

  records.forEach((record) => {
    const label = store.formatDayLabel(record.createdAt)
    if (label !== currentLabel) {
      groups.push({ label, list: [] })
      currentLabel = label
    }
    groups[groups.length - 1].list.push(record)
  })

  return groups
}

Page({
  data: {
    type: 'all',
    typeTabs: TYPE_TABS,
    groups: [],
    // 统计
    summary: {
      total: 0,
      inbound: 0,
      outbound: 0,
      pick: 0
    }
  },

  onLoad(options) {
    // 支持从首页领料明细带参数进入，直接定位到对应筛选
    const type = (options && options.type) || ''
    if (type && TYPE_TABS.some((item) => item.key === type)) {
      this.setData({ type })
    }
    this.refresh()
  },

  onShow() {
    // 出入库后返回本页需要看到最新记录
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  /** 重新加载记录 */
  refresh() {
    const all = store.listRecords({})
    const type = this.data.type
    // 出库与领料分开统计，避免「领料」既算出库又算领料导致重复计数
    const records = all.filter((item) => {
      if (type === 'all') return true
      if (type === 'pick') return isPick(item)
      if (type === 'out') return item.type === 'out' && !isPick(item)
      return item.type === type
    })

    const inbound = all.filter((item) => item.type === 'in').length
    const pick = all.filter(isPick).length
    const outbound = all.filter((item) => item.type === 'out').length - pick

    this.setData({
      groups: groupByDay(records),
      summary: {
        total: all.length,
        inbound,
        outbound,
        pick
      }
    })
  },

  handleTypeTap(e) {
    const { key } = e.currentTarget.dataset
    if (key === this.data.type) return
    this.setData({ type: key }, () => this.refresh())
  },

  /** 点击记录查看详情 */
  handleRecordTap(e) {
    const { dateIndex, index } = e.currentTarget.dataset
    const group = this.data.groups[dateIndex]
    if (!group) return
    const record = group.list[index]
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
    if (record.taskId) lines.push(`生产任务：${record.taskId}`)
    if (record.detailText) lines.push('', '领用物料：', record.detailText)
    lines.push(`备注：${record.remark || '无'}`)

    wx.showModal({
      title: `${record.typeText}详情`,
      content: lines.join('\n'),
      showCancel: false,
      confirmText: '知道了'
    })
  }
})
