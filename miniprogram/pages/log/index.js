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
  { key: 'out', label: '出库' }
]

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
      outbound: 0
    }
  },

  onLoad() {
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
    const records = this.data.type === 'all' ? all : all.filter((item) => item.type === this.data.type)

    this.setData({
      groups: groupByDay(records),
      summary: {
        total: all.length,
        inbound: all.filter((item) => item.type === 'in').length,
        outbound: all.filter((item) => item.type === 'out').length
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

    wx.showModal({
      title: `${record.typeText}详情`,
      content: [
        `单号：${record.id}`,
        `商品：${record.title}`,
        `SKU：${record.sku}`,
        `规格：${record.spec}`,
        `数量：${record.quantity}${record.unit}`,
        `库位：${record.location || '未设置'}`,
        `操作人：${record.operator}`,
        `时间：${record.time}`,
        `备注：${record.remark || '无'}`
      ].join('\n'),
      showCancel: false,
      confirmText: '知道了'
    })
  }
})
