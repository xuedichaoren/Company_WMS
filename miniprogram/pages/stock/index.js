// pages/stock/index.js
// ============================================================
// 库存查询页：搜索 / 状态筛选 / 库存汇总 / 快捷出入库
// 数据来源：utils/store.js
// ============================================================

const store = require('../../utils/store.js')

/** 状态筛选项 */
const STATUS_TABS = [
  { key: 'all', label: '全部' },
  { key: 'normal', label: '正常' },
  { key: 'warning', label: '预警' },
  { key: 'empty', label: '缺货' }
]

Page({
  data: {
    keyword: '',
    status: 'all',
    statusTabs: STATUS_TABS,
    goodsList: [],
    // 汇总数据
    summary: {
      kinds: 0,
      total: 0,
      warning: 0
    }
  },

  onLoad(options) {
    if (options && options.code) {
      this.setData({ keyword: decodeURIComponent(options.code) })
    }
    this.refresh()
  },

  onShow() {
    // 出入库后库存变化，返回本页时刷新
    this.refresh()
  },

  /** 重新加载列表与汇总 */
  refresh() {
    const all = store.listGoods({})
    const goodsList = store.listGoods({
      keyword: this.data.keyword,
      status: this.data.status
    })

    this.setData({
      goodsList,
      summary: {
        kinds: all.length,
        total: all.reduce((sum, item) => sum + item.stock, 0),
        warning: all.filter((item) => item.status !== 'normal').length
      }
    })
  },

  handleKeywordInput(e) {
    this.setData({ keyword: e.detail.value }, () => this.refresh())
  },

  handleClear() {
    this.setData({ keyword: '' }, () => this.refresh())
  },

  handleStatusTap(e) {
    const { key } = e.currentTarget.dataset
    if (key === this.data.status) return
    this.setData({ status: key }, () => this.refresh())
  },

  /** 点击商品：查看详情 / 快捷出入库 */
  handleGoodsTap(e) {
    const goods = this.data.goodsList[e.currentTarget.dataset.index]
    if (!goods) return

    wx.showActionSheet({
      itemList: ['入库该商品', '出库该商品', '查看库存详情'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.goRecordPage('inbound', goods)
          return
        }
        if (res.tapIndex === 1) {
          if (goods.stock <= 0) {
            wx.showToast({ title: '该商品已无库存', icon: 'none' })
            return
          }
          this.goRecordPage('outbound', goods)
          return
        }
        this.showDetail(goods)
      },
      fail: () => {}
    })
  },

  /** 跳转入库 / 出库页并带入商品条码 */
  goRecordPage(page, goods) {
    const code = goods.barCode || goods.sku
    wx.navigateTo({
      url: `/pages/${page}/index?code=${encodeURIComponent(code)}`
    })
  },

  /** 库存详情弹窗 */
  showDetail(goods) {
    wx.showModal({
      title: goods.title,
      content: [
        `SKU：${goods.sku}`,
        `条码：${goods.barCode || '未设置'}`,
        `规格：${goods.spec}`,
        `分类：${goods.category}`,
        `库位：${goods.location || '未设置'}`,
        `当前库存：${goods.stock}${goods.unit}`,
        `安全库存：${goods.safeStock}${goods.unit}`,
        `单价：¥${goods.price}`,
        `库存金额：¥${(goods.price * goods.stock).toFixed(2)}`
      ].join('\n'),
      showCancel: false,
      confirmText: '知道了'
    })
  }
})
